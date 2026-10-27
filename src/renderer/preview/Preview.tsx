import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  SquareDashed,
} from 'lucide-react';
import type { FrameRate, Sequence } from '@kerf/model';
import { formatDuration, formatTimecode, fpsToNumber } from '@kerf/model';
import {
  clipAtFrame,
  mediaSourceSeconds,
  renderFrame,
  MediaPool,
} from '@kerf/canvas';
import {
  clipsAtFrame,
  sequenceDurationFrames,
  visualTracksInOrder,
} from '@kerf/engine';
import { IconButton, cn } from '@kerf/ui';
import { useStudio, useStudioStoreApi } from '../state/StudioProvider';
import { selectSelectedClip } from '../state/selectors';

const HARD_SEEK_SECONDS = 0.75;
const DRIFT_GAIN = 0.5;
const MAX_RATE_OFFSET = 0.05;

function clampPlaybackRate(rate: number): number {
  return Math.max(0.0625, Math.min(16, rate));
}

/** True when a magnifier lens is active, which needs source-quality media. */
function lensActive(sequence: Sequence, frame: number): boolean {
  return sequence.tracks.some(
    (track) =>
      track.kind === 'effects' &&
      clipsAtFrame(track, frame).some(
        (clip) => clip.type === 'fxOverlay' && clip.props.kind === 'zoom',
      ),
  );
}

function syncVideos(
  sequence: Sequence,
  frame: number,
  pool: MediaPool,
  allowAudio: boolean,
  syncedClips: Map<string, string>,
  force = false,
): void {
  const active = new Set<string>();
  const lensSource = lensActive(sequence, frame);
  for (const track of visualTracksInOrder(sequence)) {
    const clip = clipAtFrame(sequence, track.id, frame);
    if (!clip || clip.type !== 'video') {
      continue;
    }
    const video = pool.video(clip.assetId);
    if (!video || video.readyState < 2) {
      continue;
    }
    active.add(clip.assetId);
    const asset = pool.asset(clip.assetId);
    const seconds = mediaSourceSeconds(clip, frame, asset, sequence);
    const clipChanged = syncedClips.get(clip.assetId) !== clip.id;
    syncedClips.set(clip.assetId, clip.id);

    video.volume = Math.max(0, Math.min(1, clip.volume));
    video.muted = !allowAudio || clip.volume <= 0;
    video.preservesPitch = true;

    if (video.seeking && !force && !clipChanged) {
      // Let the in-flight seek settle before changing the rate again.
    } else if (
      force ||
      clipChanged ||
      Math.abs(video.currentTime - seconds) > HARD_SEEK_SECONDS
    ) {
      video.playbackRate = clampPlaybackRate(clip.speed);
      if (Math.abs(video.currentTime - seconds) > 0.001) {
        video.currentTime = seconds;
      }
    } else {
      // Nudge the element towards the timeline instead of jumping backwards.
      const drift = video.currentTime - seconds;
      const correction = Math.max(
        -MAX_RATE_OFFSET,
        Math.min(MAX_RATE_OFFSET, -drift * DRIFT_GAIN),
      );
      video.playbackRate = clampPlaybackRate(clip.speed * (1 + correction));
    }

    if (video.paused) {
      void video.play().catch(() => {
        video.muted = true;
        void video.play().catch(() => undefined);
      });
    }

    const source = lensSource ? pool.ensure(clip.assetId, 'source') : null;
    if (source && source !== video) {
      source.muted = true;
      source.playbackRate = clampPlaybackRate(clip.speed);
      if (
        force ||
        clipChanged ||
        Math.abs(source.currentTime - seconds) > HARD_SEEK_SECONDS
      ) {
        source.currentTime = seconds;
      }
      if (source.paused) {
        void source.play().catch(() => undefined);
      }
    }
  }
  for (const track of visualTracksInOrder(sequence)) {
    for (const clip of track.clips) {
      if (clip.type !== 'video' || active.has(clip.assetId)) {
        continue;
      }
      pool.video(clip.assetId, 'proxy')?.pause();
      pool.video(clip.assetId, 'source')?.pause();
    }
  }
}

