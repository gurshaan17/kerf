import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  AudioLines,
  CheckCircle2,
  Clock3,
  Film,
  Image as ImageIcon,
  Captions,
  Clapperboard,
  Loader2,
  Music2,
  Palette,
  Plus,
  RefreshCw,
  ScanLine,
  Search,
  Settings2,
  Sparkles,
  Unplug,
  X,
} from 'lucide-react';
import type { Asset, AssetStatus } from '@kerf/model';
import { Button, IconButton, Input, Panel, cn } from '@kerf/ui';
import type { AnalysisAssetStatus, JobSummary } from '../shared/contracts';
import { ASSET_DRAG_MIME } from './drag';
import { GettingStarted } from './GettingStarted';
import { VisualNarrationDialog } from './transcript/VisualNarration';

export interface FootageBinProps {
  readonly assets: Asset[];
  readonly jobs: JobSummary[];
  readonly busy: boolean;
  readonly error: string | null;
  readonly onImport: () => Promise<void>;
  readonly onRelink: (assetId: string) => Promise<void>;
  readonly onCancelJob: (jobId: string) => Promise<void>;
  readonly onRefresh: () => Promise<void>;
  readonly analysis: readonly AnalysisAssetStatus[];
  readonly onAnalyze: (
    assetId: string,
    kinds: readonly ('transcript' | 'scenes' | 'beats' | 'vision')[],
  ) => Promise<void>;
  readonly onOpenTranscript: (assetId: string) => void;
  readonly onOpenScenes: (assetId: string) => void;
  readonly onOpenDescriptions: (assetId: string) => void;
  readonly onOpenBeats: (assetId: string) => void;
  readonly onOpenSearch: () => void;
  readonly onOpenAnalysis: () => void;
  readonly onOpenMotion: () => void;
  readonly onOpenReferences: () => void;
  readonly onOpenExport: () => void;
}

const STATUS_LABEL: Record<AssetStatus, string> = {
  queued: 'Queued',
  probing: 'Probing',
  processing: 'Processing',
  ready: 'Ready',
  missing: 'Missing',
  error: 'Error',
};

const STATUS_STYLE: Record<AssetStatus, string> = {
  queued: 'border-line bg-surface-2 text-ink-faint',
  probing: 'border-warn/30 bg-warn/10 text-warn',
  processing: 'border-warn/30 bg-warn/10 text-warn',
  ready: 'border-ok/30 bg-ok/10 text-ok',
  missing: 'border-danger/40 bg-danger/10 text-danger',
  error: 'border-danger/40 bg-danger/10 text-danger',
};

const KIND_LABEL = {
  video: 'Video',
  audio: 'Audio',
  image: 'Image',
  other: 'Other',
} as const;

function mediaUrl(assetId: string, slot: 'thumbnail' | 'waveform'): string {
  return `kerfmedia://asset/${encodeURIComponent(assetId)}/${slot}`;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '—';
  }
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const remaining = total % 60;
  const tail = `${minutes}:${String(remaining).padStart(2, '0')}`;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
    : tail;
}

function formatFrameRate(asset: Asset): string {
  if (!asset.frameRate) {
    return '—';
  }
  const fps = asset.frameRate.numerator / asset.frameRate.denominator;
  return `${Number.isInteger(fps) ? fps : fps.toFixed(2)} fps`;
}

