import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  DragEvent as ReactDragEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import {
  ArrowDown,
  ArrowUp,
  AudioLines,
  Check,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Eye,
  EyeOff,
  Film,
  Flag,
  Lock,
  LockOpen,
  Magnet,
  MousePointer2,
  Plus,
  Redo2,
  Scissors,
  Trash2,
  Undo2,
  Unlink,
  Volume2,
  VolumeX,
  Wand2,
  Waves,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type {
  Asset,
  Clip,
  FrameRate,
  Marker,
  Track,
  TrackKind,
} from '@kerf/model';
import { formatDuration, fpsToNumber, secondsToFrames } from '@kerf/model';
import {
  findClip,
  isClipCompatible,
  snapStart,
  timelineDurationFrames,
  tracksInOrder,
} from '@kerf/engine';
import { Button, IconButton, Input, cn } from '@kerf/ui';
import { useStudio } from '../state/StudioProvider';
import { useEditorCommands } from '../commands/editor-commands';
import { ASSET_DRAG_MIME } from '../drag';
import { assetForClip, insertAssetCommand } from './clip-commands';
import { clipsInWindow, visibleFrameWindow } from './windowing';

const HEADER_WIDTH = 112;
const SNAP_PIXELS = 7;
const EMPTY_ASSETS: readonly Asset[] = Object.freeze([]);

const OVERLAY_LABELS = {
  blur: 'Blur',
  callout: 'Callout',
  spotlight: 'Spotlight',
  zoom: 'Zoom',
} as const;

interface ClipStack {
  readonly row: number;
  readonly rows: number;
}

/**
 * Overlapping overlays share one Effects lane, so assign each clip the first
 * free row and give every clip in that lane the same row count.
 */
function stackLayout(tracks: readonly Track[]): Map<string, ClipStack> {
  const layout = new Map<string, ClipStack>();
  for (const track of tracks) {
    if (track.kind !== 'effects' || track.clips.length === 0) {
      continue;
    }
    const ordered = [...track.clips].sort(
      (left, right) =>
        left.startFrame - right.startFrame || left.id.localeCompare(right.id),
    );
    const rowEnds: number[] = [];
    const rowsById = new Map<string, number>();
    for (const clip of ordered) {
      let row = rowEnds.findIndex((end) => end <= clip.startFrame);
      if (row === -1) {
        row = rowEnds.length;
      }
      rowEnds[row] = clip.startFrame + clip.durationFrames;
      rowsById.set(clip.id, row);
    }
    const rows = Math.max(1, rowEnds.length);
    for (const [id, row] of rowsById) {
      layout.set(id, { row, rows });
    }
  }
  return layout;
}

function clampNumber(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

type TimelineMenu =
  | {
      readonly kind: 'clip';
      readonly x: number;
      readonly y: number;
      readonly clipId: string;
    }
  | {
      readonly kind: 'track';
      readonly x: number;
      readonly y: number;
      readonly trackId: string;
    }
  | {
      readonly kind: 'marker';
      readonly x: number;
      readonly y: number;
      readonly markerId: string;
    }
  | {
      readonly kind: 'add-track';
      readonly x: number;
      readonly y: number;
    };

type DragKind = 'move' | 'trim-in' | 'trim-out';

interface DragState {
  readonly kind: DragKind;
  readonly clipId: string;
  readonly originalTrackId: string;
  readonly originalStart: number;
  readonly originalDuration: number;
  readonly startClientX: number;
  readonly currentTrackId: string;
  readonly currentStart: number;
  readonly currentDuration: number;
  readonly snapFrame: number | null;
}

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
  dragging,
  left,
  width,
  stack,
  onSelect,
  onBeginDrag,
  onContextMenu,
}: {
  readonly clip: Clip;
  readonly track: Track;
  readonly selected: boolean;
  readonly dragging: boolean;
  readonly left: number;
  readonly width: number;
  readonly stack?: ClipStack;
  readonly onSelect: (clip: Clip) => void;
  readonly onBeginDrag: (
    event: ReactPointerEvent<HTMLElement>,
    kind: DragKind,
  ) => void;
  readonly onContextMenu: (
    event: ReactMouseEvent<HTMLElement>,
    clip: Clip,
  ) => void;
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
  const sequence = useStudio((state) => state.snapshot?.project.sequence);
  const linked =
    clip.type === 'fxOverlay' && clip.linkedItemId && sequence
      ? findClip(sequence, clip.linkedItemId)?.clip
      : null;
  const label =
    clip.type === 'fxOverlay'
      ? `${OVERLAY_LABELS[clip.props.kind]}${
          linked ? ` · ${linked.label || linked.type}` : ''
        }`
      : clip.label || clip.type;
  const stacked = stack !== undefined && stack.rows > 1;
  const laneHeight = Math.max(1, track.height - 8);
  const rowHeight = stacked ? laneHeight / stack.rows : laneHeight;

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        'k-clip',
        `k-clip--${clip.type}`,
        selected && 'is-selected',
        dragging && 'is-dragging',
        clip.locked && 'is-locked',
        track.locked && 'is-track-locked',
      )}
      style={{
        left: `${left}px`,
        width: `${Math.max(3, width)}px`,
        top: stacked ? `${4 + stack.row * rowHeight}px` : undefined,
        bottom: stacked ? 'auto' : undefined,
        height: stacked ? `${Math.max(8, rowHeight - 2)}px` : undefined,
        backgroundImage: thumb
          ? `linear-gradient(90deg, color-mix(in srgb, var(--k-clip-color) 28%, transparent), color-mix(in srgb, var(--k-surface-2) 72%, transparent)), url("${thumb}")`
          : waveform
            ? `linear-gradient(90deg, color-mix(in srgb, var(--k-clip-color) 20%, transparent), color-mix(in srgb, var(--k-surface-2) 62%, transparent)), url("${waveform}")`
            : undefined,
        backgroundSize: thumb ? 'cover' : waveform ? '100% 100%' : undefined,
      }}
      title={`${label} · ${clip.durationFrames} frames`}
      onPointerDown={(event) => onBeginDrag(event, 'move')}
      onContextMenu={(event) => onContextMenu(event, clip)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(clip);
        }
      }}
    >
      <span className="k-clip__label">{label}</span>
      <span
        className="k-clip__handle k-clip__handle--in"
        aria-hidden="true"
        onPointerDown={(event) => {
          event.stopPropagation();
          onBeginDrag(event, 'trim-in');
        }}
      />
      <span
        className="k-clip__handle k-clip__handle--out"
        aria-hidden="true"
        onPointerDown={(event) => {
          event.stopPropagation();
          onBeginDrag(event, 'trim-out');
        }}
      />
    </div>
  );
}

