import type { Sequence } from '@kerf/model';
import { EngineError } from './errors';
import { clipEnd } from './queries';
import type { FrameRange } from './ranges';
import { frameRangeContains, normalizeFrameRange } from './ranges';

export type SnapSource =
  | 'zero'
  | 'clip-start'
  | 'clip-end'
  | 'marker'
  | 'playhead'
  | 'grid';

export type SnapEdge = 'in' | 'out';

export interface SnapCandidate {
  readonly frame: number;
  readonly source: SnapSource;
  readonly id?: string;
  readonly trackId?: string;
  readonly label?: string;
}

export interface SnapCandidateOptions {
  sequence: Sequence;
  /** Clip edges are preferred over grid lines, but below playhead and markers. */
  includeClipEdges?: boolean;
  includeMarkers?: boolean;
  includePlayhead?: boolean;
  includeZero?: boolean;
  includeGrid?: boolean;
  /** Restrict clip edges to one track. */
  trackId?: string;
  /** Leave the clip being dragged out of its own snap points. */
  ignoreClipId?: string;
  playhead?: number;
  gridFrames?: number;
  /** Grid points are generated inside this half-open range. */
  range?: FrameRange;
}

export interface SnapStartInput extends SnapCandidateOptions {
  startFrame: number;
  durationFrames: number;
  /** Maximum distance in frames between an edge and a candidate. */
  thresholdFrames: number;
}

export interface SnapResult {
  readonly startFrame: number;
  readonly deltaFrames: number;
  readonly edge: SnapEdge | null;
  readonly candidate: SnapCandidate | null;
}

const SOURCE_PRIORITY: Record<SnapSource, number> = {
  playhead: 0,
  marker: 1,
  'clip-start': 2,
  'clip-end': 2,
  zero: 3,
  grid: 4,
};

const EDGE_PRIORITY: Record<SnapEdge, number> = {
  in: 0,
  out: 1,
};

function compareCandidates(left: SnapCandidate, right: SnapCandidate): number {
  return (
    left.frame - right.frame ||
    SOURCE_PRIORITY[left.source] - SOURCE_PRIORITY[right.source] ||
    left.source.localeCompare(right.source) ||
    (left.id ?? '').localeCompare(right.id ?? '')
  );
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new EngineError(
      'invalid-range',
      `${label} must be a finite number.`,
      'Pass a frame value instead of NaN or Infinity.',
    );
  }
}

/**
 * Collect every snap point in a range. Grid lines are only generated when a
 * range is supplied, because enumerating a long timeline at frame resolution
 * would allocate far more candidates than a drag can use.
 */
export function collectSnapCandidates(
  input: SnapCandidateOptions,
): SnapCandidate[] {
  const range = input.range
    ? normalizeFrameRange(input.range.startFrame, input.range.endFrame)
    : null;
  const candidates: SnapCandidate[] = [];

  const push = (candidate: SnapCandidate): void => {
    if (!range || frameRangeContains(range, candidate.frame)) {
      candidates.push(candidate);
    }
  };

  if (input.includeZero !== false) {
    push({ frame: 0, source: 'zero' });
  }

  if (input.includePlayhead !== false && input.playhead !== undefined) {
    assertFinite(input.playhead, 'The playhead');
    if (input.playhead >= 0) {
      push({ frame: input.playhead, source: 'playhead' });
    }
  }

  if (input.includeMarkers !== false) {
    for (const marker of input.sequence.markers) {
      push({
        frame: marker.frame,
        source: 'marker',
        id: marker.id,
        label: marker.label,
      });
    }
  }

  if (input.includeClipEdges !== false) {
    for (const track of input.sequence.tracks) {
      if (input.trackId !== undefined && track.id !== input.trackId) {
        continue;
      }
      for (const clip of track.clips) {
        if (clip.id === input.ignoreClipId) {
          continue;
        }
        push({
          frame: clip.startFrame,
          source: 'clip-start',
          id: clip.id,
          trackId: track.id,
          label: clip.label,
        });
        push({
          frame: clipEnd(clip),
          source: 'clip-end',
          id: clip.id,
          trackId: track.id,
          label: clip.label,
        });
      }
    }
  }

  if (input.includeGrid !== false && input.gridFrames !== undefined) {
    if (!Number.isFinite(input.gridFrames) || input.gridFrames <= 0) {
      throw new EngineError(
        'invalid-range',
        'The grid size must be greater than zero.',
        'Choose a positive number of frames per grid line.',
      );
    }
    if (range) {
      const first = Math.max(
        0,
        Math.ceil(range.startFrame / input.gridFrames) * input.gridFrames,
      );
      for (
        let frame = first;
        frame <= range.endFrame;
        frame += input.gridFrames
      ) {
        push({ frame, source: 'grid' });
      }
    }
  }

  return candidates.sort(compareCandidates);
}

