import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chunksFor,
  chunkFrames,
  validateSegments,
  runWaves,
  seamPass,
  seamMetric,
  parseResponse,
  deriveNarrationIntervals,
  budgetSamples,
  seamPairs,
} from './visual-narration-prototype.mjs';

test('seam review exposes text and skipped empty chunks without judging correctness', () => {
  const pairs = seamPairs([
    { chunk: 0, text: 'Run tests', evidence: [1] },
    { chunk: 2, text: 'Run tests', evidence: [20] },
  ]);
  assert.equal(pairs[0].similarity, 1);
  assert.equal(pairs[0].skippedChunks, 1);
  assert.equal(pairs[0].reviewDecision, null);
});

test('over-budget sampling is deterministic, capped, and preserves temporal coverage', () => {
  const candidates = Array.from({ length: 900 }, (_, time) => ({
    time,
    score: time % 7,
  }));
  const result = budgetSamples(candidates);
  assert.equal(result.length, 600);
  assert.equal(result[0].time, 0);
  assert.equal(new Set(result.map((s) => Math.floor(s.time / 10))).size, 90);
  assert.deepEqual(budgetSamples(candidates), result);
  assert.throws(() => budgetSamples(candidates, 5), /coverage/);
});

test('narration intervals preserve overlapping evidence and derive disjoint half-open timing', () => {
  const rows = [
    { evidence: [0, 4, 8] },
    { evidence: [4, 8] },
    { evidence: [9] },
  ];
  const result = deriveNarrationIntervals(rows, 10);
  assert.deepEqual(
    result.segments.map((s) => s.narration),
    [
      { start: 0, end: 4 },
      { start: 4, end: 9 },
      { start: 9, end: 10 },
    ],
  );
  assert.deepEqual(result.invalidRows, []);
  assert.deepEqual(rows[0].evidence, [0, 4, 8]);
  assert.equal(
    deriveNarrationIntervals([{ evidence: [1] }], 20, 2).segments[0].narration
      .end,
    3,
  );
  assert.deepEqual(deriveNarrationIntervals([], 20).segments, []);
});

test('timing flags reversed, equal, and out-of-bounds evidence without sorting or trimming', () => {
  for (const times of [
    [5, 2],
    [2, 2],
    [-1, 3],
    [1, 20],
  ]) {
    const result = deriveNarrationIntervals(
      times.map((t) => ({ evidence: [t] })),
      10,
    );
    assert.ok(result.invalidRows.length);
    assert.ok(result.segments.every((s) => s.narration === null));
    assert.deepEqual(
      result.segments.map((s) => s.evidence[0]),
      times,
    );
  }
  assert.ok(
    deriveNarrationIntervals(
      [{ evidence: [5] }, { evidence: [2] }],
      10,
    ).segments[1].timingIssues.includes('out_of_order'),
  );
});

test('accepts one JSON object or full JSON fence, rejecting explanatory prose', () => {
  assert.deepEqual(parseResponse('{"segments":[]}'), { segments: [] });
  assert.deepEqual(parseResponse('```json\n{"segments":[]}\n```'), {
    segments: [],
  });
  assert.throws(() => parseResponse('Here is the result: {"segments":[]}'));
  for (const text of ['null', '[]', '"text"'])
    assert.throws(() => parseResponse(text));
  assert.throws(() =>
    parseResponse('```json\n{"segments":[]}\n```\nExplanation'),
  );
});

test('static wave assignment is independent of completion order for N and W', async () => {
  for (let n = 0; n < 11; n++)
    for (let width = 1; width <= 3; width++) {
      const chunks = Array.from({ length: n }, (_, index) => ({ index }));
      const contexts = new Map();
      const result = await runWaves(
        chunks,
        width,
        async (chunk, context) => {
          contexts.set(
            chunk.index,
            context.map((s) => s.chunk),
          );
          await new Promise((ok) => setTimeout(ok, (n - chunk.index) % 3));
          return [{ chunk: chunk.index }];
        },
        new AbortController().signal,
      );
      assert.deepEqual(
        result.map((s) => s.chunk),
        chunks.map((c) => c.index),
      );
      for (const { index } of chunks)
        assert.deepEqual(
          contexts.get(index),
          index < width ? [] : [Math.floor(index / width) * width - 1],
        );
    }
});

test('overlap is the actual previous sample and cannot be an output endpoint', () => {
  const chunks = chunksFor(
    Array.from({ length: 12 }, (_, time) => ({ time })),
    12,
  );
  const frames = chunkFrames(chunks, 1, true);
  assert.equal(frames[0].time, 7);
  assert.equal(frames[0].contextOnly, true);
  assert.throws(() =>
    validateSegments(
      { segments: [{ startFrameIndex: 0, endFrameIndex: 1, text: 'bad' }] },
      frames,
      chunks[1],
    ),
  );
  assert.equal(
    validateSegments(
      { segments: [{ startFrameIndex: 1, endFrameIndex: 2, text: 'good' }] },
      frames,
      chunks[1],
    )[0].start,
    8,
  );
});

test('seam cleanup merges exact duplicates, preserving distinct actions and evidence', () => {
  const input = [
    {
      chunk: 0,
      text: 'Switch notifications on',
      start: 0,
      end: 2,
      evidence: [0],
    },
    {
      chunk: 1,
      text: 'Switch notifications on',
      start: 2,
      end: 4,
      evidence: [2],
    },
    {
      chunk: 2,
      text: 'Switch notifications off',
      start: 4,
      end: 6,
      evidence: [4],
    },
  ];
  const output = seamPass(input);
  assert.equal(output.length, 2);
  assert.deepEqual(output[0].evidence, [0, 2]);
  assert.equal(input[0].end, 2);
  assert.equal(seamMetric(input).duplicates, 1);
});

test('failure aborts siblings and prevents later waves', async () => {
  const started = [];
  let aborted = false;
  await assert.rejects(
    runWaves(
      Array.from({ length: 5 }, (_, index) => ({ index })),
      3,
      async (chunk, _context, signal) => {
        started.push(chunk.index);
        if (chunk.index === 1) throw new Error('provider failed');
        await new Promise((ok) => setTimeout(ok, 5));
        aborted ||= signal.aborted;
        signal.throwIfAborted();
        return [];
      },
      new AbortController().signal,
    ),
    /provider failed/,
  );
  assert.deepEqual(started, [0, 1, 2]);
  assert.equal(aborted, true);
});

test('cancel mid-wave discards results and starts no later work', async () => {
  const controller = new AbortController();
  const started = [];
  await assert.rejects(
    runWaves(
      Array.from({ length: 4 }, (_, index) => ({ index })),
      2,
      async (chunk) => {
        started.push(chunk.index);
        controller.abort(new Error('user cancelled'));
        return [];
      },
      controller.signal,
    ),
    /user cancelled/,
  );
  assert.deepEqual(started, [0, 1]);
});
