import { createCanvas } from '@napi-rs/canvas';
import type { Canvas } from '@napi-rs/canvas';
import type { Clip, FxOverlayClip, Sequence, Track } from '@kerf/model';
import {
  DEFAULT_TEXT_STYLE,
  clipSchema,
  createSequence,
  createTrack,
  newId,
} from '@kerf/model';
import { describe, expect, it } from 'vitest';
import type { MediaPool } from './media-pool';
import { renderFrame } from './render';
import { overlayTransitionProgress } from './overlays';
import { setScratchCanvasFactory } from './scratch';

// Golden frames need a 2D canvas in Node. The compositor is duck-typed, so the
// napi canvas can stand in for the browser canvas everywhere except types.
type NodeCanvas = Canvas;

function context2d(canvas: NodeCanvas): CanvasRenderingContext2D {
  return canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
}

setScratchCanvasFactory(
  (width, height) =>
    createCanvas(width, height) as unknown as HTMLCanvasElement,
);

const REGION = { x: 0.25, y: 0.2, w: 0.5, h: 0.5 };
const FRAME = 10;

function makeCanvas(width: number, height: number): NodeCanvas {
  return createCanvas(width, height) as unknown as NodeCanvas;
}

function emptyPool(): MediaPool {
  return {
    defaultQuality: 'proxy',
    media: () => null,
    asset: () => undefined,
    video: () => null,
    image: () => null,
    isReady: () => false,
    ensure: () => null,
  } as unknown as MediaPool;
}

interface OverlayInput {
  readonly kind: 'blur' | 'callout' | 'spotlight' | 'zoom';
  readonly props?: Record<string, unknown>;
  readonly startFrame?: number;
  readonly durationFrames?: number;
}

function makeOverlay(track: Track, input: OverlayInput): FxOverlayClip {
  return clipSchema.parse({
    id: newId('clip'),
    trackId: track.id,
    type: 'fxOverlay',
    startFrame: input.startFrame ?? 0,
    durationFrames: input.durationFrames ?? 100,
    linkedItemId: null,
    props: {
      kind: input.kind,
      region: REGION,
      ...input.props,
    },
  }) as FxOverlayClip;
}

function makeShapes() {
  const left: Track = createTrack({
    kind: 'overlay',
    name: 'Left',
    order: 0,
  });
  const right: Track = createTrack({
    kind: 'overlay',
    name: 'Right',
    order: 1,
  });
  const leftClip = clipSchema.parse({
    id: newId('clip'),
    trackId: left.id,
    type: 'shape',
    startFrame: 0,
    durationFrames: 100,
    shape: 'rect',
    width: 0.6,
    height: 0.6,
    fill: '#2f6fed',
  });
  const rightClip = clipSchema.parse({
    id: newId('clip'),
    trackId: right.id,
    type: 'shape',
    startFrame: 0,
    durationFrames: 100,
    shape: 'rect',
    width: 0.2,
    height: 0.35,
    fill: '#e2703a',
  });
  return {
    tracks: [
      { ...left, clips: [leftClip] },
      { ...right, clips: [rightClip] },
    ],
    clips: [leftClip, rightClip],
  };
}

function makeOverlaySequence(
  overlays: readonly {
    kind: OverlayInput['kind'];
    props?: Record<string, unknown>;
  }[],
  options: {
    width?: number;
    height?: number;
  } = {},
): Sequence {
  const shapes = makeShapes();
  const effects = createTrack({ kind: 'effects', name: 'Effects', order: 2 });
  const clips = overlays.map((input) =>
    makeOverlay(effects, { kind: input.kind, props: input.props }),
  );
  return createSequence({
    name: `Overlay ${overlays.map((entry) => entry.kind).join(' + ')}`,
    width: options.width ?? 1920,
    height: options.height ?? 1080,
    tracks: [...shapes.tracks, { ...effects, clips }],
  });
}

function renderCanvas(
  sequence: Sequence,
  width: number,
  height: number,
  frame = FRAME,
): NodeCanvas {
  const canvas = makeCanvas(width, height);
  const context = context2d(canvas);
  renderFrame(context, sequence, frame, {
    pool: emptyPool(),
    background: '#0a0a0a',
  });
  return canvas;
}

function pixels(canvas: NodeCanvas): Uint8ClampedArray {
  const context = context2d(canvas);
  return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

function downscale(
  canvas: NodeCanvas,
  width: number,
  height: number,
): NodeCanvas {
  const scaled = makeCanvas(width, height);
  const context = context2d(scaled);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    canvas as unknown as CanvasImageSource,
    0,
    0,
    width,
    height,
  );
  return scaled;
}

interface DiffStats {
  readonly mean: number;
  readonly max: number;
  readonly over24: number;
}

function diff(left: Uint8ClampedArray, right: Uint8ClampedArray): DiffStats {
  let sum = 0;
  let max = 0;
  let over24 = 0;
  let channels = 0;
  for (let index = 0; index < left.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const delta = Math.abs(
        (left[index + channel] ?? 0) - (right[index + channel] ?? 0),
      );
      sum += delta;
      max = Math.max(max, delta);
      if (delta > 24) {
        over24 += 1;
      }
      channels += 1;
    }
  }
  return { mean: sum / channels, max, over24: over24 / channels };
}