interface BestSnap {
  candidate: SnapCandidate;
  edge: SnapEdge;
  distance: number;
  startFrame: number;
}

function isBetterSnap(candidate: BestSnap, best: BestSnap): boolean {
  if (candidate.distance !== best.distance) {
    return candidate.distance < best.distance;
  }
  const candidatePriority = SOURCE_PRIORITY[candidate.candidate.source];
  const bestPriority = SOURCE_PRIORITY[best.candidate.source];
  if (candidatePriority !== bestPriority) {
    return candidatePriority < bestPriority;
  }
  const candidateEdge = EDGE_PRIORITY[candidate.edge];
  const bestEdge = EDGE_PRIORITY[best.edge];
  if (candidateEdge !== bestEdge) {
    return candidateEdge < bestEdge;
  }
  if (candidate.candidate.frame !== best.candidate.frame) {
    return candidate.candidate.frame < best.candidate.frame;
  }
  return (
    (candidate.candidate.id ?? '').localeCompare(best.candidate.id ?? '') < 0
  );
}

/**
 * Snap a proposed clip start by either its incoming or outgoing edge. The
 * returned start is always non-negative, even when the outgoing edge is the
 * one that landed on a candidate.
 */
export function snapStart(input: SnapStartInput): SnapResult {
  assertFinite(input.startFrame, 'The clip start');
  assertFinite(input.durationFrames, 'The clip duration');
  assertFinite(input.thresholdFrames, 'The snap threshold');
  if (input.durationFrames <= 0) {
    throw new EngineError(
      'invalid-range',
      'A clip needs a positive duration to snap.',
      'Use a duration of at least one frame.',
    );
  }
  if (input.thresholdFrames < 0) {
    throw new EngineError(
      'invalid-range',
      'The snap threshold cannot be negative.',
      'Use zero to disable snapping.',
    );
  }

  const noSnap: SnapResult = {
    startFrame: input.startFrame,
    deltaFrames: 0,
    edge: null,
    candidate: null,
  };
  if (input.thresholdFrames === 0) {
    return noSnap;
  }

  const endFrame = input.startFrame + input.durationFrames;
  const range = normalizeFrameRange(
    input.startFrame - input.thresholdFrames,
    endFrame + input.thresholdFrames,
  );
  const candidates = collectSnapCandidates({
    sequence: input.sequence,
    includeClipEdges: input.includeClipEdges,
    includeMarkers: input.includeMarkers,
    includePlayhead: input.includePlayhead,
    includeZero: input.includeZero,
    includeGrid: input.includeGrid,
    trackId: input.trackId,
    ignoreClipId: input.ignoreClipId,
    playhead: input.playhead,
    gridFrames: input.gridFrames,
    range,
  });

  let best: BestSnap | null = null;
  for (const candidate of candidates) {
    for (const edge of ['in', 'out'] as const) {
      const edgeFrame = edge === 'in' ? input.startFrame : endFrame;
      const distance = Math.abs(candidate.frame - edgeFrame);
      if (distance > input.thresholdFrames) {
        continue;
      }
      const startFrame =
        edge === 'in'
          ? candidate.frame
          : candidate.frame - input.durationFrames;
      if (startFrame < 0) {
        continue;
      }
      const proposal: BestSnap = {
        candidate,
        edge,
        distance,
        startFrame,
      };
      if (!best || isBetterSnap(proposal, best)) {
        best = proposal;
      }
    }
  }

  if (!best) {
    return noSnap;
  }
  return {
    startFrame: best.startFrame,
    deltaFrames: best.startFrame - input.startFrame,
    edge: best.edge,
    candidate: best.candidate,
  };
}
