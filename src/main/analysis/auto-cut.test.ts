import { describe, expect, it } from 'vitest';
import { newId, transcriptSegmentSchema } from '@kerf/model';
import { autoCutSpeech, parseAutoCutOutput } from './auto-cut';

describe('Auto cut analysis evidence', () => {
  it('parses fenced JSON and rejects malformed output', () => {
    expect(parseAutoCutOutput('```json\n{"removals":[]}\n```')).toEqual({
      removals: [],
    });
    expect(() => parseAutoCutOutput('not JSON')).toThrow('invalid JSON');
  });
  it('joins display chunks into sentences and preserves un-timed speech', () => {
    const segment = (text: string, start: number, words: string[]) =>
      transcriptSegmentSchema.parse({
        id: newId('segment'),
        startFrame: start,
        endFrame: start + 10 * Math.max(1, words.length),
        text,
        words: words.map((word, i) => ({
          text: word,
          startFrame: start + i * 10,
          endFrame: start + (i + 1) * 10,
        })),
      });
    const rows = autoCutSpeech(
      [
        segment('First', 0, ['First']),
        segment('sentence. Next.', 10, ['sentence.', 'Next.']),
        segment('Untimed speech', 40, []),
      ],
      24,
    );
    expect(rows.map((s) => s.text)).toEqual([
      'First sentence.',
      'Next.',
      'Untimed speech',
    ]);
    expect(rows[0]).toMatchObject({ startFrame: 0, endFrame: 20 });
  });
  it('keeps a pause as an editing boundary without deleting speech', () => {
    const row = transcriptSegmentSchema.parse({
      id: newId('segment'),
      startFrame: 0,
      endFrame: 100,
      text: 'Before After',
      words: [
        { text: 'Before', startFrame: 0, endFrame: 10 },
        { text: 'After', startFrame: 90, endFrame: 100 },
      ],
    });
    expect(autoCutSpeech([row], 24).map((s) => s.text)).toEqual([
      'Before',
      'After',
    ]);
  });
});
