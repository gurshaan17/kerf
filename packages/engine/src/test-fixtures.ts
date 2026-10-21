import type {
  AudioClip,
  Clip,
  Effect,
  Mask,
  Sequence,
  TimeMapPoint,
  Track,
  TrackKind,
  VideoClip,
} from '@kerf/model';
import {
  clipSchema,
  createSequence,
  createTrack,
  newId,
  trackSchema,
} from '@kerf/model';

interface MakeClipInput {
  trackId?: string;
  startFrame?: number;
  durationFrames?: number;
  assetId?: string;
  sourceInFrame?: number;
  speed?: number;
  timeMap?: TimeMapPoint[];
  effects?: Effect[];
  masks?: Mask[];
}

export function makeVideoClip(input: MakeClipInput = {}): VideoClip {
  const clip = clipSchema.parse({
    id: newId('clip'),
    trackId: input.trackId ?? newId('track'),
    startFrame: input.startFrame ?? 0,
    durationFrames: input.durationFrames ?? 48,
    type: 'video',
    assetId: input.assetId ?? newId('asset'),
    sourceInFrame: input.sourceInFrame,
    speed: input.speed,
    timeMap: input.timeMap,
    effects: input.effects,
    masks: input.masks,
  });

  if (clip.type !== 'video') {
    throw new Error('expected a video clip');
  }
  return clip;
}

export function makeAudioClip(input: MakeClipInput = {}): AudioClip {
  const clip = clipSchema.parse({
    id: newId('clip'),
    trackId: input.trackId ?? newId('track'),
    startFrame: input.startFrame ?? 0,
    durationFrames: input.durationFrames ?? 48,
    type: 'audio',
    assetId: input.assetId ?? newId('asset'),
    sourceInFrame: input.sourceInFrame,
    speed: input.speed,
    timeMap: input.timeMap,
  });

  if (clip.type !== 'audio') {
    throw new Error('expected an audio clip');
  }
  return clip;
}

export function makeTextClip(
  trackId: string,
  startFrame = 0,
  durationFrames = 48,
): Clip {
  return clipSchema.parse({
    id: newId('clip'),
    trackId,
    startFrame,
    durationFrames,
    type: 'text',
    text: 'Title',
  });
}

export function makeTrack(
  kind: TrackKind,
  order: number,
  clips: Clip[] = [],
): Track {
  const track = createTrack({ kind, order });
  return trackSchema.parse({ ...track, clips });
}

export function withClips(track: Track, clips: Clip[]): Track {
  return trackSchema.parse({ ...track, clips });
}

export function makeSequence(tracks: Track[]): Sequence {
  return createSequence({ name: 'Test sequence', tracks });
}