function changedPixels(
  left: Uint8ClampedArray,
  right: Uint8ClampedArray,
  x: number,
  y: number,
  width: number,
  height: number,
  stride: number,
): number {
  let changed = 0;
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      const index = (row * stride + column) * 4;
      if (
        left[index] !== right[index] ||
        left[index + 1] !== right[index + 1] ||
        left[index + 2] !== right[index + 2]
      ) {
        changed += 1;
      }
    }
  }
  return changed;
}

function nonUniform(data: Uint8ClampedArray): boolean {
  const first = `${data[0]}:${data[1]}:${data[2]}`;
  for (let index = 4; index < data.length; index += 4) {
    if (`${data[index]}:${data[index + 1]}:${data[index + 2]}` !== first) {
      return true;
    }
  }
  return false;
}

const KINDS: readonly {
  kind: OverlayInput['kind'];
  props?: Record<string, unknown>;
}[] = [
  { kind: 'blur', props: { mode: 'gaussian', amount: 24 } },
  { kind: 'blur', props: { mode: 'pixelate', amount: 40 } },
  {
    kind: 'callout',
    props: {
      text: 'Kerf',
      background: '#101010',
      borderColor: '#ffcc00',
      borderWidth: 4,
      fontSize: 48,
    },
  },
  { kind: 'spotlight', props: { dim: 0.7, feather: 16 } },
  { kind: 'zoom', props: { zoom: 2, borderWidth: 4 } },
];

