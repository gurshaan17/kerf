import { describe, expect, it } from 'vitest';
import { autoCutCommand, autoCutContext } from './auto-cut';
import { newId } from '@kerf/model';
import { applyCommand } from './apply';
import {
  makeAudioClip,
  makeSequence,
  makeTextClip,
  makeTrack,
  makeVideoClip,
  withClips,
} from './test-fixtures';

function fixture() {
  const videoTrack = makeTrack('video', 0);
  const audioTrack = makeTrack('audio', 1);
  const video = makeVideoClip({
    trackId: videoTrack.id,
    startFrame: 30,
    sourceInFrame: 100,
    durationFrames: 120,
  });
  const audio = makeAudioClip({ ...video, trackId: audioTrack.id });
  const later = makeVideoClip({ trackId: videoTrack.id, startFrame: 180 });
  const sequence = makeSequence([
    withClips(videoTrack, [video, later]),
    withClips(audioTrack, [audio]),
  ]);
  sequence.markers = [
    {
      id: newId('marker'),
      frame: 200,
      label: 'Later',
      kind: 'chapter',
      color: '#c9a46a',
    },
  ];
  return { video, audio, later, sequence };
}
describe('Auto cut command', () => {
  it('cuts matching audio and video, ripples later content and markers, and restores everything with one inverse', () => {
    const { video, sequence } = fixture();
    const result = applyCommand(
      sequence,
      autoCutCommand(sequence, video.id, [{ startFrame: 130, endFrame: 160 }]),
    );
    for (const track of result.sequence.tracks) {
      const first = track.clips[0]!;
      const second = track.clips[1]!;
      expect([
        first.startFrame,
        first.durationFrames,
        'sourceInFrame' in first && first.sourceInFrame,
      ]).toEqual([30, 30, 100]);
      expect([
        second.startFrame,
        second.durationFrames,
        'sourceInFrame' in second && second.sourceInFrame,
      ]).toEqual([60, 60, 160]);
    }
    expect(result.sequence.tracks[0]!.clips[2]!.startFrame).toBe(150);
    expect(result.sequence.markers[0]!.frame).toBe(170);
    expect(result.inverse).toBeTruthy();
    const undone = applyCommand(result.sequence, result.inverse!);
    expect(undone.sequence).toEqual(sequence);
    expect(applyCommand(undone.sequence, undone.inverse!).sequence).toEqual(
      result.sequence,
    );
  });
  it('supports removing the head and tail while keeping source offsets', () => {
    const { video, sequence } = fixture();
    const result = applyCommand(
      sequence,
      autoCutCommand(sequence, video.id, [
        { startFrame: 100, endFrame: 110 },
        { startFrame: 200, endFrame: 220 },
      ]),
    );
    expect(result.sequence.tracks[0]!.clips[0]).toMatchObject({
      startFrame: 30,
      durationFrames: 90,
      sourceInFrame: 110,
    });
  });
  it('refuses overlapping content, locked tracks, retiming and animated clips', () => {
    for (const change of ['overlap', 'locked', 'retimed', 'animated']) {
      const { video, sequence } = fixture();
      if (change === 'overlap')
        sequence.tracks.push(
          withClips(makeTrack('overlay', 2), [
            makeTextClip(newId('track'), 50),
          ]),
        );
      if (change === 'locked') sequence.tracks[1]!.locked = true;
      if (change === 'retimed') video.speed = 2;
      if (change === 'animated')
        video.keyframes.opacity = [{ frame: 0, value: 0, easing: 'linear' }];
      // Track schemas clone clips, so set changed media back into the sequence.
      sequence.tracks[0]!.clips[0] = video;
      expect(() => autoCutContext(sequence, video.id)).toThrow();
    }
  });
});
