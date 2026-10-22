import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createComposition } from '@kerf/model';
import { openDatabase } from '../db';
import type { DatabaseHandle } from '../db';
import { ProjectRepository } from './repository';

const contexts: Array<{ database: DatabaseHandle; root: string }> = [];

function makeRepository() {
  const root = mkdtempSync(join(tmpdir(), 'kerf-compositions-'));
  const database = openDatabase({ filename: join(root, 'kerf.db') });
  contexts.push({ database, root });
  return new ProjectRepository({
    database: database.connection,
    projectsRoot: join(root, 'projects'),
    now: () => 4_000,
  });
}

afterEach(() => {
  for (const context of contexts.splice(0)) {
    context.database.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

describe('composition persistence', () => {
  it('round-trips compositions inside the project bundle', () => {
    const repository = makeRepository();
    const bundle = repository.create({ name: 'Motion', now: 1_000 });
    const composition = createComposition({
      projectId: bundle.project.id,
      name: 'Lower third',
      now: 2_000,
    });
    repository.saveComposition(composition);

    expect(repository.findComposition(composition.id)).toEqual(composition);
    expect(repository.listCompositions(bundle.project.id)).toEqual([
      composition,
    ]);
    expect(repository.require(bundle.project.id).compositions).toEqual([
      composition,
    ]);

    const updated = {
      ...composition,
      name: 'Renamed lower third',
      updatedAt: 3_000,
    };
    repository.saveComposition(updated);
    expect(repository.findComposition(composition.id)?.name).toBe(
      'Renamed lower third',
    );
    expect(repository.deleteComposition(composition.id)).toBe(true);
    expect(repository.findComposition(composition.id)).toBeNull();
  });

  it('deletes per-asset analysis rows without touching other assets', () => {
    const repository = makeRepository();
    repository.create({ name: 'Cleanup', now: 1_000 });
    expect(repository.deleteTranscriptsForAsset('ast_missing')).toBe(0);
    expect(repository.deleteScenesForAsset('ast_missing')).toBe(0);
    expect(repository.deleteBeatMapsForAsset('ast_missing')).toBe(0);
  });
});
