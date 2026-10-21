import { describe, expect, it } from 'vitest';
import type { KerfBridge } from './contracts';

describe('renderer bridge contract', () => {
  it('exposes serializable version strings', () => {
    const bridge: KerfBridge = {
      getVersions: () => ({ electron: '1', chrome: '2', node: '3' }),
    };

    expect(Object.values(bridge.getVersions())).toEqual(['1', '2', '3']);
  });
});
