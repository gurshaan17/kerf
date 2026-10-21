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
  jobs: {
    list: async () => [],
    cancel: async () => false,
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