function TrackHeader({
  track,
  onContextMenu,
}: {
  readonly track: Track;
  readonly onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
}) {
  const apply = useStudio((state) => state.apply);
  const icon =
    track.kind === 'audio' ? (
      <AudioLines size={11} />
    ) : track.kind === 'caption' ? (
      <span className="font-mono text-[8px]">CC</span>
    ) : track.kind === 'effects' ? (
      <Wand2 size={11} />
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
      onContextMenu={onContextMenu}
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

function MarkerMenu({
  marker,
  x,
  y,
  onClose,
}: {
  readonly marker: Marker;
  readonly x: number;
  readonly y: number;
  readonly onClose: () => void;
}) {
  const apply = useStudio((state) => state.apply);
  const setPlayhead = useStudio((state) => state.setPlayhead);
  const rate = useStudio((state) => state.snapshot?.project.sequence.frameRate);
  const [label, setLabel] = useState(marker.label);

  const save = () => {
    if (label !== marker.label) {
      void apply(
        {
          type: 'marker.update',
          markerId: marker.id,
          patch: { label },
        },
        'Rename marker',
      );
    }
    onClose();
  };

  return (
    <div
      className="k-context-menu"
      style={{
        left: `${Math.min(x, window.innerWidth - 220)}px`,
        top: `${Math.min(y, window.innerHeight - 210)}px`,
      }}
      role="menu"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="k-context-menu__label">
        Marker · {rate ? timecodeLabel(marker.frame, rate) : marker.frame}
      </div>
      <div className="k-context-menu__field">
        <Input
          value={label}
          aria-label="Marker label"
          placeholder="Marker label"
          className="h-7"
          autoFocus
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setLabel(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              save();
            } else if (event.key === 'Escape') {
              onClose();
            }
          }}
        />
      </div>
      <button type="button" role="menuitem" onClick={save}>
        <Check size={13} />
        Save label
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          setPlayhead(marker.frame);
          onClose();
        }}
      >
        <Flag size={13} />
        Go to marker
      </button>
      <span className="k-context-menu__rule" />
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          void apply(
            { type: 'marker.remove', markerId: marker.id },
            'Delete marker',
          );
          onClose();
        }}
      >
        <Trash2 size={13} />
        Delete marker
      </button>
    </div>
  );
}

