import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  AudioLines,
  Copy,
  Eye,
  EyeOff,
  Film,
  Lock,
  LockOpen,
  Magnet,
  MousePointer2,
  Redo2,
  Scissors,
  Trash2,
  Undo2,
  Volume2,
  VolumeX,
  Waves,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { Clip, FrameRate, Track } from '@kerf/model';
import { formatDuration, fpsToNumber } from '@kerf/model';
import { sequenceDurationFrames, tracksInOrder } from '@kerf/engine';
import { Button, IconButton, cn } from '@kerf/ui';
import { useStudio } from '../state/StudioProvider';
import {
  assetForClip,
  deleteClipsCommand,
  duplicateClipsCommand,
  splitAtFrameCommand,
} from './clip-commands';

const HEADER_WIDTH = 112;

function timecodeLabel(frame: number, rate: FrameRate): string {
  return formatDuration(frame, rate);
}

function tickStepFrames(pixelsPerFrame: number, rate: FrameRate): number {
  const fps = fpsToNumber(rate);
  const wantedSeconds = Math.max(1, 84 / pixelsPerFrame / fps);
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
  const seconds = steps.find((step) => step >= wantedSeconds) ?? 7200;
  return Math.max(1, Math.round(seconds * fps));
}

function ClipBar({
  clip,
  track,
  selected,
  left,
  width,
  onSelect,
}: {
  readonly clip: Clip;
  readonly track: Track;
  readonly selected: boolean;
  readonly left: number;
  readonly width: number;
  readonly onSelect: (clip: Clip) => void;
}) {
  const assets = useStudio((state) => state.snapshot?.assets ?? []);
  const asset = assetForClip(clip, assets);
  const thumb =
    asset && (clip.type === 'video' || clip.type === 'image')
      ? `kerfmedia://asset/${encodeURIComponent(asset.id)}/thumbnail`
      : null;
  const waveform =
    asset && clip.type === 'audio'
      ? `kerfmedia://asset/${encodeURIComponent(asset.id)}/waveform`
      : null;
  const label = clip.label || clip.type;

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        'k-clip',
        `k-clip--${clip.type}`,
        selected && 'is-selected',
        clip.locked && 'is-locked',
        track.locked && 'is-track-locked',
      )}
      style={{
        left: `${left}px`,
        width: `${Math.max(3, width)}px`,
        backgroundImage: thumb
          ? `linear-gradient(90deg, color-mix(in srgb, var(--k-clip-color) 28%, transparent), color-mix(in srgb, var(--k-surface-2) 72%, transparent)), url("${thumb}")`
          : waveform
            ? `linear-gradient(90deg, color-mix(in srgb, var(--k-clip-color) 20%, transparent), color-mix(in srgb, var(--k-surface-2) 62%, transparent)), url("${waveform}")`
            : undefined,
        backgroundSize: thumb ? 'cover' : waveform ? '100% 100%' : undefined,
      }}
      title={`${label} · ${clip.durationFrames} frames`}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(clip);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(clip);
        }
      }}
    >
      <span className="k-clip__label">{label}</span>
    </div>
  );
}

function TrackHeader({ track }: { readonly track: Track }) {
  const apply = useStudio((state) => state.apply);
  const icon =
    track.kind === 'audio' ? (
      <AudioLines size={11} />
    ) : track.kind === 'caption' ? (
      <span className="font-mono text-[8px]">CC</span>
    ) : (
      <Film size={11} />
    );

  const update = (patch: Record<string, boolean>) => {
    void apply(
      {
        type: 'track.update',
        trackId: track.id,
        patch,
      },
      'Update track',
    );
  };

  return (
    <div
      className="k-track-head"
      data-kind={track.kind}
      style={{ height: track.height }}
    >
      <span className="k-track-head__dot" data-kind={track.kind}>
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate text-[10px] text-ink-muted">
        {track.name}
      </span>
      <div className="k-track-head__actions">
        <IconButton
          label={track.muted ? 'Unmute track' : 'Mute track'}
          size="sm"
          active={track.muted}
          icon={track.muted ? <VolumeX size={11} /> : <Volume2 size={11} />}
          onClick={() => update({ muted: !track.muted })}
        />
        <IconButton
          label={track.hidden ? 'Show track' : 'Hide track'}
          size="sm"
          active={track.hidden}
          icon={track.hidden ? <EyeOff size={11} /> : <Eye size={11} />}
          onClick={() => update({ hidden: !track.hidden })}
          disabled={track.kind === 'audio'}
        />
        <IconButton
          label={track.locked ? 'Unlock track' : 'Lock track'}
          size="sm"
          active={track.locked}
          icon={track.locked ? <Lock size={11} /> : <LockOpen size={11} />}
          onClick={() => update({ locked: !track.locked })}
        />
      </div>
    </div>
  );
}

