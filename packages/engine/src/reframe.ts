import { DEFAULT_TRANSFORM, sequenceSchema } from '@kerf/model';
import type { Sequence } from '@kerf/model';
import { findClip } from './queries';

export type ReframeFormat = 'vertical' | 'square';
export interface ReframePoint {
  readonly frame: number;
  readonly x: number;
  readonly y: number;
  readonly hold?: boolean;
}
export interface ReframeSize {
  readonly width: number;
  readonly height: number;
}

export const REFRAME_SIZES = {
  vertical: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 },
} satisfies Record<ReframeFormat, ReframeSize>;

/** Match the compositing renderer's centered contain fit, then cover the output. */
export function reframeTransform(
  source: ReframeSize,
  output: ReframeSize,
  point: Pick<ReframePoint, 'x' | 'y'>,
) {
  const contain = Math.min(
    output.width / source.width,
    output.height / source.height,
  );
  const cover = Math.max(
    output.width / source.width,
    output.height / source.height,
  );
  const width = source.width * cover;
  const height = source.height * cover;
  const shift = (focus: number, drawn: number, canvas: number) => {
    const limit = Math.max(0, (drawn - canvas) / 2);
    return limit === 0
      ? 0
      : Math.max(-limit, Math.min(limit, (0.5 - focus) * drawn));
  };
  return {
    scale: cover / contain,
    x: shift(point.x, width, output.width),
    y: shift(point.y, height, output.height),
  };
}

export function reframeSource(sequence: Sequence, clipId: string) {
  const location = findClip(sequence, clipId);
  const video = location?.clip;
  if (
    !video ||
    video.type !== 'video' ||
    location.track.hidden ||
    video.speed !== 1 ||
    video.timeMap.length
  )
    throw new Error('Choose one visible, normal-speed video clip to reframe.');
  if (
    JSON.stringify(video.transform) !== JSON.stringify(DEFAULT_TRANSFORM) ||
    video.effects.length ||
    video.masks.length ||
    Object.entries(video.keyframes).some(
      ([key, keys]) => key !== 'volume' && keys.length,
    )
  )
    throw new Error(
      'Choose a clip with default framing and no visual effects or motion.',
    );
  const end = video.startFrame + video.durationFrames;
  const neighbors = sequence.tracks
    .flatMap((track) => track.clips)
    .filter(
      (clip) =>
        clip.id !== video.id &&
        clip.startFrame < end &&
        clip.startFrame + clip.durationFrames > video.startFrame,
    );
  const audio = neighbors.filter(
    (clip) =>
      clip.type === 'audio' &&
      clip.assetId === video.assetId &&
      clip.startFrame === video.startFrame &&
      clip.durationFrames === video.durationFrames &&
      clip.sourceInFrame === video.sourceInFrame &&
      clip.speed === 1 &&
      !clip.timeMap.length,
  );
  if (neighbors.length !== audio.length || audio.length > 1)
    throw new Error(
      'Choose a section with only the video and its matching audio. Add other layers to the new version.',
    );
  return { video, audio: audio[0] };
}

export function buildReframedSequence(
  sequence: Sequence,
  clipId: string,
  source: ReframeSize,
  format: ReframeFormat,
  points: readonly ReframePoint[],
): Sequence {
  const { video, audio } = reframeSource(sequence, clipId);
  if (
    !Number.isFinite(source.width) ||
    !Number.isFinite(source.height) ||
    source.width <= 0 ||
    source.height <= 0 ||
    points[0]?.frame !== 0 ||
    points.some(
      (point, index) =>
        !Number.isInteger(point.frame) ||
        point.frame >= video.durationFrames ||
        (index > 0 && point.frame <= points[index - 1]!.frame) ||
        !Number.isFinite(point.x) ||
        point.x < 0 ||
        point.x > 1 ||
        !Number.isFinite(point.y) ||
        point.y < 0 ||
        point.y > 1,
    )
  )
    throw new Error('Use ordered framing points inside the clip.');
  const size = REFRAME_SIZES[format];
  const transforms = points.map((point) => ({
    frame: point.frame,
    ...reframeTransform(source, size, point),
    hold: point.hold,
  }));
  const first = transforms[0]!;
  const keys = (axis: 'x' | 'y') =>
    transforms.length === 1
      ? []
      : transforms.map((point) => ({
          frame: point.frame,
          value: point[axis],
          easing: point.hold ? ('hold' as const) : ('linear' as const),
        }));
  const framed = {
    ...video,
    startFrame: 0,
    locked: false,
    transform: {
      ...video.transform,
      x: first.x,
      y: first.y,
      scale: first.scale,
    },
    keyframes: { ...video.keyframes, x: keys('x'), y: keys('y') },
  };
  return sequenceSchema.parse({
    ...sequence,
    ...size,
    durationFrames: video.durationFrames,
    reference: null,
    markers: sequence.markers
      .filter(
        (marker) =>
          marker.frame >= video.startFrame &&
          marker.frame < video.startFrame + video.durationFrames,
      )
      .map((marker) => ({ ...marker, frame: marker.frame - video.startFrame })),
    tracks: sequence.tracks.flatMap<Sequence['tracks'][number]>((track) => {
      if (track.id === video.trackId)
        return [{ ...track, locked: false, clips: [framed] }];
      if (audio && track.id === audio.trackId)
        return [
          {
            ...track,
            locked: false,
            clips: [{ ...audio, locked: false, startFrame: 0 }],
          },
        ];
      return [];
    }),
  });
}
