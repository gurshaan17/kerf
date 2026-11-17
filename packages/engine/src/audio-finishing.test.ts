import { expect, it } from 'vitest';
import {
  assetSchema,
  clipSchema,
  clipAudioGain,
  createProject,
  createTranscript,
  newId,
} from '@kerf/model';
import { applyCommand } from './apply';
import { speechDuckingCommand } from './audio-finishing';
function fixture() {
  const project = createProject({ name: 'Audio' });
  const speech = assetSchema.parse({
    id: newId('asset'),
    projectId: project.id,
    name: 'Voice',
    kind: 'video',
    sourcePath: '/voice',
    frameRate: { numerator: 30, denominator: 1 },
    importedAt: 1,
    updatedAt: 1,
  });
  const music = assetSchema.parse({
    ...speech,
    id: newId('asset'),
    name: 'Music',
    kind: 'audio',
    sourcePath: '/music',
  });
  const videoTrack = project.sequence.tracks.find((t) => t.kind === 'video')!;
  const audioTrack = project.sequence.tracks.find((t) => t.kind === 'audio')!;
  const voice = clipSchema.parse({
    id: newId('clip'),
    trackId: videoTrack.id,
    type: 'video',
    assetId: speech.id,
    startFrame: 120,
    sourceInFrame: 24,
    durationFrames: 120,
  });
  const background = clipSchema.parse({
    id: newId('clip'),
    trackId: audioTrack.id,
    type: 'audio',
    assetId: music.id,
    startFrame: 100,
    durationFrames: 120,
    volume: 0.8,
  });
  const unrelated = clipSchema.parse({
    ...background,
    id: newId('clip'),
    startFrame: 300,
  });
  videoTrack.clips = [voice];
  audioTrack.clips = [background, unrelated];
  const transcript = createTranscript({
    assetId: speech.id,
    segments: [
      {
        id: newId('segment'),
        startFrame: 60,
        endFrame: 90,
        text: 'Speech',
        words: [],
      },
    ],
  });
  const input = {
    speechClipIds: [voice.id],
    backgroundClipIds: [background.id, unrelated.id],
    gain: 0.25,
    attackMs: 100,
    releaseMs: 250,
  };
  return {
    sequence: project.sequence,
    assets: [speech, music],
    transcripts: [transcript],
    background,
    unrelated,
    input,
  };
}
it('maps native speech frames through source trims and adds only overlapping background envelopes', () => {
  const f = fixture();
  const before = structuredClone(f.sequence);
  const planned = speechDuckingCommand(
    f.sequence,
    f.assets,
    f.transcripts,
    f.input,
  );
  expect(planned.backgroundClipIds).toEqual([f.background.id]);
  expect(f.sequence).toEqual(before);
  const applied = applyCommand(f.sequence, planned.command);
  const bg = applied.sequence.tracks
    .flatMap((t) => t.clips)
    .find((c) => c.id === f.background.id)!;
  if (bg.type !== 'audio') throw new Error('Expected audio');
  expect(clipAudioGain(bg, 20)).toBe(0.8);
  expect(clipAudioGain(bg, 44)).toBe(0.2); // (60 / 30 * 24) + 120 - 24 - 100
  expect(clipAudioGain(bg, 74)).toBe(0.8);
  expect(bg.volume).toBe(0.8);
  expect(
    applied.sequence.tracks
      .flatMap((t) => t.clips)
      .find((c) => c.id === f.unrelated.id),
  ).toEqual(f.unrelated);
  expect(applyCommand(applied.sequence, applied.inverse!).sequence).toEqual(
    before,
  );
});
it('rejects conflicting automation and preserves it exactly', () => {
  const f = fixture();
  f.background.keyframes.volume = [{ frame: 0, value: 0.8, easing: 'linear' }];
  const before = structuredClone(f.sequence);
  expect(() =>
    speechDuckingCommand(f.sequence, f.assets, f.transcripts, f.input),
  ).toThrow('automation already exists');
  expect(f.sequence).toEqual(before);
});
it('clips attack/release at background boundaries without adding false gain jumps', () => {
  const f = fixture();
  f.background.startFrame = 170;
  f.background.durationFrames = 20;
  const applied = applyCommand(
    f.sequence,
    speechDuckingCommand(f.sequence, f.assets, f.transcripts, f.input).command,
  ).sequence;
  const bg = applied.tracks
    .flatMap((t) => t.clips)
    .find((c) => c.id === f.background.id)!;
  if (bg.type !== 'audio') throw new Error('Expected audio');
  expect(clipAudioGain(bg, 0)).toBeCloseTo(0.4, 5); // release started at timeline 168, ends 174
  expect(clipAudioGain(bg, 4)).toBeCloseTo(0.8, 5);
});