export function Timeline() {
  const snapshot = useStudio((state) => state.snapshot);
  const selection = useStudio((state) => state.selection);
  const playhead = useStudio((state) => state.playhead);
  const pixelsPerFrame = useStudio((state) => state.pixelsPerFrame);
  const snapEnabled = useStudio((state) => state.snapEnabled);
  const tool = useStudio((state) => state.tool);
  const apply = useStudio((state) => state.apply);
  const undo = useStudio((state) => state.undo);
  const redo = useStudio((state) => state.redo);
  const selectClip = useStudio((state) => state.selectClip);
  const setPlayhead = useStudio((state) => state.setPlayhead);
  const setPixelsPerFrame = useStudio((state) => state.setPixelsPerFrame);
  const zoomBy = useStudio((state) => state.zoomBy);
  const toggleSnap = useStudio((state) => state.toggleSnap);
  const toggleRipple = useStudio((state) => state.toggleRipple);
  const rippleEnabled = useStudio((state) => state.rippleEnabled);
  const setTool = useStudio((state) => state.setTool);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(900);
  const [scrubbing, setScrubbing] = useState(false);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        setViewportWidth(entry.contentRect.width);
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const sequence = snapshot?.project.sequence;
  const tracks = useMemo(
    () => (sequence ? tracksInOrder(sequence) : []),
    [sequence],
  );
  const rate = sequence?.frameRate ?? { numerator: 24, denominator: 1 };
  const duration = sequence
    ? Math.max(
        sequenceDurationFrames(sequence),
        Math.round(fpsToNumber(rate) * 10),
      )
    : Math.round(fpsToNumber(rate) * 10);
  const contentWidth = Math.max(
    viewportWidth - HEADER_WIDTH,
    duration * pixelsPerFrame + 120,
  );
  const stepFrames = tickStepFrames(pixelsPerFrame, rate);
  const ticks = useMemo(() => {
    const next: number[] = [];
    for (let frame = 0; frame <= duration; frame += stepFrames) {
      next.push(frame);
    }
    return next;
  }, [duration, stepFrames]);

  const selectedIds = selection.clipIds;
  const selectedSet = new Set(selectedIds);

  const scrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setPlayhead((event.clientX - rect.left) / pixelsPerFrame);
  };

  const fit = () => {
    if (!sequence || viewportWidth <= HEADER_WIDTH) {
      return;
    }
    const visibleFrames = Math.max(1, sequenceDurationFrames(sequence));
    setPixelsPerFrame((viewportWidth - HEADER_WIDTH - 48) / visibleFrames);
  };

  const split = () => {
    if (!sequence) {
      return;
    }
    const command = splitAtFrameCommand(sequence, playhead, selectedIds);
    if (command) {
      void apply(command, 'Split at playhead');
    }
  };

  const remove = () => {
    if (!sequence || selectedIds.length === 0) {
      return;
    }
    const command = deleteClipsCommand(sequence, selectedIds, rippleEnabled);
    if (command) {
      void apply(command, rippleEnabled ? 'Ripple delete' : 'Delete clips');
    }
  };

  const duplicate = () => {
    if (!sequence || selectedIds.length === 0) {
      return;
    }
    const command = duplicateClipsCommand(sequence, selectedIds);
    if (command) {
      void apply(command, 'Duplicate clips');
    }
  };

  if (!sequence) {
    return null;
  }

  return (
    <section className="k-timeline" aria-label="Timeline">
      <div className="k-timeline__toolbar">
        <div className="k-timeline__tools">
          <IconButton
            label="Select tool"
            size="sm"
            tooltip="Select (V)"
            active={tool === 'select'}
            icon={<MousePointer2 size={14} />}
            onClick={() => setTool('select')}
          />
          <IconButton
            label="Blade tool"
            size="sm"
            tooltip="Split at playhead (⌘K)"
            active={tool === 'blade'}
            icon={<Scissors size={14} />}
            onClick={() => {
              setTool('blade');
              split();
            }}
          />
          <span className="k-timeline__divider" aria-hidden="true" />
          <IconButton
            label="Split at playhead"
            size="sm"
            tooltip="Split at playhead (⌘K)"
            icon={<Scissors size={13} />}
            onClick={split}
          />
          <IconButton
            label="Duplicate selected clips"
            size="sm"
            tooltip="Duplicate (⌘D)"
            icon={<Copy size={13} />}
            disabled={selectedIds.length === 0}
            onClick={duplicate}
          />
          <IconButton
            label="Delete selected clips"
            size="sm"
            tooltip="Delete (⌫)"
            icon={<Trash2 size={13} />}
            disabled={selectedIds.length === 0}
            onClick={remove}
          />
          <span className="k-timeline__divider" aria-hidden="true" />
          <IconButton
            label="Snapping"
            size="sm"
            tooltip={snapEnabled ? 'Snapping on (N)' : 'Snapping off (N)'}
            active={snapEnabled}
            icon={<Magnet size={14} />}
            onClick={toggleSnap}
          />
          <IconButton
            label="Ripple editing"
            size="sm"
            tooltip={rippleEnabled ? 'Ripple on' : 'Ripple off'}
            active={rippleEnabled}
            icon={<Waves size={14} />}
            onClick={toggleRipple}
          />
        </div>

        <div className="k-timeline__tools">
          <IconButton
            label="Undo"
            size="sm"
            tooltip="Undo (⌘Z)"
            icon={<Undo2 size={13} />}
            disabled={!snapshot?.history.canUndo}
            onClick={() => void undo()}
          />
          <IconButton
            label="Redo"
            size="sm"
            tooltip="Redo (⇧⌘Z)"
            icon={<Redo2 size={13} />}
            disabled={!snapshot?.history.canRedo}
            onClick={() => void redo()}
          />
          <span className="k-timeline__divider" aria-hidden="true" />
          <IconButton
            label="Fit timeline"
            size="sm"
            tooltip="Fit sequence"
            icon={<span className="font-mono text-[8px]">FIT</span>}
            onClick={fit}
          />
          <IconButton
            label="Zoom out"
            size="sm"
            icon={<ZoomOut size={13} />}
            onClick={() => zoomBy(1 / 1.25)}
          />
          <span className="k-timeline__zoom-label">
            {Math.round(pixelsPerFrame * 100)}%
          </span>
          <IconButton
            label="Zoom in"
            size="sm"
            icon={<ZoomIn size={13} />}
            onClick={() => zoomBy(1.25)}
          />
        </div>
      </div>

      <div className="k-timeline__scroll" ref={scrollRef}>
        <div
          className="k-timeline__grid"
          style={{ minWidth: `${HEADER_WIDTH + contentWidth}px` }}
        >
          <div className="k-timeline__row k-timeline__row--ruler">
            <div className="k-timeline__corner" aria-hidden="true" />
            <div
              className="k-timeline__ruler"
              style={{ width: `${contentWidth}px` }}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                setScrubbing(true);
                scrub(event);
              }}
              onPointerMove={(event) => {
                if (scrubbing) {
                  scrub(event);
                }
              }}
              onPointerUp={(event) => {
                event.currentTarget.releasePointerCapture(event.pointerId);
                setScrubbing(false);
              }}
              onPointerCancel={() => setScrubbing(false)}
            >
              {ticks.map((frame) => (
                <span
                  key={frame}
                  className="k-timeline__tick"
                  style={{
                    left: `${frame * pixelsPerFrame}px`,
                    width: `${stepFrames * pixelsPerFrame}px`,
                  }}
                >
                  {timecodeLabel(frame, rate)}
                </span>
              ))}
              <span
                className="k-ruler-playhead"
                style={{ left: `${playhead * pixelsPerFrame}px` }}
              />
            </div>
          </div>

          {tracks.map((track) => (
            <div
              key={track.id}
              className="k-timeline__row"
              style={{
                gridTemplateColumns: `${HEADER_WIDTH}px ${contentWidth}px`,
              }}
            >
              <TrackHeader track={track} />
              <div
                className={cn(
                  'k-track-lane',
                  track.hidden && 'is-hidden',
                  track.locked && 'is-locked',
                )}
                data-track-id={track.id}
                data-track-kind={track.kind}
                style={{
                  height: track.height,
                  backgroundSize: `${stepFrames * pixelsPerFrame}px 100%`,
                }}
              >
                {track.clips.map((clip) => (
                  <ClipBar
                    key={clip.id}
                    clip={clip}
                    track={track}
                    selected={selectedSet.has(clip.id)}
                    left={clip.startFrame * pixelsPerFrame}
                    width={clip.durationFrames * pixelsPerFrame}
                    onSelect={(next) => selectClip(next.id)}
                  />
                ))}
                <span
                  className="k-lane-playhead"
                  style={{ left: `${playhead * pixelsPerFrame}px` }}
                  aria-hidden="true"
                />
              </div>
            </div>
          ))}

          {tracks.every((track) => track.clips.length === 0) ? (
            <div className="k-timeline__empty">
              <Film size={20} aria-hidden="true" />
              <p>No clips on the timeline</p>
              <span>Drag footage from the bin, or press ⌘I to import.</span>
            </div>
          ) : null}
        </div>
      </div>

      {selectedIds.length > 1 ? (
        <div className="k-timeline__selection">
          {selectedIds.length} clips selected
          <Button
            variant="ghost"
            size="sm"
            onClick={() => selectClip(selectedIds[0] ?? '')}
          >
            Clear
          </Button>
        </div>
      ) : null}
    </section>
  );
}
