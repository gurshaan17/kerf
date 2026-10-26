import { describe, expect, it } from 'vitest';
import { createProject, projectSchema } from './project';
import {
  createMarker,
  createSequence,
  createTrack,
  markerSchema,
  sequenceSchema,
  trackSchema,
} from './sequence';
import { referenceProfileSchema, styleConfigSchema } from './style';

describe('project model', () => {
  it('creates a project with a populated sequence and style', () => {
    const project = createProject({
      name: 'Workshop cut',
      now: 1_700_000_000_000,
    });

    expect(project.schemaVersion).toBe(1);
    expect(project.name).toBe('Workshop cut');
    expect(project.createdAt).toBe(1_700_000_000_000);
    expect(project.sequence.tracks.map((track) => track.kind)).toEqual([
      'video',
      'audio',
      'audio',
    ]);
    expect(project.sequence.tracks.map((track) => track.order)).toEqual([
      0, 1, 2,
    ]);
    expect(project.sequence.frameRate).toEqual({
      numerator: 24,
      denominator: 1,
    });
    expect(project.style.accent).toBe('#c9a46a');
    expect(project.reference).toBeNull();
    expect(projectSchema.parse(project)).toEqual(project);
  });

  it('creates a project with a chosen canvas and frame rate', () => {
    const project = createProject({
      name: 'Vertical cut',
      width: 1080,
      height: 1920,
      frameRate: { numerator: 60, denominator: 1 },
      now: 1_700_000_000_000,
    });

    expect(project.sequence.width).toBe(1080);
    expect(project.sequence.height).toBe(1920);
    expect(project.sequence.frameRate).toEqual({
      numerator: 60,
      denominator: 1,
    });
    expect(projectSchema.parse(project)).toEqual(project);
  });

  it('applies style overrides without dropping defaults', () => {
    const project = createProject({
      name: 'Bold cut',
      style: { accent: '#ff5a36', captionSize: 64 },
    });

    expect(project.style.accent).toBe('#ff5a36');
    expect(project.style.captionSize).toBe(64);
    expect(project.style.fontFamily).toBe('Instrument Sans');
  });

  it('parses a reference profile', () => {
    const reference = referenceProfileSchema.parse({
      id: 'ref_0123456789ab',
      name: 'Warm workshop',
      palette: ['#c9a46a', '#0b0c0d'],
      mood: ['quiet', 'tactile'],
      sceneCount: 6,
      averageShotLengthFrames: 24,
      cutsPerMinute: 50,
      meanLuma: 0.54,
      meanSaturation: 0.42,
      meanContrast: 0.31,
      analyzedAt: 1,
      createdAt: 1,
    });

    expect(reference.sourceAssetId).toBeNull();
    expect(reference.palette).toHaveLength(2);
    expect(reference.notes).toBe('');
    expect(reference.sceneCount).toBe(6);
    expect(reference.meanLuma).toBe(0.54);
    expect(reference.analyzedAt).toBe(1);
  });

  it('rejects invalid style colours', () => {
    expect(() => styleConfigSchema.parse({ accent: 'not-a-colour' })).toThrow();
  });

  it('creates tracks with stable defaults', () => {
    const track = createTrack({ kind: 'video', order: 3 });
    expect(trackSchema.parse(track).height).toBe(54);
    expect(track.locked).toBe(false);
    expect(track.name).toBe('Video 1');
  });

  it('creates point markers with the accent default', () => {
    const marker = createMarker({ frame: 48, label: 'Chapter one' });
    expect(markerSchema.parse(marker)).toEqual(marker);
    expect(marker.frame).toBe(48);
    expect(marker.kind).toBe('marker');
    expect(marker.color).toBe('#c9a46a');
  });

  it('creates a sequence with explicit canvas settings', () => {
    const sequence = createSequence({
      name: 'Vertical',
      width: 1080,
      height: 1920,
      frameRate: { numerator: 30, denominator: 1 },
    });

    expect(sequenceSchema.parse(sequence).width).toBe(1080);
    expect(sequence.durationFrames).toBe(0);
    expect(sequence.markers).toEqual([]);
  });
});
