import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { assetSchema, clipSchema, newId } from '@kerf/model';
import { openDatabase } from '../db';
import { ProjectRepository, ProjectService } from '../projects';
import { ToolService } from '../tools/service';
import type { runProcess } from '../media/ffmpeg';
import { AudioFinishingService } from './finishing';
const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((f) => f()));
function fixture(stats = { input_i: '-20.0', input_tp: '-17.0' }) {
  const root = mkdtempSync(join(tmpdir(), 'kerf-audio-'));
  const db = openDatabase({ filename: join(root, 'test.db') });
  const repository = new ProjectRepository({
    database: db.connection,
    projectsRoot: join(root, 'projects'),
  });
  const projects = new ProjectService({ repository });
  const snapshot = projects.create({ name: 'Audio test' });
  const path = join(root, 'source.wav');
  writeFileSync(path, 'Fixture media boundary');
  const stat = statSync(path);
  const asset = repository.saveAsset(
    assetSchema.parse({
      id: newId('asset'),
      projectId: snapshot.project.id,
      name: 'Tone',
      kind: 'audio',
      sourcePath: path,
      status: 'ready',
      hasAudio: true,
      durationSeconds: 3,
      fileSize: stat.size,
      mtimeMs: stat.mtimeMs,
      importedAt: 1,
      updatedAt: 1,
    }),
  );
  projects.reloadAssets();
  const clip = clipSchema.parse({
    id: newId('clip'),
    trackId: snapshot.project.sequence.tracks.find((t) => t.kind === 'audio')!
      .id,
    type: 'audio',
    assetId: asset.id,
    startFrame: 0,
    durationFrames: 72,
  });
  projects.apply({ type: 'clip.insert', clip });
  let now = 1;
  const run = vi.fn<typeof runProcess>(async () => ({
    stdout: '',
    stderr: JSON.stringify(stats),
    code: 0,
  }));
  const audio = new AudioFinishingService({
    projects,
    run,
    ffmpegPath: '/fixture-ffmpeg',
    now: () => now,
  });
  const unused = () => {
    throw new Error('unused');
  };
  const tools = new ToolService({
    projects,
    repository,
    audio,
    exports: {
      list: () => [],
      get: () => null,
      start: unused,
      cancel: () => false,
    },
  });
  cleanup.push(() => {
    audio.dispose();
    db.close();
    rmSync(root, { recursive: true, force: true });
  });
  return {
    audio,
    tools,
    projects,
    clip,
    run,
    path,
    expire: () => {
      now += 300_001;
    },
  };
}
it('caches revision-scoped measurements and applies reviewed gain/fades once with exact undo', async () => {
  const f = fixture();
  const before = f.projects.current()!.project.sequence;
  const measured = await f.tools.audioMeasure({ clipIds: [f.clip.id] });
  expect(measured).toMatchObject({
    integratedLufs: -20,
    truePeakDbtp: -17,
    startFrame: 0,
    endFrame: 72,
    units: { loudness: 'LUFS', truePeak: 'dBTP' },
  });
  expect((await f.tools.audioMeasure({ clipIds: [f.clip.id] })).id).toBe(
    measured.id,
  );
  expect(f.run).toHaveBeenCalledOnce();
  const plan = await f.tools.audioGain({
    measurementId: measured.id,
    targetLufs: -14,
    peakCeilingDbtp: -1,
    fadeMs: 50,
  });
  expect(plan).toMatchObject({
    status: 'ready',
    gainDb: 6,
    estimatedPeakDbtp: -11,
  });
  expect(f.projects.current()!.project.sequence).toEqual(before);
  expect((await f.tools.audioConfirm(plan.id)).receipt?.undoable).toBe(true);
  const next = f.projects
    .current()!
    .project.sequence.tracks.flatMap((t) => t.clips)
    .find((c) => c.id === f.clip.id)!;
  expect(next).toMatchObject({
    volume: 10 ** (6 / 20),
    fade: { inFrames: 2, outFrames: 2 },
  });
  await expect(f.tools.audioConfirm(plan.id)).rejects.toThrow(
    'already applied',
  );
  f.projects.undo();
  expect(f.projects.current()!.project.sequence).toEqual(before);
});
it('reports unattainable peak headroom without introducing a limiter or edits', async () => {
  const f = fixture();
  const before = f.projects.current()!.project.sequence;
  const measured = await f.tools.audioMeasure({ clipIds: [f.clip.id] });
  const plan = await f.tools.audioGain({
    measurementId: measured.id,
    targetLufs: -14,
    peakCeilingDbtp: -12,
    fadeMs: 0,
  });
  expect(plan.status).toBe('unattainable');
  expect(plan.warnings.join(' ')).toContain('exceed the peak ceiling');
  await expect(f.tools.audioConfirm(plan.id)).rejects.toThrow('unattainable');
  expect(f.projects.current()!.project.sequence).toEqual(before);
});
it.each([
  { input_i: '-inf', input_tp: '-inf', status: 'silence' },
  { input_i: '-inf', input_tp: '-35', status: 'insufficient' },
])(
  'reports $status without a fabricated loudness value',
  async ({ input_i, input_tp, status }) => {
    const f = fixture({ input_i, input_tp });
    const measured = await f.tools.audioMeasure({ clipIds: [f.clip.id] });
    expect(measured.status).toBe(status);
    expect(measured.integratedLufs).toBeNull();
    await expect(
      f.tools.audioGain({
        measurementId: measured.id,
        targetLufs: -16,
        peakCeilingDbtp: -1,
        fadeMs: 0,
      }),
    ).rejects.toThrow();
  },
);
it('rejects replaced sources, expired plans and another project', async () => {
  const f = fixture();
  const measured = await f.tools.audioMeasure({ clipIds: [f.clip.id] });
  const plan = await f.tools.audioGain({
    measurementId: measured.id,
    targetLufs: -20,
    peakCeilingDbtp: -1,
    fadeMs: 0,
  });
  writeFileSync(f.path, 'Replaced content');
  expect(f.audio.read(plan.id).status).toBe('stale');
  await expect(f.tools.audioConfirm(plan.id)).rejects.toThrow('stale');
  f.expire();
  expect(() => f.audio.read(plan.id)).toThrow('expired');
  f.projects.create({ name: 'Other' });
  await expect(f.tools.audioMeasure({ clipIds: [f.clip.id] })).rejects.toThrow(
    'ready clips',
  );
});

it('cancels an in-flight measurement on project switching and caches no result', async () => {
  const f = fixture();
  f.run.mockImplementationOnce(
    (_command, _args, options) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener(
          'abort',
          () => reject(new Error('Cancelled measurement')),
          { once: true },
        );
      }),
  );
  const pending = f.tools.audioMeasure({
    clipIds: [f.clip.id],
    requestId: 'switch-project',
  });
  await vi.waitFor(() => expect(f.run).toHaveBeenCalledOnce());
  const rejected = expect(pending).rejects.toThrow('Cancelled');
  f.projects.create({ name: 'Switch during measurement' });
  await rejected;
  expect(f.audio.reviews()).toEqual([]);
});
