import type {
  Clip,
  FrameRate,
  NumberKeyframe,
  Sequence,
  SequenceTiming,
  TimeMapPoint,
  Track,
} from '@kerf/model';
import { fpsToNumber } from '@kerf/model';

function scaleFrame(value: number, factor: number): number {
  return Math.max(0, Math.round(value * factor));
}

function scaleDuration(value: number, factor: number): number {
  return Math.max(1, Math.round(value * factor));
}

function retimeKeyframes(
  keyframes: readonly NumberKeyframe[],
  factor: number,
): NumberKeyframe[] {
  return keyframes.map((keyframe) => ({
    ...keyframe,
    frame: scaleFrame(keyframe.frame, factor),
  }));
}

function retimeTimeMap(
  points: readonly TimeMapPoint[],
  factor: number,
): TimeMapPoint[] {
  let previousFrame = -1;
  return points.map((point) => {
    const frame = Math.max(previousFrame + 1, scaleFrame(point.frame, factor));
    previousFrame = frame;
    return {
      ...point,
      frame,
      sourceFrame: scaleFrame(point.sourceFrame, factor),
    };
  });
}

function retimeClip(clip: Clip, factor: number): Clip {
  const timing = {
    startFrame: scaleFrame(clip.startFrame, factor),
    durationFrames: scaleDuration(clip.durationFrames, factor),
    keyframes: {
      x: retimeKeyframes(clip.keyframes.x, factor),
      y: retimeKeyframes(clip.keyframes.y, factor),
      scale: retimeKeyframes(clip.keyframes.scale, factor),
      rotation: retimeKeyframes(clip.keyframes.rotation, factor),
      opacity: retimeKeyframes(clip.keyframes.opacity, factor),
      volume: retimeKeyframes(clip.keyframes.volume, factor),
    },
  };

  switch (clip.type) {
    case 'video':
    case 'audio':
      return {
        ...clip,
        ...timing,
        sourceInFrame: scaleFrame(clip.sourceInFrame, factor),
        fade: {
          inFrames: scaleFrame(clip.fade.inFrames, factor),
          outFrames: scaleFrame(clip.fade.outFrames, factor),
        },
        timeMap: retimeTimeMap(clip.timeMap, factor),
      };
    case 'caption':
      return {
        ...clip,
        ...timing,
        words: clip.words.map((word) => ({
          ...word,
          startFrame: scaleFrame(word.startFrame, factor),
          endFrame: scaleFrame(word.endFrame, factor),
        })),
      };
    default:
      return { ...clip, ...timing };
  }
}

function retimeTrack(track: Track, factor: number): Track {
  return {
    ...track,
    clips: track.clips.map((clip) => retimeClip(clip, factor)),
  };
}

/**
 * Rebuilds a sequence at a new frame rate while preserving wall-clock timing.
 * Every frame-based value in the sequence is scaled, including clip source
 * offsets, fades, keyframes, time maps, caption words and markers.
 */
export function retimeSequence(
  sequence: Sequence,
  frameRate: FrameRate,
): Sequence {
  const from = fpsToNumber(sequence.frameRate);
  const to = fpsToNumber(frameRate);
  if (from === to) {
    return sequence;
  }

  const factor = to / from;
  return {
    ...sequence,
    frameRate,
    durationFrames: scaleFrame(sequence.durationFrames, factor),
    markers: sequence.markers.map((marker) => ({
      ...marker,
      frame: scaleFrame(marker.frame, factor),
    })),
    tracks: sequence.tracks.map((track) => retimeTrack(track, factor)),
  };
}

/**
 * Captures every frame-based value that `retimeSequence` rewrites. The inverse
 * of a frame-rate change carries this payload so undo restores exact frames
 * instead of scaling rounded values back.
 */
export function captureSequenceTiming(sequence: Sequence): SequenceTiming {
  return {
    durationFrames: sequence.durationFrames,
    markers: sequence.markers.map((marker) => ({
      id: marker.id,
      frame: marker.frame,
    })),
    clips: sequence.tracks.flatMap((track) =>
      track.clips.map((clip) => {
        const base = {
          id: clip.id,
          startFrame: clip.startFrame,
          durationFrames: clip.durationFrames,
          keyframes: clip.keyframes,
        };
        if (clip.type === 'video' || clip.type === 'audio') {
          return {
            ...base,
            sourceInFrame: clip.sourceInFrame,
            fade: clip.fade,
            timeMap: clip.timeMap,
          };
        }
        if (clip.type === 'caption') {
          return { ...base, words: clip.words };
        }
        return base;
      }),
    ),
  };
}

function restoreClipTiming(
  clip: Clip,
  timing: SequenceTiming['clips'][number] | undefined,
): Clip {
  if (!timing) {
    return clip;
  }
  switch (clip.type) {
    case 'video':
    case 'audio':
      return {
        ...clip,
        startFrame: timing.startFrame,
        durationFrames: timing.durationFrames,
        keyframes: timing.keyframes ?? clip.keyframes,
        sourceInFrame: timing.sourceInFrame ?? clip.sourceInFrame,
        fade: timing.fade ?? clip.fade,
        timeMap: timing.timeMap ?? clip.timeMap,
      };
    case 'caption':
      return {
        ...clip,
        startFrame: timing.startFrame,
        durationFrames: timing.durationFrames,
        keyframes: timing.keyframes ?? clip.keyframes,
        words: timing.words ?? clip.words,
      };
    default:
      return {
        ...clip,
        startFrame: timing.startFrame,
        durationFrames: timing.durationFrames,
        keyframes: timing.keyframes ?? clip.keyframes,
      };
  }
}

/** Restores frame-based values captured by `captureSequenceTiming`. */
export function restoreSequenceTiming(
  sequence: Sequence,
  timing: SequenceTiming,
): Sequence {
  const clips = new Map(timing.clips.map((clip) => [clip.id, clip]));
  const markers = new Map(
    timing.markers.map((marker) => [marker.id, marker.frame]),
  );
  return {
    ...sequence,
    durationFrames: timing.durationFrames,
    markers: sequence.markers.map((marker) => {
      const frame = markers.get(marker.id);
      return frame === undefined ? marker : { ...marker, frame };
    }),
    tracks: sequence.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) =>
        restoreClipTiming(clip, clips.get(clip.id)),
      ),
    })),
  };
}
