import { z } from 'zod';
import { newId, idSchema } from './ids';
import {
  transcriptSchema,
  transcriptSegmentSchema,
  type Transcript,
  type TranscriptSegment,
} from './transcript';

const base = {
  transcriptId: idSchema('transcript'),
  expectedRevision: z.number().int().nonnegative(),
};
const segment = { ...base, segmentId: idSchema('segment') };
const text = z.string().trim().min(1).max(2000);
const frame = z.number().int().nonnegative();
export const narrationEditSchema = z.discriminatedUnion('type', [
  z.object({ ...segment, type: z.literal('updateText'), text }).strict(),
  z
    .object({
      ...segment,
      type: z.literal('setTiming'),
      startFrame: frame,
      endFrame: frame,
    })
    .strict(),
  z
    .object({ ...segment, type: z.literal('split'), splitFrame: frame })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('merge'),
      segmentIds: z.array(idSchema('segment')).min(2).max(100),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('add'),
      startFrame: frame,
      endFrame: frame,
      text,
    })
    .strict(),
  z.object({ ...segment, type: z.literal('delete') }).strict(),
  z.object({ ...base, type: z.literal('undo') }).strict(),
  z.object({ ...base, type: z.literal('redo') }).strict(),
  z.object({ ...base, type: z.literal('review') }).strict(),
]);
export type NarrationEdit = z.infer<typeof narrationEditSchema>;
export type NarrationRequest<K extends NarrationEdit['type']> = Omit<
  Extract<NarrationEdit, { type: K }>,
  'type'
>;
export const narrationGenerateSchema = z
  .object({
    assetId: idSchema('asset'),
    providerId: z.string().min(1),
    expectedRevision: z.number().int().nonnegative().nullable(),
    startFrame: frame,
    endFrame: frame,
    replaceEdited: z.boolean().default(false),
    replaceEmptySpeech: z.boolean().default(false),
  })
  .strict();
export type NarrationGenerateRequest = z.infer<typeof narrationGenerateSchema>;

export function validateNarrationSegments(
  segments: readonly TranscriptSegment[],
  duration: number,
): void {
  const ids = new Set<string>();
  let end = 0;
  for (const row of segments) {
    if (
      ids.has(row.id) ||
      row.startFrame < end ||
      row.endFrame <= row.startFrame ||
      row.endFrame > duration ||
      !row.text.trim()
    )
      throw new Error(
        'Narration rows need unique IDs, nonempty text and disjoint ranges inside the video.',
      );
    ids.add(row.id);
    end = row.endFrame;
  }
}

export function reviseNarration(
  previous: Transcript,
  segments: TranscriptSegment[],
  status: Transcript['status'],
): Transcript {
  return transcriptSchema.parse({
    ...previous,
    segments,
    text: segments.map((s) => s.text).join(' '),
    status,
    revision: previous.revision + 1,
    undoStates: [
      ...previous.undoStates,
      { segments: previous.segments, status: previous.status },
    ].slice(-30),
    redoStates: [],
  });
}

