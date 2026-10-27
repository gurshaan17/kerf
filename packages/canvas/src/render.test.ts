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
import {
  clipAtFrame,
  clipFadeOpacity,
  effectsFilter,
  mediaSourceSeconds,
  renderFrame,
} from './render';
import type { MediaPool } from './media-pool';

function makeSequence() {
  const project = createProject({ name: 'Canvas test', now: 1 });
  const track = createTrack({ kind: 'video', order: 0 });
  const asset = {
    ...createAsset({
      projectId: project.id,
      name: 'Take.mp4',
      sourcePath: '/media/take.mp4',
      kind: 'video',
      now: 1,
    }),
    durationSeconds: 10,
    frameRate: FRAME_RATES.film,
  };
  const clip = clipSchema.parse({
    id: newId('clip'),
    type: 'video',
    trackId: track.id,
    assetId: asset.id,
    startFrame: 100,
    durationFrames: 48,
    sourceInFrame: 24,
    speed: 1,
    volume: 1,
    label: 'Take',
  });
  const sequence = createSequence({
    name: 'Test',
    tracks: [{ ...track, clips: [clip] }],
  });
  return { sequence, track, clip, asset };
}

function fakeContext(): CanvasRenderingContext2D & { calls: string[] } {
  const calls: string[] = [];
  return {
    canvas: { width: 1920, height: 1080 },
    calls,
    clip: () => calls.push('clip'),
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    clearRect: () => calls.push('clearRect'),
    fillRect: () => calls.push('fillRect'),
    drawImage: () => calls.push('drawImage'),
    translate: () => calls.push('translate'),
    rotate: () => calls.push('rotate'),
    scale: () => calls.push('scale'),
    beginPath: () => calls.push('beginPath'),
    rect: () => calls.push('rect'),
    ellipse: () => calls.push('ellipse'),
    fill: () => calls.push('fill'),
    stroke: () => calls.push('stroke'),
    fillText: (text: string) => calls.push(`text:${text}`),
    measureText: (text: string) => ({ width: text.length * 12 }),
    setLineDash: () => undefined,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    letterSpacing: '0px',
  } as unknown as CanvasRenderingContext2D & { calls: string[] };
}

