import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assetSchema,
  clipSchema,
  createAsset,
  createTranscript,
  newId,
} from '@kerf/model';
import { openDatabase } from '../db';
import { JobQueue } from '../jobs';
import { ProjectRepository, ProjectService } from '../projects';
import { ProviderStore } from './providers';
import { AutoCutService } from './auto-cut-service';

const { analyse, transcribe, runFfmpeg } = vi.hoisted(() => ({
  analyse: vi.fn(),
  transcribe: vi.fn(),
  runFfmpeg: vi.fn(),
}));
vi.mock('./auto-cut', () => ({ analyseAutoCut: analyse }));
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
  const service = new AutoCutService({
    projects,
    repository,
    jobs,
    providers,
    userData: root,
  });
  const request = {
    clipId: clip.id,
    providerId: provider.id,
    purpose: 'Keep the demonstration',
  };
  analyse.mockResolvedValue({
    removals: [
      { id: 'unit_1', startFrame: 48, endFrame: 96, reason: 'Repeated setup' },
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

describe('Auto cut service', () => {
  it('persists a proposal without editing, then applies and undoes one batch', async () => {
    const f = fixture();
    const before = f.projects.current()!.project.sequence;
    const job = f.service.generate(f.request);
    expect((await finished(f.jobs, job.id)).status).toBe('succeeded');
    const proposal = f.service.proposal(job.id)!;
    expect(proposal.removals).toHaveLength(1);
    expect(f.projects.current()!.project.sequence).toEqual(before);
    const result = f.service.apply({ jobId: job.id, removalIds: ['unit_1'] });
    expect(result.command?.actor).toBe('user');
    expect(result.command?.command.type).toBe('batch');
    expect(f.projects.undo()!.snapshot.project.sequence).toEqual(before);
  });
  it('rejects stale and forged removals', async () => {
    const f = fixture();
    const job = f.service.generate(f.request);
    await finished(f.jobs, job.id);
    expect(() =>
      f.service.apply({ jobId: job.id, removalIds: ['forged'] }),
    ).toThrow('proposal');
    expect(() =>
      f.service.apply({ jobId: job.id, removalIds: ['unit_1', 'unit_1'] }),
    ).toThrow('proposal');
    f.projects.apply({ type: 'clip.move', clipId: f.clip.id, startFrame: 1 });
    expect(() =>
      f.service.apply({ jobId: job.id, removalIds: ['unit_1'] }),
    ).toThrow('changed');
  });
  it('rejects source replacement after analysis', async () => {
    const f = fixture();
    const job = f.service.generate(f.request);
    await finished(f.jobs, job.id);
    writeFileSync(f.path, 'replacement source');
    expect(() =>
      f.service.apply({ jobId: job.id, removalIds: ['unit_1'] }),
    ).toThrow('source file changed');
  });
  it('requires both consents and fails when consent changes during analysis', async () => {
    const f = fixture();
    f.providers.save({ ...f.provider, visionConsent: false });
    expect(() => f.service.generate(f.request)).toThrow('consent');
    f.providers.save({ ...f.provider, chatConsent: false });
    expect(() => f.service.generate(f.request)).toThrow('consent');
    f.providers.save({ ...f.provider });
    analyse.mockImplementation(async () => {
      f.providers.save({ ...f.provider, visionConsent: false });
      return { removals: [], sampleCount: 1 };
    });
    const job = f.service.generate(f.request);
    expect((await finished(f.jobs, job.id)).status).toBe('failed');
    expect(f.service.proposal(job.id)).toBeNull();
  });
  it('fails stale analysis and redacts provider secrets from persisted errors', async () => {
    const f = fixture();
    analyse.mockImplementation(async () => {
      f.projects.apply({ type: 'clip.move', clipId: f.clip.id, startFrame: 1 });
      return { removals: [], sampleCount: 1 };
    });
    const job = f.service.generate(f.request);
    expect((await finished(f.jobs, job.id)).error).toContain('changed');
    analyse.mockRejectedValue(new Error('Provider failed with test-secret'));
    const retry = f.service.generate(f.request);
    expect((await finished(f.jobs, retry.id)).error).toBe(
      'Provider failed with [redacted]',
    );
  });
  it('cancels on project close and scopes access to the open project', async () => {
    const f = fixture();
    analyse.mockImplementation(async (input) => {
      f.projects.close();
      input.signal.throwIfAborted();
    });
    const job = f.service.generate(f.request);
    expect((await finished(f.jobs, job.id)).status).toBe('cancelled');
    expect(() => f.service.proposal(job.id)).toThrow('open project');
  });
  it('does not resume queued provider use on restart', () => {
    const f = fixture();
    f.jobs.stop();
    const job = f.service.generate(f.request);
    const reopened = new JobQueue({ database: f.database.connection });
    reopened.start();
    expect(reopened.get(job.id)?.status).toBe('failed');
    expect(analyse).not.toHaveBeenCalled();
    reopened.stop();
  });
  it('automatically transcribes only the selected source range without replacing stored narration', async () => {
    const f = fixture(true);
    transcribe.mockResolvedValue(
      createTranscript({ assetId: f.asset.id, segments: [] }),
    );
    const job = f.service.generate(f.request);
    expect((await finished(f.jobs, job.id)).status).toBe('succeeded');
    expect(runFfmpeg).toHaveBeenCalledWith(
      '/ffmpeg',
      expect.arrayContaining(['-ss', '0', '-t', '10']),
      expect.anything(),
    );
    expect(transcribe).toHaveBeenCalledOnce();
    expect(f.projects.current()!.transcripts).toHaveLength(0);
  });
});
