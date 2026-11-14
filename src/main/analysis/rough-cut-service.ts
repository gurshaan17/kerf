import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { z } from 'zod';
import { idSchema, frameRateSchema, secondsToFrames } from '@kerf/model';
import type { ReferenceProfile } from '@kerf/model';
import { applyCommand, roughCutCommand } from '@kerf/engine';
import { buildRoughCutPlan, roughCutPlanSchema } from '@kerf/tools';
import type {
  RoughCutPlanRequest,
  ToolSearchResponse,
  ToolSnapshot,
} from '@kerf/tools';
import type { ProjectService } from '../projects';
import type { JobQueue } from '../jobs';

const storedPlanSchema = z.object({
  projectId: idSchema('project'),
  clipId: z.string(),
  assetId: idSchema('asset'),
  fingerprint: z.string().min(1),
  kind: z.literal('roughCut'),
  frameSpace: z.literal('source'),
  changes: z
    .array(
      z.object({
        id: z.string().min(1),
        evidenceId: z.string().min(1),
        evidenceKind: z.enum(['transcript', 'scene']),
        assetId: idSchema('asset'),
        startFrame: z.number().int().nonnegative(),
        endFrame: z.number().int().positive(),
        sourceFrameRate: frameRateSchema,
        sourceInFrame: z.number().int().nonnegative(),
        durationFrames: z.number().int().positive(),
        reason: z.string().min(1),
        description: z.string(),
        evidenceFrames: z.array(z.number()),
      }),
    )
    .min(1)
    .max(40),
  roughCut: z.object({
    intent: z.string(),
    assetIds: z.array(idSchema('asset')).min(1).max(20),
    targetDurationSeconds: z.number().positive().optional(),
    estimatedDurationFrames: z.number().int().positive(),
    estimatedDurationSeconds: z.number().positive(),
    appendAtFrame: z.number().int().nonnegative(),
    unmetConstraints: z.array(z.string()),
  }),
});

export interface RoughCutServiceOptions {
  referenceProfiles?(projectId: string): readonly ReferenceProfile[];
  projects: Pick<ProjectService, 'current' | 'subscribe'>;
  jobs: Pick<
    JobQueue,
    'registerHandler' | 'enqueue' | 'get' | 'list' | 'result' | 'cancel'
  >;
  search(request: {
    query: string;
    assetIds: readonly string[];
    limit: number;
  }): ToolSearchResponse;
}

