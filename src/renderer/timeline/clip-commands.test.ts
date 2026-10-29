import { describe, expect, it } from 'vitest';
import {
  FRAME_RATES,
  clipSchema,
  createAsset,
  createProject,
  createSequence,
  createTrack,
  newId,
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

function blurOverlay(
  track: ReturnType<typeof createTrack>,
  linkedItemId: string | null,
  startFrame = 0,
  durationFrames = 48,
) {
  return clipSchema.parse({
    id: newId('clip'),
    trackId: track.id,
    type: 'fxOverlay',
    startFrame,
    durationFrames,
    label: 'Blur',
    linkedItemId,
    props: {
      kind: 'blur',
      region: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
    },
  });
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
  it('inserts separate synchronized video and audio in one undoable edit', () => {
    const sequence = createSequence({ name: 'Split source audio' });
    const video = { ...videoAsset(), hasAudio: true };
    const track = preferredTrackForAsset(video, sequence)!;
    const command = insertAssetCommand(video, sequence, track.id, 30)!;
    const result = applyCommand(sequence, command);
    const clips = result.sequence.tracks.flatMap((track) => track.clips);
    expect(clips).toHaveLength(2);
    expect(clips.find((clip) => clip.type === 'video')).toMatchObject({
      assetId: video.id,
      startFrame: 30,
      durationFrames: 240,
      volume: 0,
    });
    expect(clips.find((clip) => clip.type === 'audio')).toMatchObject({
      assetId: video.id,
      startFrame: 30,
      durationFrames: 240,
      volume: 1,
      sourceInFrame: 0,
    });
    expect(applyCommand(result.sequence, result.inverse!).sequence).toEqual(
      sequence,
    );
  });

  it('creates an audio track when existing tracks are locked or occupied', () => {
    const visual = createTrack({ kind: 'video', order: 0 });
    const locked = createTrack({ kind: 'audio', order: 1, locked: true });
    const occupied = createTrack({ kind: 'audio', order: 2 });
    const existing = createClipForAsset(
      audioAsset(),
      occupied,
      0,
      FRAME_RATES.film,
    )!;
    const sequence = createSequence({
      name: 'Full tracks',
      tracks: [visual, locked, { ...occupied, clips: [existing] }],
    });
    const video = { ...videoAsset(), hasAudio: true };
    const result = applyCommand(
      sequence,
      insertAssetCommand(video, sequence, visual.id, 0)!,
    );
    expect(result.sequence.tracks).toHaveLength(4);
    expect(result.sequence.tracks[3]?.clips[0]).toMatchObject({
      type: 'audio',
      assetId: video.id,
    });
    expect(result.sequence.tracks[2]?.clips).toEqual([existing]);
    expect(applyCommand(result.sequence, result.inverse!).sequence).toEqual(
      sequence,
    );
  });

  it('keeps silent videos and images as single clip inserts', () => {
    const sequence = createSequence({ name: 'Silent footage' });
    const track = sequence.tracks[0]!;
    for (const asset of [{ ...videoAsset(), hasAudio: false }, imageAsset()]) {
      expect(insertAssetCommand(asset, sequence, track.id, 0)?.type).toBe(
        'clip.insert',
      );
    }
  });

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

  it('uses the sequence frame rate for clip duration', () => {
    const sequence = createSequence({
      name: 'Mixed rate',
      frameRate: FRAME_RATES.web30,
    });
    const video = { ...videoAsset(10), frameRate: FRAME_RATES.film };

    expect(clipDurationFrames(video, sequence.frameRate)).toBe(300);
    expect(clipDurationFrames(video, FRAME_RATES.film)).toBe(240);
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

  it('leaves a linked overlay to its source delete cascade', () => {
    const videoTrack = createTrack({ kind: 'video', order: 0 });
    const effectsTrack = createTrack({ kind: 'effects', order: 1 });
    const source = createClipForAsset(
      videoAsset(),
      videoTrack,
      0,
      FRAME_RATES.film,
    )!;
    const overlay = blurOverlay(
      effectsTrack,
      source.id,
      0,
      source.durationFrames,
    );
    const sequence = createSequence({
      name: 'Test',
      tracks: [
        { ...videoTrack, clips: [source] },
        { ...effectsTrack, clips: [overlay] },
      ],
    });

    expect(
      deleteClipsCommand(sequence, [source.id, overlay.id], false),
    ).toEqual({ type: 'clip.remove', clipId: source.id });
    expect(deleteClipsCommand(sequence, [overlay.id], false)).toEqual({
      type: 'clip.remove',
      clipId: overlay.id,
    });
  });

  it('creates an Effects track when pasting the first overlay', () => {
    const videoTrack = createTrack({ kind: 'video', order: 0 });
    const clip = createClipForAsset(
      videoAsset(),
      videoTrack,
      0,
      FRAME_RATES.film,
    )!;
    const sequence = createSequence({
      name: 'Test',
      tracks: [{ ...videoTrack, clips: [clip] }],
    });
    const detachedEffects = createTrack({ kind: 'effects', order: 1 });
    const overlay = blurOverlay(detachedEffects, clip.id, 0, 48);

    const pasted = pasteClipsCommand(sequence, [overlay], 100);

    expect(pasted?.command.type).toBe('batch');
    if (pasted?.command.type !== 'batch') {
      throw new Error('expected a batch');
    }
    expect(
      pasted.command.commands.some((command) => command.type === 'track.add'),
    ).toBe(true);
    expect(pasted.clipIds).toHaveLength(1);

    const result = applyCommand(sequence, pasted.command);
    const effects = result.sequence.tracks.find(
      (track) => track.kind === 'effects',
    );
    expect(effects).toBeDefined();
    expect(result.sequence.tracks[0]?.kind).toBe('effects');
    expect(effects?.clips).toHaveLength(1);
    expect(effects?.clips[0]).toMatchObject({
      type: 'fxOverlay',
      startFrame: 100,
      linkedItemId: clip.id,
    });
  });

  it('pastes overlapping overlays without shifting them later', () => {
    const effectsTrack = createTrack({ kind: 'effects', order: 0 });
    const existing = blurOverlay(effectsTrack, null, 0, 48);
    const sequence = createSequence({
      name: 'Test',
      tracks: [{ ...effectsTrack, clips: [existing] }],
    });

    const pasted = pasteClipsCommand(sequence, [existing], 0);

    expect(pasted?.command.type).toBe('clip.insert');
    if (pasted?.command.type !== 'clip.insert') {
      throw new Error('expected an insert');
    }
    expect(pasted.command.clip.startFrame).toBe(0);
    const result = applyCommand(sequence, pasted.command);
    expect(result.sequence.tracks[0]?.clips).toHaveLength(2);
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
