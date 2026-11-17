import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assetSchema,
  createAsset,
  createTranscript,
  newId,
  referenceProfileSchema,
} from '@kerf/model';
import type { EditingJob, EditingProposal } from '@kerf/tools';
import { openDatabase } from '../db';
import { JobQueue } from '../jobs';
import { ProjectRepository, ProjectService } from '../projects';
import { SearchService } from './search';
import { RoughCutService } from './rough-cut-service';
import { EditingService } from '../tools/editing';
import { ToolService } from '../tools/service';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((fn) => fn()));
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'kerf-rough-cut-'));
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
  const snapshot = projects.create({
    name: 'Multi source',
    frameRate: { numerator: 30, denominator: 1 },
  });
  const assets = [24, 30].map((fps, i) => {
    const sourcePath = join(root, `source-${i}.mp4`);
    writeFileSync(sourcePath, `source ${i}`);
    const stat = statSync(sourcePath);
    return repository.saveAsset(
      assetSchema.parse({
        ...createAsset({
          projectId: snapshot.project.id,
          name: `Source ${i}`,
          kind: 'video',
          sourcePath,
          fileSize: stat.size,
          mtimeMs: stat.mtimeMs,
          status: 'ready',
        }),
        frameRate: { numerator: fps, denominator: 1 },
        durationSeconds: 10,
        width: 640,
        height: 360,
        hasVideo: true,
        hasAudio: true,
      }),
    );
  });
  const transcripts = assets.map((asset, i) =>
    repository.saveTranscript(
      createTranscript({
        assetId: asset.id,
        now: 1,
        segments: [
          {
            id: newId('segment'),
            startFrame: asset.frameRate!.numerator,
            endFrame: asset.frameRate!.numerator * 3,
            text: `Demonstration step ${i}`,
            words: [],
          },
        ],
      }),
    ),
  );
  projects.refresh('analysis');
  const search = new SearchService({
    database: database.connection,
    repository,
  });
  search.reindexProject(snapshot.project.id);
  const roughCut = new RoughCutService({
    referenceProfiles: (id) => repository.listReferenceProfiles(id),
    projects,
    jobs,
    search: (request) => search.search(snapshot.project.id, request),
  });
  const unused = () => {
    throw new Error('unused');
  };
  const editing = new EditingService({
    projects,
    jobs,
    roughCut,
    database: database.connection,
    providers: { list: () => [] },
    autoCut: { generate: unused, prepare: unused, proposal: () => null },
    screenPolish: { generate: unused, prepare: unused, proposal: () => null },
  });
  const tools = new ToolService({
    projects,
    repository,
    editing,
    analysis: {
      query: (request) =>
        search.search(projects.current()!.project.id, request),
    },
    exports: {
      list: () => [],
      get: () => null,
      start: unused,
      cancel: () => false,
    },
  });
  jobs.start();
  cleanups.push(() => {
    roughCut.dispose();
    jobs.stop();
    database.close();
    rmSync(root, { recursive: true, force: true });
  });
  const request = {
    assetIds: assets.map((a) => a.id),
    intent: 'Demonstration',
    targetDurationSeconds: 4,
    selections: [...transcripts].reverse().map((t) => ({
      evidenceId: t.segments[0]!.id,
      reason: 'Introduce the second step, then show the first.',
    })),
  };
  const plan = async () => {
    const output = (await tools.call('planRoughCut', request)) as EditingJob & {
      proposal: EditingProposal;
    };
    await finished(jobs, output.id);
    return output;
  };
  return {
    root,
    projects,
    repository,
    jobs,
    assets,
    transcripts,
    tools,
    request,
    plan,
    editing,
    roughCut,
  };
}
async function finished(jobs: JobQueue, id: string) {
  await expect
    .poll(() => jobs.get(id)?.status, { timeout: 5000 })
    .not.toBe('running');
  await expect
    .poll(() => jobs.get(id)?.status, { timeout: 5000 })
    .not.toBe('queued');
  expect(jobs.get(id)?.status).toBe('succeeded');
}