function fakePool(): MediaPool {
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

function recordingPool(
  media: HTMLVideoElement | HTMLImageElement | null,
  qualities: string[],
): MediaPool {
  return {
    defaultQuality: 'proxy',
    media: (_assetId: string, quality: string) => {
      qualities.push(quality);
      return media;
    },
    asset: () => undefined,
    video: () => null,
    image: () => null,
    isReady: () => true,
    ensure: () => null,
  } as unknown as MediaPool;
}

describe('canvas compositor helpers', () => {
  it('resolve the active clip on a track', () => {
    const { sequence, track, clip } = makeSequence();

    expect(clipAtFrame(sequence, track.id, 100)?.id).toBe(clip.id);
    expect(clipAtFrame(sequence, track.id, 147)?.id).toBe(clip.id);
    expect(clipAtFrame(sequence, track.id, 99)).toBeNull();
    expect(clipAtFrame(sequence, track.id, 148)).toBeNull();
  });

  it('map a timeline frame to source seconds', () => {
    const { sequence, clip, asset } = makeSequence();

    expect(mediaSourceSeconds(clip, 100, asset, sequence)).toBeCloseTo(1);
    expect(mediaSourceSeconds(clip, 124, asset, sequence)).toBeCloseTo(2);
  });

  it('maps a 30 fps source onto a 24 fps sequence in seconds', () => {
    const project = createProject({ name: 'Mixed rate', now: 1 });
    const track = createTrack({ kind: 'video', order: 0 });
    const asset = {
      ...createAsset({
        projectId: project.id,
        name: 'Take 30.mp4',
        sourcePath: '/media/take-30.mp4',
        kind: 'video',
        now: 1,
      }),
      durationSeconds: 10,
      frameRate: FRAME_RATES.web30,
    };
    const clip = clipSchema.parse({
      id: newId('clip'),
      type: 'video',
      trackId: track.id,
      assetId: asset.id,
      startFrame: 100,
      durationFrames: 240,
      sourceInFrame: 0,
      speed: 1,
    });
    const sequence = createSequence({
      name: 'Mixed rate',
      frameRate: FRAME_RATES.film,
      tracks: [{ ...track, clips: [clip] }],
    });

    expect(mediaSourceSeconds(clip, 100, asset, sequence)).toBeCloseTo(0);
    expect(mediaSourceSeconds(clip, 124, asset, sequence)).toBeCloseTo(1);
    expect(mediaSourceSeconds(clip, 148, asset, sequence)).toBeCloseTo(2);
    expect(mediaSourceSeconds(clip, 340, asset, sequence)).toBeCloseTo(10);
  });

  it('reports missing video media without throwing', () => {
    const { sequence, asset } = makeSequence();
    const context = fakeContext();

    const stats = renderFrame(context, sequence, 100, {
      pool: fakePool(),
    });

    expect(stats.drawn).toBe(0);
    expect(stats.missingAssets).toEqual([asset.id]);
  });

  it('serializes enabled effects and ignores disabled ones', () => {
    const track = createTrack({ kind: 'overlay', order: 0 });
    const clip = clipSchema.parse({
      id: newId('clip'),
      type: 'text',
      trackId: track.id,
      startFrame: 0,
      durationFrames: 50,
      text: 'Effect',
      effects: [
        { id: newId('effect'), type: 'blur', amount: 4 },
        { id: newId('effect'), type: 'brightness', amount: 1.2 },
        { id: newId('effect'), type: 'sepia', enabled: false, amount: 1 },
      ],
    });

    expect(effectsFilter(clip)).toBe('blur(4px) brightness(1.2)');
  });

  it('ramps fades against the clip local frame', () => {
    const track = createTrack({ kind: 'video', order: 0 });
    const asset = {
      ...createAsset({
        projectId: createProject({ name: 'Fade', now: 1 }).id,
        name: 'Fade.mp4',
        sourcePath: '/media/fade.mp4',
        kind: 'video',
        now: 1,
      }),
      durationSeconds: 10,
      frameRate: FRAME_RATES.film,
    };
    const clip = clipSchema.parse({
      id: newId('clip'),
      type: 'video',
      trackId: track.id,
      assetId: asset.id,
      startFrame: 0,
      durationFrames: 100,
      sourceInFrame: 0,
      fade: { inFrames: 10, outFrames: 20 },
    });

    expect(clipFadeOpacity(clip, 0)).toBe(0);
    expect(clipFadeOpacity(clip, 5)).toBeCloseTo(0.5);
    expect(clipFadeOpacity(clip, 50)).toBe(1);
    expect(clipFadeOpacity(clip, 90)).toBeCloseTo(0.5);
    expect(clipFadeOpacity(clip, 100)).toBe(0);
  });

  it('draws text, caption and shape layers', () => {
    const project = createProject({ name: 'Layers', now: 1 });
    const textTrack = createTrack({ kind: 'overlay', order: 0 });
    const captionTrack = createTrack({ kind: 'caption', order: 1 });
    const shapeTrack = createTrack({ kind: 'overlay', order: 2 });
    const text = clipSchema.parse({
      id: newId('clip'),
      type: 'text',
      trackId: textTrack.id,
      startFrame: 0,
      durationFrames: 50,
      text: 'Hello kerf',
    });
    const caption = clipSchema.parse({
      id: newId('clip'),
      type: 'caption',
      trackId: captionTrack.id,
      transcriptId: newId('transcript'),
      segmentId: newId('segment'),
      startFrame: 0,
      durationFrames: 50,
      text: 'Hello kerf',
      words: [
        { text: 'Hello', startFrame: 0, endFrame: 10 },
        { text: 'kerf', startFrame: 10, endFrame: 20 },
      ],
    });
    const shape = clipSchema.parse({
      id: newId('clip'),
      type: 'shape',
      trackId: shapeTrack.id,
      startFrame: 0,
      durationFrames: 50,
      shape: 'ellipse',
      fill: project.sequence.style.accent,
    });
    const sequence = createSequence({
      name: 'Layers',
      tracks: [
        { ...textTrack, clips: [text] },
        { ...captionTrack, clips: [caption] },
        { ...shapeTrack, clips: [shape] },
      ],
    });
    const context = fakeContext();

    const stats = renderFrame(context, sequence, 12, {
      pool: fakePool(),
      background: null,
    });

    expect(stats.drawn).toBe(3);
    expect(context.calls).toContain('ellipse');
    expect(context.calls).toContain('text:Hello kerf');
    expect(context.calls.filter((call) => call === 'save')).toHaveLength(4);
  });

  it('defers text until after effects so overlays never cover captions', () => {
    const project = createProject({ name: 'Order', now: 1 });
    const videoTrack = createTrack({ kind: 'video', order: 0 });
    const textTrack = createTrack({ kind: 'overlay', order: 1 });
    const effectsTrack = createTrack({ kind: 'effects', order: 2 });
    const text = clipSchema.parse({
      id: newId('clip'),
      type: 'text',
      trackId: textTrack.id,
      startFrame: 0,
      durationFrames: 50,
      text: 'Hello',
    });
    const overlay = clipSchema.parse({
      id: newId('clip'),
      type: 'fxOverlay',
      trackId: effectsTrack.id,
      startFrame: 0,
      durationFrames: 50,
      props: {
        kind: 'callout',
        region: { x: 0.2, y: 0.2, w: 0.4, h: 0.4 },
        text: 'Overlay',
      },
    });
    const sequence = createSequence({
      name: 'Order',
      width: 1920,
      height: 1080,
      tracks: [
        videoTrack,
        { ...textTrack, clips: [text] },
        { ...effectsTrack, clips: [overlay] },
      ],
    });
    const context = fakeContext();

    renderFrame(context, sequence, 5, {
      pool: fakePool(),
      background: project.sequence.style.background,
    });

    const overlayText = context.calls.indexOf('text:Overlay');
    const plainText = context.calls.indexOf('text:Hello');
    expect(overlayText).toBeGreaterThanOrEqual(0);
    expect(plainText).toBeGreaterThan(overlayText);
  });

  it('draws the base pass at the requested quality and the lens at source', () => {
    const videoTrack = createTrack({ kind: 'video', order: 0 });
    const effectsTrack = createTrack({ kind: 'effects', order: 1 });
    const clip = clipSchema.parse({
      id: newId('clip'),
      type: 'video',
      trackId: videoTrack.id,
      assetId: newId('asset'),
      startFrame: 0,
      durationFrames: 50,
      sourceInFrame: 0,
    });
    const overlay = clipSchema.parse({
      id: newId('clip'),
      type: 'fxOverlay',
      trackId: effectsTrack.id,
      startFrame: 0,
      durationFrames: 50,
      props: {
        kind: 'zoom',
        region: { x: 0.3, y: 0.3, w: 0.4, h: 0.4 },
        zoom: 2,
      },
    });
    const sequence = createSequence({
      name: 'Quality',
      width: 1920,
      height: 1080,
      tracks: [
        { ...videoTrack, clips: [clip] },
        { ...effectsTrack, clips: [overlay] },
      ],
    });
    const media = {
      readyState: 2,
      videoWidth: 1920,
      videoHeight: 1080,
    } as unknown as HTMLVideoElement;
    const qualities: string[] = [];
    const context = fakeContext();

    renderFrame(context, sequence, 5, {
      pool: recordingPool(media, qualities),
      mediaQuality: 'proxy',
      lensQuality: 'source',
    });

    expect(qualities).toContain('proxy');
    expect(qualities).toContain('source');
    expect(context.calls).toContain('clip');
  });

  it('falls back to the proxy slot until lens source media is ready', () => {
    const videoTrack = createTrack({ kind: 'video', order: 0 });
    const effectsTrack = createTrack({ kind: 'effects', order: 1 });
    const clip = clipSchema.parse({
      id: newId('clip'),
      type: 'video',
      trackId: videoTrack.id,
      assetId: newId('asset'),
      startFrame: 0,
      durationFrames: 50,
      sourceInFrame: 0,
    });
    const overlay = clipSchema.parse({
      id: newId('clip'),
      type: 'fxOverlay',
      trackId: effectsTrack.id,
      startFrame: 0,
      durationFrames: 50,
      props: {
        kind: 'zoom',
        region: { x: 0.3, y: 0.3, w: 0.4, h: 0.4 },
        zoom: 2,
      },
    });
    const sequence = createSequence({
      name: 'Fallback',
      width: 1920,
      height: 1080,
      tracks: [
        { ...videoTrack, clips: [clip] },
        { ...effectsTrack, clips: [overlay] },
      ],
    });
    const readyProxy = {
      readyState: 2,
      videoWidth: 960,
      videoHeight: 540,
    } as unknown as HTMLVideoElement;
    const pendingSource = {
      readyState: 0,
      videoWidth: 0,
      videoHeight: 0,
    } as unknown as HTMLVideoElement;
    const qualities: string[] = [];
    const pool = {
      defaultQuality: 'proxy',
      media: (_assetId: string, quality: string) => {
        qualities.push(quality);
        return quality === 'source' ? pendingSource : readyProxy;
      },
      asset: () => undefined,
      video: () => null,
      image: () => null,
      isReady: () => false,
      ensure: () => null,
    } as unknown as MediaPool;
    const context = fakeContext();

    const stats = renderFrame(context, sequence, 5, {
      pool,
      mediaQuality: 'proxy',
      lensQuality: 'source',
    });

    expect(stats.missingAssets).toEqual([]);
    expect(qualities).toContain('source');
    // The lens asked for source, then fell back to the ready proxy slot.
    expect(qualities[qualities.length - 1]).toBe('proxy');
    expect(context.calls).toContain('drawImage');
  });
});