export function Timeline() {
  const sequence = useStudio(
    (state) => state.snapshot?.project.sequence ?? null,
  );
  const projectAssets = useStudio(
    (state) => state.snapshot?.assets ?? EMPTY_ASSETS,
  );
  const history = useStudio((state) => state.snapshot?.history);
  const selection = useStudio((state) => state.selection);
  const playhead = useStudio((state) => state.playhead);
  const pixelsPerFrame = useStudio((state) => state.pixelsPerFrame);
  const snapEnabled = useStudio((state) => state.snapEnabled);
  const tool = useStudio((state) => state.tool);
  const apply = useStudio((state) => state.apply);
  const undo = useStudio((state) => state.undo);
  const redo = useStudio((state) => state.redo);
  const selectClip = useStudio((state) => state.selectClip);
  const pushToast = useStudio((state) => state.pushToast);
  const commands = useEditorCommands();
  const setPlayhead = useStudio((state) => state.setPlayhead);
  const setPixelsPerFrame = useStudio((state) => state.setPixelsPerFrame);
  const zoomBy = useStudio((state) => state.zoomBy);
  const toggleSnap = useStudio((state) => state.toggleSnap);
  const toggleRipple = useStudio((state) => state.toggleRipple);
  const rippleEnabled = useStudio((state) => state.rippleEnabled);
  const setTool = useStudio((state) => state.setTool);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(900);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);
  const dragRef = useRef<DragState | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [menu, setMenu] = useState<TimelineMenu | null>(null);
  const [dropTrackId, setDropTrackId] = useState<string | null>(null);

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

  useEffect(() => {
    const clearDrop = () => setDropTrackId(null);
    window.addEventListener('dragend', clearDrop);
    window.addEventListener('drop', clearDrop);
    return () => {
      window.removeEventListener('dragend', clearDrop);
      window.removeEventListener('drop', clearDrop);
    };
  }, []);

  const tracks = useMemo(
    () => (sequence ? tracksInOrder(sequence) : []),
    [sequence],
  );
  const stacks = useMemo(() => stackLayout(tracks), [tracks]);
  const rate = sequence?.frameRate ?? { numerator: 24, denominator: 1 };
  const duration = sequence
    ? Math.max(
        timelineDurationFrames(sequence),
        ...sequence.markers.map((marker) => marker.frame + 1),
        Math.round(fpsToNumber(rate) * 10),
      )
    : Math.round(fpsToNumber(rate) * 10);
  const contentWidth = Math.max(
    viewportWidth - HEADER_WIDTH,
    duration * pixelsPerFrame + 120,
  );
  const stepFrames = tickStepFrames(pixelsPerFrame, rate);
  const clipWindow = useMemo(
    () =>
      visibleFrameWindow(
        scrollLeft,
        Math.max(1, viewportWidth - HEADER_WIDTH),
        pixelsPerFrame,
      ),
    [pixelsPerFrame, scrollLeft, viewportWidth],
  );
  const ticks = useMemo(() => {
    const next: number[] = [];
    const first = Math.max(
      0,
      Math.floor(clipWindow.startFrame / stepFrames) * stepFrames,
    );
    for (
      let frame = first;
      frame <= Math.min(duration, clipWindow.endFrame);
      frame += stepFrames
    ) {
      next.push(frame);
    }
    return next;
  }, [clipWindow, duration, stepFrames]);

  const selectedIds = selection.clipIds;
  const selectedSet = new Set(selectedIds);

  useEffect(() => {
    if (!sequence) {
      return;
    }

    const cancelDrag = () => {
      if (!dragRef.current) {
        return;
      }
      dragRef.current = null;
      setDrag(null);
      document.body.style.userSelect = '';
    };

    const commitDrag = (current: DragState) => {
      if (current.kind === 'move') {
        if (
          current.currentStart !== current.originalStart ||
          current.currentTrackId !== current.originalTrackId
        ) {
          void apply(
            {
              type: 'clip.move',
              clipId: current.clipId as Clip['id'],
              trackId: current.currentTrackId as Track['id'],
              startFrame: current.currentStart,
            },
            'Move clip',
          );
        }
      } else if (current.kind === 'trim-in') {
        const frames = current.currentStart - current.originalStart;
        if (frames !== 0) {
          void apply(
            {
              type: 'clip.trim',
              clipId: current.clipId as Clip['id'],
              edge: 'in',
              frames,
            },
            'Trim clip in',
          );
        }
      } else {
        const frames = current.currentDuration - current.originalDuration;
        if (frames !== 0) {
          void apply(
            {
              type: 'clip.trim',
              clipId: current.clipId as Clip['id'],
              edge: 'out',
              frames,
            },
            'Trim clip out',
          );
        }
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      const current = dragRef.current;
      if (!current) {
        return;
      }
      event.preventDefault();
      const location = findClip(sequence, current.clipId);
      if (!location) {
        cancelDrag();
        return;
      }
      const clip = location.clip;
      const asset = assetForClip(clip, projectAssets);
      const mediaClip = clip.type === 'video' || clip.type === 'audio';
      const sourceStart = mediaClip ? clip.sourceInFrame : 0;
      const sourceLimit =
        asset && mediaClip
          ? Math.max(1, secondsToFrames(asset.durationSeconds, rate, 'floor'))
          : null;
      const delta = Math.round(
        (event.clientX - current.startClientX) / pixelsPerFrame,
      );
      const thresholdFrames = SNAP_PIXELS / pixelsPerFrame;
      const snap = (
        startFrame: number,
        durationFrames: number,
        trackId: string,
        edge: 'in' | 'out' | 'both',
      ) => {
        if (!snapEnabled) {
          return {
            startFrame,
            snapFrame: null as number | null,
          };
        }
        const result = snapStart({
          sequence,
          startFrame,
          durationFrames,
          thresholdFrames,
          includeClipEdges: true,
          includeMarkers: true,
          includePlayhead: true,
          includeZero: true,
          trackId,
          ignoreClipId: clip.id,
          playhead,
        });
        if (result.edge === null) {
          return { startFrame, snapFrame: null };
        }
        if (edge !== 'both' && result.edge !== edge) {
          return { startFrame, snapFrame: null };
        }
        return {
          startFrame: result.startFrame,
          snapFrame: result.candidate?.frame ?? null,
        };
      };

      if (current.kind === 'move') {
        let targetTrackId = current.originalTrackId;
        const lane = (
          document.elementFromPoint(
            event.clientX,
            event.clientY,
          ) as HTMLElement | null
        )?.closest<HTMLElement>('[data-track-id]');
        const candidateTrack = lane
          ? sequence.tracks.find((track) => track.id === lane.dataset.trackId)
          : undefined;
        if (
          candidateTrack &&
          !candidateTrack.locked &&
          isClipCompatible(candidateTrack.kind, clip.type)
        ) {
          targetTrackId = candidateTrack.id;
        }
        const rawStart = Math.max(0, current.originalStart + delta);
        const snapped = snap(
          rawStart,
          current.originalDuration,
          targetTrackId,
          'both',
        );
        const next: DragState = {
          ...current,
          currentStart: Math.max(0, snapped.startFrame),
          currentDuration: current.originalDuration,
          currentTrackId: targetTrackId,
          snapFrame: snapped.snapFrame,
        };
        dragRef.current = next;
        setDrag(next);
        return;
      }

      if (current.kind === 'trim-in') {
        const minimumFrames = Math.max(-current.originalStart, -sourceStart);
        let frames = clampNumber(
          delta,
          minimumFrames,
          current.originalDuration - 1,
        );
        let newStart = current.originalStart + frames;
        let newDuration = current.originalDuration - frames;
        const snapped = snap(
          newStart,
          newDuration,
          current.originalTrackId,
          'in',
        );
        if (snapped.snapFrame !== null) {
          newStart = Math.max(
            current.originalStart + minimumFrames,
            snapped.startFrame,
          );
          frames = newStart - current.originalStart;
          newDuration = current.originalDuration - frames;
        }
        const next: DragState = {
          ...current,
          currentStart: newStart,
          currentDuration: newDuration,
          currentTrackId: current.originalTrackId,
          snapFrame: snapped.snapFrame,
        };
        dragRef.current = next;
        setDrag(next);
        return;
      }

      const maximumDuration =
        sourceLimit !== null
          ? Math.max(1, sourceLimit - sourceStart)
          : Number.POSITIVE_INFINITY;
      let newDuration = clampNumber(
        current.originalDuration + delta,
        1,
        maximumDuration,
      );
      const snapped = snap(
        current.originalStart,
        newDuration,
        current.originalTrackId,
        'out',
      );
      if (snapped.snapFrame !== null) {
        newDuration = clampNumber(
          snapped.startFrame + newDuration - current.originalStart,
          1,
          maximumDuration,
        );
      }
      const next: DragState = {
        ...current,
        currentStart: current.originalStart,
        currentDuration: newDuration,
        currentTrackId: current.originalTrackId,
        snapFrame: snapped.snapFrame,
      };
      dragRef.current = next;
      setDrag(next);
    };

    const onPointerUp = () => {
      const current = dragRef.current;
      if (!current) {
        return;
      }
      dragRef.current = null;
      setDrag(null);
      document.body.style.userSelect = '';
      commitDrag(current);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        cancelDrag();
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', cancelDrag);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', cancelDrag);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [
    apply,
    pixelsPerFrame,
    playhead,
    projectAssets,
    rate,
    sequence,
    snapEnabled,
  ]);

  useEffect(() => {
    if (!menu) {
      return;
    }
    const close = () => setMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
      }
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [menu]);

  const beginDrag = (
    clip: Clip,
    track: Track,
    event: ReactPointerEvent<HTMLElement>,
    kind: DragKind,
  ) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.shiftKey) {
      selectClip(clip.id, true);
    } else if (!selectedSet.has(clip.id)) {
      selectClip(clip.id);
    }
    if (track.locked || clip.locked) {
      return;
    }
    const next: DragState = {
      kind,
      clipId: clip.id,
      originalTrackId: track.id,
      originalStart: clip.startFrame,
      originalDuration: clip.durationFrames,
      startClientX: event.clientX,
      currentTrackId: track.id,
      currentStart: clip.startFrame,
      currentDuration: clip.durationFrames,
      snapFrame: null,
    };
    dragRef.current = next;
    setDrag(next);
    document.body.style.userSelect = 'none';
  };

  const scrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setPlayhead((event.clientX - rect.left) / pixelsPerFrame);
  };

  const fit = () => {
    if (!sequence || viewportWidth <= HEADER_WIDTH) {
      return;
    }
    const visibleFrames = Math.max(1, timelineDurationFrames(sequence));
    setPixelsPerFrame((viewportWidth - HEADER_WIDTH - 48) / visibleFrames);
  };

  const split = () => commands.split();

  const remove = (ripple = rippleEnabled) => commands.deleteSelected(ripple);

  const duplicate = () => commands.duplicateSelected();

  const addTrack = (kind: TrackKind) => {
    commands.addTrack(kind);
    setMenu(null);
  };

  const addMarker = () => commands.addMarker();

  const removeTrack = (track: Track) => {
    void apply({ type: 'track.remove', trackId: track.id }, 'Remove track');
    setMenu(null);
  };

  const moveTrack = (track: Track, direction: -1 | 1) => {
    const index = tracks.findIndex((candidate) => candidate.id === track.id);
    const toIndex = index + direction;
    if (index < 0 || toIndex < 0 || toIndex >= tracks.length) {
      return;
    }
    void apply(
      { type: 'track.reorder', trackId: track.id, toIndex },
      'Reorder track',
    );
    setMenu(null);
  };

  const dropAsset = async (
    event: ReactDragEvent<HTMLDivElement>,
    track: Track,
  ) => {
    event.preventDefault();
    setDropTrackId(null);
    if (!sequence) {
      return;
    }
    const assetId = event.dataTransfer.getData(ASSET_DRAG_MIME);
    const asset = projectAssets.find((candidate) => candidate.id === assetId);
    if (!asset || asset.status !== 'ready') {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const rawFrame = Math.max(
      0,
      Math.round((event.clientX - rect.left) / pixelsPerFrame),
    );
    const frame =
      snapEnabled &&
      Math.abs(rawFrame - playhead) * pixelsPerFrame <= SNAP_PIXELS
        ? playhead
        : rawFrame;
    const command = insertAssetCommand(asset, sequence, track.id, frame);
    if (!command) {
      pushToast({
        title: 'Cannot add footage here',
        description: track.locked
          ? `Unlock ${track.name} before dropping footage.`
          : `${asset.kind} footage does not fit the ${track.kind} track.`,
        tone: 'warning',
      });
      return;
    }
    const result = await apply(command, 'Insert footage');
    if (result) {
      const inserted =
        command.type === 'batch'
          ? command.commands.find((item) => item.type === 'clip.insert')
          : command;
      if (inserted?.type === 'clip.insert') {
        selectClip(inserted.clip.id);
      }
    }
  };

  if (!sequence) {
    return null;
  }

  const menuClip =
    menu?.kind === 'clip' ? findClip(sequence, menu.clipId)?.clip : null;
  const canSplit =
    menuClip != null &&
    menuClip.startFrame < playhead &&
    playhead < menuClip.startFrame + menuClip.durationFrames;
  const trackMenuTrack =
    menu?.kind === 'track'
      ? sequence.tracks.find((track) => track.id === menu.trackId)
      : null;
  const trackMenuIndex = trackMenuTrack
    ? tracks.findIndex((track) => track.id === trackMenuTrack.id)
    : -1;
  const markerMenuMarker =
    menu?.kind === 'marker'
      ? sequence.markers.find((marker) => marker.id === menu.markerId)
      : null;

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
            tooltip="Blade tool (B)"
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
            tooltip="Split at playhead (⌘B)"
            icon={<Scissors size={13} />}
            onClick={split}
          />
          <IconButton
            label="Duplicate selected clips"
            size="sm"
            tooltip="Duplicate (⌘D)"
            icon={<CopyPlus size={13} />}
            disabled={selectedIds.length === 0}
            onClick={duplicate}
          />
          <IconButton
            label="Delete selected clips"
            size="sm"
            tooltip="Delete (⌫)"
            icon={<Trash2 size={13} />}
            disabled={selectedIds.length === 0}
            onClick={() => remove()}
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
          <span className="k-timeline__divider" aria-hidden="true" />
          <IconButton
            label="Add marker"
            size="sm"
            tooltip="Add marker at playhead"
            icon={<Flag size={13} />}
            onClick={addMarker}
          />
          <IconButton
            label="Add track"
            size="sm"
            tooltip="Add track"
            icon={<Plus size={13} />}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              setMenu({
                kind: 'add-track',
                x: rect.left,
                y: rect.bottom + 4,
              });
            }}
          />
        </div>

        <div className="k-timeline__tools">
          <IconButton
            label="Undo"
            size="sm"
            tooltip="Undo (⌘Z)"
            icon={<Undo2 size={13} />}
            disabled={!history?.canUndo}
            onClick={() => void undo()}
          />
          <IconButton
            label="Redo"
            size="sm"
            tooltip="Redo (⇧⌘Z)"
            icon={<Redo2 size={13} />}
            disabled={!history?.canRedo}
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

      <div
        className="k-timeline__scroll"
        ref={scrollRef}
        onScroll={(event) => setScrollLeft(event.currentTarget.scrollLeft)}
      >
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
              {sequence.markers
                .filter(
                  (marker) =>
                    marker.frame >= clipWindow.startFrame &&
                    marker.frame <= clipWindow.endFrame,
                )
                .map((marker) => (
                  <button
                    key={marker.id}
                    type="button"
                    className={cn(
                      'k-ruler-marker',
                      menu?.kind === 'marker' &&
                        menu.markerId === marker.id &&
                        'is-selected',
                    )}
                    style={{ left: `${marker.frame * pixelsPerFrame}px` }}
                    title={`${marker.label || 'Marker'} · ${timecodeLabel(marker.frame, rate)}`}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      setPlayhead(marker.frame);
                    }}
                    onDoubleClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setMenu({
                        kind: 'marker',
                        x: event.clientX,
                        y: event.clientY,
                        markerId: marker.id,
                      });
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setMenu({
                        kind: 'marker',
                        x: event.clientX,
                        y: event.clientY,
                        markerId: marker.id,
                      });
                    }}
                  >
                    <Flag size={9} aria-hidden="true" />
                    <span>
                      {marker.label || timecodeLabel(marker.frame, rate)}
                    </span>
                  </button>
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
              <TrackHeader
                track={track}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setMenu({
                    kind: 'track',
                    x: event.clientX,
                    y: event.clientY,
                    trackId: track.id,
                  });
                }}
              />
              <div
                className={cn(
                  'k-track-lane',
                  track.hidden && 'is-hidden',
                  track.locked && 'is-locked',
                  dropTrackId === track.id && 'is-drop-target',
                )}
                data-track-id={track.id}
                data-track-kind={track.kind}
                style={{
                  height: track.height,
                  backgroundSize: `${stepFrames * pixelsPerFrame}px 100%`,
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setMenu({
                    kind: 'track',
                    x: event.clientX,
                    y: event.clientY,
                    trackId: track.id,
                  });
                }}
                onDragOver={(event) => {
                  if (
                    track.locked ||
                    !event.dataTransfer.types.includes(ASSET_DRAG_MIME)
                  ) {
                    return;
                  }
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'copy';
                  setDropTrackId((current) =>
                    current === track.id ? current : track.id,
                  );
                }}
                onDragLeave={(event) => {
                  const next = event.relatedTarget;
                  if (
                    next instanceof Node &&
                    event.currentTarget.contains(next)
                  ) {
                    return;
                  }
                  setDropTrackId((current) =>
                    current === track.id ? null : current,
                  );
                }}
                onDrop={(event) => {
                  void dropAsset(event, track);
                }}
              >
                {clipsInWindow(track.clips, clipWindow).map((clip) => (
                  <ClipBar
                    key={clip.id}
                    clip={clip}
                    track={track}
                    selected={selectedSet.has(clip.id)}
                    dragging={drag?.clipId === clip.id}
                    left={clip.startFrame * pixelsPerFrame}
                    width={clip.durationFrames * pixelsPerFrame}
                    stack={stacks.get(clip.id)}
                    onSelect={(next) => selectClip(next.id)}
                    onBeginDrag={(event, kind) =>
                      beginDrag(clip, track, event, kind)
                    }
                    onContextMenu={(event, next) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (!selectedSet.has(next.id)) {
                        selectClip(next.id);
                      }
                      setMenu({
                        kind: 'clip',
                        x: event.clientX,
                        y: event.clientY,
                        clipId: next.id,
                      });
                    }}
                  />
                ))}
                {drag && drag.currentTrackId === track.id ? (
                  <span
                    className="k-clip-ghost"
                    style={{
                      left: `${drag.currentStart * pixelsPerFrame}px`,
                      width: `${Math.max(3, drag.currentDuration * pixelsPerFrame)}px`,
                    }}
                    aria-hidden="true"
                  />
                ) : null}
                <span
                  className="k-lane-playhead"
                  style={{ left: `${playhead * pixelsPerFrame}px` }}
                  aria-hidden="true"
                />
              </div>
            </div>
          ))}

          {drag?.snapFrame != null ? (
            <span
              className="k-timeline__snap"
              style={{
                left: `${HEADER_WIDTH + drag.snapFrame * pixelsPerFrame}px`,
              }}
              aria-hidden="true"
            />
          ) : null}

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

      {menu?.kind === 'clip' ? (
        <div
          className="k-context-menu"
          style={{
            left: `${Math.min(menu.x, window.innerWidth - 220)}px`,
            top: `${Math.min(menu.y, window.innerHeight - 280)}px`,
          }}
          role="menu"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="k-context-menu__label">
            {menuClip?.label || 'Clip'}
          </div>
          {menuClip?.type === 'fxOverlay' ? (
            <button
              type="button"
              role="menuitem"
              disabled={!menuClip.linkedItemId}
              onClick={() => {
                void apply(
                  {
                    type: 'clip.update',
                    clipId: menuClip.id,
                    patch: { linkedItemId: null },
                  },
                  'Unlink overlay',
                );
                setMenu(null);
              }}
            >
              <Unlink size={13} />
              Unlink
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            disabled={!canSplit}
            onClick={() => {
              split();
              setMenu(null);
            }}
          >
            <Scissors size={13} />
            Split at playhead
            <span className="k-context-menu__hint">⌘B</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              commands.copySelected();
              setMenu(null);
            }}
          >
            <Copy size={13} />
            Copy
            <span className="k-context-menu__hint">⌘C</span>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!commands.hasClipboard()}
            onClick={() => {
              void commands.pasteClipboard();
              setMenu(null);
            }}
          >
            <ClipboardPaste size={13} />
            Paste at playhead
            <span className="k-context-menu__hint">⌘V</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              duplicate();
              setMenu(null);
            }}
          >
            <CopyPlus size={13} />
            Duplicate
            <span className="k-context-menu__hint">⌘D</span>
          </button>
          <span className="k-context-menu__rule" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              remove(false);
              setMenu(null);
            }}
          >
            <Trash2 size={13} />
            Delete
            <span className="k-context-menu__hint">⌫</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              remove(true);
              setMenu(null);
            }}
          >
            <Waves size={13} />
            Ripple delete
          </button>
        </div>
      ) : null}

      {menu?.kind === 'add-track' ? (
        <div
          className="k-context-menu"
          style={{
            left: `${Math.min(menu.x, window.innerWidth - 220)}px`,
            top: `${Math.min(menu.y, window.innerHeight - 220)}px`,
          }}
          role="menu"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="k-context-menu__label">Add track</div>
          <button
            type="button"
            role="menuitem"
            onClick={() => addTrack('video')}
          >
            <Film size={13} />
            Video track
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => addTrack('audio')}
          >
            <AudioLines size={13} />
            Audio track
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => addTrack('caption')}
          >
            <span className="font-mono text-[9px]">CC</span>
            Caption track
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => addTrack('effects')}
          >
            <Wand2 size={13} />
            Effects track
          </button>
        </div>
      ) : null}

      {menu?.kind === 'track' && trackMenuTrack ? (
        <div
          className="k-context-menu"
          style={{
            left: `${Math.min(menu.x, window.innerWidth - 220)}px`,
            top: `${Math.min(menu.y, window.innerHeight - 220)}px`,
          }}
          role="menu"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="k-context-menu__label">
            {trackMenuTrack.name} · {trackMenuTrack.clips.length}{' '}
            {trackMenuTrack.clips.length === 1 ? 'clip' : 'clips'}
          </div>
          <button
            type="button"
            role="menuitem"
            disabled={trackMenuIndex <= 0}
            onClick={() => moveTrack(trackMenuTrack, -1)}
          >
            <ArrowUp size={13} />
            Move up
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={trackMenuIndex < 0 || trackMenuIndex >= tracks.length - 1}
            onClick={() => moveTrack(trackMenuTrack, 1)}
          >
            <ArrowDown size={13} />
            Move down
          </button>
          <span className="k-context-menu__rule" />
          <button
            type="button"
            role="menuitem"
            disabled={trackMenuTrack.locked}
            onClick={() => removeTrack(trackMenuTrack)}
          >
            <Trash2 size={13} />
            Delete track
          </button>
        </div>
      ) : null}

      {menu?.kind === 'marker' && markerMenuMarker ? (
        <MarkerMenu
          key={markerMenuMarker.id}
          marker={markerMenuMarker}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </section>
  );
}
