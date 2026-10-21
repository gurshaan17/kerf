import { describe, expect, it } from 'vitest';
import {
  clipEndFrame,
  clipSchema,
  DEFAULT_TEXT_STYLE,
  isMediaClip,
  isVisualClip,
  timeMapSchema,
} from './clips';
import { newId } from './ids';
import { createTrack, trackSchema } from './sequence';

const clipBase = () => ({
  id: newId('clip'),
  trackId: newId('track'),
  startFrame: 12,
  durationFrames: 48,
});

describe('clip union', () => {
  it('applies video defaults', () => {
    const clip = clipSchema.parse({
      ...clipBase(),
      type: 'video',
      assetId: newId('asset'),
    });

    if (clip.type !== 'video') {
      throw new Error('expected a video clip');
    }
    expect(clip.speed).toBe(1);
    expect(clip.sourceInFrame).toBe(0);
    expect(clip.volume).toBe(1);
    expect(clip.fade).toEqual({ inFrames: 0, outFrames: 0 });
    expect(clip.timeMap).toEqual([]);
    expect(clip.transform).toEqual({
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
      opacity: 1,
      anchorX: 0.5,
      anchorY: 0.5,
    });
    expect(clip.effects).toEqual([]);
    expect(clip.masks).toEqual([]);
    expect(clip.keyframes.opacity).toEqual([]);
    expect(clip.blendMode).toBe('normal');
    expect(clipEndFrame(clip)).toBe(60);
  });

  it('applies audio, image and composition defaults', () => {
    const audio = clipSchema.parse({
      ...clipBase(),
      type: 'audio',
      assetId: newId('asset'),
    });
    const image = clipSchema.parse({
      ...clipBase(),
      type: 'image',
      assetId: newId('asset'),
    });
    const composition = clipSchema.parse({
      ...clipBase(),
      type: 'composition',
      compositionId: newId('composition'),
    });

    if (audio.type !== 'audio' || image.type !== 'image') {
      throw new Error('expected audio and image clips');
    }
    expect(audio.speed).toBe(1);
    expect(image.fit).toBe('contain');
    if (composition.type !== 'composition') {
      throw new Error('expected a composition clip');
    }
    expect(composition.name).toBe('Composition');
  });

  it('applies text, caption and shape defaults', () => {
    const text = clipSchema.parse({ ...clipBase(), type: 'text' });
    const caption = clipSchema.parse({
      ...clipBase(),
      type: 'caption',
      transcriptId: newId('transcript'),
      segmentId: newId('segment'),
      text: 'A line',
      words: [{ text: 'A', startFrame: 0, endFrame: 4 }],
    });
    const shape = clipSchema.parse({ ...clipBase(), type: 'shape' });

    if (text.type !== 'text' || caption.type !== 'caption') {
      throw new Error('expected text and caption clips');
    }
    expect(text.text).toBe('');
    expect(text.style).toEqual(DEFAULT_TEXT_STYLE);
    expect(caption.words).toHaveLength(1);
    expect(caption.words[0]?.confidence).toBe(1);
    if (shape.type !== 'shape') {
      throw new Error('expected a shape clip');
    }
    expect(shape.shape).toBe('rect');
    expect(shape.fill).toBe('#c9a46a');
    expect(shape.stroke).toBeNull();
  });

  it('rejects missing type-specific fields', () => {
    expect(() => clipSchema.parse({ ...clipBase(), type: 'video' })).toThrow();
    expect(() =>
      clipSchema.parse({ ...clipBase(), type: 'caption' }),
    ).toThrow();
    expect(() =>
      clipSchema.parse({ ...clipBase(), type: 'unknown' }),
    ).toThrow();
  });

  it('round-trips clips inside a track', () => {
    const clip = clipSchema.parse({
      ...clipBase(),
      type: 'video',
      assetId: newId('asset'),
    });
    const track = createTrack({ kind: 'video' });
    const parsed = trackSchema.parse({ ...track, clips: [clip] });

    expect(parsed.clips).toHaveLength(1);
    expect(parsed.clips[0]?.id).toBe(clip.id);
  });

  it('validates time maps and allows reversed source order', () => {
    const reversed = timeMapSchema.parse([
      { frame: 0, sourceFrame: 120 },
      { frame: 24, sourceFrame: 0 },
    ]);
    expect(reversed).toHaveLength(2);
    expect(() =>
      timeMapSchema.parse([
        { frame: 24, sourceFrame: 0 },
        { frame: 0, sourceFrame: 120 },
      ]),
    ).toThrow();
  });

  it('classifies visual and media clips', () => {
    const video = clipSchema.parse({
      ...clipBase(),
      type: 'video',
      assetId: newId('asset'),
    });
    const shape = clipSchema.parse({ ...clipBase(), type: 'shape' });

    expect(isMediaClip(video)).toBe(true);
    expect(isVisualClip(video)).toBe(true);
    expect(isMediaClip(shape)).toBe(false);
    expect(isVisualClip(shape)).toBe(true);
  });
});
