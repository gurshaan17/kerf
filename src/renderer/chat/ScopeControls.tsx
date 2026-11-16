import { Button } from '@kerf/ui';
import { X } from 'lucide-react';
import type { ChatScope } from '../../shared/chat-scope';
import type { ProjectSnapshot } from '../../shared/contracts';

export function ScopeControls({
  scope,
  snapshot,
  selectedIds,
  onChange,
  error,
}: {
  scope: ChatScope;
  snapshot: ProjectSnapshot | null;
  selectedIds: readonly string[];
  onChange: (scope: ChatScope) => void;
  error: string | null;
}) {
  return (
    <div className="grid gap-1.5" aria-label="Edit scope">
      <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-ink-muted">
        <span>Scope</span>
        <Button
          size="sm"
          variant="secondary"
          aria-pressed={scope.kind === 'project'}
          onClick={() => onChange({ kind: 'project' })}
        >
          Project
        </Button>
        {selectedIds.length > 0 && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              onChange({
                kind: 'targets',
                clipIds: [...selectedIds],
                assetIds: [],
                revision: snapshot?.project.updatedAt ?? 0,
              })
            }
          >
            Use current selection
          </Button>
        )}
        {scope.kind === 'targets' && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              onChange({ ...scope, revision: snapshot?.project.updatedAt ?? 0 })
            }
          >
            Refresh scope
          </Button>
        )}
      </div>
      {scope.kind === 'targets' && (
        <div className="flex flex-wrap gap-1">
          {scope.clipIds.map((id) => (
            <button
              key={id}
              type="button"
              className="flex max-w-full items-center gap-1 rounded-sm border border-line px-1.5 py-1 text-[10px] text-ink hover:border-line-strong focus-visible:outline-2 focus-visible:outline-accent"
              aria-label={`Remove scoped clip ${id}`}
              title={id}
              onClick={() =>
                onChange({
                  ...scope,
                  clipIds: scope.clipIds.filter((c) => c !== id),
                  assetIds: [],
                })
              }
            >
              <span className="truncate">
                {snapshot?.project.sequence.tracks
                  .flatMap((t) => t.clips)
                  .find((c) => c.id === id)?.label || id}
              </span>
              <X size={10} className="shrink-0" aria-hidden="true" />
            </button>
          ))}
          {scope.assetIds.map((id) => (
            <span
              key={id}
              title={id}
              className="max-w-full truncate rounded-sm border border-line px-1.5 py-1 text-[10px] text-ink"
            >
              {snapshot?.assets.find((a) => a.id === id)?.name ?? id}
            </span>
          ))}
        </div>
      )}
      {error && (
        <p
          role="alert"
          id="chat-scope-error"
          className="text-[11px] text-danger"
        >
          {error}
        </p>
      )}
    </div>
  );
}
