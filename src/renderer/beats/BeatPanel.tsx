import { useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { Flag, Loader2, Music2, Scissors, X } from 'lucide-react';
import type { BeatSection, FrameRate } from '@kerf/model';
import {
  beatMapDurationFrames,
  formatDuration,
  formatTimecode,
  secondsToFrames,
} from '@kerf/model';
import { Button, IconButton, Panel, cn } from '@kerf/ui';
import { SourcePreview } from '../analysis/SourcePreview';
import type { SourcePreviewHandle } from '../analysis/SourcePreview';
import { findSequenceFrame } from '../state/sequence-map';
import { useStudio } from '../state/StudioProvider';
import {
  beatDensityLabel,
  buildBeatMarkerCommands,
  buildBeatSplitCommands,
  planBeatEdits,
} from './beat-commands';
import type { BeatDensity } from './beat-commands';

export interface BeatPanelProps {
  readonly assetId: string;
  readonly onClose: () => void;
}

const FALLBACK_RATE: FrameRate = { numerator: 24, denominator: 1 };
const DENSITIES: readonly BeatDensity[] = ['sparse', 'medium', 'dense'];

function formatBpm(bpm: number): string {
  return `${Number.isInteger(bpm) ? bpm : bpm.toFixed(1)} BPM`;
}

function sectionTone(section: BeatSection): string {
  if (section.label.startsWith('Peak')) {
    return 'bg-warn/10';
  }
  if (section.label.startsWith('Break')) {
    return 'bg-surface-3/70';
  }
  if (section.label.startsWith('Main')) {
    return 'bg-accent/5';
  }
  return 'bg-surface-2/40';
}

/**
 * Beat map inspector. Beats are a timing grid, so the panel pairs a source
 * player with a compact grid strip, section list and the two timeline actions
 * that make the grid useful: markers and beat-aligned splits.
 */
export function BeatPanel({ assetId, onClose }: BeatPanelProps) {
  const snapshot = useStudio((state) => state.snapshot);
  const revealAssetFrame = useStudio((state) => state.revealAssetFrame);
  const apply = useStudio((state) => state.apply);
  const pushToast = useStudio((state) => state.pushToast);

  const asset =
    snapshot?.assets.find((candidate) => candidate.id === assetId) ?? null;
  const beatMap =
    snapshot?.beatMaps.find((candidate) => candidate.assetId === assetId) ??
    null;
  const sequence = snapshot?.project.sequence ?? null;
  const rate = asset?.frameRate ?? sequence?.frameRate ?? FALLBACK_RATE;

  const [currentFrame, setCurrentFrame] = useState(0);
  const [density, setDensity] = useState<BeatDensity>('medium');
  const [busy, setBusy] = useState<'markers' | 'split' | null>(null);
  const previewRef = useRef<SourcePreviewHandle>(null);

  const beats = useMemo(() => beatMap?.beats ?? [], [beatMap]);
  const sections = useMemo(() => beatMap?.sections ?? [], [beatMap]);

  const durationFrames = useMemo(() => {
    const assetFrames = asset
      ? secondsToFrames(asset.durationSeconds, rate)
      : 0;
    return Math.max(
      1,
      assetFrames,
      beatMap ? beatMapDurationFrames(beatMap) : 0,
    );
  }, [asset, rate, beatMap]);

  const plan = useMemo(
    () =>
      sequence && beatMap ? planBeatEdits(sequence, beatMap, density) : null,
    [sequence, beatMap, density],
  );

  const activeBeatIndex = useMemo(() => {
    let found = -1;
    for (const [index, beat] of beats.entries()) {
      if (beat.frame > currentFrame) {
        break;
      }
      found = index;
    }
    return found;
  }, [beats, currentFrame]);

  const activeSectionId =
    sections.find(
      (section) =>
        currentFrame >= section.startFrame && currentFrame < section.endFrame,
    )?.id ?? null;

  const visualStride = Math.max(1, Math.ceil(beats.length / 400));
  const selectedStride = plan?.stride ?? 1;
  const visibleBeats = useMemo(
    () =>
      beats
        .map((beat, index) => ({ beat, index }))
        .filter(({ index }) => index % visualStride === 0),
    [beats, visualStride],
  );

  const playheadPercent =
    durationFrames > 0
      ? Math.min(100, Math.max(0, (currentFrame / durationFrames) * 100))
      : 0;

  const seek = (frame: number) => {
    previewRef.current?.seekToFrame(frame);
    if (sequence && findSequenceFrame(sequence, assetId, frame) !== null) {
      revealAssetFrame(assetId, frame);
    }
  };

  const seekFromStrip = (event: MouseEvent<HTMLButtonElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0) {
      return;
    }
    const ratio = Math.min(
      1,
      Math.max(0, (event.clientX - bounds.left) / bounds.width),
    );
    seek(Math.round(ratio * durationFrames));
  };

  const addMarkers = async () => {
    if (!sequence || !plan || plan.newMarkerCount === 0) {
      return;
    }
    const commands = buildBeatMarkerCommands(sequence, plan);
    if (commands.length === 0) {
      return;
    }
    setBusy('markers');
    try {
      const result = await apply(
        { type: 'batch', label: 'Add beat markers', commands },
        'Add beat markers',
      );
      if (result) {
        pushToast({
          title: `Added ${commands.length} beat marker${
            commands.length === 1 ? '' : 's'
          }`,
          description: `${beatDensityLabel(density)} across ${
            plan.mappedClipCount
          } timeline clip${plan.mappedClipCount === 1 ? '' : 's'}.`,
          tone: 'success',
        });
      }
    } finally {
      setBusy(null);
    }
  };

  const splitOnBeats = async () => {
    if (!plan || plan.cutCount === 0) {
      return;
    }
    const commands = buildBeatSplitCommands(plan);
    if (commands.length === 0) {
      return;
    }
    setBusy('split');
    try {
      const result = await apply(
        {
          type: 'batch',
          label: `Split on beats (${density})`,
          commands,
        },
        'Split on beats',
      );
      if (result) {
        pushToast({
          title: 'Split on beats',
          description: `${plan.cutCount} cuts across ${
            plan.splits.length
          } clip${plan.splits.length === 1 ? '' : 's'}, ${
            plan.segmentCount
          } segments.`,
          tone: 'success',
        });
      }
    } finally {
      setBusy(null);
    }
  };

  const hint = !plan
    ? null
    : plan.timelineClipCount === 0
      ? 'Place this asset on the timeline to add markers or split on beats.'
      : plan.mappedClipCount === 0
        ? 'No beats fall inside the timeline clips. Move or trim a clip to cover the beat grid.'
        : plan.cutCount === 0 && plan.lockedClipCount > 0
          ? 'Unlock the timeline clip or its track to split on beats.'
          : plan.newMarkerCount === 0
            ? 'Every beat position already has a marker.'
            : `${plan.mappedClipCount} timeline clip${
                plan.mappedClipCount === 1 ? '' : 's'
              } cover this grid. Splits affect every unlocked clip.`;

  return (
    <Panel
      title="Beats"
      subtitle={asset?.name ?? 'Unknown asset'}
      bodyClassName="flex min-h-0 flex-col p-0"
      actions={
        <IconButton
          label="Close beats"
          tooltip="Close beats"
          tooltipSide="bottom"
          size="sm"
          icon={<X size={14} />}
          onClick={onClose}
        />
      }
    >
      {asset && beatMap ? (
        <>
          <SourcePreview
            ref={previewRef}
            asset={asset}
            rate={rate}
            onFrameChange={setCurrentFrame}
          />

          <div className="grid gap-2.5 border-b border-line p-3">
            <div className="grid grid-cols-2 gap-1.5">
              <div className="rounded-sm border border-line bg-surface-0 px-2 py-1.5">
                <span className="block font-mono text-[8px] tracking-[0.04em] text-ink-faint uppercase">
                  Tempo
                </span>
                <span className="mt-0.5 block font-mono text-[12px] text-ink">
                  {formatBpm(beatMap.bpm)}
                </span>
              </div>
              <div className="rounded-sm border border-line bg-surface-0 px-2 py-1.5">
                <span className="block font-mono text-[8px] tracking-[0.04em] text-ink-faint uppercase">
                  Beats
                </span>
                <span className="mt-0.5 block font-mono text-[12px] text-ink">
                  {beats.length}
                </span>
              </div>
              <div className="rounded-sm border border-line bg-surface-0 px-2 py-1.5">
                <span className="block font-mono text-[8px] tracking-[0.04em] text-ink-faint uppercase">
                  Sections
                </span>
                <span className="mt-0.5 block font-mono text-[12px] text-ink">
                  {sections.length}
                </span>
              </div>
              <div className="rounded-sm border border-line bg-surface-0 px-2 py-1.5">
                <span className="block font-mono text-[8px] tracking-[0.04em] text-ink-faint uppercase">
                  Offset
                </span>
                <span className="mt-0.5 block font-mono text-[12px] text-ink">
                  {formatTimecode(beatMap.offsetFrames, rate)}
                </span>
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="font-mono text-[8px] tracking-[0.04em] text-ink-faint uppercase">
                  Beat grid
                </span>
                <span className="font-mono text-[8px] text-ink-muted">
                  {activeBeatIndex >= 0
                    ? `Beat ${activeBeatIndex + 1} / ${beats.length}`
                    : `${beats.length} beats`}
                </span>
              </div>
              <button
                type="button"
                data-beat-strip
                onClick={seekFromStrip}
                title="Seek in source"
                aria-label="Seek in source"
                className="relative block h-14 w-full overflow-hidden rounded-sm border border-line bg-surface-0 focus-visible:outline-none"
              >
                {sections.map((section) => {
                  const left = (section.startFrame / durationFrames) * 100;
                  const width =
                    ((section.endFrame - section.startFrame) / durationFrames) *
                    100;
                  return (
                    <span
                      key={section.id}
                      className={cn(
                        'absolute inset-y-0 border-r border-line/60',
                        sectionTone(section),
                      )}
                      style={{ left: `${left}%`, width: `${width}%` }}
                    />
                  );
                })}
                {visibleBeats.map(({ beat, index }) => (
                  <span
                    key={beat.id}
                    className={cn(
                      'absolute bottom-0 w-px',
                      index % selectedStride === 0
                        ? 'bg-accent/80'
                        : 'bg-ink-faint/35',
                      index % 4 === 0 ? 'h-3/5' : 'h-1/3',
                    )}
                    style={{
                      left: `${(beat.frame / durationFrames) * 100}%`,
                    }}
                  />
                ))}
                <span
                  className="absolute inset-y-0 w-px bg-accent"
                  style={{ left: `calc(${playheadPercent}% - 0.5px)` }}
                />
              </button>
            </div>

            <div className="grid gap-1">
              <span className="font-mono text-[8px] tracking-[0.04em] text-ink-faint uppercase">
                Density
              </span>
              <div className="grid grid-cols-3 gap-1">
                {DENSITIES.map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={density === option}
                    data-beat-density={option}
                    onClick={() => setDensity(option)}
                    className={cn(
                      'h-[24px] rounded-sm border font-mono text-[8px] uppercase transition-colors duration-150 ease-k focus-visible:outline-none',
                      density === option
                        ? 'border-accent/50 bg-accent/10 text-accent-bright'
                        : 'border-line bg-surface-0 text-ink-faint hover:border-line-strong hover:text-ink-muted',
                    )}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <Button
                variant="secondary"
                size="sm"
                leadingIcon={
                  busy === 'markers' ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <Flag size={11} />
                  )
                }
                disabled={
                  busy !== null || plan === null || plan.newMarkerCount === 0
                }
                onClick={() => void addMarkers()}
              >
                Add markers
              </Button>
              <Button
                variant="secondary"
                size="sm"
                leadingIcon={
                  busy === 'split' ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <Scissors size={11} />
                  )
                }
                disabled={busy !== null || plan === null || plan.cutCount === 0}
                onClick={() => void splitOnBeats()}
              >
                Split on beats
              </Button>
            </div>

            {hint ? (
              <p className="text-[9px] leading-relaxed text-ink-faint">
                {hint}
              </p>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-1.5">
            <p className="px-2 py-1 font-mono text-[8px] tracking-[0.04em] text-ink-faint uppercase">
              Sections
            </p>
            {sections.length === 0 ? (
              <p className="px-2 py-6 text-center text-[11px] text-ink-faint">
                No sections detected.
              </p>
            ) : (
              <ol className="grid gap-0.5">
                {sections.map((section) => {
                  const active = section.id === activeSectionId;
                  return (
                    <li key={section.id}>
                      <button
                        type="button"
                        data-beat-section
                        data-active={active || undefined}
                        onClick={() => seek(section.startFrame)}
                        title="Play from this section"
                        className={cn(
                          'flex w-full items-center gap-2 rounded-sm border border-transparent px-2 py-1.5 text-left transition-colors duration-150 ease-k hover:bg-surface-2 focus-visible:outline-none',
                          active && 'border-accent/30 bg-accent/10',
                        )}
                      >
                        <span
                          className={cn(
                            'w-[58px] shrink-0 font-mono text-[9px]',
                            active ? 'text-accent-bright' : 'text-ink-faint',
                          )}
                        >
                          {formatTimecode(section.startFrame, rate)}
                        </span>
                        <span
                          className={cn(
                            'min-w-0 flex-1 text-[11px]',
                            active ? 'text-ink' : 'text-ink-muted',
                          )}
                        >
                          {section.label}
                        </span>
                        <span className="shrink-0 font-mono text-[8px] text-ink-faint">
                          {formatDuration(
                            section.endFrame - section.startFrame,
                            rate,
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>

          <footer className="border-t border-line px-3 py-2 font-mono text-[8px] tracking-[0.04em] text-ink-faint uppercase">
            {beats.length} {beats.length === 1 ? 'beat' : 'beats'} ·{' '}
            {sections.length} {sections.length === 1 ? 'section' : 'sections'} ·
            detected locally
          </footer>
        </>
      ) : (
        <div className="grid flex-1 place-content-center gap-1 p-6 text-center">
          <Music2
            size={22}
            className="mx-auto text-ink-faint"
            aria-hidden="true"
          />
          <p className="text-[12px] text-ink-muted">No beat map yet</p>
          <span className="text-[10px] leading-relaxed text-ink-faint">
            Select the asset in the Footage bin and choose Beats.
          </span>
        </div>
      )}
    </Panel>
  );
}