describe('planned multi-source cuts', () => {
  it('cites real evidence, preserves mixed-rate source audio, and reverses stages independently', async () => {
    const f = fixture();
    const before = f.projects.current()!.project.sequence;
    const plan = await f.plan();
    expect(f.projects.current()!.project.sequence).toEqual(before);
    expect(plan.proposal.changes.map((c) => c.assetId)).toEqual(
      [...f.assets].reverse().map((a) => a.id),
    );
    expect(plan.proposal.roughCut).toMatchObject({
      estimatedDurationFrames: 120,
      estimatedDurationSeconds: 4,
      unmetConstraints: [],
    });
    await f.tools.call(
      'applyEditProposal',
      { jobId: plan.id, changeIds: plan.proposal.changes.map((c) => c.id) },
      'mcp',
    );
    expect(f.projects.current()!.project.sequence).toEqual(before);
    const { receipt } = await f.tools.confirmEditing(
      plan.id,
      plan.proposal.changes.map((c) => c.id),
    );
    expect(receipt?.undoable).toBe(true);
    const cut = f.projects.current()!.project.sequence;
    const clips = cut.tracks.flatMap((t) => t.clips);
    const video = clips.filter((c) => c.type === 'video');
    const audio = clips.filter((c) => c.type === 'audio');
    expect(
      video.map((c) => [
        c.assetId,
        c.startFrame,
        c.sourceInFrame,
        c.durationFrames,
        c.volume,
      ]),
    ).toEqual([
      [f.assets[1]!.id, 0, 30, 60, 0],
      [f.assets[0]!.id, 60, 30, 60, 0],
    ]);
    expect(
      audio.map((c) => [
        c.assetId,
        c.startFrame,
        c.sourceInFrame,
        c.durationFrames,
        c.volume,
      ]),
    ).toEqual([
      [f.assets[1]!.id, 0, 30, 60, 1],
      [f.assets[0]!.id, 60, 30, 60, 1],
    ]);
    const captions = await f.tools.finishRoughCut(plan.id, 'captions');
    expect(captions.receipt?.undoable).toBe(true);
    expect(
      f.projects
        .current()!
        .project.sequence.tracks.flatMap((t) => t.clips)
        .filter((c) => c.type === 'caption')
        .map((c) => [c.startFrame, c.durationFrames]),
    ).toEqual([
      [0, 60],
      [60, 60],
    ]);
    f.projects.undo();
    expect(f.projects.current()!.project.sequence).toEqual(cut);
    const duck = await f.tools.finishRoughCut(plan.id, 'duck');
    expect(duck.note).toContain('No overlapping');
    expect(f.projects.current()!.project.sequence).toEqual(cut);
    const verification = await f.tools.finishRoughCut(plan.id, 'verify');
    expect(verification.verification?.status).toBe('partial');
    expect(
      verification.verification?.findings.filter((r) => r.severity === 'error'),
    ).toEqual([]);
    f.projects.undo();
    expect(f.projects.current()!.project.sequence).toEqual(before);
    await expect(
      f.tools.confirmEditing(
        plan.id,
        plan.proposal.changes.map((c) => c.id),
      ),
    ).rejects.toThrow('already');
  });
  it('scopes captions and ducking to the appended cut while preserving existing work', async () => {
    const f = fixture();
    await f.tools.call('insertClip', { assetId: f.assets[0]!.id });
    await f.tools.call('writeCaptions', { assetId: f.assets[0]!.id });
    const originalCaptions = f.projects
      .current()!
      .project.sequence.tracks.flatMap((t) => t.clips)
      .filter((c) => c.type === 'caption');
    const plan = await f.plan();
    expect(plan.proposal.roughCut?.appendAtFrame).toBe(300);
    await f.tools.confirmEditing(
      plan.id,
      plan.proposal.changes.map((c) => c.id),
    );
    await f.tools.finishRoughCut(plan.id, 'captions');
    const updated = f.projects
      .current()!
      .project.sequence.tracks.flatMap((t) => t.clips);
    expect(updated.filter((c) => c.type === 'caption')).toHaveLength(3);
    for (const caption of originalCaptions)
      expect(updated.find((c) => c.id === caption.id)).toEqual(caption);
    const music = f.repository.saveAsset({
      ...f.assets[0]!,
      id: newId('asset'),
      kind: 'audio',
      hasVideo: false,
      name: 'Music',
    });
    f.projects.refresh('assets');
    const inserted = (await f.tools.call('insertAudio', {
      assetId: music.id,
      startFrame: 300,
    })) as { clipId: string };
    const before = f.projects.current()!.project.sequence;
    await f.tools.finishRoughCut(plan.id, 'duck');
    const after = f.projects
      .current()!
      .project.sequence.tracks.flatMap((t) => t.clips);
    expect(after.find((c) => c.id === inserted.clipId)).toMatchObject({
      volume: 1,
      keyframes: {
        volume: expect.arrayContaining([
          expect.objectContaining({ value: 0.35 }),
        ]),
      },
    });
    for (const voice of before.tracks
      .flatMap((t) => t.clips)
      .filter((c) => c.type === 'audio' && c.assetId !== music.id))
      expect(after.find((c) => c.id === voice.id)).toEqual(voice);
    f.projects.undo();
    expect(f.projects.current()!.project.sequence).toEqual(before);
    const hits = (await f.tools.call('findInTranscript', {
      query: 'Demonstration',
      assetIds: [f.assets[1]!.id],
      limit: 1,
    })) as { results: { assetId: string; evidence: { id: string }[] }[] };
    expect(hits.results[0]?.assetId).toBe(f.assets[1]!.id);
    expect(hits.results[0]?.evidence[0]?.id).toBe(
      f.transcripts[1]!.segments[0]!.id,
    );
  });
  it('keeps full segments for a soft target and allows rejecting ranges without timeline changes', async () => {
    const f = fixture();
    const before = f.projects.current()!.project.sequence;
    const result = (await f.tools.call('planRoughCut', {
      ...f.request,
      selections: undefined,
      targetDurationSeconds: 2.5,
    })) as EditingJob & { proposal: EditingProposal };
    await finished(f.jobs, result.id);
    expect(result.proposal.roughCut?.estimatedDurationSeconds).toBe(4);
    expect(result.proposal.roughCut?.unmetConstraints.join(' ')).toContain(
      'not truncated',
    );
    await f.tools.call('cancelEditingJob', { jobId: result.id });
    await expect(
      f.tools.confirmEditing(result.id, [result.proposal.changes[0]!.id]),
    ).rejects.toThrow('cancelled');
    expect(f.projects.current()!.project.sequence).toEqual(before);
  });
  it.each(['timeline', 'transcript', 'source'] as const)(
    'rejects %s changes before commit',
    async (change) => {
      const f = fixture();
      const plan = await f.plan();
      if (change === 'timeline')
        f.projects.apply({ type: 'sequence.rename', name: 'Changed' });
      if (change === 'transcript') {
        f.repository.saveTranscript({
          ...f.transcripts[0]!,
          revision: 1,
          text: 'Changed',
        });
        f.projects.refresh('analysis');
      }
      if (change === 'source')
        writeFileSync(f.assets[0]!.sourcePath, 'replacement');
      const before = f.projects.current()!.project.sequence;
      await expect(
        f.tools.confirmEditing(plan.id, [plan.proposal.changes[0]!.id]),
      ).rejects.toThrow(/changed/i);
      expect(f.projects.current()!.project.sequence).toEqual(before);
    },
  );
  it('excludes reference footage even when its profile is not assigned to the sequence', async () => {
    const f = fixture();
    f.repository.saveReferenceProfile(
      f.projects.current()!.project.id,
      referenceProfileSchema.parse({
        id: newId('reference'),
        name: 'Reference',
        sourceAssetId: f.assets[0]!.id,
        createdAt: 1,
      }),
    );
    await expect(f.plan()).rejects.toThrow('Reference footage');
  });
  it('rejects invented and overlapping evidence, absent analysis, and another project', async () => {
    const f = fixture();
    const before = f.projects.current()!.project.sequence;
    await expect(
      f.tools.call('planRoughCut', {
        ...f.request,
        selections: [{ evidenceId: 'invented', reason: 'Guess' }],
      }),
    ).rejects.toThrow('existing evidence');
    const t = f.transcripts[0]!;
    const segment = {
      ...t.segments[0]!,
      id: newId('segment'),
      startFrame: 30,
      endFrame: 60,
    };
    f.repository.saveTranscript({ ...t, segments: [...t.segments, segment] });
    f.projects.refresh('analysis');
    await expect(
      f.tools.call('planRoughCut', {
        ...f.request,
        selections: [t.segments[0]!, segment].map((s) => ({
          evidenceId: s.id,
          reason: 'Choose',
        })),
      }),
    ).rejects.toThrow('Overlapping');
    const missingAnalysis = f.repository.saveAsset({
      ...f.assets[0]!,
      id: newId('asset'),
      name: 'Unanalysed',
    });
    f.projects.refresh('assets');
    await expect(
      f.tools.call('planRoughCut', {
        assetIds: [missingAnalysis.id],
        intent: 'Demonstration',
      }),
    ).rejects.toThrow('No usable evidence');
    const plan = await f.plan();
    f.projects.create({ name: 'Other' });
    await expect(
      f.tools.confirmEditing(plan.id, [plan.proposal.changes[0]!.id]),
    ).rejects.toThrow('open project');
    expect(before.tracks.flatMap((t) => t.clips)).toHaveLength(0);
  });
});

