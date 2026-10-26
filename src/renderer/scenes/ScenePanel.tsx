import { useMemo, useRef, useState } from 'react';
import { ScanLine, X } from 'lucide-react';
import type { FrameRate, Scene } from '@kerf/model';
import { formatDuration, formatTimecode } from '@kerf/model';
import { IconButton, Panel, cn } from '@kerf/ui';
import { SourcePreview } from '../analysis/SourcePreview';
import type { SourcePreviewHandle } from '../analysis/SourcePreview';
import { findSequenceFrame } from '../state/sequence-map';
import { useStudio } from '../state/StudioProvider';
import { SceneThumbnail } from './SceneThumbnail';

export interface ScenePanelProps {
  readonly assetId: string;
  readonly onClose: () => void;
}

const FALLBACK_RATE: FrameRate = { numerator: 24, denominator: 1 };

/**
 * Storyboard of the detected shots for one asset. Each card plays the source at
 * the shot's first frame and, when the asset is on the timeline, moves the
 * playhead to that moment.
 */
export function ScenePanel({ assetId, onClose }: ScenePanelProps) {
  const snapshot = useStudio((state) => state.snapshot);
  const revealAssetFrame = useStudio((state) => state.revealAssetFrame);

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

  const described = useMemo(
    () => scenes.filter((scene) => Boolean(scene.description?.trim())).length,
    [scenes],
  );

  const [currentFrame, setCurrentFrame] = useState(0);
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

  return (
    <Panel
      title="Scenes"
      subtitle={asset?.name ?? 'Unknown asset'}
      bodyClassName="flex min-h-0 flex-col p-0"
      actions={
        <IconButton
          label="Close scenes"
          tooltip="Close scenes"
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
          <ScanLine
            size={22}
            className="mx-auto text-ink-faint"
            aria-hidden="true"
          />
          <p className="text-[12px] text-ink-muted">No scenes yet</p>
          <span className="text-[10px] leading-relaxed text-ink-faint">
            Select the asset in the Footage bin and choose Scenes.
          </span>
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-auto p-1.5">
            <div className="grid grid-cols-2 gap-1.5">
              {scenes.map((scene) => {
                const active = scene.id === activeSceneId;
                return (
                  <button
                    key={scene.id}
                    type="button"
                    data-scene-card
                    data-active={active || undefined}
                    onClick={() => seek(scene)}
                    title="Play from the start of this shot"
                    className={cn(
                      'group overflow-hidden rounded-sm border bg-surface-0 text-left transition-colors duration-150 ease-k hover:border-line-strong focus-visible:outline-none',
                      active ? 'border-accent/50' : 'border-line',
                    )}
                  >
                    <div className="relative aspect-video overflow-hidden bg-black">
                      <SceneThumbnail scene={scene} />
                      <span className="absolute top-1 left-1 rounded-sm bg-black/70 px-1 py-px font-mono text-[8px] text-white/90">
                        #{scene.index + 1}
                      </span>
                      <span className="absolute right-1 bottom-1 rounded-sm bg-black/70 px-1 py-px font-mono text-[8px] text-white/90">
                        {formatDuration(
                          scene.endFrame - scene.startFrame,
                          rate,
                        )}
                      </span>
                    </div>
                    <div className="grid gap-0.5 px-1.5 py-1.5">
                      <span
                        className={cn(
                          'font-mono text-[8px]',
                          active ? 'text-accent-bright' : 'text-ink-faint',
                        )}
                      >
                        {formatTimecode(scene.startFrame, rate)}
                      </span>
                      <span className="line-clamp-2 text-[10px] leading-relaxed text-ink-muted">
                        {scene.description?.trim() || 'No description'}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <footer className="border-t border-line px-3 py-2 font-mono text-[8px] tracking-[0.04em] text-ink-faint uppercase">
            {scenes.length} {scenes.length === 1 ? 'shot' : 'shots'} ·{' '}
            {described} described
          </footer>
        </>
      )}
    </Panel>
  );
}
