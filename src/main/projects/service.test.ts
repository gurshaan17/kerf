import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createMarker } from '@kerf/model';
import { openDatabase } from '../db';
import type { DatabaseHandle } from '../db';
import { ProjectRepository } from './repository';
import { ProjectService } from './service';

const contexts: Array<{
  service: ProjectService;
  repository: ProjectRepository;
  database: DatabaseHandle;
  root: string;
}> = [];

function makeService(): {
  service: ProjectService;
  repository: ProjectRepository;
} {
  const root = mkdtempSync(join(tmpdir(), 'kerf-service-'));
  const database = openDatabase({ filename: join(root, 'kerf.db') });
  let now = 1_000;
  const repository = new ProjectRepository({
    database: database.connection,
    projectsRoot: join(root, 'projects'),
    now: () => now,
  });
  const service = new ProjectService({
    repository,
    now: () => {
      now += 1;
      return now;
    },
  });
  contexts.push({ service, repository, database, root });
  return { service, repository };
}

afterEach(() => {
  for (const entry of contexts.splice(0)) {
    entry.database.close();
    rmSync(entry.root, { recursive: true, force: true });
  }
});

describe('ProjectService', () => {
  it('applies three edits, undoes all and redoes all', () => {
    const { service, repository } = makeService();
    const initial = service.create({ name: 'Working cut', now: 1_000 });
    const projectId = initial.project.id;
    const original = initial.project.sequence;

    const renamed = service.apply({
      type: 'sequence.rename',
      name: 'Opening cut',
    });
    service.apply({
      type: 'marker.add',
      marker: createMarker({ frame: 24, label: 'First beat' }),
    });
    const resized = service.apply({
      type: 'sequence.setCanvas',
      width: 1080,
      height: 1920,
    });

    expect(renamed.snapshot.history.undoDepth).toBe(1);
    expect(resized.snapshot.project.sequence.width).toBe(1080);
    expect(resized.snapshot.project.sequence.markers).toHaveLength(1);

    const undoResize = service.undo();
    expect(undoResize?.snapshot.project.sequence.width).toBe(1920);
    service.undo();
    const undoRename = service.undo();
    expect(undoRename?.snapshot.project.sequence.name).toBe(original.name);
    expect(undoRename?.snapshot.history.canUndo).toBe(false);
    expect(undoRename?.snapshot.history.canRedo).toBe(true);

    expect(service.undo()).toBeNull();

    const redoRename = service.redo();
    expect(redoRename?.snapshot.project.sequence.name).toBe('Opening cut');
    service.redo();
    const redoResize = service.redo();
    expect(redoResize?.snapshot.project.sequence.width).toBe(1080);
    expect(redoResize?.snapshot.project.sequence.markers).toHaveLength(1);
    expect(service.redo()).toBeNull();

    expect(repository.listEditLog(projectId)).toHaveLength(9);
    expect(repository.open(projectId)?.project.sequence.width).toBe(1080);
  });

  it('emits change events and reloads assets', () => {
    const { service } = makeService();
    const events: string[] = [];
    service.subscribe((event) => {
      events.push(event.type);
    });
    const snapshot = service.create({ name: 'Events' });
    service.apply({ type: 'sequence.rename', name: 'Renamed' });
    service.reloadAssets([]);
    service.close();

    expect(events).toEqual([
      'project.opened',
      'project.changed',
      'project.changed',
      'project.closed',
    ]);
    expect(snapshot.history.canUndo).toBe(false);
  });

  it('rejects invalid commands without writing snapshots or history', () => {
    const { service, repository } = makeService();
    const snapshot = service.create({ name: 'Guarded' });

    expect(() =>
      service.apply({
        type: 'sequence.rename',
        name: '   ',
      }),
    ).toThrow();
    expect(repository.listEditLog(snapshot.project.id)).toHaveLength(0);
    expect(service.current()?.history.canUndo).toBe(false);
  });
});