function mediaOrder(sequence: import('@kerf/model').Sequence) {
  return sequence.tracks
    .flatMap((t) => t.clips)
    .map((c) => ({
      type: c.type,
      assetId: 'assetId' in c ? c.assetId : null,
      start: c.startFrame,
      duration: c.durationFrames,
      sourceIn: 'sourceInFrame' in c ? c.sourceInFrame : null,
      volume: 'volume' in c ? c.volume : null,
    }));
}
it('previews selected rough-cut video and synchronized audio without altering project, review or undo state', async () => {
  const f = fixture();
  const plan = await f.plan();
  const before = f.projects.current()!;
  const ids = plan.proposal.changes.map((c) => c.id);
  const preview = await f.tools.previewEditing(plan.id, ids);
  expect(f.projects.current()).toEqual(before);
  expect(f.editing.read(plan.id).reviewStatus).toBe('none');
  expect(preview.expiresAt).toBeGreaterThan(Date.now());
  expect(preview.changeIds).toEqual(ids);
  const same = await f.tools.previewEditing(plan.id, [...ids].reverse());
  expect(same.id).toBe(preview.id);
  const subset = await f.tools.previewEditing(plan.id, [ids[0]!]);
  expect(subset.id).not.toBe(preview.id);
  expect(mediaOrder(subset.snapshot.project.sequence)).toHaveLength(2);
  await f.tools.confirmEditing(plan.id, ids);
  expect(mediaOrder(f.projects.current()!.project.sequence)).toEqual(
    mediaOrder(preview.snapshot.project.sequence),
  );
  f.projects.undo();
  expect(f.projects.current()!.project.sequence).toEqual(
    before.project.sequence,
  );
  await expect(f.tools.previewEditing(plan.id, ids)).rejects.toThrow('already');
});
it('rejects forged changes, replaced sources and wrong projects before preview', async () => {
  const f = fixture();
  const plan = await f.plan();
  const ids = plan.proposal.changes.map((c) => c.id);
  await expect(f.tools.previewEditing(plan.id, ['invented'])).rejects.toThrow(
    'unique',
  );
  await expect(
    f.tools.previewEditing(plan.id, [ids[0]!, ids[0]!]),
  ).rejects.toThrow('unique');
  const before = f.projects.current()!.project.sequence;
  writeFileSync(f.assets[0]!.sourcePath, 'Replaced source content');
  await expect(f.tools.previewEditing(plan.id, ids)).rejects.toThrow(
    'Source media changed',
  );
  expect(f.projects.current()!.project.sequence).toEqual(before);
  f.projects.create({ name: 'Another project' });
  await expect(f.tools.previewEditing(plan.id, ids)).rejects.toThrow(
    'open project',
  );
});
it('bounds preview decoder inputs without preventing ordinary reviewed Apply', async () => {
  const f = fixture();
  for (let i = 0; i < 39; i++)
    f.repository.saveAsset({
      ...f.assets[0]!,
      id: newId('asset'),
      name: `Extra ${i}`,
    });
  f.projects.refresh('assets');
  const plan = await f.plan();
  const ids = plan.proposal.changes.map((c) => c.id);
  await expect(f.tools.previewEditing(plan.id, ids)).rejects.toThrow(
    '40 source assets',
  );
  expect(
    f.projects.current()!.project.sequence.tracks.flatMap((t) => t.clips),
  ).toHaveLength(0);
  await expect(f.tools.confirmEditing(plan.id, ids)).resolves.toMatchObject({
    receipt: { undoable: true },
  });
});
