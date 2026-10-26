import { useMemo, useRef, useState } from 'react';
import { CheckCircle2, Loader2, RefreshCw, Sparkles, X } from 'lucide-react';
import type { FrameRate, Scene } from '@kerf/model';
import { formatTimecode } from '@kerf/model';
import { Button, IconButton, Panel, cn } from '@kerf/ui';
import { SourcePreview } from '../analysis/SourcePreview';
import type { SourcePreviewHandle } from '../analysis/SourcePreview';
import { findSequenceFrame } from '../state/sequence-map';
import { useStudio } from '../state/StudioProvider';
import { SceneThumbnail } from '../scenes/SceneThumbnail';

export interface DescriptionPanelProps {
  readonly assetId: string;
  readonly onClose: () => void;
}

const FALLBACK_RATE: FrameRate = { numerator: 24, denominator: 1 };

/**
 * Review surface for the vision index. Descriptions are costly to generate,
 * so the panel keeps the keyframe, its saved text and the remaining work in one
 * place, and offers both a missing-only pass and a full refresh.
 */
export function DescriptionPanel({ assetId, onClose }: DescriptionPanelProps) {
  const snapshot = useStudio((state) => state.snapshot);
  const revealAssetFrame = useStudio((state) => state.revealAssetFrame);
  const analyze = useStudio((state) => state.analyze);

  const asset =
    snapshot?.assets.find((candidate) => candidate.id === assetId) ?? null;
  const sequence = snapshot?.project.sequence ?? null;
  const rate = asset?.frameRate ?? sequence?.frameRate ?? FALLBACK_RATE;

  const scenes = useMemo(
    () =>
      (snapshot?.scenes ?? [])
        .filter((scene) => scene.assetId === assetId)
        .slice()
        .sort((left, right) => left.index - right.index),
    [snapshot?.scenes, assetId],
  );

  const describedCount = useMemo(
    () => scenes.filter((scene) => Boolean(scene.description?.trim())).length,
    [scenes],
  );
  const missingCount = scenes.length - describedCount;

  const runningJob = useMemo(
    () =>
      (snapshot?.jobs ?? []).find(
        (job) =>
          job.kind === 'analysis.vision' &&
          job.targetId === assetId &&
          (job.status === 'queued' || job.status === 'running'),
      ) ?? null,
    [snapshot?.jobs, assetId],
  );

  const [currentFrame, setCurrentFrame] = useState(0);
  const [starting, setStarting] = useState<'missing' | 'all' | null>(null);
  const previewRef = useRef<SourcePreviewHandle>(null);

  const activeSceneId =
    scenes.find(
      (scene) =>
        currentFrame >= scene.startFrame && currentFrame < scene.endFrame,
    )?.id ?? null;

  const seek = (scene: Scene) => {
    previewRef.current?.seekToFrame(scene.startFrame);
    if (
      sequence &&
      findSequenceFrame(sequence, assetId, scene.startFrame) !== null
    ) {
      revealAssetFrame(assetId, scene.startFrame);
    }
  };

  const describe = async (onlyUndescribed: boolean) => {
    setStarting(onlyUndescribed ? 'missing' : 'all');
    try {
      await analyze(
        assetId,
        ['vision'],
        onlyUndescribed ? { onlyUndescribed: true } : undefined,
      );
    } finally {
      setStarting(null);
    }
  };

  const busy = starting !== null || runningJob !== null;
  const hint = runningJob
    ? null
    : missingCount === 0
      ? 'Every shot has a description. Re-run all to refresh the index.'
      : `${missingCount} shot${missingCount === 1 ? '' : 's'} still need${missingCount === 1 ? 's' : ''} a description.`;

  return (
    <Panel
      title="Descriptions"
      subtitle={asset?.name ?? 'Unknown asset'}
      bodyClassName="flex min-h-0 flex-col p-0"
      actions={
        <IconButton
          label="Close descriptions"
          tooltip="Close descriptions"
          tooltipSide="bottom"
          size="sm"
          icon={<X size={14} />}
          onClick={onClose}
        />
      }
    >
      {asset ? (
        <SourcePreview
          ref={previewRef}
          asset={asset}
          rate={rate}
          onFrameChange={setCurrentFrame}
        />
      ) : null}

      {scenes.length === 0 ? (
        <div className="grid flex-1 place-content-center gap-1 p-6 text-center">
          <Sparkles
            size={22}
            className="mx-auto text-ink-faint"
            aria-hidden="true"
          />
          <p className="text-[12px] text-ink-muted">No keyframes to describe</p>
          <span className="text-[10px] leading-relaxed text-ink-faint">
            Select the asset in the Footage bin and choose Scenes first.
          </span>
        </div>
      ) : (
        <>
          <div className="grid gap-2.5 border-b border-line p-3">
            <div className="grid grid-cols-3 gap-1.5">
              <div className="rounded-sm border border-line bg-surface-0 px-2 py-1.5">
                <span className="block font-mono text-[8px] tracking-[0.04em] text-ink-faint uppercase">
                  Shots
                </span>
                <span className="mt-0.5 block font-mono text-[12px] text-ink">
                  {scenes.length}
                </span>
              </div>
              <div className="rounded-sm border border-line bg-surface-0 px-2 py-1.5">
                <span className="block font-mono text-[8px] tracking-[0.04em] text-ink-faint uppercase">
                  Described
                </span>
                <span className="mt-0.5 block font-mono text-[12px] text-ok">
                  {describedCount}
                </span>
              </div>
              <div className="rounded-sm border border-line bg-surface-0 px-2 py-1.5">
                <span className="block font-mono text-[8px] tracking-[0.04em] text-ink-faint uppercase">
                  Missing
                </span>
                <span
                  className={cn(
                    'mt-0.5 block font-mono text-[12px]',
                    missingCount > 0 ? 'text-warn' : 'text-ink',
                  )}
                >
                  {missingCount}
                </span>
              </div>
            </div>

            <div data-description-actions className="flex items-center gap-1.5">
              <Button
                variant="secondary"
                size="sm"
                leadingIcon={
                  starting === 'missing' ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <Sparkles size={11} />
                  )
                }
                disabled={busy || missingCount === 0}
                onClick={() => void describe(true)}
              >
                Describe missing
              </Button>
              <Button
                variant="secondary"
                size="sm"
                leadingIcon={
                  starting === 'all' ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <RefreshCw size={11} />
                  )
                }
                disabled={busy || describedCount === 0}
                onClick={() => void describe(false)}
              >
                Re-run all
              </Button>
            </div>

            {runningJob ? (
              <p className="flex items-center gap-1.5 font-mono text-[8px] tracking-[0.04em] text-accent-bright uppercase">
                <Loader2
                  size={10}
                  className="animate-spin"
                  aria-hidden="true"
                />
                {runningJob.status === 'queued'
                  ? 'Queued for vision'
                  : runningJob.stage || 'Describing keyframes'}
                <span className="text-ink-faint">
                  {Math.round(runningJob.progress * 100)}%
                </span>
              </p>
            ) : hint ? (
              <p className="text-[9px] leading-relaxed text-ink-faint">
                {hint}
              </p>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-1.5">
            <p className="px-2 py-1 font-mono text-[8px] tracking-[0.04em] text-ink-faint uppercase">
              Keyframes
            </p>
            <ol className="grid gap-1">
              {scenes.map((scene) => {
                const described = Boolean(scene.description?.trim());
                const active = scene.id === activeSceneId;
                return (
                  <li key={scene.id}>
                    <button
                      type="button"
                      data-description-row
                      data-active={active || undefined}
                      onClick={() => seek(scene)}
                      title="Play from the start of this shot"
                      className={cn(
                        'flex w-full items-start gap-2 rounded-sm border p-1.5 text-left transition-colors duration-150 ease-k hover:border-line-strong focus-visible:outline-none',
                        active
                          ? 'border-accent/40 bg-accent/5'
                          : 'border-line bg-surface-0',
                      )}
                    >
                      <div className="aspect-video w-[82px] shrink-0 overflow-hidden rounded-xs border border-line bg-black">
                        <SceneThumbnail scene={scene} />
                      </div>
                      <div className="grid min-w-0 flex-1 gap-0.5">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={cn(
                              'font-mono text-[8px]',
                              active ? 'text-accent-bright' : 'text-ink-faint',
                            )}
                          >
                            #{scene.index + 1}
                          </span>
                          <span className="font-mono text-[8px] text-ink-faint">
                            {formatTimecode(scene.startFrame, rate)}
                          </span>
                          <span
                            className={cn(
                              'ml-auto inline-flex items-center gap-0.5 rounded-pill border px-1 py-px font-mono text-[7px] uppercase',
                              described
                                ? 'border-ok/30 bg-ok/10 text-ok'
                                : 'border-line bg-surface-2 text-ink-faint',
                            )}
                          >
                            {described ? (
                              <CheckCircle2 size={8} aria-hidden="true" />
                            ) : null}
                            {described ? 'Described' : 'Missing'}
                          </span>
                        </div>
                        <span
                          className={cn(
                            'line-clamp-3 text-[10px] leading-relaxed',
                            described
                              ? 'text-ink-muted'
                              : 'text-ink-faint italic',
                          )}
                        >
                          {scene.description?.trim() || 'Not described yet'}
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>

          <footer className="border-t border-line px-3 py-2 font-mono text-[8px] tracking-[0.04em] text-ink-faint uppercase">
            {describedCount} of {scenes.length} described · {missingCount}{' '}
            missing · indexed for search
          </footer>
        </>
      )}
    </Panel>
  );
}
