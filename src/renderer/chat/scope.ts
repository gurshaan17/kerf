import type { ChatScope } from '../../shared/chat-scope';
import type { ChatAssetMention, ProjectSnapshot } from '../../shared/contracts';

export function composerScope(
  snapshot: ProjectSnapshot | null,
  selected: readonly string[],
  explicit: ChatScope | undefined,
  mentions: readonly ChatAssetMention[],
): ChatScope {
  if (explicit?.kind === 'project') return explicit;
  const clipIds = [...new Set(explicit?.clipIds ?? selected)];
  const assetIds = [
    ...new Set([
      ...(explicit?.assetIds ?? []),
      ...mentions.map((m) => m.assetId),
    ]),
  ];
  if (!explicit && !clipIds.length && !assetIds.length)
    return { kind: 'project' };
  return {
    kind: 'targets',
    clipIds,
    assetIds,
    revision: explicit?.revision ?? snapshot?.project.updatedAt ?? 0,
  };
}
export function scopeError(
  scope: ChatScope,
  snapshot: ProjectSnapshot | null,
): string | null {
  if (!snapshot) return 'Open a project before sending.';
  if (scope.kind === 'project') return null;
  if (!scope.clipIds.length && !scope.assetIds.length)
    return 'Choose project scope or select clips before sending.';
  if (scope.clipIds.length > 50 || scope.assetIds.length > 50)
    return 'Scope up to 50 clips and 50 sources per turn.';
  if (scope.revision !== snapshot.project.updatedAt)
    return 'The selection changed. Refresh the scope before sending.';
  if (
    scope.clipIds.some(
      (id) =>
        !snapshot.project.sequence.tracks.some((t) =>
          t.clips.some((c) => c.id === id),
        ),
    )
  )
    return 'A scoped clip is missing. Remove it or use the current selection.';
  if (
    scope.assetIds.some(
      (id) => !snapshot.assets.some((a) => a.id === id && a.status === 'ready'),
    )
  )
    return 'A scoped source is missing or not ready.';
  return null;
}
export function scopeLabel(scope: ChatScope): string {
  return scope.kind === 'project'
    ? 'Project'
    : `${scope.clipIds.length} clips · ${scope.assetIds.length} sources`;
}
