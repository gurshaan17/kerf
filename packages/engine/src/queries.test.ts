import { newId } from '@kerf/model';
import { describe, expect, it } from 'vitest';
import { EngineError } from './errors';
import {
  audioTracksInOrder,
  clipAtFrame,
  clipEnd,
  clipStart,
  clipsForAsset,
  clipsInRange,
  clipsOnTrack,
  findClip,
  findOverlap,
  findTrack,
  hasOverlap,
  nextTrackOrder,
  requireClip,
  requireTrack,
  sequenceDurationFrames,
  tracksInOrder,
  visualTracksInOrder,
} from './queries';
import {
  makeAudioClip,
  makeSequence,
  makeTrack,
  makeVideoClip,
  withClips,
} from './test-fixtures';

const assetId = newId('asset');
const videoTrack = makeTrack('video', 2);
const earlyClip = makeVideoClip({
  trackId: videoTrack.id,
  assetId,
  startFrame: 0,
  durationFrames: 12,
});
const lateClip = makeVideoClip({
  trackId: videoTrack.id,
  assetId,
  startFrame: 24,
  durationFrames: 48,
});
const populatedVideo = withClips(videoTrack, [lateClip, earlyClip]);

const audioTrack = makeTrack('audio', 0);
const audioClip = makeAudioClip({
  trackId: audioTrack.id,
  assetId,
  startFrame: 12,
  durationFrames: 24,
});
const populatedAudio = withClips(audioTrack, [audioClip]);
const emptyAudio = makeTrack('audio', 1);

const sequence = makeSequence([emptyAudio, populatedVideo, populatedAudio]);

describe('sequence queries', () => {
  it('orders tracks by order and filters by kind', () => {
    expect(tracksInOrder(sequence).map((track) => track.id)).toEqual([
      populatedAudio.id,
      emptyAudio.id,
      populatedVideo.id,
    ]);
    expect(audioTracksInOrder(sequence).map((track) => track.id)).toEqual([
      populatedAudio.id,
      emptyAudio.id,
    ]);
    expect(visualTracksInOrder(sequence).map((track) => track.id)).toEqual([
      populatedVideo.id,
    ]);
  });

  it('finds tracks and reports missing ids with an engine error', () => {
    expect(findTrack(sequence, populatedVideo.id)?.id).toBe(populatedVideo.id);
    expect(requireTrack(sequence, populatedAudio.id).id).toBe(
      populatedAudio.id,
    );

    try {
      requireTrack(sequence, 'trk_missing00000');
      throw new Error('expected a missing track error');
    } catch (error) {
      expect(error).toBeInstanceOf(EngineError);
      if (error instanceof EngineError) {
        expect(error.code).toBe('not-found');
        expect(error.hint).toBeTruthy();
      }
    }
  });

  it('finds clips and their containing tracks', () => {
    const location = findClip(sequence, lateClip.id);
    expect(location?.track.id).toBe(populatedVideo.id);
    expect(location?.index).toBe(0);
    expect(requireClip(sequence, earlyClip.id).clip.id).toBe(earlyClip.id);
    expect(() => requireClip(sequence, 'clp_missing00000')).toThrow(
      EngineError,
    );
  });

  it('sorts clips on a track by start frame', () => {
    expect(clipsOnTrack(populatedVideo).map((clip) => clip.id)).toEqual([
      earlyClip.id,
      lateClip.id,
    ]);
  });

  it('finds clips at frame boundaries', () => {
    expect(clipAtFrame(populatedVideo, 0)?.id).toBe(earlyClip.id);
    expect(clipAtFrame(populatedVideo, 11)?.id).toBe(earlyClip.id);
    expect(clipAtFrame(populatedVideo, 12)).toBeUndefined();
    expect(clipAtFrame(populatedVideo, 24)?.id).toBe(lateClip.id);
    expect(clipAtFrame(populatedVideo, 72)).toBeUndefined();
  });

  it('finds clips intersecting a range', () => {
    expect(clipsInRange(populatedVideo, 10, 30).map((clip) => clip.id)).toEqual(
      [earlyClip.id, lateClip.id],
    );
    expect(clipsInRange(populatedVideo, 12, 24)).toEqual([]);
    expect(clipsInRange(populatedVideo, 30, 30)).toEqual([]);
  });

  it('detects overlaps with an optional ignore id', () => {
    expect(findOverlap(populatedVideo, 12, 12)).toBeUndefined();
    expect(findOverlap(populatedVideo, 10, 20)?.id).toBe(lateClip.id);
    expect(hasOverlap(populatedVideo, 10, 20)).toBe(true);
    expect(hasOverlap(populatedVideo, 24, 48, lateClip.id)).toBe(false);
  });

  it('reports the sequence duration and next track order', () => {
    expect(clipStart(earlyClip)).toBe(0);
    expect(clipEnd(lateClip)).toBe(72);
    expect(sequenceDurationFrames(sequence)).toBe(72);
    expect(nextTrackOrder(sequence)).toBe(3);
  });

  it('finds every clip that uses an asset', () => {
    expect(clipsForAsset(sequence, assetId)).toHaveLength(3);
    expect(clipsForAsset(sequence, newId('asset'))).toEqual([]);
  });
});
