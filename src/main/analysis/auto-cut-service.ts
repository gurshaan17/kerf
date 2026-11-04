import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { autoCutCommand, autoCutContext } from '@kerf/engine';
import { secondsToFrames } from '@kerf/model';
import type { Asset, TranscriptSegment } from '@kerf/model';
import {
  autoCutApplySchema,
  autoCutGenerateSchema,
  autoCutProposalSchema,
} from '../../shared/auto-cut';
import type { AutoCutProposal } from '../../shared/auto-cut';
import type { ProjectSnapshot } from '../../shared/contracts';
import type { JobContext, JobQueue } from '../jobs';
import type { ProjectRepository, ProjectService } from '../projects';
import { findExecutable, runFfmpeg } from '../media/ffmpeg';
import type { ProviderStore } from './providers';
import { analyseAutoCut } from './auto-cut';
import { transcribeAsset } from './transcribe';
import { findWhisperBinary, findModelPath, modelRootFor } from './whisper';

const payloadSchema = autoCutGenerateSchema.extend({
  projectId: z.string(),
  fingerprint: z.string(),
  providerRevision: z.string(),
  assetId: z.string(),
});
const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export interface AutoCutServiceOptions {
  projects: ProjectService;
  repository: ProjectRepository;
  jobs: JobQueue;
  providers: ProviderStore;
  userData: string;
  ffmpeg?: string;
}

export class AutoCutService {
  private readonly unsubscribe: () => void;
  constructor(private readonly options: AutoCutServiceOptions) {
    options.jobs.registerHandler('analysis.autoCut', (payload, context) =>
      this.run(payloadSchema.parse(payload), context),
    );
    this.unsubscribe = options.projects.subscribe((event) => {
      if (event.type === 'project.closed' || event.type === 'project.opened') {
        for (const job of options.jobs.list())
          if (
            job.kind === 'analysis.autoCut' &&
            ['queued', 'running'].includes(job.status)
          )
            options.jobs.cancel(job.id);
      }
    });
  }
  dispose(): void {
    this.unsubscribe();
  }

  private current(clipId: string) {
    const snapshot = this.options.projects.current();
    if (!snapshot) throw new Error('Open a project before using Auto cut.');
    const { clip } = autoCutContext(snapshot.project.sequence, clipId);
    const asset = snapshot.assets.find((a) => a.id === clip.assetId);
    if (!asset || asset.status !== 'ready' || !asset.hasVideo)
      throw new Error('Choose a ready video clip.');
    if (
      clip.durationFrames >
      secondsToFrames(300, snapshot.project.sequence.frameRate)
    )
      throw new Error('Auto cut currently supports clips up to five minutes.');
    if (
      clip.sourceInFrame + clip.durationFrames >
      secondsToFrames(
        asset.durationSeconds,
        snapshot.project.sequence.frameRate,
      ) +
        1
    )
      throw new Error('The clip extends past its source media.');
    const stat = statSync(asset.sourcePath);
    if (
      asset.fileSize &&
      (stat.size !== asset.fileSize ||
        Math.abs(stat.mtimeMs - asset.mtimeMs) > 1)
    )
      throw new Error(
        'The source file changed. Refresh or relink before using Auto cut.',
      );
    return { snapshot, clip, asset };
  }

  private fingerprint(snapshot: ProjectSnapshot, asset: Asset): string {
    const stat = statSync(asset.sourcePath);
    return digest({
      projectId: snapshot.project.id,
      updatedAt: snapshot.project.updatedAt,
      sequence: snapshot.project.sequence,
      source: [
        asset.sourcePath,
        asset.contentHash,
        asset.fileSize,
        asset.mtimeMs,
        stat.size,
        stat.mtimeMs,
      ],
      speech: snapshot.transcripts.filter(
        (t) => t.assetId === asset.id && t.source === 'speech',
      ),
    });
  }
  private providerRevision(id: string): string {
    const account = this.options.providers.find(id);
    if (!account?.enabled || !account.visionConsent || !account.chatConsent)
      throw new Error(
        'Choose a provider with vision and chat consent enabled to analyse frames and speech.',
      );
    return digest([account, this.options.providers.apiKey(id)]);
  }

