import { z } from 'zod';
import { newId } from '@kerf/model';
import type { DatabaseLogger, SqliteDatabase } from '../db';
import type { JobStatus, JobSummary } from '../../shared/contracts';

export interface JobContext {
  readonly job: JobSummary;
  readonly signal: AbortSignal;
  update(progress: number, stage?: string): void;
}

export type JobHandler = (
  payload: unknown,
  context: JobContext,
) => Promise<unknown> | unknown;

export interface EnqueueJobInput {
  readonly projectId: string | null;
  readonly kind: string;
  readonly payload?: unknown;
}

export interface JobQueueOptions {
  readonly database: SqliteDatabase;
  readonly now?: () => number;
  readonly logger?: DatabaseLogger;
}

interface JobRow {
  id: string;
  project_id: string | null;
  kind: string;
  status: string;
  progress: number;
  error: string | null;
  payload_json: string;
  created_at: number;
  updated_at: number;
  stage: string;
  result_json: string | null;
  started_at: number | null;
  finished_at: number | null;
  cancel_requested: number;
}

const jobStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);

function parseJson(value: string | null): unknown {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function parseStatus(value: string): JobStatus {
  const parsed = jobStatusSchema.safeParse(value);
  return parsed.success ? parsed.data : 'failed';
}

function targetIdFromPayload(payloadJson: string): string | null {
  const payload = parseJson(payloadJson);
  if (
    payload &&
    typeof payload === 'object' &&
    'assetId' in payload &&
    typeof payload.assetId === 'string'
  ) {
    return payload.assetId;
  }
  return null;
}

function summaryFromRow(row: JobRow): JobSummary {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    targetId: targetIdFromPayload(row.payload_json),
    status: parseStatus(row.status),
    stage: row.stage,
    progress: Math.max(0, Math.min(1, row.progress)),
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A sequential, SQLite-backed queue. The worker only holds one process at a
 * time, so ingest cannot saturate the machine, and every state change survives
 * a crash or a restart.
 */
export class JobQueue {
  private readonly database: SqliteDatabase;
  private readonly now: () => number;
  private readonly logger?: DatabaseLogger;
  private readonly handlers = new Map<string, JobHandler>();
  private readonly listeners = new Set<(job: JobSummary) => void>();
  private running = false;
  private stopping = false;
  private draining = false;
  private active: { id: string; controller: AbortController } | null = null;

  constructor(options: JobQueueOptions) {
    this.database = options.database;
    this.now = options.now ?? Date.now;
    this.logger = options.logger;
  }

  registerHandler(kind: string, handler: JobHandler): void {
    this.handlers.set(kind, handler);
  }

  subscribe(listener: (job: JobSummary) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.stopping = false;

    const interrupted = this.database
      .prepare("SELECT id FROM jobs WHERE status = 'running'")
      .all() as Array<{ id: string }>;
    this.database
      .prepare(
        "UPDATE jobs SET status = 'failed', error = 'Visual narration was interrupted. Generate again explicitly to resume provider use.', finished_at = ?, updated_at = ? WHERE status = 'running' AND kind = 'analysis.visualNarration'",
      )
      .run(this.now(), this.now());
    this.database
      .prepare(
        "UPDATE jobs SET status = 'failed', error = 'Speech generation was interrupted. Generate again explicitly to resume provider use.', finished_at = ?, updated_at = ? WHERE status = 'running' AND kind = 'narration.tts'",
      )
      .run(this.now(), this.now());
    this.database
      .prepare(
        `UPDATE jobs SET
          status = 'queued', stage = '', progress = 0, error = NULL,
          started_at = NULL, cancel_requested = 0, updated_at = ?
        WHERE status = 'running'`,
      )
      .run(this.now());
    for (const row of interrupted) {
      const job = this.get(row.id);
      if (job) {
        this.emit(job);
      }
    }

    this.pump();
  }

  stop(): void {
    this.running = false;
    this.stopping = true;
    this.active?.controller.abort();
  }

  enqueue(input: EnqueueJobInput): JobSummary {
    const id = newId('job');
    const now = this.now();
    this.database
      .prepare(
        `INSERT INTO jobs (
          id, project_id, kind, status, progress, error, payload_json,
          created_at, updated_at, stage
        ) VALUES (
          @id, @project_id, @kind, 'queued', 0, NULL, @payload_json,
          @created_at, @updated_at, ''
        )`,
      )
      .run({
        id,
        project_id: input.projectId,
        kind: input.kind,
        payload_json: JSON.stringify(input.payload ?? {}),
        created_at: now,
        updated_at: now,
      });

    const job = this.get(id);
    if (!job) {
      throw new Error('The queued job could not be read back.');
    }
    this.emit(job);
    this.pump();
    return job;
  }

  list(projectId?: string): JobSummary[] {
    const rows = (
      projectId === undefined
        ? this.database
            .prepare('SELECT * FROM jobs ORDER BY created_at DESC')
            .all()
        : this.database
            .prepare(
              'SELECT * FROM jobs WHERE project_id = ? ORDER BY created_at DESC',
            )
            .all(projectId)
    ) as JobRow[];
    return rows.map(summaryFromRow);
  }

  get(id: string): JobSummary | null {
    const row = this.database
      .prepare('SELECT * FROM jobs WHERE id = ?')
      .get(id) as JobRow | undefined;
    return row ? summaryFromRow(row) : null;
  }

  cancel(id: string): boolean {
    const job = this.get(id);
    if (!job) {
      return false;
    }
    if (job.status === 'queued') {
      const now = this.now();
      this.database
        .prepare(
          `UPDATE jobs SET
            status = 'cancelled', stage = 'cancelled', progress = 0,
            finished_at = ?, updated_at = ?
          WHERE id = ? AND status = 'queued'`,
        )
        .run(now, now, id);
      const cancelled = this.get(id);
      if (cancelled) {
        this.emit(cancelled);
      }
      return true;
    }

    if (job.status === 'running') {
      this.database
        .prepare(
          'UPDATE jobs SET cancel_requested = 1, updated_at = ? WHERE id = ?',
        )
        .run(this.now(), id);
      if (this.active?.id === id) {
        this.active.controller.abort();
      }
      return true;
    }

    return false;
  }

  private pump(): void {
    if (!this.running || this.draining || this.stopping) {
      return;
    }
    this.draining = true;
    void this.drain().finally(() => {
      this.draining = false;
      if (this.running && !this.stopping && this.hasQueued()) {
        this.pump();
      }
    });
  }

  private async drain(): Promise<void> {
    while (this.running && !this.stopping) {
      const row = this.database
        .prepare(
          "SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1",
        )
        .get() as JobRow | undefined;
      if (!row) {
        return;
      }
      await this.runJob(row);
    }
  }

  private async runJob(row: JobRow): Promise<void> {
    const now = this.now();
    const started = this.database
      .prepare(
        `UPDATE jobs SET
          status = 'running', stage = 'starting', progress = 0, error = NULL,
          started_at = ?, finished_at = NULL, cancel_requested = 0, updated_at = ?
        WHERE id = ? AND status = 'queued'`,
      )
      .run(now, now, row.id);
    if (started.changes === 0) {
      return;
    }

    const controller = new AbortController();
    this.active = { id: row.id, controller };
    let job = this.get(row.id);
    if (!job) {
      return;
    }
    this.emit(job);

    const handler = this.handlers.get(row.kind);
    if (!handler) {
      this.finish(
        row.id,
        'failed',
        `No handler is registered for ${row.kind}.`,
      );
      if (this.active?.id === row.id) {
        this.active = null;
      }
      return;
    }

    const update = (progress: number, stage?: string) => {
      if (controller.signal.aborted) {
        const error = new Error('The job was cancelled.');
        error.name = 'AbortError';
        throw error;
      }
      const clamped = Math.max(0, Math.min(1, progress));
      const updatedAt = this.now();
      this.database
        .prepare(
          `UPDATE jobs SET progress = ?, stage = ?, updated_at = ?
           WHERE id = ? AND status = 'running'`,
        )
        .run(clamped, stage ?? job?.stage ?? '', updatedAt, row.id);
      job = this.get(row.id);
      if (job) {
        this.emit(job);
      }
    };

    try {
      const result = await handler(parseJson(row.payload_json), {
        job,
        signal: controller.signal,
        update,
      });
      if (this.stopping) {
        return;
      }
      if (controller.signal.aborted) {
        this.finish(row.id, 'cancelled', null, null);
        return;
      }
      this.finish(row.id, 'succeeded', null, result);
      this.logger?.info('Job finished', { id: row.id, kind: row.kind });
    } catch (error) {
      if (this.stopping) {
        return;
      }
      if (controller.signal.aborted || isAbortError(error)) {
        this.finish(row.id, 'cancelled', null);
      } else {
        this.finish(row.id, 'failed', errorText(error));
        this.logger?.warn?.('Job failed', {
          id: row.id,
          kind: row.kind,
          error: errorText(error),
        });
      }
    } finally {
      if (this.active?.id === row.id) {
        this.active = null;
      }
    }
  }

  private finish(
    id: string,
    status: JobStatus,
    error: string | null,
    result?: unknown,
  ): void {
    const now = this.now();
    const current = this.get(id);
    this.database
      .prepare(
        `UPDATE jobs SET
          status = ?, stage = ?, progress = ?, error = ?, result_json = ?,
          finished_at = ?, updated_at = ?, cancel_requested = 0
        WHERE id = ?`,
      )
      .run(
        status,
        status === 'succeeded'
          ? current?.kind === 'analysis.visualNarration'
            ? current.stage
            : 'done'
          : status,
        status === 'succeeded' ? 1 : (this.get(id)?.progress ?? 0),
        error,
        result === undefined ? null : JSON.stringify(result),
        now,
        now,
        id,
      );
    const job = this.get(id);
    if (job) {
      this.emit(job);
    }
  }

  private hasQueued(): boolean {
    const row = this.database
      .prepare("SELECT 1 AS present FROM jobs WHERE status = 'queued' LIMIT 1")
      .get() as { present: number } | undefined;
    return row !== undefined;
  }

  private emit(job: JobSummary): void {
    for (const listener of this.listeners) {
      listener(job);
    }
  }
}
