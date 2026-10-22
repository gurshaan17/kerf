import { useEffect, useRef, useState } from 'react';
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
import { sequenceDurationFrames, visualTracksInOrder } from '@kerf/engine';
import { IconButton, cn } from '@kerf/ui';
import { useStudio, useStudioStoreApi } from '../state/StudioProvider';
import { selectSelectedClip } from '../state/selectors';

function syncVideos(
  sequence: Sequence,
  frame: number,
  pool: MediaPool,
  allowAudio: boolean,
): void {
  const active = new Set<string>();
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
    if (Math.abs(video.currentTime - seconds) > 0.18) {
      video.currentTime = seconds;
    }
    video.volume = Math.max(0, Math.min(1, clip.volume));
    video.muted = !allowAudio || clip.volume <= 0;
    if (video.paused) {
      void video.play().catch(() => {
        video.muted = true;
        void video.play().catch(() => undefined);
      });
    }
  }
  for (const track of visualTracksInOrder(sequence)) {
    for (const clip of track.clips) {
      if (clip.type !== 'video' || active.has(clip.assetId)) {
        continue;
      }
      pool.video(clip.assetId)?.pause();
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
    const seconds = mediaSourceSeconds(
      clip,
      frame,
      pool.asset(clip.assetId),
      sequence,
    );
    if (Math.abs(video.currentTime - seconds) > 0.02) {
      video.currentTime = seconds;
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
    pool.video(id)?.pause();
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
  const store = useStudioStoreApi();
  const [safeZones, setSafeZones] = useState(true);
  const [missingMedia, setMissingMedia] = useState(false);
  const [mediaRevision, setMediaRevision] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

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
    });
    setMissingMedia(stats.missingAssets.length > 0);
  }, [mediaRevision, playhead, pool, selection.clipIds, sequence]);

  useEffect(() => {
    if (!sequence || !pool || playing) {
      return;
    }
    seekVideos(sequence, playhead, pool);
    pauseVideos(sequence, pool);
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
      current.setPlayhead(rounded);
      syncVideos(sequence, rounded, pool, true);
      frameHandle = requestAnimationFrame(tick);
    };
    syncVideos(sequence, startFrame, pool, true);
    frameHandle = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frameHandle);
      pauseVideos(sequence, pool);
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
