import type { EditCommand, Sequence, Track } from '@kerf/model';
import { createTrack } from '@kerf/model';
import { tracksInOrder } from './queries';

/** The first Effects track in timeline order, if one exists. */
export function findEffectsTrack(sequence: Sequence): Track | undefined {
  return tracksInOrder(sequence).find((track) => track.kind === 'effects');
}

export interface EnsureEffectsTrack {
  commands: EditCommand[];
  trackId: string;
  created: boolean;
}

/**
 * Returns the commands needed to place an Effects track above every existing
 * track. The caller appends the first overlay insert and wraps the whole list
 * in a batch so creating the track and adding the overlay is one undo step.
 */
export function ensureEffectsTrackCommands(
  sequence: Sequence,
): EnsureEffectsTrack {
  const existing = findEffectsTrack(sequence);
  if (existing) {
    return { commands: [], trackId: existing.id, created: false };
  }

  const track = createTrack({ kind: 'effects', name: 'Effects', order: 0 });
  const commands: EditCommand[] = sequence.tracks.map((candidate) => ({
    type: 'track.update',
    trackId: candidate.id,
    patch: { order: candidate.order + 1 },
  }));
  commands.push({ type: 'track.add', track, index: 0 });

  return { commands, trackId: track.id, created: true };
}
