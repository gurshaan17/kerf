import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assetSchema,
  createAsset,
  createTranscript,
  newId,
  sceneSchema,
  transcriptSegmentSchema,
} from '@kerf/model';
import { openDatabase } from '../db';
import type { DatabaseHandle } from '../db';
import { ProjectRepository } from '../projects';
import { SearchService } from './search';

const contexts: Array<{
  database: DatabaseHandle;
  root: string;
  repository: ProjectRepository;
}> = [];

function makeContext(fts5Enabled: boolean) {
  const root = mkdtempSync(join(tmpdir(), 'kerf-search-'));
  const database = openDatabase({ filename: join(root, 'kerf.db') });
  const repository = new ProjectRepository({
    database: database.connection,
    projectsRoot: join(root, 'projects'),
    now: () => 1_000,
  });
  const bundle = repository.create({ name: 'Search', now: 1_000 });
  const asset = assetSchema.parse({
    ...createAsset({
      projectId: bundle.project.id,
      name: 'interview.mp4',
      sourcePath: '/media/interview.mp4',
      kind: 'video',
      now: 1_100,
    }),
    status: 'ready',
    hasVideo: true,
    hasAudio: true,
  });
  repository.saveAsset(asset);
  contexts.push({ database, root, repository });
  const search = new SearchService({
    database: database.connection,
    repository,
    fts5Enabled,
  });
  return { bundle, asset, repository, search };
}

afterEach(() => {
  for (const context of contexts.splice(0)) {
    context.database.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

describe('SearchService', () => {
  it('indexes phrase-searchable transcript windows and scene descriptions', () => {
    const { bundle, asset, repository, search } = makeContext(true);
    const transcript = createTranscript({
      assetId: asset.id,
      now: 2_000,
      segments: [
        transcriptSegmentSchema.parse({
          id: newId('segment'),
          startFrame: 0,
          endFrame: 48,
          text: 'Hello Kerf world',
          words: [
            { text: 'Hello', startFrame: 0, endFrame: 12 },
            { text: 'Kerf', startFrame: 12, endFrame: 24 },
            { text: 'world', startFrame: 24, endFrame: 48 },
          ],
        }),
      ],
    });
    repository.saveTranscript(transcript);
    repository.saveScene(
      sceneSchema.parse({
        id: newId('scene'),
        assetId: asset.id,
        index: 0,
        startFrame: 60,
        endFrame: 120,
        description: 'A red car drives through heavy rain at night.',
        score: 0.8,
      }),
    );
    search.reindexProject(bundle.project.id);

    const words = search.search(bundle.project.id, { query: 'hello kerf' });
    expect(words.vectorSearch).toBe(false);
    expect(words.results[0]).toMatchObject({
      kind: 'transcript',
      assetId: asset.id,
      assetName: 'interview.mp4',
      startFrame: 0,
    });
    expect(words.results[0]?.text).toContain('Hello Kerf world');

    const scene = search.search(bundle.project.id, { query: 'red car' });
    expect(scene.results.some((result) => result.kind === 'scene')).toBe(true);
    expect(scene.results[0]?.text).toContain('red car');
  });

  it('falls back to LIKE matching when FTS5 is unavailable', () => {
    const { bundle, asset, repository, search } = makeContext(false);
    const transcript = createTranscript({
      assetId: asset.id,
      now: 2_000,
      segments: [
        transcriptSegmentSchema.parse({
          id: newId('segment'),
          startFrame: 0,
          endFrame: 24,
          text: 'We build a local editor',
          words: [
            { text: 'We', startFrame: 0, endFrame: 4 },
            { text: 'build', startFrame: 4, endFrame: 8 },
            { text: 'a', startFrame: 8, endFrame: 10 },
            { text: 'local', startFrame: 10, endFrame: 16 },
            { text: 'editor', startFrame: 16, endFrame: 24 },
          ],
        }),
      ],
    });
    repository.saveTranscript(transcript);

    const result = search.search(bundle.project.id, { query: 'local editor' });
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.text).toBe('We build a local editor');
  });

  it('returns no results for an empty query', () => {
    const { bundle, search } = makeContext(true);
    expect(search.search(bundle.project.id, { query: '   ' })).toEqual({
      results: [],
      vectorSearch: false,
    });
  });
});
