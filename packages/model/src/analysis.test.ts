import { describe, expect, it } from 'vitest';
import {
  assetKindFromPath,
  assetSchema,
  createAsset,
  fileNameFromPath,
  mediaStreamSchema,
} from './assets';
import { beatMapSchema, beatMapDurationFrames, beatSchema } from './beats';
import { newId } from './ids';
import { createProject } from './project';
import { sceneSchema } from './scenes';
import {
  createTranscript,
  transcriptDurationFrames,
  transcriptSchema,
  transcriptSegmentSchema,
} from './transcript';

describe('asset model', () => {
  it('creates a queued asset with an empty cache', () => {
    const project = createProject({ name: 'Cut', now: 1 });
    const asset = createAsset({
      projectId: project.id,
      name: 'clip.mp4',
      sourcePath: '/media/clip.mp4',
      kind: 'video',
      now: 2,
    });

    expect(asset.status).toBe('queued');
    expect(asset.cache).toEqual({
      proxyPath: null,
      thumbnailPath: null,
      waveformPath: null,
      filmstripPath: null,
    });
    expect(assetSchema.parse(asset)).toEqual(asset);
  });

  it('detects kinds and names from paths', () => {
    expect(assetKindFromPath('/media/a.MP4')).toBe('video');
    expect(assetKindFromPath('/media/a.wav')).toBe('audio');
    expect(assetKindFromPath('/media/a.avif')).toBe('image');
    expect(assetKindFromPath('/media/a.txt')).toBe('other');
    expect(fileNameFromPath('/media/take one.mov')).toBe('take one.mov');
    expect(fileNameFromPath('clip.mp4')).toBe('clip.mp4');
  });

  it('parses media streams', () => {
    const stream = mediaStreamSchema.parse({
      index: 1,
      kind: 'audio',
      codec: 'aac',
      sampleRate: 48_000,
      channels: 2,
      durationSeconds: 12.5,
    });

    expect(stream.width).toBeNull();
    expect(stream.channels).toBe(2);
  });
});

describe('transcript model', () => {
  const makeSegment = () =>
    transcriptSegmentSchema.parse({
      id: newId('segment'),
      startFrame: 0,
      endFrame: 48,
      text: 'Hello there',
      words: [
        { text: 'Hello', startFrame: 0, endFrame: 20 },
        { text: 'there', startFrame: 22, endFrame: 48 },
      ],
    });

  it('creates a transcript and joins segment text', () => {
    const assetId = newId('asset');
    const first = makeSegment();
    const second = transcriptSegmentSchema.parse({
      id: newId('segment'),
      startFrame: 48,
      endFrame: 72,
      text: 'again',
      words: [],
    });
    const transcript = createTranscript({
      assetId,
      segments: [first, second],
      now: 10,
    });

    expect(transcript.language).toBe('en');
    expect(transcript.text).toBe('Hello there again');
    expect(transcriptDurationFrames(transcript)).toBe(72);
    expect(transcriptSchema.parse(transcript)).toEqual(transcript);
  });

  it('rejects words with impossible timing or confidence', () => {
    expect(() =>
      transcriptSegmentSchema.parse({
        id: newId('segment'),
        startFrame: 10,
        endFrame: 12,
        text: 'bad',
        words: [{ text: 'bad', startFrame: 12, endFrame: 10, confidence: 1.4 }],
      }),
    ).toThrow();
  });
});

describe('analysis model', () => {
  it('requires scenes to have positive duration', () => {
    const scene = sceneSchema.parse({
      id: newId('scene'),
      assetId: newId('asset'),
      index: 0,
      startFrame: 0,
      endFrame: 24,
    });
    expect(scene.score).toBe(0.5);
    expect(scene.thumbnailPath).toBeNull();
    expect(() =>
      sceneSchema.parse({
        id: newId('scene'),
        assetId: newId('asset'),
        index: 1,
        startFrame: 24,
        endFrame: 24,
      }),
    ).toThrow();
  });

  it('parses beats and reports the last analysed frame', () => {
    const map = beatMapSchema.parse({
      id: newId('beatmap'),
      assetId: newId('asset'),
      bpm: 120,
      offsetFrames: 4,
      beats: [
        { id: newId('beat'), frame: 4, strength: 0.9 },
        { id: newId('beat'), frame: 28 },
      ],
      sections: [
        {
          id: newId('section'),
          label: 'Intro',
          startFrame: 0,
          endFrame: 48,
        },
      ],
      createdAt: 1,
    });

    expect(map.beats).toHaveLength(2);
    expect(beatSchema.parse(map.beats[0])).toEqual(map.beats[0]);
    expect(beatMapDurationFrames(map)).toBe(48);
  });
});
