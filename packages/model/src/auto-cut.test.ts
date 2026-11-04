import { describe, expect, it } from 'vitest';
import { autoCutKeptRanges, autoCutRemovals, autoCutUnits } from './auto-cut';
import { newId } from './ids';
import { transcriptSegmentSchema } from './transcript';

const unit = (id: string, startFrame: number, endFrame: number) => ({
  id,
  startFrame,
  endFrame,
  text: '',
});
const decision = (unitId: string, confidence = 'clear') => ({
  unitId,
  confidence,
  reason: 'Repeated setup',
});
describe('Auto cut evidence', () => {
  it('covers a trimmed source range without splitting speech, including overlapping segments', () => {
    const segments = [
      [120, 210],
      [200, 270],
    ].map(([startFrame, endFrame]) =>
      transcriptSegmentSchema.parse({
        id: newId('segment'),
        startFrame,
        endFrame,
        text: 'Keep this sentence.',
      }),
    );
    expect(autoCutUnits(100, 300, 50, segments)).toEqual([
      { ...unit('unit_0', 100, 120) },
      {
        ...unit('unit_1', 120, 270),
        text: 'Keep this sentence. Keep this sentence.',
      },
      unit('unit_2', 270, 300),
    ]);
  });
  it('merges adjacent clear removals before padding; keeps uncertain and unmentioned footage', () => {
    const units = [
      unit('a', 0, 30),
      unit('b', 30, 60),
      unit('c', 60, 90),
      unit('d', 90, 120),
    ];
    const removals = autoCutRemovals(
      units,
      { removals: [decision('b'), decision('c'), decision('d', 'uncertain')] },
      5,
      15,
    );
    expect(removals).toEqual([
      { id: 'b', startFrame: 35, endFrame: 85, reason: 'Repeated setup' },
    ]);
    expect(autoCutKeptRanges(0, 120, removals)).toEqual([
      { startFrame: 0, endFrame: 35 },
      { startFrame: 85, endFrame: 120 },
    ]);
  });
  it('rejects hallucinated IDs, duplicates, full removal and invalid ranges', () => {
    const units = [unit('a', 0, 30)];
    for (const removals of [
      [decision('missing')],
      [decision('a'), decision('a')],
      [decision('a')],
    ])
      expect(() => autoCutRemovals(units, { removals }, 5, 5)).toThrow();
    for (const cuts of [
      [{ startFrame: 20, endFrame: 40 }],
      [
        { startFrame: 10, endFrame: 20 },
        { startFrame: 15, endFrame: 25 },
      ],
    ])
      expect(() => autoCutKeptRanges(0, 30, cuts)).toThrow();
    expect(autoCutRemovals(units, { removals: [] }, 5, 5)).toEqual([]);
  });
});
