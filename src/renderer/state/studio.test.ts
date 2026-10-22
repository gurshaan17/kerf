import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '@kerf/model';
import type {
  EditResult,
  KerfBridge,
  ProjectSnapshot,
  ProjectSummary,
} from '../../shared/contracts';
import { createStudioStore } from './studio';

function makeSnapshot(): ProjectSnapshot {
  const project = createProject({ name: 'Store test', now: 1 });
  const sequence = {
    ...project.sequence,
    durationFrames: 240,
  };
  const withDuration = { ...project, sequence };
  const summary: ProjectSummary = {
    id: project.id,
    name: project.name,
    folderPath: '/tmp/store-test',
    width: sequence.width,
    height: sequence.height,
    frameRate: sequence.frameRate,
    durationFrames: sequence.durationFrames,
    assetCount: 0,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
  return {
    summary,
    project: withDuration,
    assets: [],
    transcripts: [],
    scenes: [],
    beatMaps: [],
    compositions: [],
    jobs: [],
    history: {
      canUndo: false,
      canRedo: false,
      undoDepth: 0,
      redoDepth: 0,
      undo: null,
      redo: null,
      groupOpen: false,
    },
  };
}

function makeBridge(snapshot: ProjectSnapshot) {
  const apply = vi.fn(
    async (): Promise<EditResult> => ({
      snapshot,
      command: null,
      inverse: null,
    }),
  );
  const bridge = {
    getVersions: () => ({ electron: '', chrome: '', node: '' }),
    projects: {
      list: vi.fn(async () => [snapshot.summary]),
      active: vi.fn(async () => snapshot),
      create: vi.fn(async () => snapshot),
      open: vi.fn(async () => snapshot),
      close: vi.fn(async () => undefined),
      rename: vi.fn(async () => snapshot.summary),
      delete: vi.fn(async () => true),
      reveal: vi.fn(async () => undefined),
    },
    edits: {
      apply,
      undo: vi.fn(async () => null),
      redo: vi.fn(async () => null),
      history: vi.fn(async () => snapshot.history),
    },
    assets: {
      list: vi.fn(async () => snapshot.assets),
      import: vi.fn(async () => []),
      pick: vi.fn(async () => []),
      refresh: vi.fn(async () => []),
      relink: vi.fn(async () => null),
    },
    jobs: {
      list: vi.fn(async () => []),
      cancel: vi.fn(async () => true),
    },
    analysis: {
      run: vi.fn(async () => ({ jobs: [], skipped: [] })),
      status: vi.fn(async () => []),
      search: vi.fn(async () => ({ results: [], vectorSearch: false })),
      providers: vi.fn(async () => []),
      saveProvider: vi.fn(async () => {
        throw new Error('not used');
      }),
      deleteProvider: vi.fn(async () => true),
      testProvider: vi.fn(async () => ({ ok: true, message: 'ok' })),
      models: vi.fn(async () => []),
      downloadModel: vi.fn(async () => {
        throw new Error('not used');
      }),
      deleteModel: vi.fn(async () => true),
    },
    motion: {
      save: vi.fn(async () => {
        throw new Error('not used');
      }),
      delete: vi.fn(async () => snapshot),
    },
    export: {
      pickPath: vi.fn(async () => null),
      start: vi.fn(async () => {
        throw new Error('not used');
      }),
      writeFrame: vi.fn(async () => undefined),
      finish: vi.fn(async () => {
        throw new Error('not used');
      }),
      cancel: vi.fn(async () => true),
      list: vi.fn(async () => []),
      reveal: vi.fn(async () => undefined),
      otio: vi.fn(async () => null),
    },
    events: {
      subscribe: vi.fn(() => () => undefined),
    },
  } satisfies KerfBridge;
  return { bridge, apply };
}

describe('studio store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('hydrates projects and the active snapshot', async () => {
    const snapshot = makeSnapshot();
    const { bridge } = makeBridge(snapshot);
    const store = createStudioStore(bridge);

    await store.getState().hydrate();

    expect(store.getState().projects).toEqual([snapshot.summary]);
    expect(store.getState().snapshot).toBe(snapshot);
    expect(store.getState().busy).toBe(false);
  });

  it('merges job events without replacing the snapshot', () => {
    const snapshot = makeSnapshot();
    const { bridge } = makeBridge(snapshot);
    const store = createStudioStore(bridge);
    store.setState({ snapshot });
    const job = {
      id: 'job_1',
      projectId: snapshot.project.id,
      kind: 'media.probe',
      targetId: 'asset_1',
      status: 'running' as const,
      stage: 'probing',
      progress: 0.25,
      error: null,
      createdAt: 1,
      updatedAt: 2,
      startedAt: 1,
      finishedAt: null,
    };

    store.getState().handleEvent({ type: 'jobs.changed', job });

    expect(store.getState().snapshot?.jobs).toEqual([job]);
    expect(store.getState().snapshot?.project).toBe(snapshot.project);
  });

  it('clamps the playhead to the sequence duration', () => {
    const snapshot = makeSnapshot();
    const { bridge } = makeBridge(snapshot);
    const store = createStudioStore(bridge);
    store.setState({ snapshot });

    store.getState().setPlayhead(999);
    expect(store.getState().playhead).toBe(240);

    store.getState().nudgePlayhead(-300);
    expect(store.getState().playhead).toBe(0);
  });

  it('supports additive selection and clearing', () => {
    const snapshot = makeSnapshot();
    const { bridge } = makeBridge(snapshot);
    const store = createStudioStore(bridge);

    store.getState().selectClip('clip_a');
    store.getState().selectClip('clip_b', true);
    expect(store.getState().selection.clipIds).toEqual(['clip_a', 'clip_b']);

    store.getState().selectClip('clip_a', true);
    expect(store.getState().selection.clipIds).toEqual(['clip_b']);

    store.getState().clearSelection();
    expect(store.getState().selection.clipIds).toEqual([]);
  });

  it('applies commands through the bridge', async () => {
    const snapshot = makeSnapshot();
    const { bridge, apply } = makeBridge(snapshot);
    const store = createStudioStore(bridge);
    const command = { type: 'sequence.rename' as const, name: 'Renamed' };

    const result = await store.getState().apply(command, 'Rename');

    expect(apply).toHaveBeenCalledWith(command);
    expect(result?.snapshot).toBe(snapshot);
    expect(store.getState().snapshot).toBe(snapshot);
  });

  it('merges export progress and terminal events', () => {
    const snapshot = makeSnapshot();
    const { bridge } = makeBridge(snapshot);
    const store = createStudioStore(bridge);
    store.setState({ snapshot });
    const record = {
      id: 'export_1',
      projectId: snapshot.project.id,
      preset: 'sequence',
      outputPath: '/tmp/cut.mp4',
      status: 'rendering' as const,
      progress: 0.25,
      error: null,
      createdAt: 1,
      completedAt: null,
    };

    store.getState().handleEvent({ type: 'export.changed', export: record });
    expect(store.getState().exports).toEqual([record]);

    store.getState().handleEvent({
      type: 'export.changed',
      export: { ...record, status: 'succeeded', progress: 1 },
    });
    expect(store.getState().exports[0]?.status).toBe('succeeded');
    expect(store.getState().toasts.at(-1)?.title).toBe('Export complete');
  });

  it('surfaces edit failures as a toast', async () => {
    const snapshot = makeSnapshot();
    const { bridge } = makeBridge(snapshot);
    bridge.edits.apply.mockRejectedValueOnce(new Error('Overlap'));
    const store = createStudioStore(bridge);

    const result = await store.getState().apply({
      type: 'sequence.rename',
      name: 'Renamed',
    });

    expect(result).toBeNull();
    expect(store.getState().error).toBe('Overlap');
    expect(store.getState().toasts.at(-1)?.tone).toBe('error');
  });
});