export function editNarration(
  previous: Transcript,
  input: NarrationEdit,
  duration: number,
): Transcript {
  if (previous.source !== 'visual')
    throw new Error('This editor only changes visual narration.');
  if (
    previous.id !== input.transcriptId ||
    previous.revision !== input.expectedRevision
  )
    throw new Error('Narration changed. Reload and reapply your edit.');
  const rows = previous.segments.map((row) => ({ ...row }));
  if (input.type === 'undo' || input.type === 'redo') {
    const from =
      input.type === 'undo' ? previous.undoStates : previous.redoStates;
    const state = from.at(-1);
    if (!state) throw new Error(`Nothing to ${input.type}.`);
    validateNarrationSegments(state.segments, duration);
    const other = { segments: previous.segments, status: previous.status };
    return transcriptSchema.parse({
      ...previous,
      ...state,
      text: state.segments.map((s) => s.text).join(' '),
      revision: previous.revision + 1,
      undoStates:
        input.type === 'undo'
          ? from.slice(0, -1)
          : [...previous.undoStates, other].slice(-30),
      redoStates:
        input.type === 'redo'
          ? from.slice(0, -1)
          : [...previous.redoStates, other].slice(-30),
    });
  }
  if (input.type === 'review')
    return reviseNarration(previous, rows, 'reviewed');
  if (input.type === 'add')
    rows.push(
      transcriptSegmentSchema.parse({
        id: newId('segment'),
        text: input.text,
        startFrame: input.startFrame,
        endFrame: input.endFrame,
        origin: 'manual',
      }),
    );
  else if (input.type === 'merge') {
    const indices = input.segmentIds
      .map((id) => rows.findIndex((row) => row.id === id))
      .sort((a, b) => a - b);
    if (
      new Set(indices).size !== indices.length ||
      indices.some(
        (index, i) => index < 0 || (i > 0 && index !== indices[i - 1]! + 1),
      )
    )
      throw new Error('Merge consecutive rows only.');
    const selected = indices.map((index) => rows[index]!);
    rows.splice(
      indices[0]!,
      indices.length,
      transcriptSegmentSchema.parse({
        ...selected[0],
        id: newId('segment'),
        text: selected.map((s) => s.text).join(' '),
        endFrame: selected.at(-1)!.endFrame,
        origin: selected.some((row) => row.origin === 'manual')
          ? 'manual'
          : 'edited',
        evidenceFrames: [
          ...new Set(selected.flatMap((s) => s.evidenceFrames)),
        ].sort((a, b) => a - b),
      }),
    );
  } else {
    const index = rows.findIndex((row) => row.id === input.segmentId);
    const row = rows[index];
    if (!row) throw new Error('That narration row no longer exists.');
    const origin = row.origin === 'manual' ? 'manual' : 'edited';
    if (input.type === 'delete') rows.splice(index, 1);
    else if (input.type === 'updateText')
      rows[index] = { ...row, text: input.text, origin };
    else if (input.type === 'setTiming')
      rows[index] = {
        ...row,
        startFrame: input.startFrame,
        endFrame: input.endFrame,
        origin,
      };
    else {
      if (
        input.splitFrame <= row.startFrame ||
        input.splitFrame >= row.endFrame
      )
        throw new Error('Split inside the selected row.');
      const words = row.text.trim().split(/\s+/);
      if (words.length < 2)
        throw new Error('A row needs at least two words to split its text.');
      const boundary = Math.max(
        1,
        Math.min(
          words.length - 1,
          Math.round(
            (words.length * (input.splitFrame - row.startFrame)) /
              (row.endFrame - row.startFrame),
          ),
        ),
      );
      rows.splice(
        index,
        1,
        {
          ...row,
          id: newId('segment'),
          text: words.slice(0, boundary).join(' '),
          endFrame: input.splitFrame,
          origin,
        },
        {
          ...row,
          id: newId('segment'),
          text: words.slice(boundary).join(' '),
          startFrame: input.splitFrame,
          origin,
        },
      );
    }
  }
  rows.sort((a, b) => a.startFrame - b.startFrame);
  validateNarrationSegments(rows, duration);
  return reviseNarration(previous, rows, 'draft');
}

export function regenerateNarration(
  previous: Transcript,
  generated: TranscriptSegment[],
  start: number,
  end: number,
  replaceEdited: boolean,
  duration: number,
): Transcript {
  const kept = previous.segments.filter(
    (row) =>
      row.startFrame < start ||
      row.endFrame > end ||
      row.origin === 'manual' ||
      (row.origin === 'edited' && !replaceEdited),
  );
  const added = generated.filter(
    (row) =>
      row.startFrame >= start &&
      row.endFrame <= end &&
      !kept.some(
        (saved) =>
          row.startFrame < saved.endFrame && row.endFrame > saved.startFrame,
      ),
  );
  const rows = [...kept, ...added].sort((a, b) => a.startFrame - b.startFrame);
  validateNarrationSegments(rows, duration);
  return reviseNarration(previous, rows, 'draft');
}
