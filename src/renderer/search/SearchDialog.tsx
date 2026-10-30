import { useEffect, useMemo, useState } from 'react';
import { Captions, Loader2, ScanLine, Search } from 'lucide-react';
import {
  formatTimecode,
  framesToSeconds,
  secondsToFrames,
  type Asset,
} from '@kerf/model';
import { Button, Dialog, Input, cn } from '@kerf/ui';
import type { SearchResponse, SearchResult } from '../../shared/contracts';
import { useStudio } from '../state/StudioProvider';

export interface SearchDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function SearchDialog({ open, onOpenChange }: SearchDialogProps) {
  const snapshot = useStudio((state) => state.snapshot);
  const revealAssetFrame = useStudio((state) => state.revealAssetFrame);
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const assets = useMemo(
    () =>
      new Map<string, Asset>(
        (snapshot?.assets ?? []).map((asset) => [asset.id, asset]),
      ),
    [snapshot?.assets],
  );
  const rate = snapshot?.project.sequence.frameRate ?? {
    numerator: 24,
    denominator: 1,
  };

  useEffect(() => {
    if (!open) {
      return;
    }
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResponse(null);
      setError(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);
      void window.kerf.analysis
        .search({ query: trimmed, limit: 40 })
        .then((result) => {
          if (!cancelled) {
            setResponse(result);
            setError(null);
          }
        })
        .catch((cause: unknown) => {
          if (!cancelled) {
            setError(cause instanceof Error ? cause.message : String(cause));
            setResponse(null);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false);
          }
        });
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query]);

  const choose = (result: SearchResult) => {
    const sourceRate = assets.get(result.assetId)?.frameRate ?? rate;
    revealAssetFrame(
      result.assetId,
      result.transcriptSource === 'visual'
        ? secondsToFrames(framesToSeconds(result.startFrame, sourceRate), rate)
        : result.startFrame,
    );
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search analysis"
      description="Phrase search across transcript windows and described shots."
      panelClassName="max-w-[640px]"
      footer={
        <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
          Close
        </Button>
      }
    >
      <div className="grid gap-3">
        <div className="relative">
          <Search
            size={14}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-faint"
            aria-hidden="true"
          />
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search words, names or scene descriptions"
            className="h-9 pl-9"
            aria-label="Search analysis"
          />
          {loading ? (
            <Loader2
              size={14}
              className="absolute top-1/2 right-3 -translate-y-1/2 animate-spin text-accent"
              aria-hidden="true"
            />
          ) : null}
        </div>

        <p className="font-mono text-[9px] tracking-[0.04em] text-ink-faint uppercase">
          {response?.vectorSearch
            ? 'Hybrid lexical + local vector search'
            : 'Local lexical search · embeddings unavailable'}
        </p>

        {error ? (
          <p className="rounded-sm border border-danger/30 bg-danger/10 px-3 py-2 text-[11px] text-danger">
            {error}
          </p>
        ) : null}

        {!error &&
        query.trim().length >= 2 &&
        !loading &&
        response?.results.length === 0 ? (
          <p className="py-8 text-center text-[11px] text-ink-faint">
            No transcript or scene matches “{query.trim()}”.
          </p>
        ) : null}

        {response && response.results.length > 0 ? (
          <div className="max-h-[48vh] overflow-auto rounded-sm border border-line">
            {response.results.map((result) => {
              const asset = assets.get(result.assetId);
              const assetRate = asset?.frameRate ?? rate;
              return (
                <button
                  key={result.id}
                  type="button"
                  className="flex w-full items-start gap-2.5 border-b border-line px-3 py-2.5 text-left last:border-0 hover:bg-surface-2"
                  onClick={() => choose(result)}
                >
                  <span
                    className={cn(
                      'mt-0.5 grid size-6 shrink-0 place-items-center rounded-xs border',
                      result.kind === 'transcript'
                        ? 'border-accent/30 bg-accent/10 text-accent'
                        : 'border-ok/30 bg-ok/10 text-ok',
                    )}
                  >
                    {result.kind === 'transcript' ? (
                      <Captions size={12} />
                    ) : (
                      <ScanLine size={12} />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[11px] font-medium text-ink">
                        {result.assetName}
                        {result.transcriptSource === 'visual' && (
                          <span className="ml-2 text-ink-faint">
                            Visual narration
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 font-mono text-[9px] text-ink-faint">
                        {formatTimecode(result.startFrame, assetRate)}
                      </span>
                    </span>
                    <span className="mt-0.5 block line-clamp-2 text-[10px] leading-relaxed text-ink-muted">
                      {result.text}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
