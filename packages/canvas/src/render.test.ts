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
import { clipAtFrame, mediaSourceSeconds, renderFrame } from './render';
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
    media: () => null,
    asset: () => undefined,
    video: () => null,
    image: () => null,
    isReady: () => false,
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

  it('reports missing video media without throwing', () => {
    const { sequence, asset } = makeSequence();
    const context = fakeContext();

    const stats = renderFrame(context, sequence, 100, {
      pool: fakePool(),
    });

    expect(stats.drawn).toBe(0);
    expect(stats.missingAssets).toEqual([asset.id]);
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
});
