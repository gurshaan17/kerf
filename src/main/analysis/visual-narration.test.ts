import { describe, expect, it } from 'vitest';
import {
  narrationIntervals,
  parseVisualOutput,
  visualBudget,
  visualChunks,
  visualWaves,
} from './visual-narration';
const rate = { numerator: 24, denominator: 1 };
describe('visual narration pipeline', () => {
  it('strictly parses raw or fenced JSON and rejects context indices, prose and ordering defects', () => {
    const frames = [
      { time: 0, contextOnly: true },
      { time: 1, contextOnly: false },
      { time: 2, contextOnly: false },
    ];
    expect(
      parseVisualOutput(
        '```json\n{"segments":[{"startFrameIndex":1,"endFrameIndex":2,"text":"Open settings"}]}\n```',
        frames,
        0,
      )[0]!.evidence,
    ).toEqual([1, 2]);
    expect(() =>
      parseVisualOutput(
        '{"segments":[{"startFrameIndex":0,"endFrameIndex":1,"text":"Bad"}]}',
        frames,
        0,
      ),
    ).toThrow();
    expect(() =>
      parseVisualOutput('Here is {"segments":[]}', frames, 0),
    ).toThrow();
  });
  it('retains overlapping evidence while deriving disjoint intervals and bounded final hold', () => {
    const rows = narrationIntervals(
      [
        { text: 'Open settings', evidence: [0, 1, 3], chunk: 0 },
        { text: 'Change value', evidence: [2, 3], chunk: 0 },
      ],
      rate,
      240,
    );
    expect(rows.map((s) => [s.startFrame, s.endFrame])).toEqual([
      [0, 48],
      [48, 120],
    ]);
    expect(rows[0]!.evidenceFrames).toEqual([0, 24, 72]);
    expect(() =>
      narrationIntervals(
        [
          { text: 'Later', evidence: [2], chunk: 0 },
          { text: 'Earlier', evidence: [1], chunk: 0 },
        ],
        rate,
        240,
      ),
    ).toThrow(/timing/);
  });
  it('caps samples without dropping temporal coverage or tail', () => {
    const samples = Array.from({ length: 900 }, (_, time) => ({
      time,
      score: time % 3,
    }));
    const kept = visualBudget(samples);
    expect(kept).toHaveLength(600);
    expect(new Set(kept.map((s) => Math.floor(s.time / 10))).size).toBe(90);
    expect(kept[0]!.time).toBe(0);
    expect(visualChunks(kept, 900).every((c) => c.samples.length <= 8)).toBe(
      true,
    );
  });
  it('aborts siblings and stops subsequent waves after failure', async () => {
    const chunks = visualChunks(
      Array.from({ length: 32 }, (_, i) => ({ time: i * 2, score: 1 })),
      64,
    );
    const started: number[] = [];
    await expect(
      visualWaves(
        chunks,
        3,
        async (chunk, _context, signal) => {
          started.push(chunk.index);
          if (chunk.index === 1) throw new Error('provider failure');
          await new Promise((resolve) => setTimeout(resolve, 5));
          signal.throwIfAborted();
          return [];
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow('provider failure');
    expect(started).toEqual([0, 1, 2]);
  });
});