describe('overlay golden frames', () => {
  for (const entry of KINDS) {
    const label =
      entry.kind === 'blur' ? `blur (${entry.props?.mode})` : entry.kind;

    it(`renders ${label} at 1920×1080`, () => {
      const sequence = makeOverlaySequence([entry]);
      const canvas = renderCanvas(sequence, 1920, 1080);
      const data = pixels(canvas);

      expect(nonUniform(data)).toBe(true);

      const plain = renderCanvas(makeOverlaySequence([]), 1920, 1080);
      expect(diff(data, pixels(plain)).over24).toBeGreaterThan(0.003);
    });

    it(`matches the downscaled 1080p frame for ${label}`, () => {
      const wide = renderCanvas(
        makeOverlaySequence([entry], { width: 1920, height: 1080 }),
        1920,
        1080,
      );
      const narrow = renderCanvas(
        makeOverlaySequence([entry], { width: 960, height: 540 }),
        960,
        540,
      );
      const stats = diff(pixels(narrow), pixels(downscale(wide, 960, 540)));

      expect(stats.mean).toBeLessThan(9);
      expect(stats.max).toBeLessThan(200);
      expect(stats.over24).toBeLessThan(0.05);
    });
  }

  it('draws overlapping overlays in insertion order', () => {
    const effects = createTrack({ kind: 'effects', name: 'Effects', order: 2 });
    const red = makeOverlay(effects, {
      kind: 'callout',
      props: {
        text: '',
        background: '#ff0000',
        borderWidth: 0,
        transitionInFrames: 0,
      },
    });
    const green = makeOverlay(effects, {
      kind: 'callout',
      props: {
        text: '',
        background: '#00ff00',
        borderWidth: 0,
        transitionInFrames: 0,
      },
    });
    const shapes = makeShapes();
    const sequence = createSequence({
      name: 'Order',
      width: 1920,
      height: 1080,
      tracks: [...shapes.tracks, { ...effects, clips: [red, green] }],
    });

    const context = context2d(makeCanvas(1920, 1080));
    renderFrame(context, sequence, FRAME, {
      pool: emptyPool(),
      background: '#0a0a0a',
    });
    const greenPixel = context.getImageData(960, 540, 1, 1).data;
    expect([greenPixel[0], greenPixel[1], greenPixel[2]]).toEqual([0, 255, 0]);

    const swapped = createSequence({
      name: 'Order swapped',
      width: 1920,
      height: 1080,
      tracks: [...shapes.tracks, { ...effects, clips: [green, red] }],
    });
    const swappedContext = context2d(makeCanvas(1920, 1080));
    renderFrame(swappedContext, swapped, FRAME, {
      pool: emptyPool(),
      background: '#0a0a0a',
    });
    const redPixel = swappedContext.getImageData(960, 540, 1, 1).data;
    expect([redPixel[0], redPixel[1], redPixel[2]]).toEqual([255, 0, 0]);

    // A later start frame sorts above an earlier one regardless of insertion.
    const lateGreen = makeOverlay(effects, {
      kind: 'callout',
      startFrame: 5,
      props: {
        text: '',
        background: '#00ff00',
        borderWidth: 0,
      },
    });
    const startOrdered = createSequence({
      name: 'Start order',
      width: 1920,
      height: 1080,
      tracks: [...shapes.tracks, { ...effects, clips: [lateGreen, red] }],
    });
    const startContext = context2d(makeCanvas(1920, 1080));
    renderFrame(startContext, startOrdered, FRAME, {
      pool: emptyPool(),
      background: '#0a0a0a',
    });
    const startPixel = startContext.getImageData(960, 540, 1, 1).data;
    expect([startPixel[0], startPixel[1], startPixel[2]]).toEqual([0, 255, 0]);
  });

  it('leaves caption glyphs at normal scale under a zoom lens', () => {
    const shapes = makeShapes();
    const captionTrack = createTrack({
      kind: 'caption',
      name: 'Captions',
      order: 3,
    });
    const caption = clipSchema.parse({
      id: newId('clip'),
      trackId: captionTrack.id,
      type: 'caption',
      startFrame: 0,
      durationFrames: 100,
      transcriptId: newId('transcript'),
      segmentId: newId('segment'),
      text: 'Kerf',
      style: { ...DEFAULT_TEXT_STYLE, background: '#101010' },
    });
    const effects = createTrack({ kind: 'effects', name: 'Effects', order: 2 });
    const lens = makeOverlay(effects, {
      kind: 'zoom',
      props: {
        region: { x: 0.3, y: 0.72, w: 0.4, h: 0.2 },
        zoom: 3,
        borderWidth: 0,
        shadow: false,
      },
    });

    const withoutLens = createSequence({
      name: 'Caption',
      width: 1920,
      height: 1080,
      tracks: [
        ...shapes.tracks,
        { ...captionTrack, clips: [caption] },
        { ...effects, clips: [] },
      ],
    });
    const withLens = createSequence({
      name: 'Caption + lens',
      width: 1920,
      height: 1080,
      tracks: [
        ...shapes.tracks,
        { ...captionTrack, clips: [caption] },
        { ...effects, clips: [lens] },
      ],
    });

    const plain = renderCanvas(withoutLens, 1920, 1080);
    const lensed = renderCanvas(withLens, 1920, 1080);
    const plainData = pixels(plain);
    const lensedData = pixels(lensed);
    // The lens must actually change the frame somewhere.
    expect(diff(plainData, lensedData).over24).toBeGreaterThan(0.01);

    // The caption box is opaque, so the glyph area must be pixel-identical.
    const captionWidth = 320;
    const captionHeight = 80;
    const left = Math.round(960 - captionWidth / 2);
    const top = Math.round(1080 * 0.84 - captionHeight / 2);
    expect(
      changedPixels(
        plainData,
        lensedData,
        left,
        top,
        captionWidth,
        captionHeight,
        1920,
      ),
    ).toBe(0);
  });

  it('honours transitions and clip opacity', () => {
    const sequence = makeOverlaySequence([
      {
        kind: 'callout',
        props: {
          region: REGION,
          text: '',
          background: '#ffffff',
          borderWidth: 0,
          transitionInFrames: 10,
        },
      },
    ]);
    const at = (value: Sequence, frame: number) => {
      const context = context2d(makeCanvas(1920, 1080));
      renderFrame(context, value, frame, {
        pool: emptyPool(),
        background: '#000000',
      });
      return context.getImageData(960, 540, 1, 1).data[0] ?? 0;
    };

    const plain = makeOverlaySequence([]);
    const base = at(plain, 0);
    expect(at(sequence, 0)).toBe(base);
    expect(at(sequence, 5)).toBeGreaterThan(base);
    expect(at(sequence, 9)).toBeGreaterThan(at(sequence, 5));
    expect(at(sequence, 20)).toBe(255);
  });

  it('interpolates zoom transitions instead of switching scale abruptly', () => {
    const zoom = makeOverlaySequence([
      {
        kind: 'zoom',
        props: {
          zoom: 3,
          transitionInFrames: 10,
          transitionOutFrames: 10,
          easing: 'linear',
        },
      },
    ]).tracks.find((track) => track.kind === 'effects')?.clips[0];

    if (!zoom || zoom.type !== 'fxOverlay') {
      throw new Error('expected a zoom overlay');
    }

    expect(overlayTransitionProgress(zoom.props, 0, 100)).toBe(0);
    expect(overlayTransitionProgress(zoom.props, 5, 100)).toBeCloseTo(5 / 9);
    expect(overlayTransitionProgress(zoom.props, 10, 100)).toBe(1);
    expect(overlayTransitionProgress(zoom.props, 95, 100)).toBeCloseTo(4 / 9);
    expect(overlayTransitionProgress(zoom.props, 99, 100)).toBe(0);
  });
});

describe('overlay layer typing', () => {
  it('keeps overlays out of the base layer type', () => {
    const shapes = makeShapes();
    const effects = createTrack({ kind: 'effects', name: 'Effects', order: 2 });
    const overlay = makeOverlay(effects, { kind: 'blur' });
    const base: Clip[] = shapes.clips;
    expect(base.some((clip) => clip.type === 'fxOverlay')).toBe(false);
    expect(overlay.type).toBe('fxOverlay');
  });
});
