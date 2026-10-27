import type { ClipType, TrackKind } from '@kerf/model';
import { describe, expect, it } from 'vitest';
import {
  allowedClipTypes,
  assertClipCompatible,
  compatibleTrackKinds,
  isClipCompatible,
  trackKindLabel,
  CLIP_TYPES_BY_TRACK_KIND,
} from './compatibility';
import { EngineError, isEngineError } from './errors';
import { makeAudioClip, makeTrack, makeVideoClip } from './test-fixtures';

const expected: Record<TrackKind, ClipType[]> = {
  video: ['video', 'image', 'text', 'shape', 'composition'],
  audio: ['audio'],
  caption: ['caption'],
  overlay: ['video', 'image', 'text', 'caption', 'shape', 'composition'],
  effects: ['fxOverlay'],
};

describe('track compatibility', () => {
  it('publishes the allowed clip types for every track kind', () => {
    for (const kind of Object.keys(expected) as TrackKind[]) {
      expect(allowedClipTypes(kind)).toEqual(expected[kind]);
      expect(CLIP_TYPES_BY_TRACK_KIND[kind]).toEqual(expected[kind]);
    }
  });

  it('checks individual clip and track pairs', () => {
    expect(isClipCompatible('video', 'video')).toBe(true);
    expect(isClipCompatible('video', 'audio')).toBe(false);
    expect(isClipCompatible('audio', 'audio')).toBe(true);
    expect(isClipCompatible('caption', 'caption')).toBe(true);
    expect(isClipCompatible('overlay', 'caption')).toBe(true);
    expect(isClipCompatible('effects', 'fxOverlay')).toBe(true);
    expect(isClipCompatible('overlay', 'fxOverlay')).toBe(false);
    expect(isClipCompatible('video', 'fxOverlay')).toBe(false);
    expect(compatibleTrackKinds('fxOverlay')).toEqual(['effects']);
  });

  it('lists every track kind that accepts a clip type', () => {
    expect(compatibleTrackKinds('video')).toEqual(['video', 'overlay']);
    expect(compatibleTrackKinds('audio')).toEqual(['audio']);
    expect(compatibleTrackKinds('caption')).toEqual(['caption', 'overlay']);
    expect(compatibleTrackKinds('shape')).toEqual(['video', 'overlay']);
    expect(compatibleTrackKinds('composition')).toEqual(['video', 'overlay']);
  });

  it('accepts a valid placement', () => {
    const track = makeTrack('video', 0);
    const clip = makeVideoClip({ trackId: track.id });
    expect(() => assertClipCompatible(track, clip)).not.toThrow();
  });

  it('rejects a clip on the wrong track with a helpful error', () => {
    const track = makeTrack('video', 0);
    const clip = makeAudioClip({ trackId: track.id });

    try {
      assertClipCompatible(track, clip);
      throw new Error('expected an incompatible track error');
    } catch (error) {
      expect(isEngineError(error)).toBe(true);
      if (error instanceof EngineError) {
        expect(error.code).toBe('incompatible-track');
        expect(error.message).toContain('audio');
        expect(error.hint).toContain('audio');
      }
    }
  });

  it('labels track kinds', () => {
    expect(trackKindLabel('video')).toBe('video');
    expect(trackKindLabel('audio')).toBe('audio');
    expect(trackKindLabel('caption')).toBe('caption');
    expect(trackKindLabel('overlay')).toBe('overlay');
    expect(trackKindLabel('effects')).toBe('effects');
  });
});
