import { useState } from 'react';
import {
  Check,
  Film,
  Image as ImageIcon,
  Loader2,
  Palette,
  Scissors,
  Sparkles,
  Timer,
  Trash2,
  Wand2,
} from 'lucide-react';
import type { Asset, ReferenceProfile, Sequence } from '@kerf/model';
import type { ReferencePacing } from '../../shared/contracts';
import { Button, Dialog, cn } from '@kerf/ui';
import { useStudio } from '../state/StudioProvider';

export interface ReferencesDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

function mediaUrl(assetId: string): string {
  return `kerfmedia://asset/${encodeURIComponent(assetId)}/thumbnail`;
}

function formatPercent(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

function formatNumber(value: number, places = 0): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(places);
}

function suggestedPacing(
  profile: ReferenceProfile,
  sequence: Sequence,
): ReferencePacing {
  const fps = sequence.frameRate.numerator / sequence.frameRate.denominator;
  const target =
    profile.cutsPerMinute > 0
      ? Math.max(1, Math.round((60 / profile.cutsPerMinute) * fps))
      : 0;
  const suggestedCutFrames =
    target > 0
      ? Array.from(
          {
            length: Math.min(
              200,
              Math.floor((sequence.durationFrames - 1) / target),
            ),
          },
          (_, index) => (index + 1) * target,
        )
      : [];
  return {
    averageShotLengthFrames: profile.averageShotLengthFrames,
    cutsPerMinute: profile.cutsPerMinute,
    sceneCount: profile.sceneCount,
    targetShotLengthFrames: target || null,
    suggestedCutFrames,
  };
}

function Metric({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div className="rounded-sm border border-line bg-surface-0 px-2.5 py-2">
      <p className="font-mono text-[8px] tracking-[0.04em] text-ink-faint uppercase">
        {label}
      </p>
      <p className="mt-1 font-mono text-[12px] text-ink">{value}</p>
    </div>
  );
}