function seekVideos(sequence: Sequence, frame: number, pool: MediaPool): void {
  for (const track of visualTracksInOrder(sequence)) {
    const clip = clipAtFrame(sequence, track.id, frame);
    if (!clip || clip.type !== 'video') {
      continue;
    }
    const video = pool.video(clip.assetId);
    if (!video) {
      continue;
    }
    video.playbackRate = clampPlaybackRate(clip.speed);
    video.preservesPitch = true;
    const seconds = mediaSourceSeconds(
      clip,
      frame,
      pool.asset(clip.assetId),
      sequence,
    );
    if (Math.abs(video.currentTime - seconds) > 0.02) {
      video.currentTime = seconds;
    }
    if (lensActive(sequence, frame)) {
      const source = pool.ensure(clip.assetId, 'source');
      if (source && source !== video) {
        source.muted = true;
        source.playbackRate = clampPlaybackRate(clip.speed);
        if (Math.abs(source.currentTime - seconds) > 0.02) {
          source.currentTime = seconds;
        }
      }
    }
  }
}

function pauseVideos(sequence: Sequence, pool: MediaPool): void {
  const ids = new Set(
    sequence.tracks.flatMap((track) =>
      track.clips
        .filter((clip) => clip.type === 'video')
        .map((clip) => clip.assetId),
    ),
  );
  for (const id of ids) {
    pool.video(id, 'proxy')?.pause();
    pool.video(id, 'source')?.pause();
  }
}

function sequenceSpec(width: number, height: number, rate: FrameRate): string {
  const fps = fpsToNumber(rate);
  return `${width} × ${height} · ${Number.isInteger(fps) ? fps : fps.toFixed(2)} fps`;
}

