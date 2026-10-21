import type { EditCommand, Sequence } from '@kerf/model';
import { clipEndFrame } from '@kerf/model';
import { clipsOnTrack, requireClip } from './queries';

/**
 * Ripple helpers return ordinary batches so an undo stays one step and the
 * command catalog does not need a second family of timing commands.
 */
export function rippleDeleteCommand(
  sequence: Sequence,
  clipId: string,
): EditCommand {
  const location = requireClip(sequence, clipId);
  const endFrame = clipEndFrame(location.clip);
  const delta = -location.clip.durationFrames;
  const moves: EditCommand[] = clipsOnTrack(location.track)
    .filter((clip) => clip.id !== clipId && clip.startFrame >= endFrame)
    .map((clip) => ({
      type: 'clip.move',
      clipId: clip.id,
      trackId: location.track.id,
      startFrame: clip.startFrame + delta,
    }));

  return {
    type: 'batch',
    label: 'Ripple delete',
    commands: [{ type: 'clip.remove', clipId: location.clip.id }, ...moves],
  };
}

/**
 * Ripple trims close or open space after the outgoing edge. Trimming the
 * incoming edge leaves the clip end in place, so it is a plain trim.
 */
export function rippleTrimCommand(
  sequence: Sequence,
  clipId: string,
  edge: 'in' | 'out',
  frames: number,
): EditCommand {
  const location = requireClip(sequence, clipId);
  const trim: EditCommand = {
    type: 'clip.trim',
    clipId: location.clip.id,
    edge,
    frames,
  };

  if (edge === 'in' || frames === 0) {
    return trim;
  }

  const endFrame = clipEndFrame(location.clip);
  const moves: EditCommand[] = clipsOnTrack(location.track)
    .filter((clip) => clip.id !== clipId && clip.startFrame >= endFrame)
    .map((clip) => ({
      type: 'clip.move',
      clipId: clip.id,
      trackId: location.track.id,
      startFrame: clip.startFrame + frames,
    }));

  if (moves.length === 0) {
    return trim;
  }

  return {
    type: 'batch',
    label: 'Ripple trim',
    commands: frames > 0 ? [...moves].reverse().concat(trim) : [trim, ...moves],
  };
}
