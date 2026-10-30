import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assetSchema,
  createAsset,
  createTranscript,
  newId,
  transcriptSchema,
  transcriptSegmentSchema,
} from '@kerf/model';
import type { NarrationGenerateRequest, TranscriptSegment } from '@kerf/model';
import { openDatabase } from '../db';
import { JobQueue } from '../jobs';
import { ProjectRepository, ProjectService } from '../projects';
import { AnalysisService } from './service';

const { generate } = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock('./visual-narration', () => ({ generateVisualNarration: generate }));
const cleanups: (() => void)[] = [];
beforeEach(() => {
  generate.mockReset();
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});
const segment = () =>
  transcriptSegmentSchema.parse({
    id: newId('segment'),
    text: 'Open visible settings',
    startFrame: 0,
    endFrame: 48,
    evidenceFrames: [0, 24],
  });
function fixture(existing = false) {
  const root = mkdtempSync(join(tmpdir(), 'kerf-narration-'));
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
  const project = projects.create({ name: 'Narration test' });
  const path = join(root, 'source.mp4');
  writeFileSync(path, 'test-media');
  const stat = statSync(path);
  const asset = repository.saveAsset(
    assetSchema.parse({
      ...createAsset({
        projectId: project.project.id,
        sourcePath: path,
        name: 'source.mp4',
        kind: 'video',
        status: 'ready',
        fileSize: stat.size,
        mtimeMs: stat.mtimeMs,
      }),
      hasVideo: true,
      durationSeconds: 10,
      frameRate: { numerator: 24, denominator: 1 },
    }),
  );
  if (existing)
    repository.commitNarration(
      transcriptSchema.parse({
        ...createTranscript({ assetId: asset.id, segments: [segment()] }),
        source: 'visual',
        status: 'draft',
      }),
      null,
    );
  projects.refresh('assets');
  const analysis = new AnalysisService({
    database,
    repository,
    projects,
    jobs,
    userData: root,
    ffmpeg: '/unused',
    secrets: {
      encrypt: (value) => Buffer.from(value),
      decrypt: (value) => value.toString(),
    },
  });
  const provider = analysis.saveProvider({
    kind: 'openai-compatible',
    label: 'Local test',
    model: 'vision',
    enabled: true,
    visionConsent: true,
  });
  const request: NarrationGenerateRequest = {
    assetId: asset.id,
    providerId: provider.id,
    expectedRevision: existing ? 0 : null,
    startFrame: 0,
    endFrame: 240,
    replaceEdited: false,
    replaceEmptySpeech: false,
  };
  cleanups.push(() => {
    jobs.stop();
    database.close();
    rmSync(root, { recursive: true, force: true });
  });
  return {
    root,
    path,
    database,
    repository,
    jobs,
    projects,
    analysis,
    provider,
    request,
    asset,
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

describe('visual narration service safety', () => {
  it('redacts credentials from persisted provider errors', async () => {
    const f = fixture();
    f.analysis.saveProvider({
      id: f.provider.id,
      kind: 'openai-compatible',
      label: 'Local test',
      apiKey: 'fixture-private-token',
      enabled: true,
      visionConsent: true,
    });
    generate.mockRejectedValue(
      new Error('Provider rejected fixture-private-token'),
    );
    const job = f.analysis.generateNarration(f.request);
    f.jobs.start();
    const result = await finished(f.jobs, job.id);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('[redacted]');
    expect(result.error).not.toContain('fixture-private-token');
  });
  it('pins the selected provider model while a request is queued', async () => {
    const f = fixture();
    generate.mockResolvedValue({
      segments: [segment()],
      sampleCount: 2,
      candidateCount: 2,
    });
    const job = f.analysis.generateNarration(f.request);
    f.analysis.saveProvider({
      id: f.provider.id,
      kind: 'openai-compatible',
      label: 'Local test',
      model: 'changed-model',
      enabled: true,
      visionConsent: true,
    });
    f.jobs.start();
    expect((await finished(f.jobs, job.id)).status).toBe('failed');
    expect(generate).not.toHaveBeenCalled();
  });
  it('does not upload a different source relinked while the job was queued', async () => {
    const f = fixture();
    generate.mockResolvedValue({
      segments: [segment()],
      sampleCount: 2,
      candidateCount: 2,
    });
    const job = f.analysis.generateNarration(f.request);
    const replacement = join(f.root, 'replacement.mp4');
    writeFileSync(replacement, 'other-media');
    f.repository.saveAsset({ ...f.asset, sourcePath: replacement });
    f.projects.refresh('assets');
    f.jobs.start();
    expect((await finished(f.jobs, job.id)).status).toBe('failed');
    expect(generate).not.toHaveBeenCalled();
  });
  it('queues explicit provider work and commits a draft atomically', async () => {
    const f = fixture();
    generate.mockResolvedValue({
      segments: [segment()],
      sampleCount: 2,
      candidateCount: 2,
    });
    const job = f.analysis.generateNarration(f.request);
    f.jobs.start();
    expect((await finished(f.jobs, job.id)).status).toBe('succeeded');
    expect(f.projects.current()!.transcripts[0]).toMatchObject({
      source: 'visual',
      status: 'draft',
      revision: 0,
    });
    expect(f.projects.current()!.assets[0]!.transcriptId).toBe(
      f.projects.current()!.transcripts[0]!.id,
    );
    const payload = f.database.connection
      .prepare('SELECT payload_json FROM jobs WHERE id=?')
      .get(job.id);
    expect(JSON.stringify(payload)).not.toMatch(/apiKey|ciphertext/);
  });
  it('preserves previous rows after empty output or provider failure without retry', async () => {
    const f = fixture(true);
    const before = f.projects.current()!.transcripts[0];
    generate.mockResolvedValueOnce({
      segments: [],
      sampleCount: 2,
      candidateCount: 2,
    });
    const empty = f.analysis.generateNarration(f.request);
    f.jobs.start();
    expect((await finished(f.jobs, empty.id)).status).toBe('succeeded');
    expect(f.jobs.get(empty.id)?.stage).toContain('No useful visual changes');
    expect(f.projects.current()!.transcripts[0]).toEqual(before);
    generate.mockRejectedValueOnce(new Error('Provider failed'));
    const failure = f.analysis.generateNarration(f.request);
    expect((await finished(f.jobs, failure.id)).status).toBe('failed');
    expect(f.projects.current()!.transcripts[0]).toEqual(before);
    expect(generate).toHaveBeenCalledTimes(2);
  });
  it('rejects a generated result if a user edits while it runs', async () => {
    const f = fixture(true);
    let release!: (value: {
      segments: TranscriptSegment[];
      sampleCount: number;
      candidateCount: number;
    }) => void;
    generate.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const job = f.analysis.generateNarration(f.request);
    f.jobs.start();
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    const previous = f.projects.current()!.transcripts[0]!;
    f.analysis.editNarration({
      type: 'updateText',
      transcriptId: previous.id,
      expectedRevision: 0,
      segmentId: previous.segments[0]!.id,
      text: 'User correction',
    });
    release({ segments: [segment()], sampleCount: 2, candidateCount: 2 });
    expect((await finished(f.jobs, job.id)).status).toBe('failed');
    expect(f.projects.current()!.transcripts[0]!.segments[0]!.text).toBe(
      'User correction',
    );
  });
  it('rejects changed source files before commit', async () => {
    const f = fixture(true);
    generate.mockImplementation(async () => {
      writeFileSync(f.path, 'changed-media');
      return { segments: [segment()], sampleCount: 2, candidateCount: 2 };
    });
    const before = f.projects.current()!.transcripts[0];
    const job = f.analysis.generateNarration(f.request);
    f.jobs.start();
    expect((await finished(f.jobs, job.id)).status).toBe('failed');
    expect(f.projects.current()!.transcripts[0]).toEqual(before);
  });
  it('preserves the prior draft when consent is revoked or the project is closed', async () => {
    const f = fixture(true);
    const before = f.projects.current()!.transcripts[0];
    generate.mockImplementation(async () => {
      f.analysis.saveProvider({
        id: f.provider.id,
        kind: 'openai-compatible',
        label: 'Local test',
        visionConsent: false,
      });
      return { segments: [segment()], sampleCount: 2, candidateCount: 2 };
    });
    const revoked = f.analysis.generateNarration(f.request);
    f.jobs.start();
    expect((await finished(f.jobs, revoked.id)).status).toBe('failed');
    expect(f.projects.current()!.transcripts[0]).toEqual(before);
    f.analysis.saveProvider({
      id: f.provider.id,
      kind: 'openai-compatible',
      label: 'Local test',
      visionConsent: true,
    });
    generate.mockImplementation(async () => {
      f.projects.close();
      return { segments: [segment()], sampleCount: 2, candidateCount: 2 };
    });
    const closed = f.analysis.generateNarration(f.request);
    expect((await finished(f.jobs, closed.id)).status).toBe('cancelled');
    expect(f.repository.listTranscripts(f.asset.projectId)[0]).toEqual(before);
  });
  it('blocks nonempty speech including text-only legacy output', () => {
    const f = fixture();
    const speech = createTranscript({
      assetId: f.asset.id,
      segments: [],
      text: 'Possible Whisper junk, still requires user review',
    });
    f.repository.saveTranscript(speech);
    f.projects.refresh('analysis');
    expect(() =>
      f.analysis.generateNarration({
        ...f.request,
        expectedRevision: 0,
        replaceEmptySpeech: true,
      }),
    ).toThrow(/speech/);
  });
});
