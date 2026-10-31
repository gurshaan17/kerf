import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db';
import type { DatabaseHandle } from '../db';
import type { JobSummary } from '../../shared/contracts';
import { JobQueue } from './queue';

const contexts: Array<{
  queue: JobQueue;
  database: DatabaseHandle;
  root: string;
}> = [];

function makeQueue(): { queue: JobQueue; database: DatabaseHandle } {
  const root = mkdtempSync(join(tmpdir(), 'kerf-jobs-'));
  const database = openDatabase({ filename: join(root, 'kerf.db') });
  let now = 1_000;
  const queue = new JobQueue({
    database: database.connection,
    now: () => {
      now += 1;
      return now;
    },
  });
  contexts.push({ queue, database, root });
  return { queue, database };
}

afterEach(() => {
  for (const context of contexts.splice(0)) {
    context.queue.stop();
    context.database.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

async function waitFor(
  condition: () => boolean,
  timeoutMs = 3_000,
): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('Timed out waiting for the queue.');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function statusOf(queue: JobQueue, id: string): string | undefined {
  return queue.get(id)?.status;
}

describe('JobQueue', () => {
  it('runs jobs sequentially and persists stage, progress and results', async () => {
    const { queue } = makeQueue();
    const order: string[] = [];
    const progress: number[] = [];
    const updates: JobSummary[] = [];
    queue.subscribe((job) => {
      updates.push(job);
      progress.push(job.progress);
    });
    queue.registerHandler('ingest', async (payload, context) => {
      order.push((payload as { name: string }).name);
      context.update(0.25, 'probing');
      await new Promise((resolve) => setTimeout(resolve, 15));
      context.update(0.75, 'encoding');
      return { staged: true };
    });

    const first = queue.enqueue({
      projectId: null,
      kind: 'ingest',
      payload: { name: 'first', assetId: 'ast_one' },
    });
    const second = queue.enqueue({
      projectId: null,
      kind: 'ingest',
      payload: { name: 'second' },
    });
    queue.start();

    await waitFor(
      () =>
        statusOf(queue, first.id) === 'succeeded' &&
        statusOf(queue, second.id) === 'succeeded',
    );

    expect(order).toEqual(['first', 'second']);
    expect(queue.get(first.id)).toMatchObject({
      status: 'succeeded',
      stage: 'done',
      progress: 1,
      error: null,
    });
    expect(queue.get(first.id)?.startedAt).not.toBeNull();
    expect(queue.get(first.id)?.finishedAt).not.toBeNull();
    expect(queue.get(first.id)?.targetId).toBe('ast_one');
    expect(progress.some((value) => value === 0.25)).toBe(true);
    expect(progress.at(-1)).toBe(1);
    expect(updates.some((job) => job.stage === 'encoding')).toBe(true);
  });

  it('cancels a queued job without invoking its handler', async () => {
    const { queue } = makeQueue();
    let calls = 0;
    queue.registerHandler('ingest', () => {
      calls += 1;
    });
    const job = queue.enqueue({
      projectId: null,
      kind: 'ingest',
      payload: {},
    });

    expect(queue.cancel(job.id)).toBe(true);
    expect(queue.get(job.id)?.status).toBe('cancelled');
    queue.start();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(calls).toBe(0);
    expect(queue.cancel(job.id)).toBe(false);
  });

  it('aborts a running job and marks it cancelled', async () => {
    const { queue } = makeQueue();
    queue.registerHandler('ingest', (_payload, context) => {
      return new Promise((_resolve, reject) => {
        context.signal.addEventListener('abort', () => {
          const error = new Error('Stopped');
          error.name = 'AbortError';
          reject(error);
        });
      });
    });

    const job = queue.enqueue({
      projectId: null,
      kind: 'ingest',
      payload: {},
    });
    queue.start();
    await waitFor(() => statusOf(queue, job.id) === 'running');
    expect(queue.cancel(job.id)).toBe(true);
    await waitFor(() => statusOf(queue, job.id) === 'cancelled');
    expect(queue.get(job.id)?.stage).toBe('cancelled');
  });

  it('resumes an interrupted running job on the next start', async () => {
    const { queue, database } = makeQueue();
    let calls = 0;
    queue.registerHandler('ingest', () => {
      calls += 1;
    });
    const job = queue.enqueue({
      projectId: null,
      kind: 'ingest',
      payload: {},
    });
    database.connection
      .prepare(
        "UPDATE jobs SET status = 'running', stage = 'encoding', progress = 0.4 WHERE id = ?",
      )
      .run(job.id);

    queue.start();
    await waitFor(() => statusOf(queue, job.id) === 'succeeded');
    expect(calls).toBe(1);
    expect(queue.get(job.id)?.progress).toBe(1);
  });

  it.each(['analysis.visualNarration', 'narration.tts'])(
    'does not automatically resume an interrupted %s provider job',
    (kind) => {
      const { queue, database } = makeQueue();
      let calls = 0;
      queue.registerHandler(kind, () => {
        calls++;
      });
      const job = queue.enqueue({
        projectId: null,
        kind,
        payload: {},
      });
      database.connection
        .prepare("UPDATE jobs SET status='running' WHERE id=?")
        .run(job.id);
      queue.start();
      expect(queue.get(job.id)?.status).toBe('failed');
      expect(calls).toBe(0);
      expect(queue.get(job.id)?.error).toContain('explicitly');
    },
  );

  it('fails a job when no handler is registered', async () => {
    const { queue } = makeQueue();
    const job = queue.enqueue({
      projectId: null,
      kind: 'unknown',
      payload: {},
    });
    queue.start();
    await waitFor(() => statusOf(queue, job.id) === 'failed');
    expect(queue.get(job.id)?.error).toContain('No handler');
  });
});
