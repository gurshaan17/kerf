import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assetSchema,
  beatMapSchema,
  createAsset,
  createMarker,
  createTranscript,
  newId,
  projectSchema,
  referenceProfileSchema,
  sceneSchema,
  transcriptSegmentSchema,
  transcriptSchema,
} from '@kerf/model';
import { openDatabase } from '../db';
import type { DatabaseHandle } from '../db';
import { ProjectRepository } from './repository';

const repositories: Array<{
  repository: ProjectRepository;
  database: DatabaseHandle;
  root: string;
}> = [];

function makeRepository(): ProjectRepository {
  const root = mkdtempSync(join(tmpdir(), 'kerf-projects-'));
  const database = openDatabase({ filename: join(root, 'kerf.db') });
  const repository = new ProjectRepository({
    database: database.connection,
    projectsRoot: join(root, 'projects'),
    now: () => 10_000,
  });
  repositories.push({ repository, database, root });
  return repository;
}

afterEach(() => {
  for (const entry of repositories.splice(0)) {
    entry.database.close();
    rmSync(entry.root, { recursive: true, force: true });
  }
});

describe('ProjectRepository', () => {
  it('commits narration revisions atomically, rejects stale writes and persists undo states', () => {
    const repository = makeRepository();
    const bundle = repository.create({ name: 'Narration' });
    const asset = repository.saveAsset(
      createAsset({
        projectId: bundle.project.id,
        sourcePath: '/tmp/demo.mp4',
        name: 'demo.mp4',
        kind: 'video',
      }),
    );
    const previous = transcriptSchema.parse({
      ...createTranscript({ assetId: asset.id, segments: [] }),
      source: 'visual',
      status: 'draft',
    });
    repository.commitNarration(previous, null);
    const next = transcriptSchema.parse({
      ...previous,
      revision: 1,
      undoStates: [{ segments: [], status: 'draft' }],
    });
    repository.commitNarration(next, previous);
    expect(() =>
      repository.commitNarration({ ...next, revision: 2 }, previous),
    ).toThrow(/changed/);
    const reopened = repository.open(bundle.project.id)!;
    expect(reopened.transcripts[0]).toMatchObject({
      revision: 1,
      undoStates: [{ segments: [], status: 'draft' }],
    });
    expect(reopened.assets[0]?.transcriptId).toBe(next.id);
  });
  it('creates project folders and lists, opens, renames and deletes projects', () => {
    const repository = makeRepository();
    const bundle = repository.create({
      name: 'Workshop Cut',
      now: 1_000,
    });

    const folder = repository.folderFor(bundle.project.id)!;
    expect(bundle.project.name).toBe('Workshop Cut');
    expect(existsSync(folder)).toBe(true);
    for (const directory of ['assets', 'analysis', 'exports', 'cache']) {
      expect(existsSync(join(folder, directory))).toBe(true);
    }

    const list = repository.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: bundle.project.id,
      name: 'Workshop Cut',
      assetCount: 0,
    });

    const opened = repository.open(bundle.project.id);
    expect(opened?.project).toEqual(bundle.project);
    expect(repository.open('prj_missing')).toBeNull();

    const renamed = repository.rename(bundle.project.id, 'Final Cut');
    expect(renamed.name).toBe('Final Cut');
    expect(renamed.folderPath).toBe(list[0]?.folderPath);
    expect(repository.open(bundle.project.id)?.project.name).toBe('Final Cut');

    expect(repository.delete(bundle.project.id)).toBe(true);
    expect(existsSync(folder)).toBe(false);
    expect(repository.list()).toEqual([]);
    expect(repository.delete(bundle.project.id)).toBe(false);
  });

  it('saves sequence snapshots without losing unrelated fields', () => {
    const repository = makeRepository();
    const bundle = repository.create({ name: 'Snapshot', now: 1_000 });
    const marker = createMarker({ frame: 24, label: 'Opening' });
    const project = projectSchema.parse({
      ...bundle.project,
      sequence: {
        ...bundle.project.sequence,
        markers: [marker],
        name: 'Renamed sequence',
      },
      updatedAt: 2_000,
    });

    repository.saveProject(project);
    const reopened = repository.open(project.id)?.project;
    expect(reopened?.sequence.markers).toEqual([marker]);
    expect(reopened?.sequence.name).toBe('Renamed sequence');
    expect(reopened?.updatedAt).toBe(2_000);
    expect(repository.getSummary(project.id)?.updatedAt).toBe(2_000);
  });

  it('round-trips assets, transcripts, scenes, beat maps and profiles', () => {
    const repository = makeRepository();
    const bundle = repository.create({ name: 'Bundle', now: 1_000 });
    const projectId = bundle.project.id;
    const asset = assetSchema.parse({
      ...createAsset({
        projectId,
        name: 'clip.mp4',
        sourcePath: '/media/clip.mp4',
        kind: 'video',
        now: 1_100,
      }),
      status: 'ready',
      durationSeconds: 12.5,
      width: 1920,
      height: 1080,
      frameRate: { numerator: 24, denominator: 1 },
      hasVideo: true,
      hasAudio: true,
      cache: {
        proxyPath: '/cache/proxy.mp4',
        thumbnailPath: '/cache/thumb.jpg',
        waveformPath: null,
        filmstripPath: null,
      },
    });
    repository.saveAsset(asset);

    const segment = transcriptSegmentSchema.parse({
      id: newId('segment'),
      startFrame: 0,
      endFrame: 24,
      text: 'Hello there',
      words: [{ text: 'Hello', startFrame: 0, endFrame: 12 }],
    });
    const transcript = createTranscript({
      assetId: asset.id,
      segments: [segment],
      now: 1_200,
    });
    repository.saveTranscript(transcript);

    const scene = sceneSchema.parse({
      id: newId('scene'),
      assetId: asset.id,
      index: 0,
      startFrame: 0,
      endFrame: 24,
      score: 0.8,
    });
    repository.saveScene(scene);

    const beatMap = beatMapSchema.parse({
      id: newId('beatmap'),
      assetId: asset.id,
      bpm: 120,
      beats: [{ id: newId('beat'), frame: 0 }],
      createdAt: 1_300,
    });
    repository.saveBeatMap(beatMap);

    const profile = referenceProfileSchema.parse({
      id: newId('reference'),
      name: 'Warm workshop',
      palette: ['#c9a46a'],
      sceneCount: 6,
      averageShotLengthFrames: 24,
      cutsPerMinute: 50,
      meanLuma: 0.54,
      meanSaturation: 0.42,
      meanContrast: 0.31,
      analyzedAt: 1_400,
      createdAt: 1_400,
    });
    repository.saveReferenceProfile(projectId, profile);

    const reopened = repository.require(projectId);
    expect(reopened.assets).toEqual([asset]);
    expect(reopened.transcripts).toEqual([transcript]);
    expect(reopened.scenes).toEqual([scene]);
    expect(reopened.beatMaps).toEqual([beatMap]);
    expect(reopened.referenceProfiles).toEqual([profile]);
    expect(repository.getSummary(projectId)?.assetCount).toBe(1);
  });

  it('stores and updates export history records', () => {
    const repository = makeRepository();
    const bundle = repository.create({ name: 'Exports', now: 1_000 });
    const record = {
      id: newId('export'),
      projectId: bundle.project.id,
      preset: '1080p',
      outputPath: '/tmp/exports/cut.mp4',
      status: 'rendering' as const,
      progress: 0.25,
      error: null,
      createdAt: 2_000,
      completedAt: null,
    };

    repository.saveExport(record);
    expect(repository.findExport(record.id)).toEqual(record);
    expect(repository.listExports(bundle.project.id)).toEqual([record]);

    repository.saveExport({
      ...record,
      status: 'succeeded',
      progress: 1,
      completedAt: 3_000,
    });
    expect(repository.findExport(record.id)).toMatchObject({
      status: 'succeeded',
      progress: 1,
      completedAt: 3_000,
    });
    expect(repository.listExports(bundle.project.id)).toHaveLength(1);
  });

  it('commits snapshot and edit log atomically', () => {
    const repository = makeRepository();
    const bundle = repository.create({ name: 'History', now: 1_000 });
    const project = projectSchema.parse({
      ...bundle.project,
      name: 'History edited',
      updatedAt: 2_000,
    });
    const command = {
      type: 'sequence.rename' as const,
      name: 'History edited',
    };
    repository.commitEdit(project, {
      id: newId('command'),
      commandId: command.type,
      actor: 'user',
      label: 'Rename project',
      command,
      inverse: { type: 'sequence.rename', name: 'History' },
      createdAt: 2_000,
    });

    const reopened = repository.open(project.id)?.project;
    expect(reopened?.name).toBe('History edited');
    const log = repository.listEditLog(project.id);
    expect(log).toHaveLength(1);
    expect(log[0]?.command).toEqual(command);
    expect(log[0]?.inverse).toEqual({
      type: 'sequence.rename',
      name: 'History',
    });
  });
});
