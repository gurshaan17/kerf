import { createHash } from 'node:crypto';
import { rmSync, statSync } from 'node:fs';
import { generateText } from 'ai';
import { z } from 'zod';
import {
  assetSchema,
  clipSchema,
  EMPTY_ASSET_CACHE,
  newId,
  projectSchema,
  secondsToFrames,
} from '@kerf/model';
import type { Asset } from '@kerf/model';
import {
  applyCommand,
  roughCutCommand,
  sequenceDurationFrames,
} from '@kerf/engine';
import {
  clipDiscoverySchema,
  highlightProposalSchema,
  highlightSelectionSchema,
} from '@kerf/tools';
import type {
  ClipDiscoveryRequest,
  ClipDiscoveryReview,
  HighlightOutput,
  HighlightProposal,
  HighlightSelection,
} from '@kerf/tools';
import type { SqliteDatabase } from '../db';
import type { ProjectRepository, ProjectService } from '../projects';
import type { JobContext, JobQueue } from '../jobs';
import type { ProviderStore } from './providers';
import {
  HIGHLIGHT_PROMPT,
  highlightEvidence,
  parseHighlights,
  selectedHighlights,
} from './highlights';

const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const payloadSchema = z.object({
  projectId: z.string(),
  request: clipDiscoverySchema,
  fingerprint: z.string(),
  providerRevision: z.string(),
});
interface Ledger {
  applied?: boolean;
  cancelled?: boolean;
  outputs?: HighlightOutput[];
  origin?: { conversationId: string; turnId: string };
  selection?: HighlightSelection;
}
interface Options {
  projects: ProjectService;
  repository: ProjectRepository;
  database: SqliteDatabase;
  jobs: JobQueue;
  providers: ProviderStore;
}
export class HighlightService {
  private readonly off: () => void;
  constructor(private readonly options: Options) {
    options.jobs.registerHandler('analysis.highlights', (payload, context) =>
      this.run(payloadSchema.parse(payload), context),
    );
    this.off = options.projects.subscribe((event) => {
      if (event.type === 'project.closed' || event.type === 'project.opened')
        for (const job of options.jobs.list())
          if (
            job.kind === 'analysis.highlights' &&
            ['running', 'queued'].includes(job.status)
          )
            options.jobs.cancel(job.id);
    });
  }
  dispose() {
    this.off();
  }
  private source(assetId: string, projectId?: string) {
    const snapshot = this.options.projects.current();
    if (!snapshot || (projectId && snapshot.project.id !== projectId))
      throw new Error(
        'Open the originating source project before reviewing highlights.',
      );
    const asset = snapshot.assets.find((a) => a.id === assetId);
    if (
      !asset ||
      asset.kind !== 'video' ||
      !asset.hasAudio ||
      !asset.hasVideo ||
      asset.status !== 'ready' ||
      !asset.frameRate
    )
      throw new Error(
        'Choose one ready speech-bearing source video with a known frame rate.',
      );
    if (
      [
        snapshot.project.reference,
        snapshot.project.sequence.reference,
        ...this.options.repository.listReferenceProfiles(snapshot.project.id),
      ].some((p) => p?.sourceAssetId === asset.id)
    )
      throw new Error('Reference footage cannot become highlight output.');
    const transcript = snapshot.transcripts.find(
      (t) =>
        t.assetId === asset.id &&
        t.source === 'speech' &&
        t.status === 'reviewed',
    );
    if (!transcript)
      throw new Error(
        'Transcribe and review this source once before discovering highlights.',
      );
    return { snapshot, asset, transcript };
  }
  private identity(asset: Asset) {
    const stat = statSync(asset.sourcePath);
    if (
      asset.fileSize &&
      (asset.fileSize !== stat.size ||
        Math.abs(asset.mtimeMs - stat.mtimeMs) > 1)
    )
      throw new Error(
        'Source media changed. Refresh or relink it before discovery.',
      );
    return [asset.sourcePath, asset.contentHash, stat.size, stat.mtimeMs];
  }
  private fingerprint(source: ReturnType<HighlightService['source']>) {
    return digest([
      source.snapshot.project.id,
      source.asset,
      this.identity(source.asset),
      source.transcript,
    ]);
  }
  private provider(id: string) {
    const account = this.options.providers.find(id);
    if (!account?.enabled || !account.chatConsent)
      throw new Error(
        'Choose an enabled text provider with chat consent for transcript discovery.',
      );
    return {
      account,
      revision: digest([account, this.options.providers.apiKey(id)]),
    };
  }
  private ledger(id: string): Ledger {
    const row = this.options.database
      .prepare('SELECT value_json FROM app_settings WHERE key = ?')
      .get(`clip-discovery:${id}`) as { value_json: string } | undefined;
    return row ? JSON.parse(row.value_json) : {};
  }
  private save(id: string, value: Ledger) {
    this.options.database
      .prepare(
        'INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at',
      )
      .run(`clip-discovery:${id}`, JSON.stringify(value), Date.now());
  }
  private job(id: string) {
    const job = this.options.jobs.get(id);
    if (
      !job ||
      job.kind !== 'analysis.highlights' ||
      job.projectId !== this.options.projects.current()?.project.id
    )
      throw new Error('That discovery belongs to another project.');
    return job;
  }
  start(
    input: ClipDiscoveryRequest,
    origin?: Ledger['origin'],
  ): ClipDiscoveryReview {
    const request = clipDiscoverySchema.parse(input);
    const source = this.source(request.assetId);
    highlightEvidence(source.asset, source.transcript);
    const provider = this.provider(request.providerId);
    if (
      this.options.jobs
        .list(source.snapshot.project.id)
        .some(
          (j) =>
            j.kind === 'analysis.highlights' &&
            j.targetId === request.assetId &&
            ['queued', 'running'].includes(j.status),
        )
    )
      throw new Error('This source already has running highlight discovery.');
    const job = this.options.jobs.enqueue({
      projectId: source.snapshot.project.id,
      kind: 'analysis.highlights',
      payload: {
        projectId: source.snapshot.project.id,
        assetId: source.asset.id,
        request,
        fingerprint: this.fingerprint(source),
        providerRevision: provider.revision,
      },
    });
    this.save(job.id, { origin });
    return this.read(job.id);
  }
  private async run(
    payload: z.infer<typeof payloadSchema>,
    context: JobContext,
  ) {
    context.signal.throwIfAborted();
    const source = this.source(payload.request.assetId, payload.projectId);
    if (this.fingerprint(source) !== payload.fingerprint)
      throw new Error(
        'Source or transcript changed. Discover again explicitly.',
      );
    const provider = this.provider(payload.request.providerId);
    if (provider.revision !== payload.providerRevision)
      throw new Error('Provider settings changed. Discover again explicitly.');
    const evidence = highlightEvidence(source.asset, source.transcript);
    context.update(0.2, 'Selecting complete thoughts from reviewed speech');
    const result = await generateText({
      model: this.options.providers.chatModel(provider.account),
      system: HIGHLIGHT_PROMPT,
      messages: [
        {
          role: 'user',
          content: JSON.stringify({
            request: payload.request,
            sourceFrameRate: source.asset.frameRate,
            evidence,
          }),
        },
      ],
      maxOutputTokens: 4096,
      maxRetries: 0,
      abortSignal: AbortSignal.any([
        context.signal,
        AbortSignal.timeout(120000),
      ]),
    });
    context.signal.throwIfAborted();
    if (
      this.provider(payload.request.providerId).revision !==
        provider.revision ||
      this.fingerprint(
        this.source(payload.request.assetId, payload.projectId),
      ) !== payload.fingerprint
    )
      throw new Error(
        'Source, transcript or provider changed during discovery. Discover again explicitly.',
      );
    const candidates = parseHighlights(
      result.text,
      evidence,
      source.asset,
      payload.request,
    );
    context.update(1, 'Highlights ready for selection');
    return highlightProposalSchema.parse({
      version: 1,
      projectId: payload.projectId,
      assetId: source.asset.id,
      fingerprint: payload.fingerprint,
      request: payload.request,
      sourceFrameRate: source.asset.frameRate,
      evidence,
      candidates,
      warnings: [
        ...(candidates.length < payload.request.count
          ? [
              `Requested ${payload.request.count}; evidence supports ${candidates.length} proposed highlights. No extra clips were invented.`,
            ]
          : []),
        'Source aspect is preserved. No speaker tracking, automatic reframing, captions, finishing or export is added. Human review determines editorial quality.',
      ],
    });
  }
  private check(proposal: HighlightProposal) {
    const source = this.source(proposal.assetId, proposal.projectId);
    if (this.fingerprint(source) !== proposal.fingerprint)
      throw new Error(
        'Source or transcript changed. Discover again before creation.',
      );
    this.provider(proposal.request.providerId);
    return source;
  }
  read(id: string): ClipDiscoveryReview {
    const job = this.job(id);
    const ledger = this.ledger(id);
    const proposal =
      job.status === 'succeeded'
        ? highlightProposalSchema.parse(this.options.jobs.result(id))
        : null;
    let eligible = false;
    let reason = 'Wait for discovery to finish.';
    if (ledger.applied)
      reason =
        'Outputs were already created. Repeated Apply cannot create duplicates.';
    else if (ledger.cancelled) reason = 'Discovery was cancelled.';
    else if (proposal) {
      try {
        this.check(proposal);
        eligible = proposal.candidates.length > 0;
        reason = eligible
          ? ''
          : 'No suitable candidates. Choose different footage or discover again explicitly.';
      } catch (cause) {
        reason = cause instanceof Error ? cause.message : String(cause);
      }
    }
    return {
      id,
      projectId: job.projectId!,
      status: job.status,
      stage: job.stage,
      error: job.error,
      proposal,
      eligible,
      reason,
      applied: !!ledger.applied,
      cancelled: !!ledger.cancelled,
      outputs: (ledger.outputs ?? []).map((o) => ({
        ...o,
        exists: !!this.options.repository.getSummary(o.projectId),
      })),
      origin: ledger.origin,
      requestedSelections: ledger.selection?.selections,
    };
  }
  reviews(conversationId?: string | null) {
    return this.options.jobs
      .list(this.options.projects.current()?.project.id)
      .filter(
        (j) =>
          j.kind === 'analysis.highlights' &&
          j.projectId === this.options.projects.current()?.project.id,
      )
      .filter(
        (j) =>
          conversationId === undefined ||
          !this.ledger(j.id).origin ||
          this.ledger(j.id).origin?.conversationId === conversationId,
      )
      .slice(0, 20)
      .map((j) => this.read(j.id));
  }
  request(input: HighlightSelection) {
    const parsed = highlightSelectionSchema.parse(input);
    const review = this.read(parsed.jobId);
    if (!review.eligible || !review.proposal) throw new Error(review.reason);
    selectedHighlights(review.proposal, parsed);
    this.save(parsed.jobId, {
      ...this.ledger(parsed.jobId),
      selection: parsed,
    });
    return { status: 'awaiting-review' as const, jobId: parsed.jobId };
  }
  cancel(id: string) {
    this.job(id);
    const ledger = this.ledger(id);
    if (!ledger.applied) {
      this.options.jobs.cancel(id);
      this.save(id, { ...ledger, cancelled: true });
    }
    return this.read(id);
  }
  outputs(id: string) {
    const review = this.read(id);
    return { projectId: review.projectId, jobId: id, outputs: review.outputs };
  }
  /** Desktop only. All projects and replay protection publish in one SQLite transaction. */
  confirm(input: HighlightSelection) {
    const parsed = highlightSelectionSchema.parse(input);
    const review = this.read(parsed.jobId);
    if (!review.eligible || !review.proposal) throw new Error(review.reason);
    const proposal = review.proposal;
    const { snapshot, asset, transcript } = this.check(proposal);
    const selected = selectedHighlights(proposal, parsed);
    const folders: string[] = [];
    try {
      return this.options.database.transaction(() => {
        const outputs = selected.map((candidate) => {
          const bundle = this.options.repository.create({
            name: candidate.title,
            width: asset.width ?? snapshot.project.sequence.width,
            height: asset.height ?? snapshot.project.sequence.height,
            frameRate: proposal.sourceFrameRate,
          });
          folders.push(this.options.repository.folderFor(bundle.project.id)!);
          const childTranscriptId = newId('transcript');
          const childAsset = assetSchema.parse({
            ...asset,
            id: newId('asset'),
            projectId: bundle.project.id,
            cache: EMPTY_ASSET_CACHE,
            transcriptId: childTranscriptId,
          });
          this.options.repository.saveAsset(childAsset);
          const childTranscript = {
            ...transcript,
            id: childTranscriptId,
            assetId: childAsset.id,
            undoStates: [],
            redoStates: [],
          };
          this.options.repository.saveTranscript(childTranscript);
          const command = roughCutCommand(
            bundle.project.sequence,
            [childAsset],
            [
              {
                assetId: childAsset.id,
                sourceInFrame: candidate.startFrame,
                durationFrames: candidate.endFrame - candidate.startFrame,
                label: candidate.title,
              },
            ],
          );
          const applied = applyCommand(bundle.project.sequence, command, {
            sourceDurationFrames: () =>
              secondsToFrames(
                asset.durationSeconds,
                proposal.sourceFrameRate,
                'floor',
              ),
          });
          const clips = applied.sequence.tracks.flatMap((t) => t.clips);
          const video = clips.find((c) => c.type === 'video')!;
          const audio = clips.find((c) => c.type === 'audio')!;
          const output: HighlightOutput = {
            candidateId: candidate.id,
            projectId: bundle.project.id,
            assetId: childAsset.id,
            videoClipId: video.id,
            audioClipId: audio.id,
            name: candidate.title,
            startFrame: candidate.startFrame,
            endFrame: candidate.endFrame,
            durationFrames: video.durationFrames,
            exists: true,
          };
          const project = projectSchema.parse({
            ...bundle.project,
            sequence: applied.sequence,
            highlightOrigin: {
              version: 1,
              parentProjectId: snapshot.project.id,
              sourceAssetId: asset.id,
              fingerprint: proposal.fingerprint,
              sourceIdentity: digest(this.identity(asset)),
              jobId: parsed.jobId,
              ...output,
            },
          });
          this.options.repository.commitEdit(project, {
            id: newId('command'),
            commandId: 'batch',
            actor: 'user',
            label: 'Create approved highlight',
            command,
            inverse: applied.inverse,
            createdAt: Date.now(),
          });
          return output;
        });
        this.save(parsed.jobId, {
          ...this.ledger(parsed.jobId),
          applied: true,
          outputs,
          selection: parsed,
        });
        return {
          projectId: snapshot.project.id,
          jobId: parsed.jobId,
          outputs,
          origin: review.origin,
        };
      })();
    } catch (cause) {
      for (const path of folders)
        rmSync(path, { recursive: true, force: true });
      throw cause;
    }
  }
  verify(projectId: string) {
    const bundle = this.options.repository.require(projectId);
    const origin = bundle.project.highlightOrigin;
    const currentId = this.options.projects.current()?.project.id;
    if (
      !origin ||
      (currentId !== projectId && currentId !== origin.parentProjectId)
    )
      throw new Error(
        'Open the highlight output or its source project before verifying.',
      );
    const findings: string[] = [];
    const asset = bundle.assets.find((a) => a.id === origin.assetId);
    try {
      if (!asset || digest(this.identity(asset)) !== origin.sourceIdentity)
        findings.push('Source identity changed or is missing.');
    } catch {
      findings.push('Source media changed or is missing.');
    }
    const clips = bundle.project.sequence.tracks.flatMap((t) => t.clips);
    for (const id of [origin.videoClipId, origin.audioClipId]) {
      const clip = clips.find((c) => c.id === id);
      if (!clip) {
        findings.push(`Original output clip ${id} was deleted or replaced.`);
        continue;
      }
      if (
        (clip.type !== 'video' && clip.type !== 'audio') ||
        clip.assetId !== origin.assetId ||
        clip.startFrame !== 0 ||
        clip.sourceInFrame !== origin.startFrame ||
        clip.durationFrames !== origin.durationFrames ||
        clip.speed !== 1 ||
        clip.timeMap.length
      )
        findings.push(
          `Output clip ${id} differs from its approved source range.`,
        );
      const parsed = clipSchema.safeParse(clip);
      if (!parsed.success) findings.push(`Invalid clip ${id}.`);
    }
    if (
      sequenceDurationFrames(bundle.project.sequence) !== origin.durationFrames
    )
      findings.push('Output duration differs from the approved highlight.');
    return {
      projectId,
      valid: findings.length === 0,
      findings,
      videoClipId: origin.videoClipId,
      audioClipId: origin.audioClipId,
    };
  }
}
