import { describe, expect, it, vi } from 'vitest';
import { parsePolishOutput, analyseScreenPolish } from './screen-polish';
const { generate, sample, ffmpeg, remove } = vi.hoisted(() => ({
  generate: vi.fn(),
  sample: vi.fn(),
  ffmpeg: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('ai', () => ({ generateText: generate }));
vi.mock('./visual-narration', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./visual-narration')>()),
  sampleVideo: sample,
}));
vi.mock('../media/ffmpeg', () => ({ runFfmpeg: ffmpeg }));
vi.mock('node:fs', () => ({
  mkdirSync: vi.fn(),
  mkdtempSync: () => '/tmp/polish-test',
  readFileSync: () => Buffer.from('jpeg'),
  rmSync: remove,
}));
const rate = { numerator: 30000, denominator: 1001 };
const frames = [
  { time: 2, contextOnly: true },
  { time: 4, contextOnly: false },
  { time: 6, contextOnly: false },
];
const row = {
  startIndex: 1,
  endIndex: 1,
  kind: 'zoom',
  region: { x: 0.1, y: 0.3, w: 0.2, h: 0.1 },
  text: '',
  reason: 'The settings dialog opens',
};
const json = (suggestions: unknown[]) => JSON.stringify({ suggestions });
describe('vision polish evidence', () => {
  it('maps actual evidence to fractional-fps source timing, bounded by the next sampled state', () => {
    const result = parsePolishOutput(json([row]), frames, rate, 300);
    expect(result[0]).toMatchObject({
      startFrame: 120,
      endFrame: 180,
      evidenceFrames: [120],
    });
    expect(parsePolishOutput(json([]), frames, rate, 300)).toEqual([]);
  });
  it('rejects hallucinated indices, context endpoints, overlap and invalid regions', () => {
    for (const patch of [
      { startIndex: 0 },
      { endIndex: 100 },
      { startIndex: 2, endIndex: 1 },
      { region: { x: 0.9, y: 0.5, w: 0.3, h: 0.2 } },
      { kind: 'blur' },
    ])
      expect(() =>
        parsePolishOutput(json([{ ...row, ...patch }]), frames, rate, 300),
      ).toThrow();
    expect(() =>
      parsePolishOutput(json([row, row]), frames, rate, 300),
    ).toThrow();
    expect(() => parsePolishOutput('bad JSON', frames, rate, 300)).toThrow(
      'invalid polish',
    );
  });
  it('sends image evidence to the model, checks consent and cleans temporary frames', async () => {
    sample.mockResolvedValue({
      samples: [
        { time: 4, score: 1 },
        { time: 6, score: 0.2 },
      ],
      candidates: 2,
    });
    generate.mockResolvedValue({
      text: json([{ ...row, startIndex: 0, endIndex: 0 }]),
    });
    const check = vi.fn();
    const result = await analyseScreenPolish({
      path: '/recording',
      ffmpeg: '/ffmpeg',
      workRoot: '/tmp',
      rate,
      startFrame: 120,
      endFrame: 300,
      model: {} as never,
      signal: new AbortController().signal,
      checkProvider: check,
      progress: vi.fn(),
    });
    expect(result.observations).toHaveLength(1);
    expect(result.sampleCount).toBe(2);
    expect(
      generate.mock.calls[0]![0].messages[0].content.filter(
        (p: { type: string }) => p.type === 'file',
      ),
    ).toHaveLength(2);
    expect(check).toHaveBeenCalledTimes(3);
    expect(remove).toHaveBeenCalledWith('/tmp/polish-test', {
      recursive: true,
      force: true,
    });
    generate.mockRejectedValueOnce(new Error('provider failed'));
    await expect(
      analyseScreenPolish({
        path: '/recording',
        ffmpeg: '/ffmpeg',
        workRoot: '/tmp',
        rate,
        startFrame: 120,
        endFrame: 300,
        model: {} as never,
        signal: new AbortController().signal,
        checkProvider: check,
        progress: vi.fn(),
      }),
    ).rejects.toThrow('provider failed');
    expect(remove).toHaveBeenCalledTimes(2);
  });
});
