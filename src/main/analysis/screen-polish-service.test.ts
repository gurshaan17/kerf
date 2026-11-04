import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assetSchema, clipSchema, createAsset, newId } from '@kerf/model';
import { openDatabase } from '../db';
import { JobQueue } from '../jobs';
import { ProjectRepository, ProjectService } from '../projects';
import { ProviderStore } from './providers';
import { ScreenPolishService } from './screen-polish-service';

const { analyse, transcribe, runFfmpeg } = vi.hoisted(() => ({
  analyse: vi.fn(),
  transcribe: vi.fn(),
  runFfmpeg: vi.fn(),
}));
vi.mock('./screen-polish', () => ({ analyseScreenPolish: analyse }));
vi.mock('./transcribe', () => ({ transcribeAsset: transcribe }));
vi.mock('./whisper', () => ({
  findWhisperBinary: () => '/whisper',
  findModelPath: () => '/model',
  modelRootFor: () => '/models',
}));
vi.mock('../media/ffmpeg', () => ({
  findExecutable: () => '/ffmpeg',
  runFfmpeg,
}));
const cleanups: (() => void)[] = [];
beforeEach(() => {
  analyse.mockReset();
  transcribe.mockReset();
  runFfmpeg.mockReset();
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});
function fixture(audio = false) {
  const root = mkdtempSync(join(tmpdir(), 'kerf-auto-cut-'));
  const database = openDatabase({ filename: join(root, 'test.db') });
  const repository = new ProjectRepository({
    database: database.connection,
    projectsRoot: join(root, 'projects'),
  });
  const jobs = new JobQueue({ database: database.connection });
  const projects = new ProjectService({
    repository,
    jobs: (id) => jobs.list(id),
  });
  const snapshot = projects.create({ name: 'Auto cut test' });
  const path = join(root, 'video.mp4');
  writeFileSync(path, 'source');
  const stat = statSync(path);
  const asset = repository.saveAsset(
    assetSchema.parse({
      ...createAsset({
        projectId: snapshot.project.id,
        sourcePath: path,
        name: 'video.mp4',
        kind: 'video',
        status: 'ready',
        fileSize: stat.size,
        mtimeMs: stat.mtimeMs,
      }),
      width: 640,
      height: 360,
      hasVideo: true,
      hasAudio: audio,
      durationSeconds: 10,
      frameRate: { numerator: 24, denominator: 1 },
    }),
  );
  projects.refresh('assets');
  const clip = clipSchema.parse({
    id: newId('clip'),
    trackId: snapshot.project.sequence.tracks.find((t) => t.kind === 'video')!
      .id,
    type: 'video',
    assetId: asset.id,
    durationFrames: 240,
    startFrame: 0,
  });
  projects.apply({ type: 'clip.insert', clip });
  const providers = new ProviderStore({
    database: database.connection,
    secrets: { encrypt: (v) => Buffer.from(v), decrypt: (v) => v.toString() },
  });
  const provider = providers.save({
    kind: 'openai-compatible',
    label: 'Local test',
    model: 'vision',
    enabled: true,
    visionConsent: true,
    chatConsent: true,
    apiKey: 'test-secret',
  });
  const service = new ScreenPolishService({
    projects,
    repository,
    jobs,
    providers,
  });
  const request = {
    clipId: clip.id,
    providerId: provider.id,
  };
  analyse.mockResolvedValue({
    observations: [
      {
        startFrame: 48,
        endFrame: 96,
        evidenceFrames: [48, 72],
        kind: 'zoom',
        region: { x: 0.2, y: 0.3, w: 0.2, h: 0.1 },
        text: '',
        reason: 'Settings changed',
      },
    ],
    sampleCount: 5,
  });
  cleanups.push(() => {
    service.dispose();
    jobs.stop();
    database.close();
    rmSync(root, { recursive: true, force: true });
  });
  jobs.start();
  return {
    root,
    path,
    database,
    repository,
    jobs,
    projects,
    providers,
    provider,
    asset,
    clip,
    service,
    request,
  };
}
async function finished(jobs: JobQueue, id: string) {
  for (let i = 0; i < 500; i++) {
    const job = jobs.get(id)!;
    if (['succeeded', 'failed', 'cancelled'].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error('Job did not finish');
}

describe('screen polish service', () => {
  it('persists evidence without editing, applies adjusted suggestions, and undoes atomically', async () => {
    const f = fixture();
    const before = f.projects.current()!.project.sequence;
    const job = f.service.generate(f.request);
    expect((await finished(f.jobs, job.id)).status).toBe('succeeded');
    const proposal = f.service.proposal(job.id)!;
    expect(proposal.suggestions).toHaveLength(1);
    expect(f.projects.current()!.project.sequence).toEqual(before);
    const suggestion = {
      ...proposal.suggestions[0]!,
      kind: 'callout',
      text: 'Save settings',
      x: 0.7,
    };
    f.service.apply({ jobId: job.id, suggestions: [suggestion] });
    const overlay = f.projects
      .current()!
      .project.sequence.tracks.flatMap((t) => t.clips)
      .find((c) => c.type === 'fxOverlay');
    expect(overlay).toMatchObject({
      linkedItemId: f.clip.id,
      startFrame: 48,
      durationFrames: 48,
      props: { kind: 'callout', text: 'Save settings', pointer: { x: 0.7 } },
    });
    expect(() =>
      f.service.apply({ jobId: job.id, suggestions: [suggestion] }),
    ).toThrow('changed');
    expect(f.projects.undo()!.snapshot.project.sequence).toEqual(before);
  });
  it('maps letterboxed video regions and source trim to timeline coordinates', async () => {
    const f = fixture();
    f.projects.apply({
      type: 'clip.update',
      clipId: f.clip.id,
      patch: { sourceInFrame: 24, startFrame: 100, durationFrames: 120 },
    });
    f.projects.apply({ type: 'sequence.setCanvas', width: 1080, height: 1920 });
    const job = f.service.generate(f.request);
    expect((await finished(f.jobs, job.id)).status).toBe('succeeded');
    const row = f.service.proposal(job.id)!.suggestions[0]!;
    expect(row.startFrame).toBe(124);
    expect(row.x).toBeCloseTo(0.3);
    expect(row.y).toBeCloseTo((1 - 0.31640625) / 2 + 0.35 * 0.31640625);
    expect(row.height).toBeCloseTo(0.031640625);
    expect(row.evidenceFrames).toEqual([48, 72]);
  });
  it('rejects stale, forged, duplicate and out-of-bounds suggestions', async () => {
    const f = fixture();
    const job = f.service.generate(f.request);
    await finished(f.jobs, job.id);
    const row = f.service.proposal(job.id)!.suggestions[0]!;
    for (const suggestions of [
      [{ ...row, id: 'forged' }],
      [row, row],
      [{ ...row, durationFrames: 999 }],
    ])
      expect(() => f.service.apply({ jobId: job.id, suggestions })).toThrow();
    f.projects.apply({ type: 'clip.move', clipId: f.clip.id, startFrame: 1 });
    expect(() =>
      f.service.apply({ jobId: job.id, suggestions: [row] }),
    ).toThrow('changed');
  });
  it('requires vision consent and checks revocation before publishing results', async () => {
    const f = fixture();
    f.providers.save({ ...f.provider, visionConsent: false });
    expect(() => f.service.generate(f.request)).toThrow('consent');
    f.providers.save({ ...f.provider });
    analyse.mockImplementation(async () => {
      f.providers.save({ ...f.provider, visionConsent: false });
      return { observations: [], sampleCount: 1 };
    });
    const job = f.service.generate(f.request);
    expect((await finished(f.jobs, job.id)).status).toBe('failed');
    expect(f.service.proposal(job.id)).toBeNull();
  });
  it('rejects changed source files and redacts provider secrets in job errors', async () => {
    const f = fixture();
    const job = f.service.generate(f.request);
    await finished(f.jobs, job.id);
    writeFileSync(f.path, 'replacement');
    expect(() =>
      f.service.apply({
        jobId: job.id,
        suggestions: f.service.proposal(job.id)!.suggestions,
      }),
    ).toThrow('source file changed');
    const other = fixture();
    analyse.mockRejectedValue(new Error('test-secret failed'));
    const failed = other.service.generate(other.request);
    expect((await finished(other.jobs, failed.id)).error).toContain(
      '[redacted]',
    );
    expect(other.jobs.get(failed.id)!.error).not.toContain('test-secret');
  });
  it('cancels work on project close and never edits on cancellation', async () => {
    const f = fixture();
    analyse.mockImplementation(async (input) => {
      f.projects.close();
      input.signal.throwIfAborted();
      return { observations: [], sampleCount: 1 };
    });
    const job = f.service.generate(f.request);
    expect((await finished(f.jobs, job.id)).status).toBe('cancelled');
  });
});
