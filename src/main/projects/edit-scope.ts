import { applyCommand } from '@kerf/engine';
import type { Clip, EditCommand, Sequence } from '@kerf/model';
import type { EditReceipt } from '@kerf/tools';
import type { ChatScope } from '../../shared/chat-scope';
import type { ProjectSnapshot } from '../../shared/contracts';
import { referenceFingerprint } from './reference-fingerprint';

export function validateChatScope(
  scope: ChatScope,
  snapshot: Pick<ProjectSnapshot, 'project' | 'assets'>,
  checkRevision = true,
) {
  if (scope.kind === 'project') return;
  if (
    (!scope.clipIds.length && !scope.assetIds.length) ||
    new Set(scope.clipIds).size !== scope.clipIds.length ||
    new Set(scope.assetIds).size !== scope.assetIds.length
  )
    throw new Error(
      'Choose project scope or unique clips and sources before sending.',
    );
  if (checkRevision && scope.revision !== snapshot.project.updatedAt)
    throw new Error(
      'The scoped selection changed. Refresh the scope before sending.',
    );
  for (const id of scope.clipIds)
    if (
      !snapshot.project.sequence.tracks.some((t) =>
        t.clips.some((c) => c.id === id),
      )
    )
      throw new Error(
        'A scoped clip is missing. Refresh the scope before sending.',
      );
  for (const id of scope.assetIds)
    if (!snapshot.assets.some((a) => a.id === id && a.status === 'ready'))
      throw new Error(
        'A scoped source is missing or not ready. Refresh the scope before sending.',
      );
}

/** Preview pure engine commands before any live mutation, including indirect ripple changes. */
export function createEditScope(
  scope: ChatScope,
  initial: Pick<ProjectSnapshot, 'project' | 'assets'>,
  current: () => Pick<ProjectSnapshot, 'project' | 'assets'> | null,
) {
  validateChatScope(scope, initial, false);
  const scoped = scope.kind === 'targets';
  const assets = new Set(scoped ? scope.assetIds : []);
  const original = initial.project.sequence.tracks
    .flatMap((t) => t.clips)
    .filter(
      (c) =>
        scoped &&
        (scope.clipIds.includes(c.id) ||
          ('assetId' in c && assets.has(c.assetId))),
    );
  const allowed = new Set<string>(original.map((c) => c.id));
  const expected = new Map<string, string | null>(
    original.map((c) => [c.id, referenceFingerprint(initial, 'clip', c.id)]),
  );
  const sources = new Map(
    [...assets].map((id) => [id, referenceFingerprint(initial, 'asset', id)]),
  );
  const live = () => {
    const snapshot = current();
    if (!snapshot || snapshot.project.id !== initial.project.id)
      throw new Error('The scoped project changed. Start a new turn.');
    if (scoped) {
      for (const [id, fingerprint] of expected)
        if (referenceFingerprint(snapshot, 'clip', id) !== fingerprint)
          throw new Error(
            'A scoped clip changed during this turn. Start a new turn with fresh scope.',
          );
      for (const [id, fingerprint] of sources)
        if (referenceFingerprint(snapshot, 'asset', id) !== fingerprint)
          throw new Error(
            'A scoped source changed during this turn. Start a new turn with fresh scope.',
          );
    }
    return snapshot;
  };
  const newClipAllowed = (clip: Clip) => {
    if ('assetId' in clip) {
      if (assets.has(clip.assetId)) return true;
      return original.some(
        (c) =>
          'assetId' in c &&
          c.assetId === clip.assetId &&
          (!('sourceInFrame' in c) ||
            !('sourceInFrame' in clip) ||
            (clip.sourceInFrame >= c.sourceInFrame &&
              clip.sourceInFrame +
                clip.durationFrames * ('speed' in clip ? clip.speed : 1) <=
                c.sourceInFrame +
                  c.durationFrames * ('speed' in c ? c.speed : 1))),
      );
    }
    return original.some(
      (c) =>
        clip.startFrame >= c.startFrame &&
        clip.startFrame + clip.durationFrames <=
          c.startFrame + c.durationFrames,
    );
  };
  const checkCommand = (command: EditCommand) => {
    const snapshot = live();
    if (!scoped) return;
    const before = snapshot.project.sequence;
    const after = applyCommand(before, command).sequence;
    const metadata = (sequence: Sequence) =>
      JSON.stringify({ ...sequence, tracks: [], durationFrames: 0 });
    const deny = () => {
      throw new Error(
        'This edit affects targets outside the submitted scope. Choose broader scope in a new turn.',
      );
    };
    if (metadata(before) !== metadata(after)) deny();
    const oldClips = new Map(
      before.tracks.flatMap((t) => t.clips).map((c) => [c.id, c]),
    );
    const newClips = new Map(
      after.tracks.flatMap((t) => t.clips).map((c) => [c.id, c]),
    );
    for (const [id, old] of oldClips)
      if (
        JSON.stringify(old) !== JSON.stringify(newClips.get(id)) &&
        !allowed.has(id)
      )
        deny();
    for (const [id, clip] of newClips) {
      if (!oldClips.has(id) && !newClipAllowed(clip)) deny();
      const old = oldClips.get(id);
      if (
        old &&
        'assetId' in clip &&
        (!('assetId' in old) || old.assetId !== clip.assetId) &&
        !assets.has(clip.assetId)
      )
        deny();
    }
    for (const track of before.tracks) {
      const next = after.tracks.find((t) => t.id === track.id);
      if (
        !next ||
        JSON.stringify({ ...track, clips: [] }) !==
          JSON.stringify({ ...next, clips: [] })
      )
        deny();
    }
  };
  const committed = (receipt: EditReceipt) => {
    if (!scoped || receipt.projectId !== initial.project.id) return;
    const snapshot = current();
    if (!snapshot || snapshot.project.id !== initial.project.id) return;
    for (const change of receipt.changes) {
      allowed.add(change.clipId);
      expected.set(
        change.clipId,
        referenceFingerprint(snapshot, 'clip', change.clipId),
      );
    }
  };
  return { checkCommand, committed };
}
