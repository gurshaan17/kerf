import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assetSchema, createAsset, newId, sceneSchema } from '@kerf/model';
import { openDatabase } from '../db';
import type { DatabaseHandle } from '../db';
import { ProjectRepository } from '../projects';
import {
  mimeForPath,
  parseMediaRequest,
  parseRangeHeader,
  resolveMediaTarget,
  serveMediaRequest,
} from './media-paths';

const contexts: Array<{
  repository: ProjectRepository;
  database: DatabaseHandle;
  root: string;
}> = [];

function makeRepository(): ProjectRepository {
  const root = mkdtempSync(join(tmpdir(), 'kerf-media-'));
  const database = openDatabase({ filename: join(root, 'kerf.db') });
  const repository = new ProjectRepository({
    database: database.connection,
    projectsRoot: join(root, 'projects'),
  });
  contexts.push({ repository, database, root });
  return repository;
}

afterEach(() => {
  for (const context of contexts.splice(0)) {
    context.database.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

describe('kerfmedia URLs', () => {
  it('parses asset and project requests', () => {
    expect(parseMediaRequest('kerfmedia://asset/ast_123/thumbnail')).toEqual({
      kind: 'asset',
      assetId: 'ast_123',
      slot: 'thumbnail',
    });
    expect(
      parseMediaRequest('kerfmedia://project/prj_123/exports/final%20cut.mp4'),
    ).toEqual({
      kind: 'project',
      projectId: 'prj_123',
      relativePath: 'exports/final cut.mp4',
    });
    expect(parseMediaRequest('kerfmedia://scene/scn_123/thumbnail')).toEqual({
      kind: 'scene',
      sceneId: 'scn_123',
    });
    expect(parseMediaRequest('https://example.com/a.mp4')).toBeNull();
    expect(parseMediaRequest('kerfmedia://asset/ast_123/nope')).toBeNull();
    expect(parseMediaRequest('kerfmedia://scene/scn_123/poster')).toBeNull();
  });

  it('maps common media extensions', () => {
    expect(mimeForPath('/a/b.MP4')).toBe('video/mp4');
    expect(mimeForPath('/a/b.wav')).toBe('audio/wav');
    expect(mimeForPath('/a/b.jpg')).toBe('image/jpeg');
    expect(mimeForPath('/a/b.bin')).toBe('application/octet-stream');
  });

  it('parses byte ranges including suffix ranges', () => {
    expect(parseRangeHeader(null, 100)).toEqual({ kind: 'none' });
    expect(parseRangeHeader('bytes=10-19', 100)).toEqual({
      kind: 'range',
      start: 10,
      end: 19,
    });
    expect(parseRangeHeader('bytes=90-', 100)).toEqual({
      kind: 'range',
      start: 90,
      end: 99,
    });
    expect(parseRangeHeader('bytes=-5', 100)).toEqual({
      kind: 'range',
      start: 95,
      end: 99,
    });
    expect(parseRangeHeader('bytes=120-130', 100)).toEqual({
      kind: 'invalid',
    });
  });
});

describe('resolveMediaTarget', () => {
  it('serves asset caches and project files while rejecting traversal', async () => {
    const repository = makeRepository();
    const bundle = repository.create({ name: 'Media' });
    const folder = repository.folderFor(bundle.project.id)!;
    const thumbnail = join(folder, 'cache', 'thumbnails', 'frame.jpg');
    writeFileSync(thumbnail, 'image-bytes');
    const source = join(folder, 'source.mp4');
    writeFileSync(source, '0123456789');

    const asset = assetSchema.parse({
      ...createAsset({
        projectId: bundle.project.id,
        name: 'source.mp4',
        sourcePath: source,
        kind: 'video',
      }),
      cache: {
        proxyPath: null,
        thumbnailPath: thumbnail,
        waveformPath: null,
        filmstripPath: null,
      },
    });
    repository.saveAsset(asset);

    const thumbRequest = parseMediaRequest(
      `kerfmedia://asset/${asset.id}/thumbnail`,
    );
    expect(thumbRequest).not.toBeNull();
    expect(resolveMediaTarget(repository, thumbRequest!)?.filePath).toBe(
      thumbnail,
    );

    const projectRequest = parseMediaRequest(
      `kerfmedia://project/${bundle.project.id}/source.mp4`,
    );
    expect(resolveMediaTarget(repository, projectRequest!)?.mimeType).toBe(
      'video/mp4',
    );

    const traversal = parseMediaRequest(
      `kerfmedia://project/${bundle.project.id}/%2E%2E%2Foutside.mp4`,
    );
    expect(resolveMediaTarget(repository, traversal!)).toBeNull();
  });

  it('serves scene thumbnails inside the project and rejects others', () => {
    const repository = makeRepository();
    const bundle = repository.create({ name: 'Scenes' });
    const folder = repository.folderFor(bundle.project.id)!;
    const source = join(folder, 'source.mp4');
    writeFileSync(source, '0123456789');

    const asset = assetSchema.parse({
      ...createAsset({
        projectId: bundle.project.id,
        name: 'source.mp4',
        sourcePath: source,
        kind: 'video',
      }),
    });
    repository.saveAsset(asset);

    const keyframe = join(
      folder,
      'analysis',
      'keyframes',
      asset.id,
      'scene.jpg',
    );
    mkdirSync(dirname(keyframe), { recursive: true });
    writeFileSync(keyframe, 'image-bytes');

    const scene = sceneSchema.parse({
      id: newId('scene'),
      assetId: asset.id,
      index: 0,
      startFrame: 0,
      endFrame: 24,
      thumbnailPath: keyframe,
      score: 0.6,
    });
    repository.saveScene(scene);

    const request = parseMediaRequest(
      `kerfmedia://scene/${scene.id}/thumbnail`,
    );
    expect(request).toEqual({ kind: 'scene', sceneId: scene.id });
    const target = resolveMediaTarget(repository, request!);
    expect(target?.filePath).toBe(keyframe);
    expect(target?.mimeType).toBe('image/jpeg');

    expect(
      resolveMediaTarget(repository, { kind: 'scene', sceneId: 'scn_missing' }),
    ).toBeNull();

    const outside = join(tmpdir(), `kerf-outside-${scene.id}.jpg`);
    writeFileSync(outside, 'nope');
    repository.saveScene({ ...scene, thumbnailPath: outside });
    expect(resolveMediaTarget(repository, request!)).toBeNull();
    rmSync(outside, { force: true });

    repository.saveScene({ ...scene, thumbnailPath: null });
    expect(resolveMediaTarget(repository, request!)).toBeNull();
  });

  it('streams ranges and handles HEAD requests', async () => {
    const repository = makeRepository();
    const bundle = repository.create({ name: 'Range' });
    const folder = repository.folderFor(bundle.project.id)!;
    const source = join(folder, 'cache', 'clip.mp4');
    writeFileSync(source, '0123456789');
    const asset = assetSchema.parse({
      ...createAsset({
        projectId: bundle.project.id,
        name: 'clip.mp4',
        sourcePath: source,
        kind: 'video',
      }),
      cache: {
        proxyPath: source,
        thumbnailPath: null,
        waveformPath: null,
        filmstripPath: null,
      },
    });
    repository.saveAsset(asset);

    const url = `kerfmedia://asset/${asset.id}/proxy`;
    const get = await serveMediaRequest(
      repository,
      url,
      new Request(`https://kerf.local/${asset.id}`, {
        headers: { Range: 'bytes=2-5' },
      }),
    );
    expect(get.status).toBe(206);
    expect(await get.text()).toBe('2345');
    expect(get.headers.get('Content-Range')).toBe('bytes 2-5/10');

    const head = await serveMediaRequest(
      repository,
      url,
      new Request(`https://kerf.local/${asset.id}`, { method: 'HEAD' }),
    );
    expect(head.status).toBe(200);
    expect(head.headers.get('Content-Length')).toBe('10');
  });
});
