import { describe, expect, it } from 'vitest';
import type { KerfBridge } from './contracts';

const bridge: KerfBridge = {
  getVersions: () => ({ electron: '1', chrome: '2', node: '3' }),
  projects: {
    list: async () => [],
    active: async () => null,
    create: async () => {
      throw new Error('not used');
    },
    open: async () => {
      throw new Error('not used');
    },
    close: async () => {},
    rename: async () => {
      throw new Error('not used');
    },
    delete: async () => false,
    reveal: async () => {},
  },
  edits: {
    apply: async () => {
      throw new Error('not used');
    },
    undo: async () => null,
    redo: async () => null,
    history: async () => {
      throw new Error('not used');
    },
  },
  assets: {
    list: async () => [],
    import: async () => [],
    pick: async () => [],
    refresh: async () => [],
    relink: async () => null,
  },
  jobs: {
    list: async () => [],
    cancel: async () => false,
  },
  analysis: {
    run: async () => ({ jobs: [], skipped: [] }),
    status: async () => [],
    search: async () => ({ results: [], vectorSearch: false }),
    providers: async () => [],
    saveProvider: async () => {
      throw new Error('not used');
    },
    deleteProvider: async () => false,
    testProvider: async () => ({ ok: false, message: 'not used' }),
    models: async () => [],
    downloadModel: async () => {
      throw new Error('not used');
    },
    deleteModel: async () => false,
  },
  motion: {
    save: async () => {
      throw new Error('not used');
    },
    delete: async () => {
      throw new Error('not used');
    },
  },
  mcp: {
    status: async () => ({
      enabled: false,
      autoStart: true,
      port: 3919,
      running: false,
      endpoint: null,
      token: '',
      sessions: 0,
      activity: [],
      error: null,
    }),
    update: async () => ({
      enabled: false,
      autoStart: true,
      port: 3919,
      running: false,
      endpoint: null,
      token: '',
      sessions: 0,
      activity: [],
      error: null,
    }),
    rotateToken: async () => ({
      enabled: false,
      autoStart: true,
      port: 3919,
      running: false,
      endpoint: null,
      token: '',
      sessions: 0,
      activity: [],
      error: null,
    }),
  },
  chat: {
    send: async () => {
      throw new Error('not used');
    },
    abort: async () => false,
    provider: async () => ({ providerId: null, provider: null }),
    setProvider: async () => ({ providerId: null, provider: null }),
  },
  renderer: {
    subscribe: () => () => undefined,
    respond: async () => {},
    setEditorContext: async () => {},
  },
  export: {
    pickPath: async () => null,
    start: async () => {
      throw new Error('not used');
    },
    writeFrame: async () => {},
    finish: async () => {
      throw new Error('not used');
    },
    cancel: async () => false,
    list: async () => [],
    reveal: async () => {},
    otio: async () => null,
  },
  events: {
    subscribe: () => () => {},
  },
};

describe('renderer bridge contract', () => {
  it('exposes serializable version strings', () => {
    expect(Object.values(bridge.getVersions())).toEqual(['1', '2', '3']);
  });

  it('keeps the project surface behind promises', async () => {
    await expect(bridge.projects.list()).resolves.toEqual([]);
    await expect(bridge.projects.active()).resolves.toBeNull();
    expect(bridge.events.subscribe(() => {})).toBeTypeOf('function');
  });
});