function AssetThumb({ asset }: { readonly asset: Asset }) {
  const [failed, setFailed] = useState(false);
  if (failed || !asset.cache.thumbnailPath) {
    return (
      <div className="grid h-full place-items-center bg-surface-0 text-ink-faint">
        {asset.kind === 'image' ? <ImageIcon size={18} /> : <Film size={18} />}
      </div>
    );
  }
  return (
    <img
      src={mediaUrl(asset.id)}
      alt=""
      loading="lazy"
      decoding="async"
      className="h-full w-full object-cover"
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}

export function ReferencesDialog({
  open,
  onOpenChange,
}: ReferencesDialogProps) {
  const snapshot = useStudio((state) => state.snapshot);
  const pushToast = useStudio((state) => state.pushToast);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [strength, setStrength] = useState(1);
  const [pacing, setPacing] = useState<ReferencePacing | null>(null);

  const sequence = snapshot?.project.sequence ?? null;
  const profile = sequence?.reference ?? null;
  const candidates = (snapshot?.assets ?? []).filter(
    (asset) =>
      asset.status === 'ready' &&
      (asset.kind === 'video' || asset.kind === 'image'),
  );
  const activePacing =
    pacing ?? (profile && sequence ? suggestedPacing(profile, sequence) : null);

  const assign = async (asset: Asset) => {
    setBusyId(asset.id);
    try {
      await window.kerf.references.use({ assetId: asset.id });
      setPacing(null);
      pushToast({
        title: 'Reference assigned',
        description: `${asset.name} was measured for look and pacing.`,
        tone: 'success',
      });
    } catch (cause) {
      pushToast({
        title: 'Could not profile the reference',
        description: cause instanceof Error ? cause.message : String(cause),
        tone: 'error',
      });
    } finally {
      setBusyId(null);
    }
  };

  const clear = async () => {
    setApplying(true);
    try {
      await window.kerf.references.clear();
      setPacing(null);
      pushToast({
        title: 'Reference cleared',
        description: 'The timeline and its grade are unchanged.',
        tone: 'success',
      });
    } catch (cause) {
      pushToast({
        title: 'Could not clear the reference',
        description: cause instanceof Error ? cause.message : String(cause),
        tone: 'error',
      });
    } finally {
      setApplying(false);
    }
  };

  const applyLook = async () => {
    setApplying(true);
    try {
      const result = await window.kerf.references.applyLook({ strength });
      setPacing(result.pacing);
      pushToast({
        title:
          result.appliedClipCount > 0
            ? 'Reference look applied'
            : 'No clips needed the look',
        description:
          result.appliedClipCount > 0
            ? `${result.effectsAdded} effects across ${result.appliedClipCount} clips. Undo reverts the grade.`
            : 'Select visual clips or add footage first.',
        tone: result.appliedClipCount > 0 ? 'success' : 'warning',
      });
    } catch (cause) {
      pushToast({
        title: 'Could not apply the reference look',
        description: cause instanceof Error ? cause.message : String(cause),
        tone: 'error',
      });
    } finally {
      setApplying(false);
    }
  };

  const applyPacing = async () => {
    setApplying(true);
    try {
      const result = await window.kerf.references.applyPacing();
      setPacing(result.pacing);
      pushToast({
        title:
          result.added > 0 ? 'Pacing markers placed' : 'No new pacing markers',
        description:
          result.added > 0
            ? `${result.added} beat markers follow the reference rhythm.`
            : 'The sequence already has markers at every suggested cut.',
        tone: result.added > 0 ? 'success' : 'info',
      });
    } catch (cause) {
      pushToast({
        title: 'Could not place pacing markers',
        description: cause instanceof Error ? cause.message : String(cause),
        tone: 'error',
      });
    } finally {
      setApplying(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="References"
      description="Measure a finished piece for its grade and cutting rhythm. The reference media is read only: it never enters the timeline, preview or export."
      panelClassName="max-w-[760px]"
      footer={
        <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
          Close
        </Button>
      }
    >
      <div className="grid max-h-[68vh] gap-5 overflow-auto pr-1">
        {profile ? (
          <section className="grid gap-3">
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-sm border border-line bg-surface-0 p-3">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-[12px] font-semibold text-ink">
                  <Palette size={13} className="text-accent" />
                  {profile.name}
                </p>
                <p className="mt-1 flex items-center gap-1.5 font-mono text-[9px] text-ink-faint">
                  <Check size={10} className="text-ok" />
                  {profile.analyzedAt
                    ? `profiled ${new Date(profile.analyzedAt).toLocaleString()}`
                    : 'not measured yet'}
                  {profile.sourceAssetId
                    ? ` · source ${profile.sourceAssetId.slice(-6)}`
                    : ''}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  variant="primary"
                  size="sm"
                  disabled={applying}
                  leadingIcon={
                    applying ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      <Wand2 size={11} />
                    )
                  }
                  onClick={() => void applyLook()}
                >
                  Apply look
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={applying}
                  leadingIcon={<Scissors size={11} />}
                  onClick={() => void applyPacing()}
                >
                  Place pacing
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={applying}
                  leadingIcon={<Trash2 size={11} />}
                  onClick={() => void clear()}
                >
                  Clear
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {profile.palette.length > 0 ? (
                profile.palette.map((colour) => (
                  <span
                    key={colour}
                    className="inline-flex items-center gap-1.5 rounded-pill border border-line bg-surface-0 px-2 py-1 font-mono text-[8px] text-ink-muted"
                  >
                    <span
                      className="size-2.5 rounded-full border border-line-strong"
                      style={{ backgroundColor: colour }}
                      aria-hidden="true"
                    />
                    {colour}
                  </span>
                ))
              ) : (
                <span className="text-[9px] text-ink-faint">
                  No palette sampled.
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Metric label="Shots" value={formatNumber(profile.sceneCount)} />
              <Metric
                label="Average shot"
                value={`${formatNumber(profile.averageShotLengthFrames, 1)} fr`}
              />
              <Metric
                label="Cuts / minute"
                value={formatNumber(profile.cutsPerMinute, 1)}
              />
              <Metric label="Luma" value={formatPercent(profile.meanLuma)} />
              <Metric
                label="Saturation"
                value={formatPercent(profile.meanSaturation)}
              />
              <Metric
                label="Contrast"
                value={formatPercent(profile.meanContrast)}
              />
            </div>

            <div className="grid gap-2 rounded-sm border border-line bg-surface-0 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-[10px] font-medium text-ink">
                  <Sparkles size={11} className="text-accent" />
                  Look strength
                </p>
                <span className="font-mono text-[9px] text-ink-faint">
                  {Math.round(strength * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={strength}
                aria-label="Reference look strength"
                onChange={(event) => setStrength(Number(event.target.value))}
                className="w-full accent-[var(--color-accent)]"
              />
              <p className="text-[9px] leading-relaxed text-ink-faint">
                Brightness, contrast and saturation are mapped from the measured
                profile and added as undoable clip effects.
              </p>
            </div>

            {activePacing ? (
              <div className="grid gap-2 rounded-sm border border-line bg-surface-0 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="flex items-center gap-1.5 text-[10px] font-medium text-ink">
                    <Timer size={11} className="text-accent" />
                    Pacing target
                  </p>
                  <p className="font-mono text-[9px] text-ink-faint">
                    {activePacing.targetShotLengthFrames
                      ? `${activePacing.targetShotLengthFrames} frames / shot`
                      : 'No measured rhythm'}
                  </p>
                </div>
                <p className="text-[9px] leading-relaxed text-ink-faint">
                  {activePacing.suggestedCutFrames.length > 0
                    ? `${activePacing.suggestedCutFrames.length} suggested cut points. “Place pacing” adds beat markers; it never moves or trims a clip.`
                    : 'The sequence is too short for a suggested cut at this rhythm.'}
                </p>
                {activePacing.suggestedCutFrames.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {activePacing.suggestedCutFrames
                      .slice(0, 16)
                      .map((frame) => (
                        <span
                          key={frame}
                          className="rounded-xs border border-line bg-surface-1 px-1.5 py-0.5 font-mono text-[8px] text-ink-muted"
                        >
                          {frame}
                        </span>
                      ))}
                    {activePacing.suggestedCutFrames.length > 16 ? (
                      <span className="px-1 font-mono text-[8px] text-ink-faint">
                        +{activePacing.suggestedCutFrames.length - 16}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : (
          <p className="rounded-sm border border-line bg-surface-0 px-3 py-3 text-[10px] leading-relaxed text-ink-faint">
            No reference is assigned. Pick a finished video or still below to
            measure its shot rhythm, palette and colour.
          </p>
        )}

        <section className="grid gap-2">
          <div>
            <h3 className="text-[11px] font-semibold text-ink">
              Reference footage
            </h3>
            <p className="mt-0.5 text-[9px] leading-relaxed text-ink-faint">
              The source stays in the footage bin. Kerf stores only the measured
              profile, so removing the file later does not remove the look.
            </p>
          </div>
          {candidates.length > 0 ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {candidates.map((asset) => {
                const active = profile?.sourceAssetId === asset.id;
                return (
                  <button
                    key={asset.id}
                    type="button"
                    disabled={busyId !== null || applying}
                    className={cn(
                      'group min-w-0 overflow-hidden rounded-sm border bg-surface-0 text-left transition-colors disabled:opacity-60',
                      active
                        ? 'border-accent/70'
                        : 'border-line hover:border-line-strong',
                    )}
                    onClick={() => void assign(asset)}
                  >
                    <div className="relative aspect-video overflow-hidden">
                      <AssetThumb asset={asset} />
                      {busyId === asset.id ? (
                        <span className="absolute inset-0 grid place-items-center bg-surface-0/70">
                          <Loader2
                            size={16}
                            className="animate-spin text-accent"
                          />
                        </span>
                      ) : null}
                      {active ? (
                        <span className="absolute top-1 right-1 rounded-xs bg-accent px-1 py-0.5 font-mono text-[8px] text-surface-0 uppercase">
                          active
                        </span>
                      ) : null}
                    </div>
                    <div className="p-2">
                      <p className="truncate text-[10px] font-medium text-ink">
                        {asset.name}
                      </p>
                      <p className="mt-0.5 font-mono text-[8px] text-ink-faint uppercase">
                        {asset.kind} · {Math.round(asset.durationSeconds)}s
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="rounded-sm border border-line bg-surface-0 px-3 py-3 text-[10px] text-ink-faint">
              Import a video or still to use it as a reference.
            </p>
          )}
        </section>
      </div>
    </Dialog>
  );
}
