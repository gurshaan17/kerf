import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../db';
import { ProjectRepository } from '../projects/repository';
import { ProjectService } from '../projects/service';
import { ExportService } from './service';
import type { ExportEncoder } from './service';
import type { ExportEvent } from '../../shared/contracts';

const cleanups: Array<() => void> = [];

function makeServices(customEncoder?: ExportEncoder) {
  const root = mkdtempSync(join(tmpdir(), 'kerf-export-'));
  const database = openDatabase({ filename: join(root, 'kerf.db') });
  const repository = new ProjectRepository({
    database: database.connection,
    projectsRoot: join(root, 'projects'),
    now: () => 10_000,
  });
  const projects = new ProjectService({ repository, now: () => 10_000 });
  const created = projects.create({ name: 'Export test', now: 1_000 });
  repository.saveProject({
    ...created.project,
    sequence: { ...created.project.sequence, durationFrames: 240 },
  });
  const snapshot = projects.open(created.project.id);
  const events: ExportEvent[] = [];
  const encode =
    customEncoder ??
    vi.fn(async (plan: { outputPath: string }) => {
      writeFileSync(plan.outputPath, 'encoded');
    });
  const exports = new ExportService({
    repository,
    projects,
    now: () => 20_000,
    onEvent: (event) => events.push(event),
    encode,
  });
  cleanups.push(() => {
    exports.dispose();
    database.close();
    rmSync(root, { recursive: true, force: true });
  });
  return {
    root,
    snapshot,
    exports,
    events,
    encode,
  };
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

describe('ExportService', () => {
  it('renders frames in order, encodes and records history', async () => {
    const { root, snapshot, exports, events, encode } = makeServices();
    const outputPath = join(root, 'out.mp4');
    const result = exports.start({
      presetId: '720p',
      startFrame: 0,
      endFrame: 2,
      outputPath,
    });

    expect(result).toMatchObject({
      width: 1280,
      height: 720,
      frameCount: 2,
    });
    expect(exports.list(snapshot.project.id)[0]?.status).toBe('rendering');

    await exports.writeFrame(result.export.id, 0, new Uint8Array([1]));
    await exports.writeFrame(result.export.id, 1, new Uint8Array([2]));
    const finished = await exports.finish(result.export.id);

    expect(finished.status).toBe('succeeded');
    expect(finished.progress).toBe(1);
    expect(finished.completedAt).toBe(20_000);
    expect(existsSync(outputPath)).toBe(true);
    expect(encode).toHaveBeenCalledTimes(1);
    expect(events.at(-1)?.export.status).toBe('succeeded');
    expect(exports.list(snapshot.project.id)[0]).toMatchObject({
      status: 'succeeded',
      outputPath,
    });
  });

  it('rejects out-of-order frames and cancels cleanly', async () => {
    const { root, exports } = makeServices();
    const result = exports.start({
      presetId: 'sequence',
      startFrame: 0,
      endFrame: 2,
      outputPath: join(root, 'cancel.mp4'),
    });

    await expect(
      exports.writeFrame(result.export.id, 1, new Uint8Array([1])),
    ).rejects.toThrow(/in order/);
    expect(exports.cancel(result.export.id)).toBe(true);
    await expect(
      exports.writeFrame(result.export.id, 0, new Uint8Array([1])),
    ).rejects.toThrow(/no longer running/);
    expect(exports.list()[0]?.status).toBe('cancelled');
  });

  it('removes a partial output when encoding is cancelled', async () => {
    let signalEncoding: () => void = () => undefined;
    const encoding = new Promise<void>((resolve) => {
      signalEncoding = resolve;
    });
    const { root, exports } = makeServices(async (plan, options) => {
      writeFileSync(plan.outputPath, 'partial');
      signalEncoding();
      await new Promise((_, reject) => {
        options.signal.addEventListener(
          'abort',
          () => reject(new Error('cancelled')),
          { once: true },
        );
      });
    });
    const outputPath = join(root, 'partial.mp4');
    const result = exports.start({
      presetId: 'sequence',
      startFrame: 0,
      endFrame: 2,
      outputPath,
    });
    await exports.writeFrame(result.export.id, 0, new Uint8Array([1]));
    await exports.writeFrame(result.export.id, 1, new Uint8Array([2]));

    const finish = exports.finish(result.export.id);
    await encoding;
    expect(existsSync(outputPath)).toBe(true);
    expect(exports.cancel(result.export.id)).toBe(true);
    const record = await finish;

    expect(record.status).toBe('cancelled');
    expect(existsSync(outputPath)).toBe(false);
  });

  it('allows only one active export at a time', () => {
    const { root, exports } = makeServices();
    exports.start({
      presetId: 'sequence',
      startFrame: 0,
      endFrame: 1,
      outputPath: join(root, 'first.mp4'),
    });

    expect(() =>
      exports.start({
        presetId: 'sequence',
        startFrame: 0,
        endFrame: 1,
        outputPath: join(root, 'second.mp4'),
      }),
    ).toThrow(/current export/);
  });
});