export function Preview() {
  const snapshot = useStudio((state) => state.snapshot);
  const selection = useStudio((state) => state.selection);
  const selectedClip = useStudio(selectSelectedClip);
  const playhead = useStudio((state) => state.playhead);
  const playing = useStudio((state) => state.playing);
  const setPlayhead = useStudio((state) => state.setPlayhead);
  const togglePlaying = useStudio((state) => state.togglePlaying);
  const compositionTrees = useStudio((state) => state.compositionTrees);
  const store = useStudioStoreApi();
  const [safeZones, setSafeZones] = useState(true);
  const [missingMedia, setMissingMedia] = useState(false);
  const [mediaRevision, setMediaRevision] = useState(0);
  const treeMap = useMemo(
    () => new Map(Object.entries(compositionTrees)),
    [compositionTrees],
  );
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const syncedClipsRef = useRef(new Map<string, string>());

  const assets = snapshot?.assets ?? [];
  const assetsRef = useRef(assets);
  assetsRef.current = assets;
  const assetSignature = assets
    .map(
      (asset) => `${asset.id}:${asset.status}:${asset.cache.proxyPath ?? ''}`,
    )
    .join('|');
  const [pool, setPool] = useState<MediaPool | null>(null);
  const sequence = snapshot?.project.sequence;
  const duration = sequence ? sequenceDurationFrames(sequence) : 0;
  const rate = sequence?.frameRate ?? { numerator: 24, denominator: 1 };

  useEffect(() => {
    const next = new MediaPool(assetsRef.current);
    setPool(next);
    const unsubscribe = next.onReady(() => {
      setMediaRevision((revision) => revision + 1);
    });
    return () => {
      unsubscribe();
      next.dispose();
    };
  }, [assetSignature]);

  useEffect(() => {
    if (!sequence || !pool) {
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    if (canvas.width !== sequence.width || canvas.height !== sequence.height) {
      canvas.width = sequence.width;
      canvas.height = sequence.height;
    }
    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }
    const stats = renderFrame(context, sequence, playhead, {
      pool,
      selectedClipId: selection.clipIds[0] ?? null,
      compositionTrees: treeMap,
      mediaQuality: 'proxy',
      lensQuality: 'source',
    });
    setMissingMedia(stats.missingAssets.length > 0);
  }, [mediaRevision, playhead, pool, selection.clipIds, sequence, treeMap]);

  useEffect(() => {
    if (!sequence || !pool || playing) {
      return;
    }
    seekVideos(sequence, playhead, pool);
    pauseVideos(sequence, pool);
    syncedClipsRef.current.clear();
  }, [playhead, playing, pool, sequence]);

  useEffect(() => {
    if (!playing || !sequence || !pool) {
      return;
    }
    const state = store.getState();
    let startFrame = state.playhead;
    if (startFrame >= duration) {
      startFrame = 0;
      state.setPlayhead(0);
    }
    const startedAt = performance.now();
    const fps = fpsToNumber(sequence.frameRate);
    let frameHandle = 0;
    let lastRounded = -1;
    const tick = () => {
      const current = store.getState();
      if (!current.playing) {
        return;
      }
      const frame = startFrame + ((performance.now() - startedAt) / 1000) * fps;
      const rounded = Math.min(Math.round(frame), duration);
      if (rounded >= duration) {
        current.setPlayhead(duration);
        current.setPlaying(false);
        pauseVideos(sequence, pool);
        return;
      }
      if (rounded !== lastRounded) {
        lastRounded = rounded;
        current.setPlayhead(rounded);
      }
      syncVideos(sequence, rounded, pool, true, syncedClipsRef.current);
      frameHandle = requestAnimationFrame(tick);
    };
    syncedClipsRef.current.clear();
    syncVideos(sequence, startFrame, pool, true, syncedClipsRef.current, true);
    frameHandle = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frameHandle);
      pauseVideos(sequence, pool);
      syncedClipsRef.current.clear();
    };
  }, [duration, playing, pool, sequence, store]);

  if (!sequence) {
    return null;
  }

  const empty = sequence.tracks.every((track) => track.clips.length === 0);

  return (
    <section className="k-stage" aria-label="Preview">
      <div className="k-stage__head">
        <div>
          <p className="font-mono text-[10px] tracking-[0.12em] text-ink-faint uppercase">
            Program monitor
          </p>
          <h2 className="k-stage__title truncate">{sequence.name}</h2>
        </div>
        <div className="k-stage__meta">
          <span>{sequenceSpec(sequence.width, sequence.height, rate)}</span>
          {selectedClip ? (
            <span className="k-stage__selection-note">
              {selectedClip.label || selectedClip.type}
            </span>
          ) : null}
        </div>
      </div>

      <div className="k-stage__viewport">
        <div
          className="k-stage__canvas"
          style={{
            aspectRatio: `${sequence.width} / ${sequence.height}`,
            width: `min(100cqw, calc(100cqh * ${sequence.width} / ${sequence.height}))`,
          }}
        >
          <canvas
            ref={canvasRef}
            className="k-stage__frame-canvas"
            aria-label={`Frame ${playhead}`}
          />
          {safeZones ? (
            <>
              <span className="k-stage__safe" aria-hidden="true" />
              <span className="k-stage__safe-center" aria-hidden="true" />
            </>
          ) : null}
          {empty ? (
            <div className="k-stage__empty k-stage__empty--overlay">
              <SquareDashed size={24} aria-hidden="true" />
              <p>Empty sequence</p>
              <span>Drag a clip onto the timeline to see it here.</span>
            </div>
          ) : null}
          {!empty && missingMedia ? (
            <div className="k-stage__loading">
              <span className="k-stage__loading-dot" />
              Loading media
            </div>
          ) : null}
        </div>
      </div>

      <div className="k-stage__transport">
        <div className="k-transport__group">
          <IconButton
            label="Jump to start"
            size="sm"
            icon={<SkipBack size={14} />}
            onClick={() => setPlayhead(0)}
          />
          <IconButton
            label="Previous frame"
            size="sm"
            icon={<ChevronLeft size={14} />}
            onClick={() => setPlayhead(playhead - 1)}
          />
          <IconButton
            label={playing ? 'Pause' : 'Play'}
            size="md"
            active={playing}
            className="k-transport__play"
            icon={playing ? <Pause size={15} /> : <Play size={15} />}
            onClick={togglePlaying}
          />
          <IconButton
            label="Next frame"
            size="sm"
            icon={<ChevronRight size={14} />}
            onClick={() => setPlayhead(playhead + 1)}
          />
          <IconButton
            label="Jump to end"
            size="sm"
            icon={<SkipForward size={14} />}
            onClick={() => setPlayhead(duration)}
          />
        </div>

        <span className="k-timecode">{formatTimecode(playhead, rate)}</span>
        <span className="k-stage__duration">
          / {formatDuration(duration, rate)}
        </span>

        <span className="k-transport__spacer" />

        <button
          type="button"
          className={cn('k-transport__toggle', safeZones && 'is-active')}
          onClick={() => setSafeZones((value) => !value)}
        >
          <SquareDashed size={12} />
          Safe zones
        </button>
      </div>
    </section>
  );
}
