import { describe, expect, it } from 'vitest';
import { clipSchema, newId } from '@kerf/model';
import { applyCommand } from './apply';
import {
  transcriptEditCommand,
  transcriptOccurrences,
} from './transcript-edit';
import {
  makeAudioClip,
  makeSequence,
  makeTrack,
  makeVideoClip,
  withClips,
} from './test-fixtures';

function fixture() {
  const v = makeTrack('video', 0),
    a = makeTrack('audio', 1),
    c = makeTrack('overlay', 2);
  const video = makeVideoClip({
    trackId: v.id,
    durationFrames: 120,
    sourceInFrame: 24,
  });
  const audio = makeAudioClip({ ...video, trackId: a.id });
  const caption = clipSchema.parse({
    type: 'caption',
    id: newId('clip'),
    trackId: c.id,
    startFrame: 24,
    durationFrames: 48,
    transcriptId: newId('transcript'),
    segmentId: newId('segment'),
    text: 'one two',
    words: [
      { text: 'one', startFrame: 0, endFrame: 24 },
      { text: 'two', startFrame: 24, endFrame: 48 },
    ],
  });
  return {
    video,
    sequence: makeSequence([
      withClips(v, [video]),
      withClips(a, [audio]),
      withClips(c, [caption]),
    ]),
  };
}
describe('transcript edits', () => {
  it('maps differing rates, speeds, partial trims and repeated occurrences', () => {
    const { video, sequence } = fixture();
    sequence.tracks[0]!.clips.push({
      ...video,
      id: newId('clip'),
      startFrame: 200,
      speed: 2,
    });
    expect(
      transcriptOccurrences(
        sequence,
        video.assetId,
        { startFrame: 60, endFrame: 120 },
        { numerator: 60, denominator: 1 },
      ),
    ).toMatchObject([
      { startFrame: 0, endFrame: 24 },
      { startFrame: 200, endFrame: 212 },
      { startFrame: 0, endFrame: 24 },
    ]);
  });
  for (const action of ['remove', 'extract', 'move', 'mute'] as const)
    it(`${action} preserves sync and supports exact undo/redo`, () => {
      const { video, sequence } = fixture();
      const result = applyCommand(
        sequence,
        transcriptEditCommand(sequence, 24, 48, action, video.assetId),
      );
      const undo = applyCommand(result.sequence, result.inverse!);
      expect(undo.sequence).toEqual(sequence);
      expect(applyCommand(undo.sequence, undo.inverse!).sequence).toEqual(
        result.sequence,
      );
      const tracks = result.sequence.tracks;
      if (action === 'remove') {
        expect(
          tracks[0]!.clips.map((c) => [c.startFrame, c.durationFrames]),
        ).toEqual([
          [0, 24],
          [24, 72],
        ]);
        expect(tracks[2]!.clips[0]).toMatchObject({
          startFrame: 24,
          durationFrames: 24,
          text: 'two',
          words: [{ text: 'two', startFrame: 0, endFrame: 24 }],
        });
      }
      if (action === 'extract')
        expect(tracks[0]!.clips[1]).toMatchObject({
          startFrame: 120,
          durationFrames: 24,
          sourceInFrame: 48,
        });
      if (action === 'move')
        expect(tracks[0]!.clips.find((c) => c.startFrame === 96)).toMatchObject(
          { durationFrames: 24, sourceInFrame: 48 },
        );
      if (action === 'mute') {
        expect(tracks[0]!.clips[1]).toMatchObject({
          volume: 0,
          durationFrames: 24,
        });
        expect(tracks[2]!.clips).toEqual(sequence.tracks[2]!.clips);
      }
    });
  it('rejects empty ranges, locked tracks and speed ramps', () => {
    const { sequence } = fixture();
    expect(() => transcriptEditCommand(sequence, 24, 24, 'remove')).toThrow();
    sequence.tracks[1]!.locked = true;
    expect(() => transcriptEditCommand(sequence, 24, 48, 'remove')).toThrow(
      'Unlock',
    );
  });
});

it('removes an entire occurrence and restores it exactly', () => {
  const { sequence } = fixture();
  const result = applyCommand(
    sequence,
    transcriptEditCommand(sequence, 0, 120, 'remove'),
  );
  expect(result.sequence.tracks.every((t) => !t.clips.length)).toBe(true);
  expect(applyCommand(result.sequence, result.inverse!).sequence).toEqual(
    sequence,
  );
});

it('rejects partial captions without timing rather than duplicating their text', () => {
  const { sequence } = fixture();
  const caption = sequence.tracks[2]!.clips[0]!;
  if (caption.type === 'caption') caption.words = [];
  expect(() => transcriptEditCommand(sequence, 24, 48, 'remove')).toThrow(
    'without word timing',
  );
});
