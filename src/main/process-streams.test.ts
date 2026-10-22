import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import {
  installProcessStreamGuards,
  isBrokenPipe,
  type ProcessOutputStream,
} from './process-streams';

function fakeStream(): NodeJS.WriteStream {
  return new EventEmitter() as unknown as NodeJS.WriteStream;
}

describe('process stream guards', () => {
  it('recognises a broken pipe', () => {
    expect(
      isBrokenPipe(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })),
    ).toBe(true);
    expect(
      isBrokenPipe(Object.assign(new Error('other'), { code: 'ECONNRESET' })),
    ).toBe(false);
    expect(isBrokenPipe(null)).toBe(false);
  });

  it('does not throw when stdout reports EPIPE', () => {
    const stream = fakeStream();
    installProcessStreamGuards([stream]);
    expect(() => {
      stream.emit(
        'error',
        Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }),
      );
    }).not.toThrow();
  });

  it('tolerates a missing stream', () => {
    const streams: ProcessOutputStream[] = [undefined, fakeStream()];
    expect(() => installProcessStreamGuards(streams)).not.toThrow();
  });
});
