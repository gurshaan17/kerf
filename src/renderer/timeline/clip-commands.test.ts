import { describe, expect, it } from 'vitest';
import {
  FRAME_RATES,
  createAsset,
  createProject,
  createSequence,
  createTrack,
} from '@kerf/model';
import { applyCommand } from '@kerf/engine';
import {
  clipDurationFrames,
  createClipForAsset,
  deleteClipsCommand,
  duplicateClipsCommand,
  insertAssetCommand,
  pasteClipsCommand,
  preferredTrackForAsset,
  splitAtFrameCommand,
} from './clip-commands';

function projectId() {
  return createProject({ name: 'Clip commands', now: 1 }).id;
}

function videoAsset(durationSeconds = 10) {
  return {
    ...createAsset({
      projectId: projectId(),
      name: 'Take one.mp4',
      sourcePath: '/media/take-one.mp4',
      kind: 'video',
      now: 1,
    }),
    durationSeconds,
    frameRate: FRAME_RATES.film,
  };
}

function imageAsset() {
  return {
    ...createAsset({
      projectId: projectId(),
      name: 'Still.png',
      sourcePath: '/media/still.png',
      kind: 'image',
      now: 1,
    }),
    durationSeconds: 0,
  };
}

function audioAsset() {
  return {
    ...createAsset({
      projectId: projectId(),
      name: 'Score.wav',
      sourcePath: '/media/score.wav',
      kind: 'audio',
      now: 1,
    }),
    durationSeconds: 10,
    frameRate: FRAME_RATES.film,
  };
}

describe('timeline clip commands', () => {
  it('maps an asset to the first compatible unlocked track', () => {
    const sequence = createSequence({ name: 'Test' });
    const video = videoAsset();
    const track = preferredTrackForAsset(video, sequence);

    expect(track?.kind).toBe('video');
    expect(
      createClipForAsset(video, track!, 0, sequence.frameRate),
    ).toMatchObject({
      type: 'video',
      assetId: video.id,
      durationFrames: 240,
      startFrame: 0,
      label: video.name,
    });
  });

  it('uses a five second hold for stills', () => {
    const sequence = createSequence({ name: 'Test' });
    const image = imageAsset();
    const track = preferredTrackForAsset(image, sequence);

    expect(clipDurationFrames(image, sequence.frameRate)).toBe(120);
    expect(
      createClipForAsset(image, track!, 20, sequence.frameRate),
    ).toMatchObject({
      type: 'image',
      startFrame: 20,
      durationFrames: 120,
    });
  });

  it('inserts onto a locked track as no command', () => {
    const locked = createTrack({ kind: 'video', locked: true, order: 0 });
    const sequence = createSequence({ name: 'Test', tracks: [locked] });

    expect(insertAssetCommand(videoAsset(), sequence, locked.id, 0)).toBeNull();
  });

  it('builds a split for the selected clip at the playhead', () => {
    const track = createTrack({ kind: 'video', order: 0 });
    const video = videoAsset();
    const clip = createClipForAsset(video, track, 0, FRAME_RATES.film)!;
    const sequence = createSequence({
      name: 'Test',
      tracks: [{ ...track, clips: [clip] }],
    });

    const command = splitAtFrameCommand(sequence, 100, [clip.id]);

    expect(command).toEqual({
      type: 'clip.split',
      clipId: clip.id,
      frame: 100,
    });
  });

  it('splits every clip under the playhead when nothing is selected', () => {
    const videoTrack = createTrack({ kind: 'video', order: 0 });
    const audioTrack = createTrack({ kind: 'audio', order: 1 });
    const videoClip = createClipForAsset(
      videoAsset(),
      videoTrack,
      0,
      FRAME_RATES.film,
    )!;
    const audioClip = createClipForAsset(
      audioAsset(),
      audioTrack,
      0,
      FRAME_RATES.film,
    )!;
    const sequence = createSequence({
      name: 'Test',
      tracks: [
        { ...videoTrack, clips: [videoClip] },
        { ...audioTrack, clips: [audioClip] },
      ],
    });

    const command = splitAtFrameCommand(sequence, 50, []);

    expect(command?.type).toBe('batch');
  });

  it('pastes copies at the playhead and moves them clear of clips', () => {
    const track = createTrack({ kind: 'video', order: 0 });
    const clip = createClipForAsset(videoAsset(), track, 0, FRAME_RATES.film)!;
    const sequence = createSequence({
      name: 'Test',
      tracks: [{ ...track, clips: [clip] }],
    });

    const pasted = pasteClipsCommand(sequence, [clip], 100);

    expect(pasted?.command.type).toBe('clip.insert');
    if (pasted?.command.type === 'clip.insert') {
      expect(pasted.command.clip.startFrame).toBe(clip.durationFrames);
      expect(pasted.command.clip.id).not.toBe(clip.id);
      expect(pasted.clipIds).toEqual([pasted.command.clip.id]);
      const result = applyCommand(sequence, pasted.command);
      expect(
        result.sequence.tracks[0]?.clips.map((candidate) => candidate.id),
      ).toContain(pasted.command.clip.id);
    }
  });

  it('keeps relative spacing when pasting several clips', () => {
    const track = createTrack({ kind: 'video', order: 0 });
    const first = createClipForAsset(videoAsset(), track, 0, FRAME_RATES.film)!;
    const second = createClipForAsset(
      videoAsset(),
      track,
      300,
      FRAME_RATES.film,
    )!;
    const sequence = createSequence({
      name: 'Test',
      tracks: [{ ...track, clips: [first, second] }],
    });

    const pasted = pasteClipsCommand(sequence, [first, second], 1000);

    expect(pasted?.command.type).toBe('batch');
    if (pasted?.command.type === 'batch') {
      const starts = pasted.command.commands.map((command) =>
        command.type === 'clip.insert' ? command.clip.startFrame : -1,
      );
      expect(starts).toEqual([1000, 1300]);
      expect(pasted.clipIds).toHaveLength(2);
    }
  });

  it('deletes or duplicates selected clips', () => {
    const track = createTrack({ kind: 'video', order: 0 });
    const clip = createClipForAsset(videoAsset(), track, 0, FRAME_RATES.film)!;
    const sequence = createSequence({
      name: 'Test',
      tracks: [{ ...track, clips: [clip] }],
    });

    expect(deleteClipsCommand(sequence, [clip.id], false)).toEqual({
      type: 'clip.remove',
      clipId: clip.id,
    });
    expect(duplicateClipsCommand(sequence, [clip.id])).toEqual({
      type: 'clip.duplicate',
      clipId: clip.id,
      offsetFrames: clip.durationFrames,
    });
  });
});
