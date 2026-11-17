import {
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { generateText } from 'ai';
import { assetSchema, createTranscript, newId } from '@kerf/model';
import { openDatabase } from '../db';
import { ProjectRepository, ProjectService } from '../projects';
import { JobQueue } from '../jobs';
import { ProviderStore } from './providers';
import { HighlightService } from './highlight-service';
import { ToolService } from '../tools/service';
import { highlightEvidence, parseHighlights } from './highlights';
vi.mock('ai', async (original) => ({
  ...(await original<typeof import('ai')>()),
  generateText: vi.fn(),
}));
const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.splice(0).forEach((f) => f());
  vi.restoreAllMocks();
});
const response = (
  ranges = [
    [0, 1],
    [2, 3],
  ],
) =>
  JSON.stringify({
    candidates: ranges.map(([a, b], i) => ({
      startEvidenceId: `speech_${a}`,
      endEvidenceId: `speech_${b}`,
      title: `Useful thought ${i + 1}`,
      rationale: 'Opens with a specific problem and ends with its solution.',
      warnings: [],
    })),
  });
function fixture() {
  vi.mocked(generateText).mockReset();
  vi.mocked(generateText).mockResolvedValue({ text: response() } as Awaited<
    ReturnType<typeof generateText>
  >);
  const root = mkdtempSync(join(tmpdir(), 'kerf-highlights-'));
  const db = openDatabase({ filename: join(root, 'test.db') });
  const repository = new ProjectRepository({
    database: db.connection,
    projectsRoot: join(root, 'projects'),
  });
  const jobs = new JobQueue({ database: db.connection });
  const projects = new ProjectService({
    repository,
    jobs: (id) => jobs.list(id),
  });
  const parent = projects.create({
    name: 'Interview',
    frameRate: { numerator: 24, denominator: 1 },
  });
  const path = join(root, 'interview.mp4');
  writeFileSync(path, 'source-video');
  const stat = statSync(path);
  const asset = repository.saveAsset(
    assetSchema.parse({
      id: newId('asset'),
      projectId: parent.project.id,
      kind: 'video',
      name: 'Interview',
      status: 'ready',
      sourcePath: path,
      hasAudio: true,
      hasVideo: true,
      frameRate: { numerator: 30, denominator: 1 },
      width: 640,
      height: 360,
      durationSeconds: 20,
      fileSize: stat.size,
      mtimeMs: stat.mtimeMs,
      importedAt: 1,
      updatedAt: 1,
    }),
  );
  const transcript = repository.saveTranscript(
    createTranscript({
      assetId: asset.id,
      segments: Array.from({ length: 4 }, (_, i) => ({
        id: newId('segment'),
        startFrame: i * 90 + 30,
        endFrame: i * 90 + 90,
        text: `Complete useful thought ${i}.`,
        words: [],
      })),
    }),
  );
  projects.refresh('analysis');
  const providers = new ProviderStore({
    database: db.connection,
    secrets: { encrypt: (v) => Buffer.from(v), decrypt: (v) => v.toString() },
  });
  const provider = providers.save({
    kind: 'ollama',
    label: 'Local text',
    model: 'fixture',
    chatConsent: true,
    enabled: true,
  });
  const service = new HighlightService({
    projects,
    repository,
    jobs,
    providers,
    database: db.connection,
  });
  const unused = () => {
    throw new Error('unused');
  };
  const tools = new ToolService({
    projects,
    repository,
    highlights: service,
    exports: {
      list: () => [],
      get: () => null,
      start: unused,
      cancel: () => false,
    },
  });
  jobs.start();
  cleanup.push(() => {
    service.dispose();
    jobs.stop();
    db.close();
    rmSync(root, { recursive: true, force: true });
  });
  const input = {
    assetId: asset.id,
    providerId: provider.id,
    count: 3,
    minSeconds: 2,
    maxSeconds: 6,
    topic: 'useful solutions',
  };
  const discover = async () => {
    const started = service.start(input);
    await vi.waitFor(() =>
      expect(['succeeded', 'failed', 'cancelled']).toContain(
        jobs.get(started.id)?.status,
      ),
    );
    return service.read(started.id);
  };
  return {
    db,
    root,
    repository,
    jobs,
    projects,
    parent,
    asset,
    transcript,
    provider,
    providers,
    service,
    tools,
    input,
    discover,
  };
}
it('discovers fewer evidence-backed candidates without source edits, creates only approval and persists individually editable outputs', async () => {
  const f = fixture();
  const before = f.projects.current()!;
  const review = await f.discover();
  expect(review.proposal?.candidates).toHaveLength(2);
  expect(review.proposal?.warnings.join(' ')).toContain('Requested 3');
  expect(review.proposal?.candidates[0]).toMatchObject({
    startFrame: 30,
    endFrame: 180,
    durationSeconds: 5,
    excerpt: 'Complete useful thought 0. Complete useful thought 1.',
  });
  const selection = {
    jobId: review.id,
    selections: [{ candidateId: 'highlight_2' }],
  };
  expect(f.service.request(selection).status).toBe('awaiting-review');
  expect(f.projects.current()!.project).toEqual(before.project);
  expect(f.projects.current()!.history).toEqual(before.history);
  expect(f.repository.list()).toHaveLength(1);
  const created = await f.tools.highlightConfirm(selection);
  expect(created.outputs).toHaveLength(1);
  const output = created.outputs[0]!;
  expect(output.candidateId).toBe('highlight_2');
  expect(f.service.verify(output.projectId).findings).toEqual([]);
  const child = f.repository.require(output.projectId);
  expect(child.project.sequence.frameRate.numerator).toBe(30);
  expect(child.project.highlightOrigin).toMatchObject({
    parentProjectId: before.project.id,
    candidateId: 'highlight_2',
  });
  expect(child.assets[0]!.sourcePath).toBe(f.asset.sourcePath);
  expect(child.assets[0]!.cache.proxyPath).toBeNull();
  expect(child.assets[0]!.transcriptId).toBe(child.transcripts[0]!.id);
  expect(f.projects.current()!.project).toEqual(before.project);
  expect(f.projects.current()!.history).toEqual(before.history);
  expect(() => f.service.confirm(selection)).toThrow('already created');
  f.service.dispose();
  const reopened = new HighlightService({
    projects: f.projects,
    repository: f.repository,
    jobs: f.jobs,
    providers: f.providers,
    database: f.db.connection,
  });
  expect(reopened.outputs(review.id).outputs[0]).toMatchObject(output);
  expect(() => reopened.confirm(selection)).toThrow('already created');
  expect(generateText).toHaveBeenCalledOnce();
  f.projects.open(output.projectId);
  const beforeEdit = f.projects.current()!.project.sequence;
  f.projects.apply({
    type: 'clip.update',
    clipId: output.videoClipId,
    patch: { label: 'Refined output' },
  });
  f.projects.undo();
  expect(f.projects.current()!.project.sequence).toEqual(beforeEdit);
  expect(f.repository.require(before.project.id).project.sequence).toEqual(
    before.project.sequence,
  );
  f.projects.open(before.project.id);
  f.repository.delete(output.projectId);
  expect(reopened.outputs(review.id).outputs[0]!.exists).toBe(false);
  expect(() => reopened.confirm(selection)).toThrow('already created');
  reopened.dispose();
});
it('rolls back every project and folder if one output fails and permits explicit retry', async () => {
  const f = fixture();
  const review = await f.discover();
  const save = f.repository.commitEdit.bind(f.repository);
  vi.spyOn(f.repository, 'commitEdit')
    .mockImplementationOnce(save)
    .mockImplementationOnce(() => {
      throw new Error('disk failure');
    });
  const selection = {
    jobId: review.id,
    selections: [
      { candidateId: 'highlight_1' },
      { candidateId: 'highlight_2' },
    ],
  };
  expect(() => f.service.confirm(selection)).toThrow('disk failure');
  expect(f.repository.list()).toHaveLength(1);
  expect(readdirSync(join(f.root, 'projects'))).toHaveLength(1);
  expect(f.service.outputs(review.id).outputs).toEqual([]);
  const outputs = f.service.confirm(selection).outputs;
  expect(outputs).toHaveLength(2);
  const sibling = f.repository.require(outputs[1]!.projectId).project;
  f.projects.open(outputs[0]!.projectId);
  f.projects.apply({
    type: 'clip.update',
    clipId: outputs[0]!.videoClipId,
    patch: { label: 'Only first output' },
  });
  expect(f.repository.require(outputs[1]!.projectId).project).toEqual(sibling);
});
it('rejects stale files, transcript edits, invalid selections and cross-project review', async () => {
  const f = fixture();
  const review = await f.discover();
  expect(() =>
    f.service.confirm({
      jobId: review.id,
      selections: [{ candidateId: 'invented' }],
    }),
  ).toThrow('stored proposal');
  expect(() =>
    f.service.confirm({
      jobId: review.id,
      selections: [{ candidateId: 'highlight_1', endEvidenceId: 'speech_3' }],
    }),
  ).toThrow('duration bounds');
  f.repository.saveTranscript({ ...f.transcript, revision: 1 });
  f.projects.refresh('analysis');
  expect(f.service.read(review.id).eligible).toBe(false);
  expect(() =>
    f.service.confirm({
      jobId: review.id,
      selections: [{ candidateId: 'highlight_1' }],
    }),
  ).toThrow('changed');
  writeFileSync(f.asset.sourcePath, 'replaced');
  expect(() => f.service.start(f.input)).toThrow('changed');
  f.projects.create({ name: 'Other' });
  expect(() => f.service.read(review.id)).toThrow('another project');
  expect(f.repository.list()).toHaveLength(2);
});
it('rejects invented evidence and overlaps, and permits empty results', () => {
  const f = fixture();
  const evidence = highlightEvidence(f.asset, f.transcript);
  expect(() =>
    parseHighlights(
      response([
        [0, 1],
        [1, 2],
      ]),
      evidence,
      f.asset,
      f.input,
    ),
  ).toThrow('overlap');
  expect(() =>
    parseHighlights(response([[0, 99]]), evidence, f.asset, f.input),
  ).toThrow('source speech evidence');
  expect(parseHighlights(response([]), evidence, f.asset, f.input)).toEqual([]);
});
it('requires reviewed speech and provider consent without making provider calls on read', async () => {
  const f = fixture();
  const review = await f.discover();
  vi.mocked(generateText).mockClear();
  f.service.read(review.id);
  f.service.reviews();
  expect(generateText).not.toHaveBeenCalled();
  f.providers.save({ ...f.provider, chatConsent: false });
  expect(f.service.read(review.id).eligible).toBe(false);
  expect(() =>
    f.service.confirm({
      jobId: review.id,
      selections: [{ candidateId: 'highlight_1' }],
    }),
  ).toThrow('chat consent');
  f.repository.saveTranscript({ ...f.transcript, status: 'draft' });
  f.projects.refresh('analysis');
  expect(() => f.service.start(f.input)).toThrow('review');
});
it('cancels running discovery without later publishing a result', async () => {
  const f = fixture();
  vi.mocked(generateText).mockImplementationOnce(
    (input) =>
      new Promise((_resolve, reject) => {
        input.abortSignal?.addEventListener('abort', () =>
          reject(new DOMException('Cancelled', 'AbortError')),
        );
      }),
  );
  const review = f.service.start(f.input);
  await vi.waitFor(() => expect(f.jobs.get(review.id)?.status).toBe('running'));
  f.service.cancel(review.id);
  await vi.waitFor(() =>
    expect(f.jobs.get(review.id)?.status).toBe('cancelled'),
  );
  expect(f.service.read(review.id)).toMatchObject({
    eligible: false,
    cancelled: true,
    proposal: null,
  });
  expect(f.repository.list()).toHaveLength(1);
});
it('marks queued discovery interrupted on restart instead of resuming a provider request', () => {
  const f = fixture();
  f.jobs.stop();
  const review = f.service.start(f.input);
  const queue = new JobQueue({ database: f.db.connection });
  queue.start();
  expect(queue.get(review.id)).toMatchObject({
    status: 'failed',
    error: expect.stringContaining('interrupted'),
  });
  queue.stop();
});

it('rejects whole-source discovery outside the submitted source scope before starting jobs', async () => {
  const f = fixture();
  await expect(
    f.tools.call('startClipDiscovery', f.input, 'agent', undefined, {
      scope: {
        kind: 'targets',
        clipIds: [],
        assetIds: [newId('asset')],
        revision: f.projects.current()!.project.updatedAt,
      },
    }),
  ).rejects.toThrow('whole source');
  expect(f.jobs.list()).toEqual([]);
  expect(generateText).not.toHaveBeenCalled();
});
