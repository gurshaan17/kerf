import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { findClip, screenPolishCommand } from '@kerf/engine';
import { DEFAULT_TRANSFORM, newId, secondsToFrames } from '@kerf/model';
import {
  polishGenerateSchema,
  polishApplySchema,
  polishProposalSchema,
  type PolishProposal,
} from '../../shared/screen-polish';
import type { JobContext, JobQueue } from '../jobs';
import type { ProjectRepository, ProjectService } from '../projects';
import type { ProviderStore } from './providers';
import { findExecutable } from '../media/ffmpeg';
import { analyseScreenPolish } from './screen-polish';

const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const payloadSchema = polishGenerateSchema.extend({
  projectId: z.string(),
  fingerprint: z.string(),
  providerRevision: z.string(),
});
export interface ScreenPolishServiceOptions {
  projects: ProjectService;
  repository: ProjectRepository;
  jobs: JobQueue;
  providers: ProviderStore;
  ffmpeg?: string;
}
export class ScreenPolishService {
  private readonly unsubscribe: () => void;
  constructor(private readonly options: ScreenPolishServiceOptions) {
    options.jobs.registerHandler('analysis.screenPolish', (payload, context) =>
      this.run(payloadSchema.parse(payload), context),
    );
    this.unsubscribe = options.projects.subscribe((event) => {
      if (event.type === 'project.closed' || event.type === 'project.opened')
        for (const job of options.jobs.list())
          if (
            job.kind === 'analysis.screenPolish' &&
            ['queued', 'running'].includes(job.status)
          )
            options.jobs.cancel(job.id);
    });
  }
  dispose() {
    this.unsubscribe();
  }
  private current(clipId: string) {
    const snapshot = this.options.projects.current();
    if (!snapshot)
      throw new Error('Open a project before using screen polish.');
    const location = findClip(snapshot.project.sequence, clipId);
    const clip = location?.clip;
    if (!clip || clip.type !== 'video')
      throw new Error('Select a video clip on the timeline.');
    if (location.track.locked || location.track.hidden || clip.locked)
      throw new Error(
        'Unlock and show the selected video before analysing it.',
      );
    if (clip.speed !== 1 || clip.timeMap.length)
      throw new Error('Screen polish needs a normal-speed clip.');
    if (
      JSON.stringify(clip.transform) !== JSON.stringify(DEFAULT_TRANSFORM) ||
      Object.values(clip.keyframes).some((keys) => keys.length)
    )
      throw new Error(
        'Reset the video transform and motion before analysing screen polish so focus regions match the footage.',
      );
    const sequence = snapshot.project.sequence;
    if (clip.durationFrames > secondsToFrames(300, sequence.frameRate))
      throw new Error('Split the video into clips up to five minutes long.');
    const asset = snapshot.assets.find((a) => a.id === clip.assetId);
    if (
      !asset ||
      asset.status !== 'ready' ||
      !asset.hasVideo ||
      !asset.width ||
      !asset.height
    )
      throw new Error('Choose ready video footage with known dimensions.');
    if (
      clip.sourceInFrame + clip.durationFrames >
      secondsToFrames(asset.durationSeconds, sequence.frameRate) + 1
    )
      throw new Error('The clip extends beyond its source media.');
    const stat = statSync(asset.sourcePath);
    if (
      asset.fileSize &&
      (stat.size !== asset.fileSize ||
        Math.abs(stat.mtimeMs - asset.mtimeMs) > 1)
    )
      throw new Error(
        'The source file changed. Refresh or relink it before analysing.',
      );
    const fingerprint = digest({
      projectId: snapshot.project.id,
      sequence,
      asset,
      file: [stat.size, stat.mtimeMs],
    });
    return { snapshot, sequence, clip, asset, fingerprint };
  }
  private providerRevision(id: string) {
    const provider = this.options.providers.find(id);
    if (!provider?.enabled || !provider.visionConsent)
      throw new Error(
        'Choose an enabled provider with vision consent in Analysis settings.',
      );
    return digest([provider, this.options.providers.apiKey(id)]);
  }
  generate(request: unknown) {
    const parsed = polishGenerateSchema.parse(request);
    const current = this.current(parsed.clipId);
    const providerRevision = this.providerRevision(parsed.providerId);
    if (
      this.options.jobs
        .list(current.snapshot.project.id)
        .some(
          (j) =>
            j.kind === 'analysis.screenPolish' &&
            ['queued', 'running'].includes(j.status),
        )
    )
      throw new Error('Screen polish is already analysing this project.');
    return this.options.jobs.enqueue({
      projectId: current.snapshot.project.id,
      kind: 'analysis.screenPolish',
      payload: {
        ...parsed,
        projectId: current.snapshot.project.id,
        fingerprint: current.fingerprint,
        providerRevision,
      },
    });
  }
  proposal(jobId: string): PolishProposal | null {
    const job = this.options.jobs.get(jobId);
    if (
      !job ||
      job.kind !== 'analysis.screenPolish' ||
      job.projectId !== this.options.projects.current()?.project.id
    )
      throw new Error(
        'This polish proposal does not belong to the open project.',
      );
    return job.status === 'succeeded'
      ? polishProposalSchema.parse(this.options.jobs.result(jobId))
      : null;
  }
  apply(request: unknown) {
    const parsed = polishApplySchema.parse(request);
    const proposal = this.proposal(parsed.jobId);
    if (!proposal)
      throw new Error('Wait for screen polish analysis to finish.');
    const current = this.current(proposal.clipId);
    if (current.fingerprint !== proposal.fingerprint)
      throw new Error(
        'The timeline or source changed. Analyse again before applying polish.',
      );
    const ids = new Set(parsed.suggestions.map((s) => s.id));
    if (
      ids.size !== parsed.suggestions.length ||
      parsed.suggestions.some(
        (s) =>
          s.clipId !== proposal.clipId ||
          !proposal.suggestions.some((original) => original.id === s.id),
      )
    )
      throw new Error('Choose only suggestions from this proposal.');
    return this.options.projects.apply(
      screenPolishCommand(current.sequence, parsed.suggestions),
      { actor: 'user', label: 'Apply screen polish' },
    );
  }
  private async run(
    payload: z.infer<typeof payloadSchema>,
    context: JobContext,
  ): Promise<PolishProposal> {
    const secret = this.options.providers.apiKey(payload.providerId);
    try {
      const check = () => {
        context.signal.throwIfAborted();
        const current = this.current(payload.clipId);
        if (
          current.snapshot.project.id !== payload.projectId ||
          current.fingerprint !== payload.fingerprint
        )
          throw new Error('The timeline or source changed. Analyse again.');
        if (
          this.providerRevision(payload.providerId) !== payload.providerRevision
        )
          throw new Error(
            'Provider settings or consent changed. Analyse again.',
          );
      };
      check();
      const { snapshot, sequence, clip, asset } = this.current(payload.clipId);
      const result = await analyseScreenPolish({
        path: asset.sourcePath,
        ffmpeg: this.options.ffmpeg ?? findExecutable('ffmpeg'),
        workRoot: join(
          this.options.repository.folderFor(snapshot.project.id)!,
          'analysis',
          'work',
        ),
        rate: sequence.frameRate,
        startFrame: clip.sourceInFrame,
        endFrame: clip.sourceInFrame + clip.durationFrames,
        model: this.options.providers.model(
          this.options.providers.find(payload.providerId)!,
        ),
        signal: context.signal,
        checkProvider: check,
        progress: (p, stage) => context.update(p, stage),
      });
      check();
      // Video uses contain-fit. Convert source-normalized regions to canvas coordinates.
      const scale = Math.min(
        sequence.width / asset.width!,
        sequence.height / asset.height!,
      );
      const w = (asset.width! * scale) / sequence.width;
      const h = (asset.height! * scale) / sequence.height;
      const suggestions = result.observations.map((row) => ({
        id: newId('effect'),
        clipId: clip.id,
        startFrame: clip.startFrame + row.startFrame - clip.sourceInFrame,
        durationFrames: row.endFrame - row.startFrame,
        x: (1 - w) / 2 + (row.region.x + row.region.w / 2) * w,
        y: (1 - h) / 2 + (row.region.y + row.region.h / 2) * h,
        width: Math.max(0.02, row.region.w * w),
        height: Math.max(0.02, row.region.h * h),
        zoom: 2,
        kind: row.kind,
        text: row.text,
        reason: row.reason,
        evidenceFrames: row.evidenceFrames,
      }));
      // Validate the entire draft before exposing it to the user; an empty result is valid.
      if (suggestions.length) screenPolishCommand(sequence, suggestions);
      context.update(
        1,
        suggestions.length
          ? 'Polish suggestions ready for review'
          : 'No clear screen interactions found',
      );
      return polishProposalSchema.parse({
        projectId: snapshot.project.id,
        clipId: clip.id,
        assetId: asset.id,
        fingerprint: payload.fingerprint,
        providerId: payload.providerId,
        sampleCount: result.sampleCount,
        suggestions,
      });
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
    }
  }
}
