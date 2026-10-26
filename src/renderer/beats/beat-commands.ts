import type {
  BeatMap,
  EditCommand,
  MediaClip,
  Sequence,
  Track,
} from '@kerf/model';
import { createMarker, isMediaClip } from '@kerf/model';
import { clipSourceRange, timelineFrameAtSource } from '@kerf/engine';

export type BeatDensity = 'sparse' | 'medium' | 'dense';

export interface BeatMarkerPosition {
  readonly frame: number;
  readonly beatIndex: number;
}

export interface BeatSplitTarget {
  readonly clipId: MediaClip['id'];
  readonly frames: readonly number[];
}

export interface BeatEditPlan {
  readonly density: BeatDensity;
  readonly stride: number;
  readonly timelineClipCount: number;
  readonly mappedClipCount: number;
  readonly markerFrames: readonly BeatMarkerPosition[];
  readonly newMarkerCount: number;
  readonly splits: readonly BeatSplitTarget[];
  readonly cutCount: number;
  readonly segmentCount: number;
  readonly lockedClipCount: number;
}

export function strideForDensity(density: BeatDensity): number {
  switch (density) {
    case 'sparse':
      return 4;
    case 'medium':
      return 2;
    case 'dense':
      return 1;
  }
}

export function beatDensityLabel(density: BeatDensity): string {
  switch (density) {
    case 'sparse':
      return 'Every 4th beat';
    case 'medium':
      return 'Every 2nd beat';
    case 'dense':
      return 'Every beat';
  }
}

function assetClips(
  sequence: Sequence,
  assetId: string,
): Array<{ clip: MediaClip; track: Track }> {
  const matches: Array<{ clip: MediaClip; track: Track }> = [];
  for (const track of sequence.tracks) {
    for (const clip of track.clips) {
      if (!isMediaClip(clip) || clip.assetId !== assetId) {
        continue;
      }
      matches.push({ clip, track });
    }
  }
  return matches;
}

/**
 * Map a beat grid from asset source frames into sequence frames for every
 * timeline clip of that asset. Markers use every mapped position; splits keep
 * only positions strictly inside unlocked clips, in descending order so each
 * `clip.split` still targets the original clip's left half.
 */
export function planBeatEdits(
  sequence: Sequence,
  beatMap: BeatMap,
  density: BeatDensity,
): BeatEditPlan {
  const stride = strideForDensity(density);
  const markerByFrame = new Map<number, number>();
  const splits: BeatSplitTarget[] = [];
  let mappedClipCount = 0;
  let cutCount = 0;
  let segmentCount = 0;
  let lockedClipCount = 0;

  const clips = assetClips(sequence, beatMap.assetId);
  for (const { clip, track } of clips) {
    const range = clipSourceRange(clip);
    const usedFrames = new Set<number>();
    const beatFrames: number[] = [];

    beatMap.beats.forEach((beat, index) => {
      if (index % stride !== 0) {
        return;
      }
      if (beat.frame < range.startFrame || beat.frame >= range.endFrame) {
        return;
      }
      const sequenceFrame = timelineFrameAtSource(clip, beat.frame);
      if (sequenceFrame === null) {
        return;
      }
      if (
        sequenceFrame < clip.startFrame ||
        sequenceFrame >= clip.startFrame + clip.durationFrames ||
        usedFrames.has(sequenceFrame)
      ) {
        return;
      }
      usedFrames.add(sequenceFrame);
      beatFrames.push(sequenceFrame);
      if (!markerByFrame.has(sequenceFrame)) {
        markerByFrame.set(sequenceFrame, index);
      }
    });

    if (beatFrames.length === 0) {
      continue;
    }
    mappedClipCount += 1;

    const inside = beatFrames
      .filter(
        (frame) =>
          frame > clip.startFrame &&
          frame < clip.startFrame + clip.durationFrames,
      )
      .sort((left, right) => right - left);

    if (clip.locked || track.locked) {
      if (inside.length > 0) {
        lockedClipCount += 1;
      }
      continue;
    }
    if (inside.length === 0) {
      continue;
    }
    splits.push({ clipId: clip.id, frames: inside });
    cutCount += inside.length;
    segmentCount += inside.length + 1;
  }

  const markerFrames = [...markerByFrame]
    .map(([frame, beatIndex]) => ({ frame, beatIndex }))
    .sort((left, right) => left.frame - right.frame);
  const existingFrames = new Set(
    sequence.markers.map((marker) => marker.frame),
  );

  return {
    density,
    stride,
    timelineClipCount: clips.length,
    mappedClipCount,
    markerFrames,
    newMarkerCount: markerFrames.filter(
      (marker) => !existingFrames.has(marker.frame),
    ).length,
    splits,
    cutCount,
    segmentCount,
    lockedClipCount,
  };
}

export function buildBeatMarkerCommands(
  sequence: Sequence,
  plan: BeatEditPlan,
): EditCommand[] {
  const existingFrames = new Set(
    sequence.markers.map((marker) => marker.frame),
  );
  const commands: EditCommand[] = [];
  for (const marker of plan.markerFrames) {
    if (existingFrames.has(marker.frame)) {
      continue;
    }
    existingFrames.add(marker.frame);
    commands.push({
      type: 'marker.add',
      marker: createMarker({
        frame: marker.frame,
        label: `B${marker.beatIndex + 1}`,
        kind: 'beat',
        color: '#c9a46a',
      }),
    });
  }
  return commands;
}

export function buildBeatSplitCommands(plan: BeatEditPlan): EditCommand[] {
  const commands: EditCommand[] = [];
  for (const target of plan.splits) {
    for (const frame of target.frames) {
      commands.push({ type: 'clip.split', clipId: target.clipId, frame });
    }
  }
  return commands;
}
