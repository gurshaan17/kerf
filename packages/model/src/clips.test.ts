import { describe, expect, it } from 'vitest';
import {
  clipEndFrame,
  clipSchema,
  DEFAULT_TEXT_STYLE,
  isFxOverlayClip,
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

  it('applies defaults to every effect overlay kind', () => {
    const overlayBase = (kind: string) => ({
      ...clipBase(),
      type: 'fxOverlay',
      props: {
        kind,
        region: { x: 0.1, y: 0.2, w: 0.4, h: 0.3 },
      },
    });

    const blur = clipSchema.parse(overlayBase('blur'));
    const callout = clipSchema.parse(overlayBase('callout'));
    const spotlight = clipSchema.parse(overlayBase('spotlight'));
    const zoom = clipSchema.parse(overlayBase('zoom'));

    for (const clip of [blur, callout, spotlight, zoom]) {
      if (clip.type !== 'fxOverlay') {
        throw new Error('expected an effect overlay');
      }
      expect(clip.linkedItemId).toBeNull();
      expect(clip.props.region).toEqual({ x: 0.1, y: 0.2, w: 0.4, h: 0.3 });
      expect(clip.props.shape).toBe('rect');
      expect(clip.props.cornerRadius).toBe(0);
      expect(clip.props.transitionInFrames).toBe(0);
      expect(clip.props.transitionOutFrames).toBe(0);
      expect(clip.props.easing).toBe('ease-in-out');
    }

    if (
      blur.type !== 'fxOverlay' ||
      blur.props.kind !== 'blur' ||
      callout.type !== 'fxOverlay' ||
      callout.props.kind !== 'callout' ||
      spotlight.type !== 'fxOverlay' ||
      spotlight.props.kind !== 'spotlight' ||
      zoom.type !== 'fxOverlay' ||
      zoom.props.kind !== 'zoom'
    ) {
      throw new Error('expected matching overlay kinds');
    }

    expect(blur.props.mode).toBe('gaussian');
    expect(blur.props.amount).toBe(24);
    expect(callout.props.text).toBe('Callout');
    expect(callout.props.pointer).toBeNull();
    expect(callout.props.borderWidth).toBe(3);
    expect(callout.props.fontSize).toBe(36);
    expect(spotlight.props.dim).toBe(0.55);
    expect(spotlight.props.feather).toBe(24);
    expect(spotlight.props.color).toBe('#000000');
    expect(zoom.props.zoom).toBe(2);
    expect(zoom.props.focus).toBeNull();
    expect(zoom.props.borderWidth).toBe(4);
    expect(zoom.props.shadow).toBe(true);
    expect(isFxOverlayClip(blur)).toBe(true);
  });

  it('rejects invalid effect overlay props', () => {
    const overlay = (props: Record<string, unknown>) => ({
      ...clipBase(),
      type: 'fxOverlay',
      props,
    });
    const region = { x: 0.1, y: 0.2, w: 0.4, h: 0.3 };

    expect(() =>
      clipSchema.parse(overlay({ kind: 'sparkle', region })),
    ).toThrow();
    expect(() =>
      clipSchema.parse(overlay({ kind: 'blur', region: { ...region, w: 0 } })),
    ).toThrow();
    expect(() =>
      clipSchema.parse(overlay({ kind: 'blur', region: { ...region, x: 3 } })),
    ).toThrow();
    expect(() =>
      clipSchema.parse(overlay({ kind: 'callout', region, textColor: 'red' })),
    ).toThrow();
    expect(() =>
      clipSchema.parse(overlay({ kind: 'zoom', region, zoom: 9 })),
    ).toThrow();
    expect(() =>
      clipSchema.parse({ ...clipBase(), type: 'fxOverlay' }),
    ).toThrow();
  });
});
