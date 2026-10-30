import { describe, expect, it } from 'vitest';
import {
  createTranscript,
  transcriptSchema,
  transcriptSegmentSchema,
} from './transcript';
import {
  editNarration,
  narrationEditSchema,
  regenerateNarration,
} from './narration';
import { newId } from './ids';

const row = (
  start: number,
  end: number,
  origin: 'generated' | 'edited' | 'manual' = 'generated',
) =>
  transcriptSegmentSchema.parse({
    id: newId('segment'),
    text: 'A useful visible action',
    startFrame: start,
    endFrame: end,
    origin,
    evidenceFrames: [start, end],
  });
function draft() {
  return transcriptSchema.parse({
    ...createTranscript({
      assetId: newId('asset'),
      segments: [row(0, 20), row(30, 50)],
    }),
    source: 'visual',
    status: 'draft',
  });
}

describe('visual narration edits', () => {
  it('defaults legacy data to speech without losing stable IDs', () => {
    const original = createTranscript({
      assetId: newId('asset'),
      segments: [row(0, 10)],
    });
    const {
      source: _,
      revision: __,
      status: ___,
      undoStates: ____,
      redoStates: _____,
      ...legacy
    } = original;
    expect(transcriptSchema.parse(legacy)).toMatchObject({
      source: 'speech',
      revision: 0,
      status: 'reviewed',
      undoStates: [],
    });
  });
  it('edits text with stable IDs and persistent undo/redo states and monotonic revisions', () => {
    const previous = draft();
    const id = previous.segments[0]!.id;
    const edited = editNarration(
      previous,
      {
        type: 'updateText',
        transcriptId: previous.id,
        expectedRevision: 0,
        segmentId: id,
        text: 'Changed description',
      },
      100,
    );
    expect(edited.segments[0]).toMatchObject({
      id,
      origin: 'edited',
      evidenceFrames: [0, 20],
    });
    const reopened = transcriptSchema.parse(JSON.parse(JSON.stringify(edited)));
    const undone = editNarration(
      reopened,
      { type: 'undo', transcriptId: previous.id, expectedRevision: 1 },
      100,
    );
    expect(undone.segments).toEqual(previous.segments);
    expect(undone.revision).toBe(2);
    const redone = editNarration(
      undone,
      { type: 'redo', transcriptId: previous.id, expectedRevision: 2 },
      100,
    );
    expect(redone.segments).toEqual(edited.segments);
    expect(redone.revision).toBe(3);
    expect(() =>
      editNarration(
        redone,
        {
          type: 'delete',
          transcriptId: previous.id,
          expectedRevision: 1,
          segmentId: id,
        },
        100,
      ),
    ).toThrow(/changed/);
  });
  it('validates operations, prevents overlap and splits/merges with new IDs', () => {
    const previous = draft();
    const id = previous.segments[0]!.id;
    expect(() =>
      editNarration(
        previous,
        {
          type: 'setTiming',
          transcriptId: previous.id,
          expectedRevision: 0,
          segmentId: id,
          startFrame: 10,
          endFrame: 40,
        },
        100,
      ),
    ).toThrow(/disjoint/);
    const split = editNarration(
      previous,
      {
        type: 'split',
        transcriptId: previous.id,
        expectedRevision: 0,
        segmentId: id,
        splitFrame: 10,
      },
      100,
    );
    expect(split.segments).toHaveLength(3);
    expect(split.segments.every((s) => s.id !== id)).toBe(true);
    expect(
      split.segments
        .slice(0, 2)
        .map((s) => s.text)
        .join(' '),
    ).toBe(previous.segments[0]!.text);
    const merged = editNarration(
      split,
      {
        type: 'merge',
        transcriptId: split.id,
        expectedRevision: 1,
        segmentIds: split.segments.slice(0, 2).map((s) => s.id),
      },
      100,
    );
    expect(merged.segments[0]).toMatchObject({
      startFrame: 0,
      endFrame: 20,
      origin: 'edited',
    });
    expect(() =>
      narrationEditSchema.parse({
        type: 'delete',
        transcriptId: previous.id,
        expectedRevision: 0,
        segmentId: id,
        segments: [],
      }),
    ).toThrow();
  });
  it('regeneration preserves edits, manual rows and out-of-range IDs; replacement is explicit', () => {
    const previous = transcriptSchema.parse({
      ...draft(),
      segments: [
        row(0, 10, 'edited'),
        row(10, 20, 'manual'),
        row(20, 30),
        row(40, 50),
      ],
    });
    const proposals = [row(0, 10), row(10, 20), row(20, 30)];
    const next = regenerateNarration(previous, proposals, 0, 30, false, 100);
    expect(next.segments.slice(0, 2).map((s) => s.id)).toEqual(
      previous.segments.slice(0, 2).map((s) => s.id),
    );
    expect(next.segments.at(-1)!.id).toBe(previous.segments.at(-1)!.id);
    const replaced = regenerateNarration(previous, proposals, 0, 30, true, 100);
    expect(replaced.segments[0]!.id).not.toBe(previous.segments[0]!.id);
    expect(replaced.segments[1]!.id).toBe(previous.segments[1]!.id);
  });
});