  generate(request: unknown) {
    const parsed = autoCutGenerateSchema.parse(request);
    const { snapshot, clip, asset } = this.current(parsed.clipId);
    const providerRevision = this.providerRevision(parsed.providerId);
    if (
      this.options.jobs
        .list(snapshot.project.id)
        .some(
          (j) =>
            j.kind === 'analysis.autoCut' &&
            j.targetId === asset.id &&
            ['queued', 'running'].includes(j.status),
        )
    )
      throw new Error('Auto cut is already analysing this asset.');
    if (
      asset.hasAudio &&
      !snapshot.transcripts.some(
        (t) => t.assetId === asset.id && t.source === 'speech',
      )
    )
      this.whisper();
    return this.options.jobs.enqueue({
      projectId: snapshot.project.id,
      kind: 'analysis.autoCut',
      payload: {
        ...parsed,
        clipId: clip.id,
        assetId: asset.id,
        projectId: snapshot.project.id,
        fingerprint: this.fingerprint(snapshot, asset),
        providerRevision,
      },
    });
  }

  proposal(jobId: string): AutoCutProposal | null {
    const job = this.options.jobs.get(jobId);
    if (
      !job ||
      job.kind !== 'analysis.autoCut' ||
      job.projectId !== this.options.projects.current()?.project.id
    )
      throw new Error(
        'That Auto cut proposal does not belong to the open project.',
      );
    if (job.status !== 'succeeded') return null;
    return autoCutProposalSchema.parse(this.options.jobs.result(jobId));
  }

  apply(request: unknown) {
    const parsed = autoCutApplySchema.parse(request);
    const proposal = this.proposal(parsed.jobId);
    if (!proposal) throw new Error('Wait for Auto cut analysis to finish.');
    const { snapshot, asset } = this.current(proposal.clipId);
    if (this.fingerprint(snapshot, asset) !== proposal.fingerprint)
      throw new Error(
        'The timeline, transcript or source changed. Analyse again before applying.',
      );
    const ids = new Set(parsed.removalIds);
    if (
      ids.size !== parsed.removalIds.length ||
      [...ids].some((id) => !proposal.removals.some((r) => r.id === id))
    )
      throw new Error('Choose only removals from this proposal.');
    const command = autoCutCommand(
      snapshot.project.sequence,
      proposal.clipId,
      proposal.removals.filter((r) => ids.has(r.id)),
    );
    return this.options.projects.apply(command, {
      actor: 'user',
      label: 'Auto cut',
    });
  }

  private whisper() {
    const binary = findWhisperBinary();
    const model = findModelPath(modelRootFor(this.options.userData));
    if (!binary || !model)
      throw new Error(
        'Auto cut needs speech transcription for video with audio. Install Whisper and a model in Analysis settings, or transcribe this asset first.',
      );
    return { binary, model };
  }