/** Local evidence planning; no provider call or timeline mutation during planning. */
export class RoughCutService {
  private readonly unsubscribe: () => void;
  constructor(private readonly options: RoughCutServiceOptions) {
    options.jobs.registerHandler('analysis.roughCut', (payload, context) => {
      context.signal.throwIfAborted();
      const proposal = storedPlanSchema.parse(payload);
      this.check(proposal);
      context.update(1, 'Rough cut ready for review');
      return proposal;
    });
    this.unsubscribe = options.projects.subscribe((event) => {
      if (event.type === 'project.closed' || event.type === 'project.opened')
        for (const job of options.jobs.list())
          if (
            job.kind === 'analysis.roughCut' &&
            ['queued', 'running'].includes(job.status)
          )
            options.jobs.cancel(job.id);
    });
  }
  dispose() {
    this.unsubscribe();
  }
  private snapshot(): ToolSnapshot {
    const snapshot = this.options.projects.current();
    if (!snapshot)
      throw new Error('Open a project before planning a rough cut.');
    return {
      ...snapshot,
      referenceProfiles:
        this.options.referenceProfiles?.(snapshot.project.id) ??
        [
          snapshot.project.reference,
          snapshot.project.sequence.reference,
        ].filter((p) => p !== null),
    };
  }
  private fingerprint(snapshot: ToolSnapshot, assetIds: readonly string[]) {
    const selected = new Set(assetIds);
    const assets = snapshot.assets.filter((a) => selected.has(a.id));
    const sources = assets.map((a) => {
      const stat = statSync(a.sourcePath);
      if (
        a.fileSize &&
        (stat.size !== a.fileSize || Math.abs(stat.mtimeMs - a.mtimeMs) > 1)
      )
        throw new Error(
          'Source media changed. Refresh or relink before planning.',
        );
      return [a.id, stat.size, stat.mtimeMs];
    });
    return createHash('sha256')
      .update(
        JSON.stringify({
          project: snapshot.project,
          assets,
          sources,
          references: snapshot.referenceProfiles.filter(
            (p) => p.sourceAssetId && selected.has(p.sourceAssetId),
          ),
          transcripts: snapshot.transcripts.filter((t) =>
            selected.has(t.assetId),
          ),
          scenes: snapshot.scenes.filter((s) => selected.has(s.assetId)),
        }),
      )
      .digest('hex');
  }
  generate(input: RoughCutPlanRequest) {
    const request = roughCutPlanSchema.parse(input);
    const snapshot = this.snapshot();
    const plan = buildRoughCutPlan(snapshot, request, (query) =>
      this.options.search({
        query: query.slice(0, 200),
        assetIds: request.assetIds,
        limit: 100,
      }),
    );
    const stored = storedPlanSchema.parse({
      ...plan,
      fingerprint: this.fingerprint(snapshot, request.assetIds),
    });
    this.compile(snapshot, stored.changes); // Validate the whole draft without committing it.
    const job = this.options.jobs.enqueue({
      projectId: snapshot.project.id,
      kind: 'analysis.roughCut',
      payload: stored,
    });
    return { job, proposal: { ...stored, jobId: job.id } };
  }
  proposal(jobId: string) {
    const job = this.options.jobs.get(jobId);
    if (
      !job ||
      job.kind !== 'analysis.roughCut' ||
      job.projectId !== this.options.projects.current()?.project.id
    )
      throw new Error(
        'That rough-cut proposal does not belong to the open project.',
      );
    return job.status === 'succeeded'
      ? { ...storedPlanSchema.parse(this.options.jobs.result(jobId)), jobId }
      : null;
  }
  private check(proposal: z.infer<typeof storedPlanSchema>) {
    const snapshot = this.snapshot();
    if (
      snapshot.project.id !== proposal.projectId ||
      this.fingerprint(snapshot, proposal.roughCut.assetIds) !==
        proposal.fingerprint
    )
      throw new Error(
        'The project, source or evidence changed. Plan the rough cut again.',
      );
    return snapshot;
  }
  private compile(
    snapshot: ToolSnapshot,
    changes: z.infer<typeof storedPlanSchema>['changes'],
  ) {
    const command = roughCutCommand(
      snapshot.project.sequence,
      snapshot.assets,
      changes.map((c) => ({
        assetId: c.assetId,
        sourceInFrame: c.sourceInFrame,
        durationFrames: c.durationFrames,
        label: c.description,
      })),
    );
    applyCommand(snapshot.project.sequence, command, {
      sourceDurationFrames: (id) => {
        const asset = snapshot.assets.find((a) => a.id === id);
        return asset
          ? secondsToFrames(
              asset.durationSeconds,
              snapshot.project.sequence.frameRate,
              'floor',
            )
          : undefined;
      },
    });
    return command;
  }
  prepare(jobId: string, changeIds: readonly string[]) {
    const proposal = this.proposal(jobId);
    if (!proposal) throw new Error('Wait for rough-cut planning to finish.');
    const snapshot = this.check(proposal);
    if (
      !changeIds.length ||
      new Set(changeIds).size !== changeIds.length ||
      changeIds.some((id) => !proposal.changes.some((c) => c.id === id))
    )
      throw new Error(
        'Choose unique changes from the stored rough-cut proposal.',
      );
    return this.compile(
      snapshot,
      proposal.changes.filter((c) => changeIds.includes(c.id)),
    );
  }
}