function formatBpm(bpm: number): string {
  return `${Number.isInteger(bpm) ? bpm : bpm.toFixed(1)} BPM`;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) {
    return '—';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1_024)),
  );
  const value = bytes / 1_024 ** exponent;
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`;
}

function KindIcon({ kind, size = 15 }: { kind: Asset['kind']; size?: number }) {
  if (kind === 'audio') {
    return <AudioLines size={size} aria-hidden="true" />;
  }
  if (kind === 'image') {
    return <ImageIcon size={size} aria-hidden="true" />;
  }
  return <Film size={size} aria-hidden="true" />;
}

function StatusChip({ status }: { status: AssetStatus }) {
  return (
    <span
      className={cn(
        'inline-flex h-[18px] items-center rounded-pill border px-1.5 font-mono text-[9px] tracking-[0.03em] uppercase',
        STATUS_STYLE[status],
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

function AssetPreview({ asset }: { asset: Asset }) {
  const source =
    asset.kind === 'audio'
      ? asset.cache.waveformPath
        ? mediaUrl(asset.id, 'waveform')
        : null
      : asset.cache.thumbnailPath
        ? mediaUrl(asset.id, 'thumbnail')
        : null;

  if (!source) {
    return (
      <div className="grid h-full place-items-center bg-surface-0 text-ink-faint">
        {asset.status === 'missing' || asset.status === 'error' ? (
          <Unplug size={24} aria-hidden="true" />
        ) : asset.status === 'queued' ||
          asset.status === 'probing' ||
          asset.status === 'processing' ? (
          <Loader2
            size={22}
            className="animate-spin text-accent-dim"
            aria-hidden="true"
          />
        ) : (
          <KindIcon kind={asset.kind} size={24} />
        )}
      </div>
    );
  }

  return (
    <img
      src={source}
      alt=""
      loading="lazy"
      decoding="async"
      className={cn(
        'h-full w-full',
        asset.kind === 'audio'
          ? 'object-contain p-2 opacity-80'
          : 'object-cover',
      )}
      draggable={false}
    />
  );
}

export function FootageBin({
  assets: projectAssets,
  jobs,
  busy,
  error,
  onImport,
  onRelink,
  onCancelJob,
  onRefresh,
  analysis,
  onAnalyze,
  onOpenTranscript,
  onOpenScenes,
  onOpenDescriptions,
  onOpenBeats,
  onOpenSearch,
  onOpenAnalysis,
  onOpenMotion,
  onOpenReferences,
  onOpenExport,
}: FootageBinProps) {
  const assets = useMemo(
    () => projectAssets.filter((asset) => asset.generatedBy !== 'tts'),
    [projectAssets],
  );
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [narrationOpen, setNarrationOpen] = useState(false);

  const pendingJobs = jobs.filter(
    (job) => job.status === 'queued' || job.status === 'running',
  );
  const activeJob =
    pendingJobs.find((job) => job.status === 'running') ??
    pendingJobs[0] ??
    null;
  const activeProgress = activeJob
    ? Math.max(0, Math.min(1, activeJob.progress))
    : 0;

  const jobsByTarget = useMemo(() => {
    const map = new Map<string, JobSummary>();
    for (const job of jobs) {
      if (
        !job.targetId ||
        job.status === 'succeeded' ||
        job.status === 'failed' ||
        job.status === 'cancelled'
      ) {
        continue;
      }
      const existing = map.get(job.targetId);
      if (!existing || job.status === 'running') {
        map.set(job.targetId, job);
      }
    }
    return map;
  }, [jobs]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return assets;
    }
    return assets.filter((asset) =>
      [asset.name, asset.kind, asset.status, asset.sourcePath]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }, [assets, query]);

  const selected = selectedId
    ? (assets.find((asset) => asset.id === selectedId) ?? null)
    : null;
  const selectedAnalysis = selected
    ? (analysis.find((entry) => entry.assetId === selected.id) ?? null)
    : null;
  const readyCount = assets.filter((asset) => asset.status === 'ready').length;

  return (
    <Panel
      title="Footage"
      subtitle={`${assets.length} ${assets.length === 1 ? 'item' : 'items'} · ${readyCount} ready`}
      bodyClassName="flex flex-col p-0 overflow-hidden"
      actions={
        <>
          <IconButton
            label="Search transcripts and scenes"
            tooltip="Search transcripts and scenes"
            tooltipSide="bottom"
            size="sm"
            icon={<Search size={14} />}
            onClick={onOpenSearch}
          />
          <IconButton
            label="References"
            tooltip="References"
            tooltipSide="bottom"
            size="sm"
            icon={<Palette size={14} />}
            onClick={onOpenReferences}
          />
          <IconButton
            label="Compositions"
            tooltip="Compositions"
            tooltipSide="bottom"
            size="sm"
            icon={<Clapperboard size={14} />}
            onClick={onOpenMotion}
          />
          <IconButton
            label="Analysis settings"
            tooltip="Analysis settings"
            tooltipSide="bottom"
            size="sm"
            icon={<Settings2 size={14} />}
            onClick={onOpenAnalysis}
          />
          <IconButton
            label="Check source availability"
            tooltip="Check source availability"
            tooltipSide="bottom"
            size="sm"
            icon={<RefreshCw size={14} />}
            disabled={busy}
            onClick={() => void onRefresh()}
          />
          <Button
            variant="primary"
            size="sm"
            leadingIcon={<Plus size={13} />}
            disabled={busy}
            onClick={() => void onImport()}
          >
            Import
          </Button>
        </>
      }
    >
      <div className="border-b border-line p-2.5">
        <div className="relative">
          <Search
            size={13}
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-faint"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search footage"
            aria-label="Search footage"
            className="h-7 pr-8 pl-[30px] text-[11px]"
          />
          {query ? (
            <button
              type="button"
              className="absolute top-1/2 right-1.5 grid size-5 -translate-y-1/2 place-items-center rounded-xs text-ink-faint hover:bg-surface-2 hover:text-ink"
              aria-label="Clear search"
              onClick={() => setQuery('')}
            >
              <X size={12} />
            </button>
          ) : null}
        </div>
      </div>

      {activeJob ? (
        <div className="border-b border-line bg-surface-2/60 px-3 py-2">
          <div className="flex items-center gap-2">
            <Loader2
              size={12}
              className="shrink-0 animate-spin text-accent"
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[10px] font-medium text-ink">
                Importing {pendingJobs.length}{' '}
                {pendingJobs.length === 1 ? 'item' : 'items'}
              </p>
              <p className="font-mono text-[9px] tracking-[0.02em] text-ink-faint">
                {activeJob.stage || 'starting'} ·{' '}
                {Math.round(activeProgress * 100)}%
              </p>
            </div>
            <IconButton
              label="Cancel import"
              tooltip="Cancel import"
              size="sm"
              icon={<X size={13} />}
              onClick={() => void onCancelJob(activeJob.id)}
            />
          </div>
          <div className="mt-1.5 h-0.5 overflow-hidden rounded-pill bg-surface-0">
            <div
              className="h-full rounded-pill bg-accent transition-[width] duration-150"
              style={{ width: `${Math.max(2, activeProgress * 100)}%` }}
            />
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="flex items-start gap-2 border-b border-danger/30 bg-danger/10 px-3 py-2 text-[10px] leading-snug text-danger">
          <AlertTriangle size={13} className="mt-px shrink-0" />
          <p>{error}</p>
        </div>
      ) : null}

      <GettingStarted
        assets={assets}
        analysis={analysis}
        onImport={onImport}
        onOpenExport={onOpenExport}
      />

      <div className="min-h-0 flex-1 overflow-auto">
        {assets.length === 0 ? (
          <div className="grid justify-items-center px-5 py-10 text-center">
            <span className="grid size-12 place-items-center rounded-md border border-line bg-surface-0 text-accent-dim">
              <Film size={22} aria-hidden="true" />
            </span>
            <h3 className="mt-3 font-display text-[18px] leading-tight font-medium">
              No footage yet
            </h3>
            <p className="mt-1.5 max-w-[28ch] text-[10px] leading-relaxed text-ink-muted">
              Import video, audio or images. Kerf makes proxies, thumbnails and
              waveforms on this machine.
            </p>
            <Button
              className="mt-4"
              variant="secondary"
              size="sm"
              leadingIcon={<Plus size={13} />}
              disabled={busy}
              onClick={() => void onImport()}
            >
              Import footage
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <p className="px-4 py-8 text-center text-[11px] text-ink-faint">
            No footage matches “{query}”.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2 p-2.5">
            {filtered.map((asset) => {
              const job = jobsByTarget.get(asset.id);
              const progress = job ? Math.max(0, Math.min(1, job.progress)) : 0;
              const active = asset.id === selectedId;
              return (
                <button
                  key={asset.id}
                  type="button"
                  className={cn(
                    'group min-w-0 overflow-hidden rounded-sm border bg-surface-0 text-left transition-colors focus-visible:outline-none',
                    asset.status === 'ready' &&
                      'cursor-grab active:cursor-grabbing',
                    active
                      ? 'border-accent/70 shadow-1'
                      : 'border-line hover:border-line-strong',
                  )}
                  draggable={asset.status === 'ready'}
                  onDragStart={(event) => {
                    if (asset.status !== 'ready') {
                      event.preventDefault();
                      return;
                    }
                    event.dataTransfer.effectAllowed = 'copy';
                    event.dataTransfer.setData(ASSET_DRAG_MIME, asset.id);
                  }}
                  onClick={() => setSelectedId(asset.id)}
                  aria-pressed={active}
                  title={asset.name}
                >
                  <div className="relative aspect-video overflow-hidden bg-surface-0">
                    <AssetPreview asset={asset} />
                    <span className="absolute top-1 left-1 grid size-5 place-items-center rounded-xs bg-surface-0/80 text-ink-muted backdrop-blur-sm">
                      <KindIcon kind={asset.kind} size={11} />
                    </span>
                    <span className="absolute right-1 bottom-1 rounded-xs bg-surface-0/85 px-1 font-mono text-[8px] text-ink-muted">
                      {formatDuration(asset.durationSeconds)}
                    </span>
                    {job ? (
                      <span
                        className="absolute inset-x-0 bottom-0 h-0.5 bg-surface-0"
                        aria-hidden="true"
                      >
                        <span
                          className="block h-full bg-accent"
                          style={{ width: `${Math.max(2, progress * 100)}%` }}
                        />
                      </span>
                    ) : null}
                  </div>
                  <div className="space-y-1.5 p-2">
                    <p className="overflow-hidden text-[10px] leading-snug font-medium text-ellipsis whitespace-nowrap text-ink">
                      {asset.name}
                    </p>
                    <div className="flex items-center justify-between gap-1">
                      <StatusChip status={asset.status} />
                      <span className="truncate font-mono text-[8px] text-ink-faint uppercase">
                        {asset.kind}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {selected ? (
        <div className="max-h-[42%] overflow-auto border-t border-line bg-surface-1 px-3 py-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="overflow-hidden text-[11px] font-semibold text-ellipsis whitespace-nowrap text-ink">
                {selected.name}
              </p>
              <p className="mt-0.5 font-mono text-[8px] tracking-[0.03em] text-ink-faint uppercase">
                {KIND_LABEL[selected.kind]}
                {selected.hasAudio ? ' · audio' : ''}
              </p>
            </div>
            <StatusChip status={selected.status} />
          </div>

          {selected.error ? (
            <div className="mt-2 flex items-start gap-1.5 rounded-xs border border-danger/30 bg-danger/10 px-2 py-1.5 text-[9px] leading-snug text-danger">
              <AlertTriangle size={11} className="mt-px shrink-0" />
              <p>{selected.error}</p>
            </div>
          ) : null}

          <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5">
            <div>
              <dt className="font-mono text-[8px] tracking-[0.04em] text-ink-faint uppercase">
                Duration
              </dt>
              <dd className="mt-0.5 flex items-center gap-1 font-mono text-[10px] text-ink-muted">
                <Clock3 size={10} aria-hidden="true" />
                {formatDuration(selected.durationSeconds)}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[8px] tracking-[0.04em] text-ink-faint uppercase">
                Size
              </dt>
              <dd className="mt-0.5 font-mono text-[10px] text-ink-muted">
                {formatBytes(selected.fileSize)}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[8px] tracking-[0.04em] text-ink-faint uppercase">
                Resolution
              </dt>
              <dd className="mt-0.5 font-mono text-[10px] text-ink-muted">
                {selected.width && selected.height
                  ? `${selected.width} × ${selected.height}`
                  : '—'}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[8px] tracking-[0.04em] text-ink-faint uppercase">
                Frame rate
              </dt>
              <dd className="mt-0.5 font-mono text-[10px] text-ink-muted">
                {formatFrameRate(selected)}
              </dd>
            </div>
          </dl>

          <p
            className="mt-2 overflow-hidden font-mono text-[9px] text-ellipsis whitespace-nowrap text-ink-faint"
            title={selected.sourcePath}
          >
            {selected.sourcePath}
          </p>

          {selected.status === 'missing' ? (
            <p className="mt-2 text-[9px] leading-relaxed text-ink-muted">
              Relink the source file to rebuild its analysis, proxy, thumbnail
              and waveform.
            </p>
          ) : null}

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {selectedAnalysis?.transcript ? (
              <button
                type="button"
                title="View transcript"
                onClick={() => onOpenTranscript(selected.id)}
                className="inline-flex h-[18px] items-center gap-1 rounded-pill border border-ok/30 bg-ok/10 px-1.5 font-mono text-[8px] uppercase text-ok transition-colors duration-150 ease-k hover:border-ok/60 hover:bg-ok/15 focus-visible:outline-none"
              >
                <Captions size={9} />{' '}
                {selectedAnalysis.transcriptSource === 'visual'
                  ? 'Visual narration'
                  : 'Transcript'}
              </button>
            ) : (
              <span className="inline-flex h-[18px] items-center gap-1 rounded-pill border border-line bg-surface-2 px-1.5 font-mono text-[8px] uppercase text-ink-faint">
                <Captions size={9} /> No words
              </span>
            )}
            {selectedAnalysis && selectedAnalysis.sceneCount > 0 ? (
              <button
                type="button"
                title="View scenes"
                onClick={() => onOpenScenes(selected.id)}
                className="inline-flex h-[18px] items-center gap-1 rounded-pill border border-ok/30 bg-ok/10 px-1.5 font-mono text-[8px] uppercase text-ok transition-colors duration-150 ease-k hover:border-ok/60 hover:bg-ok/15 focus-visible:outline-none"
              >
                <ScanLine size={10} /> {selectedAnalysis.sceneCount}{' '}
                {selectedAnalysis.sceneCount === 1 ? 'scene' : 'scenes'}
              </button>
            ) : (
              <span className="inline-flex h-[18px] items-center gap-1 rounded-pill border border-line bg-surface-2 px-1.5 font-mono text-[8px] uppercase text-ink-faint">
                <ScanLine size={10} /> 0 scenes
              </span>
            )}
            {selectedAnalysis?.beatMap ? (
              <button
                type="button"
                title="View beats"
                onClick={() => onOpenBeats(selected.id)}
                className="inline-flex h-[18px] items-center gap-1 rounded-pill border border-ok/30 bg-ok/10 px-1.5 font-mono text-[8px] uppercase text-ok transition-colors duration-150 ease-k hover:border-ok/60 hover:bg-ok/15 focus-visible:outline-none"
              >
                <Music2 size={9} />{' '}
                {selectedAnalysis.bpm !== null
                  ? formatBpm(selectedAnalysis.bpm)
                  : 'Beats'}
              </button>
            ) : (
              <span className="inline-flex h-[18px] items-center gap-1 rounded-pill border border-line bg-surface-2 px-1.5 font-mono text-[8px] uppercase text-ink-faint">
                <Music2 size={9} /> No tempo
              </span>
            )}
            {selectedAnalysis && selectedAnalysis.sceneCount > 0 ? (
              <button
                type="button"
                title="Review descriptions"
                onClick={() => onOpenDescriptions(selected.id)}
                className={cn(
                  'inline-flex h-[18px] items-center gap-1 rounded-pill border px-1.5 font-mono text-[8px] uppercase transition-colors duration-150 ease-k focus-visible:outline-none',
                  selectedAnalysis.descriptions > 0
                    ? 'border-ok/30 bg-ok/10 text-ok hover:border-ok/60 hover:bg-ok/15'
                    : 'border-line bg-surface-2 text-ink-faint hover:border-line-strong hover:text-ink-muted',
                )}
              >
                <Sparkles size={9} /> {selectedAnalysis.descriptions} described
              </button>
            ) : (
              <span className="inline-flex h-[18px] items-center gap-1 rounded-pill border border-line bg-surface-2 px-1.5 font-mono text-[8px] uppercase text-ink-faint">
                <Sparkles size={9} /> 0 described
              </span>
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<Captions size={11} />}
              disabled={busy || selected.kind === 'image' || !selected.hasAudio}
              onClick={() => void onAnalyze(selected.id, ['transcript'])}
            >
              Transcribe
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={
                busy ||
                selected.kind !== 'video' ||
                selected.status !== 'ready' ||
                jobs.some(
                  (job) =>
                    job.kind === 'analysis.visualNarration' &&
                    job.targetId === selected.id &&
                    (job.status === 'queued' || job.status === 'running'),
                )
              }
              onClick={() =>
                selectedAnalysis?.transcriptSource === 'visual'
                  ? onOpenTranscript(selected.id)
                  : setNarrationOpen(true)
              }
            >
              Visual narration
            </Button>
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<ScanLine size={11} />}
              disabled={busy || selected.kind !== 'video'}
              onClick={() => void onAnalyze(selected.id, ['scenes'])}
            >
              Scenes
            </Button>
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<Music2 size={11} />}
              disabled={
                busy || (!selected.hasAudio && selected.kind !== 'audio')
              }
              onClick={() => void onAnalyze(selected.id, ['beats'])}
            >
              Beats
            </Button>
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<Sparkles size={11} />}
              disabled={
                busy || !selectedAnalysis || selectedAnalysis.sceneCount === 0
              }
              onClick={() => void onAnalyze(selected.id, ['vision'])}
            >
              Describe
            </Button>
          </div>

          <div className="mt-2 flex items-center gap-2">
            <Button
              variant={selected.status === 'missing' ? 'primary' : 'secondary'}
              size="sm"
              leadingIcon={<RefreshCw size={12} />}
              disabled={busy}
              onClick={() => void onRelink(selected.id)}
            >
              {selected.status === 'missing'
                ? 'Relink source'
                : 'Replace source'}
            </Button>
            {selected.status === 'ready' ? (
              <span className="inline-flex items-center gap-1 font-mono text-[8px] tracking-[0.02em] text-ok uppercase">
                <CheckCircle2 size={10} aria-hidden="true" />
                Ready
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
      {selected && (
        <VisualNarrationDialog
          key={selected.id}
          open={narrationOpen}
          onClose={() => setNarrationOpen(false)}
          asset={selected}
          onQueued={() => onOpenTranscript(selected.id)}
        />
      )}
    </Panel>
  );
}