  private async run(
    payload: z.infer<typeof payloadSchema>,
    context: JobContext,
  ): Promise<AutoCutProposal> {
    const { snapshot, clip, asset } = this.current(payload.clipId);
    const check = () => {
      context.signal.throwIfAborted();
      const current = this.current(payload.clipId);
      if (
        current.snapshot.project.id !== payload.projectId ||
        this.fingerprint(current.snapshot, current.asset) !==
          payload.fingerprint
      )
        throw new Error(
          'Project, timeline, transcript or source changed. Analyse again.',
        );
      if (
        this.providerRevision(payload.providerId) !== payload.providerRevision
      )
        throw new Error(
          'The provider settings or consent changed. Analyse again.',
        );
    };
    check();
    const provider = this.options.providers.find(payload.providerId)!;
    const secret = this.options.providers.apiKey(provider.id);
    const folder = this.options.repository.folderFor(snapshot.project.id)!;
    const workRoot = join(folder, 'analysis', 'work');
    const rate = snapshot.project.sequence.frameRate;
    const seconds = (frame: number) =>
      (frame * rate.denominator) / rate.numerator;
    const ffmpeg = this.options.ffmpeg ?? findExecutable('ffmpeg');
    let work: string | undefined;
    try {
      let segments: TranscriptSegment[] = [];
      const existing = snapshot.transcripts.find(
        (t) => t.assetId === asset.id && t.source === 'speech',
      );
      if (existing) {
        const sourceRate = asset.frameRate ?? { numerator: 24, denominator: 1 };
        const factor =
          rate.numerator /
          rate.denominator /
          (sourceRate.numerator / sourceRate.denominator);
        segments = existing.segments.map((s) => ({
          ...s,
          startFrame: Math.round(s.startFrame * factor),
          endFrame: Math.round(s.endFrame * factor),
          words: s.words.map((w) => ({
            ...w,
            startFrame: Math.round(w.startFrame * factor),
            endFrame: Math.round(w.endFrame * factor),
          })),
        }));
      } else if (asset.hasAudio) {
        const whisper = this.whisper();
        mkdirSync(workRoot, { recursive: true });
        work = mkdtempSync(join(workRoot, 'auto-cut-speech-'));
        const wav = join(work, 'clip.wav');
        context.update(0.02, 'Extracting selected clip audio locally');
        await runFfmpeg(
          ffmpeg,
          [
            '-nostdin',
            '-v',
            'error',
            '-y',
            '-ss',
            String(seconds(clip.sourceInFrame)),
            '-i',
            asset.sourcePath,
            '-t',
            String(seconds(clip.durationFrames)),
            '-vn',
            '-ac',
            '1',
            '-ar',
            '16000',
            wav,
          ],
          { signal: context.signal },
        );
        const transcript = await transcribeAsset({
          asset: {
            ...asset,
            sourcePath: wav,
            frameRate: rate,
            durationSeconds: seconds(clip.durationFrames),
          },
          ffmpeg,
          whisper: whisper.binary,
          model: whisper.model,
          workDirectory: work,
          signal: context.signal,
          onProgress: (p) =>
            context.update(0.03 + 0.22 * p, 'Transcribing speech locally'),
        });
        segments = transcript.segments.map((s) => ({
          ...s,
          startFrame: s.startFrame + clip.sourceInFrame,
          endFrame: s.endFrame + clip.sourceInFrame,
          words: s.words.map((w) => ({
            ...w,
            startFrame: w.startFrame + clip.sourceInFrame,
            endFrame: w.endFrame + clip.sourceInFrame,
          })),
        }));
      }
      check();
      const result = await analyseAutoCut({
        path: asset.sourcePath,
        ffmpeg,
        workRoot,
        rate,
        startFrame: clip.sourceInFrame,
        endFrame: clip.sourceInFrame + clip.durationFrames,
        segments,
        sceneCuts: snapshot.scenes
          .filter((s) => s.assetId === asset.id)
          .map((s) => seconds(s.startFrame)),
        purpose: payload.purpose,
        model: this.options.providers.model(provider),
        signal: context.signal,
        checkProvider: check,
        progress: (p, stage) => context.update(p, stage),
      });
      check();
      context.update(
        1,
        result.removals.length
          ? 'Cut proposal ready for review'
          : 'No clearly irrelevant sections found',
      );
      return {
        projectId: snapshot.project.id,
        clipId: clip.id,
        assetId: asset.id,
        fingerprint: payload.fingerprint,
        providerId: provider.id,
        providerRevision: payload.providerRevision,
        purpose: payload.purpose,
        startFrame: clip.sourceInFrame,
        endFrame: clip.sourceInFrame + clip.durationFrames,
        frameRate: rate,
        ...result,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        secret
          ? message
              .split(secret)
              .join('[redacted]')
              .split(encodeURIComponent(secret))
              .join('[redacted]')
          : message,
      );
    } finally {
      if (work) rmSync(work, { recursive: true, force: true });
    }
  }
}
