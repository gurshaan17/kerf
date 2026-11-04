import type { EditCommand, Sequence } from '@kerf/model';
import {
  clipSchema,
  newId,
  overlayPropsSchema,
  secondsToFrames,
} from '@kerf/model';
import { ensureEffectsTrackCommands, findEffectsTrack } from './effects-track';
import { findClip } from './queries';

export interface PolishFocus {
  clipId: string;
  startFrame: number;
  durationFrames: number;
  x: number;
  y: number;
  kind: 'zoom' | 'spotlight' | 'callout';
  text: string;
}

/** Timing cues only: flattened recordings do not provide click positions. */
export function suggestScreenPolish(sequence: Sequence): PolishFocus[] {
  const duration = Math.max(
    1,
    Math.round(secondsToFrames(3, sequence.frameRate)),
  );
  const existing = new Set(
    sequence.tracks
      .flatMap((t) => t.clips)
      .filter((c) => c.type === 'fxOverlay')
      .map((c) => c.linkedItemId),
  );
  return sequence.tracks
    .filter((t) => t.kind === 'video' && !t.hidden && !t.locked)
    .flatMap((t) => t.clips)
    .filter((c) => c.type === 'video' && !existing.has(c.id))
    .sort((a, b) => a.startFrame - b.startFrame)
    .slice(0, 12)
    .map((c) => ({
      clipId: c.id,
      startFrame: c.startFrame,
      durationFrames: Math.min(duration, c.durationFrames),
      x: 0.5,
      y: 0.5,
      kind: 'zoom',
      text: '',
    }));
}

/** Revalidates against the current sequence; all overlays form one undo step. */
export function screenPolishCommand(
  sequence: Sequence,
  focuses: readonly PolishFocus[],
): EditCommand {
  if (!focuses.length) throw new Error('Choose at least one focus point.');
  if (findEffectsTrack(sequence)?.locked)
    throw new Error('Unlock the Effects track first.');
  const effects = ensureEffectsTrackCommands(sequence);
  const commands: EditCommand[] = [...effects.commands];
  for (const focus of focuses) {
    const found = findClip(sequence, focus.clipId);
    const source = found?.clip;
    if (!source || source.type !== 'video')
      throw new Error(
        'The source video is no longer available. Regenerate suggestions.',
      );
    if (
      !Number.isFinite(focus.x) ||
      !Number.isFinite(focus.y) ||
      focus.x < 0 ||
      focus.x > 1 ||
      focus.y < 0 ||
      focus.y > 1
    )
      throw new Error('Focus coordinates must be between 0 and 1.');
    if (
      !Number.isInteger(focus.startFrame) ||
      !Number.isInteger(focus.durationFrames) ||
      focus.durationFrames < 1 ||
      focus.startFrame < source.startFrame ||
      focus.startFrame + focus.durationFrames >
        source.startFrame + source.durationFrames
    )
      throw new Error('Keep the effect timing inside its source clip.');
    const transition = Math.min(
      Math.floor(focus.durationFrames / 2),
      Math.round(secondsToFrames(0.25, sequence.frameRate)),
    );
    const region = {
      x: Math.min(0.6, Math.max(0, focus.x - 0.2)),
      y: Math.min(0.7, Math.max(0, focus.y - 0.15)),
      w: 0.4,
      h: 0.3,
    };
    const props = overlayPropsSchema.parse({
      kind: focus.kind,
      region,
      transitionInFrames: transition,
      transitionOutFrames: transition,
      ...(focus.kind === 'zoom'
        ? { focus: { x: focus.x, y: focus.y }, zoom: 2 }
        : {}),
      ...(focus.kind === 'callout'
        ? {
            text: focus.text.trim() || 'Look here',
            pointer: { x: focus.x, y: focus.y },
          }
        : {}),
    });
    commands.push({
      type: 'clip.insert',
      clip: clipSchema.parse({
        id: newId('clip'),
        trackId: effects.trackId,
        type: 'fxOverlay',
        startFrame: focus.startFrame,
        durationFrames: focus.durationFrames,
        linkedItemId: source.id,
        label: `Screen polish · ${focus.kind}`,
        props,
      }),
    });
  }
  return { type: 'batch', label: 'Apply screen polish', commands };
}
