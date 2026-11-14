import type { EditReceipt } from '@kerf/tools';
import type { EditCommand } from '@kerf/model';
import type {
  EditingJob,
  EditingProposal,
  EditingReview,
  ToolContext,
  ToolEditingAccess,
} from '@kerf/tools';
import type { JobQueue } from '../jobs';
import type { AutoCutService } from '../analysis/auto-cut-service';
import type { ScreenPolishService } from '../analysis/screen-polish-service';
import type { SqliteDatabase } from '../db/connection';

export interface EditingServiceOptions {
  projects: { current(): { project: { id: string } } | null };
  jobs: Pick<JobQueue, 'get' | 'list' | 'cancel'>;
  autoCut: Pick<AutoCutService, 'generate' | 'proposal' | 'prepare'>;
  screenPolish: Pick<ScreenPolishService, 'generate' | 'proposal' | 'prepare'>;
  database: SqliteDatabase;
  providers: { list(): ReturnType<ToolEditingAccess['providers']> };
}

/** Shared review lifecycle; approval is available only over the desktop IPC bridge. */
export class EditingService implements ToolEditingAccess {
  private readonly selections = new Map<string, readonly string[]>();
  constructor(private readonly options: EditingServiceOptions) {}

  private job(jobId: string) {
    const job = this.options.jobs.get(jobId);
    const projectId = this.options.projects.current()?.project.id;
    if (
      !projectId ||
      !job ||
      job.projectId !== projectId ||
      !['analysis.autoCut', 'analysis.screenPolish'].includes(job.kind)
    )
      throw new Error('That editing job does not belong to the open project.');
    return job;
  }
  private state(jobId: string): 'applied' | 'cancelled' | null {
    const row = this.options.database
      .prepare('SELECT value_json FROM app_settings WHERE key = ?')
      .get(`editing-review:${jobId}`) as { value_json: string } | undefined;
    return row ? JSON.parse(row.value_json).status : null;
  }
  private save(jobId: string, status: 'applied' | 'cancelled') {
    this.options.database
      .prepare(
        'INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at',
      )
      .run(`editing-review:${jobId}`, JSON.stringify({ status }), Date.now());
  }
  providers() {
    return this.options.providers
      .list()
      .map(({ id, label, enabled, visionConsent, chatConsent }) => ({
        id,
        label,
        enabled,
        visionConsent,
        chatConsent,
      }));
  }
  recordReceipt(jobId: string, receipt: EditReceipt) {
    this.options.database
      .prepare('UPDATE app_settings SET value_json = ? WHERE key = ?')
      .run(
        JSON.stringify({ status: 'applied', receipt }),
        `editing-review:${jobId}`,
      );
  }
  private receipt(jobId: string): EditReceipt | undefined {
    const row = this.options.database
      .prepare('SELECT value_json FROM app_settings WHERE key = ?')
      .get(`editing-review:${jobId}`) as { value_json: string } | undefined;
    return row ? JSON.parse(row.value_json).receipt : undefined;
  }
  start(
    kind: 'autoCut' | 'screenPolish',
    input: { clipId: string; providerId: string; purpose?: string },
  ): EditingJob {
    const job =
      kind === 'autoCut'
        ? this.options.autoCut.generate(input)
        : this.options.screenPolish.generate({
            clipId: input.clipId,
            providerId: input.providerId,
          });
    return this.read(job.id);
  }
  read(jobId: string): EditingJob {
    const job = this.job(jobId);
    return {
      id: job.id,
      projectId: job.projectId,
      kind: job.kind,
      status: job.status,
      stage: job.stage,
      progress: job.progress,
      error: job.error,
      reviewStatus:
        this.state(jobId) ??
        (this.selections.has(jobId) ? 'awaiting-review' : 'none'),
    };
  }
  cancel(jobId: string): EditingJob {
    this.job(jobId);
    if (this.state(jobId) === 'applied') return this.read(jobId);
    this.options.jobs.cancel(jobId);
    this.save(jobId, 'cancelled');
    this.selections.delete(jobId);
    return this.read(jobId);
  }
  proposal(jobId: string): EditingProposal | null {
    const job = this.job(jobId);
    if (job.status !== 'succeeded') return null;
    if (job.kind === 'analysis.autoCut') {
      const p = this.options.autoCut.proposal(jobId);
      return (
        p && {
          jobId,
          projectId: p.projectId,
          clipId: p.clipId,
          assetId: p.assetId,
          fingerprint: p.fingerprint,
          kind: 'autoCut',
          frameSpace: 'source',
          changes: p.removals.map((r) => ({
            ...r,
            evidenceFrames: [],
            description: 'Remove section',
          })),
        }
      );
    }
    const p = this.options.screenPolish.proposal(jobId);
    return (
      p && {
        jobId,
        projectId: p.projectId,
        clipId: p.clipId,
        assetId: p.assetId,
        fingerprint: p.fingerprint,
        kind: 'screenPolish',
        frameSpace: 'sequence',
        changes: p.suggestions.map((s) => ({
          id: s.id,
          startFrame: s.startFrame,
          endFrame: s.startFrame + s.durationFrames,
          reason: s.reason,
          evidenceFrames: s.evidenceFrames,
          description: `${s.kind}${s.text ? ': ' + s.text : ''}`,
        })),
      }
    );
  }
  private validate(jobId: string, changeIds: readonly string[]): EditCommand {
    if (this.state(jobId))
      throw new Error(
        'This proposal was already applied or cancelled. Analyse again.',
      );
    const proposal = this.proposal(jobId);
    if (!proposal)
      throw new Error('Wait for editing analysis to succeed before review.');
    if (
      !changeIds.length ||
      new Set(changeIds).size !== changeIds.length ||
      changeIds.some((id) => !proposal.changes.some((c) => c.id === id))
    )
      throw new Error('Select unique changes from the stored proposal.');
    if (proposal.kind === 'autoCut')
      return this.options.autoCut.prepare({
        jobId,
        removalIds: [...changeIds],
      });
    const stored = this.options.screenPolish.proposal(jobId)!;
    return this.options.screenPolish.prepare({
      jobId,
      suggestions: stored.suggestions.filter((s) => changeIds.includes(s.id)),
    });
  }
  requestApply(jobId: string, changeIds: readonly string[]) {
    this.validate(jobId, changeIds);
    this.selections.set(jobId, [...changeIds]);
    return { status: 'awaiting-review' as const, jobId };
  }
  reviews(): EditingReview[] {
    const projectId = this.options.projects.current()?.project.id;
    if (!projectId) return [];
    return this.options.jobs
      .list(projectId)
      .filter((j) =>
        ['analysis.autoCut', 'analysis.screenPolish'].includes(j.kind),
      )
      .slice(0, 40)
      .map((job) => {
        const proposal = this.proposal(job.id);
        return {
          job: this.read(job.id),
          proposal,
          receipt: this.receipt(job.id),
          selectedIds:
            this.selections.get(job.id) ??
            proposal?.changes.map((c) => c.id) ??
            [],
        };
      });
  }
  /** Synchronous revalidation and commit; never exposed as a model tool. */
  confirm(jobId: string, changeIds: readonly string[], context: ToolContext) {
    return this.options.database.transaction(() => {
      const command = this.validate(jobId, changeIds);
      const result = context.apply(command, {
        label: 'Apply reviewed AI edits',
      });
      this.save(jobId, 'applied');
      this.selections.delete(jobId);
      return result;
    })();
  }
}
