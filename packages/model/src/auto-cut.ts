import { z } from 'zod';
import type { TranscriptSegment } from './transcript';

export const autoCutRangeSchema = z
  .object({
    startFrame: z.number().int().nonnegative(),
    endFrame: z.number().int().positive(),
  })
  .strict()
  .refine((range) => range.endFrame > range.startFrame, 'Empty range');
export type AutoCutRange = z.infer<typeof autoCutRangeSchema>;

export const autoCutDecisionSchema = z
  .object({
    unitId: z.string().min(1).max(40),
    reason: z.string().trim().min(1).max(400),
    confidence: z.enum(['clear', 'uncertain']),
  })
  .strict();
export const autoCutOutputSchema = z
  .object({
    removals: z.array(autoCutDecisionSchema).max(400),
  })
  .strict();
export interface AutoCutUnit extends AutoCutRange {
  id: string;
  text: string;
}
export interface AutoCutRemoval extends AutoCutRange {
  id: string;
  reason: string;
}

/** Speech segments are indivisible; silence is evidence, never a cut rule. */
export function autoCutUnits(
  startFrame: number,
  endFrame: number,
  stepFrames: number,
  segments: readonly TranscriptSegment[],
): AutoCutUnit[] {
  autoCutRangeSchema.parse({ startFrame, endFrame });
  if (!Number.isInteger(stepFrames) || stepFrames < 1)
    throw new Error('Invalid sampling interval');
  const speech = segments.filter(
    (s) => s.endFrame > startFrame && s.startFrame < endFrame,
  );
  const boundaries = new Set([startFrame, endFrame]);
  for (const row of speech) {
    boundaries.add(Math.max(startFrame, row.startFrame));
    boundaries.add(Math.min(endFrame, row.endFrame));
  }
  for (
    let frame = startFrame + stepFrames;
    frame < endFrame;
    frame += stepFrames
  )
    boundaries.add(frame);
  const ordered = [...boundaries]
    .filter(
      (frame) =>
        frame === startFrame ||
        frame === endFrame ||
        !speech.some((s) => s.startFrame < frame && s.endFrame > frame),
    )
    .sort((a, b) => a - b);
  return ordered.slice(0, -1).map((start, index) => ({
    id: `unit_${index}`,
    startFrame: start,
    endFrame: ordered[index + 1]!,
    text: speech
      .filter((s) => s.startFrame < ordered[index + 1]! && s.endFrame > start)
      .map((s) => s.text)
      .join(' '),
  }));
}

export function autoCutRemovals(
  units: readonly AutoCutUnit[],
  output: unknown,
  paddingFrames: number,
  minimumFrames: number,
): AutoCutRemoval[] {
  const parsed = autoCutOutputSchema.parse(output);
  const decisions = new Map<string, z.infer<typeof autoCutDecisionSchema>>();
  for (const decision of parsed.removals) {
    if (
      !units.some((u) => u.id === decision.unitId) ||
      decisions.has(decision.unitId)
    )
      throw new Error('Auto cut returned unknown or duplicate evidence');
    decisions.set(decision.unitId, decision);
  }
  const merged: AutoCutRemoval[] = [];
  for (const unit of units) {
    const decision = decisions.get(unit.id);
    if (decision?.confidence !== 'clear') continue;
    const previous = merged.at(-1);
    if (previous?.endFrame === unit.startFrame) {
      previous.endFrame = unit.endFrame;
      if (!previous.reason.includes(decision.reason))
        previous.reason += `; ${decision.reason}`;
    } else
      merged.push({
        id: unit.id,
        startFrame: unit.startFrame,
        endFrame: unit.endFrame,
        reason: decision.reason,
      });
  }
  const start = units[0]?.startFrame;
  const end = units.at(-1)?.endFrame;
  const padded = merged
    .map((range) => ({
      ...range,
      startFrame:
        range.startFrame + (range.startFrame === start ? 0 : paddingFrames),
      endFrame: range.endFrame - (range.endFrame === end ? 0 : paddingFrames),
    }))
    .filter((r) => r.endFrame - r.startFrame >= minimumFrames);
  if (
    padded.reduce((sum, r) => sum + r.endFrame - r.startFrame, 0) >=
    (end ?? 0) - (start ?? 0)
  )
    throw new Error('Auto cut cannot remove the entire clip');
  return padded;
}

export function autoCutKeptRanges(
  startFrame: number,
  endFrame: number,
  removals: readonly AutoCutRange[],
): AutoCutRange[] {
  autoCutRangeSchema.parse({ startFrame, endFrame });
  const kept: AutoCutRange[] = [];
  let cursor = startFrame;
  for (const range of removals) {
    autoCutRangeSchema.parse({
      startFrame: range.startFrame,
      endFrame: range.endFrame,
    });
    if (range.startFrame < cursor || range.endFrame > endFrame)
      throw new Error(
        'Cuts must be ordered, non-overlapping and inside the clip',
      );
    if (range.startFrame > cursor)
      kept.push({ startFrame: cursor, endFrame: range.startFrame });
    cursor = range.endFrame;
  }
  if (cursor < endFrame) kept.push({ startFrame: cursor, endFrame });
  if (!kept.length) throw new Error('Auto cut must keep some footage');
  return kept;
}
