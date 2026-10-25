import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import type { Asset, FrameRate } from '@kerf/model';
import { formatTimecode, fpsToNumber } from '@kerf/model';

export interface SourcePreviewHandle {
  seekToFrame(frame: number): void;
}

export interface SourcePreviewProps {
  readonly asset: Asset;
  readonly rate: FrameRate;
  readonly onFrameChange?: (frame: number) => void;
}

function sourceUrl(assetId: string): string {
  return `kerfmedia://asset/${encodeURIComponent(assetId)}/source`;
}

/**
 * Compact source player shared by the analysis side panels. It owns the media
 * element so a panel can seek by frame and mirror the playhead without
 * duplicating video/audio wiring.
 */
export const SourcePreview = forwardRef<
  SourcePreviewHandle,
  SourcePreviewProps
>(function SourcePreview({ asset, rate, onFrameChange }, ref) {
  const fps = Math.max(1, fpsToNumber(rate));
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [currentFrame, setCurrentFrame] = useState(0);

  const syncFromMedia = () => {
    const media = videoRef.current ?? audioRef.current;
    if (!media) {
      return;
    }
    const frame = Math.round(media.currentTime * fps);
    setCurrentFrame(frame);
    onFrameChange?.(frame);
  };

  useImperativeHandle(
    ref,
    () => ({
      seekToFrame(frame: number) {
        const media = videoRef.current ?? audioRef.current;
        if (media) {
          const target = frame / fps;
          const duration = Number.isFinite(media.duration)
            ? media.duration
            : null;
          media.currentTime = duration
            ? Math.min(target, Math.max(0, duration - 0.05))
            : target;
          void media.play().catch(() => undefined);
        }
        setCurrentFrame(frame);
        onFrameChange?.(frame);
      },
    }),
    [fps, onFrameChange],
  );

  if (
    asset.status !== 'missing' &&
    asset.kind !== 'video' &&
    asset.kind !== 'audio'
  ) {
    return null;
  }

  const mediaEvents = {
    onTimeUpdate: syncFromMedia,
    onSeeked: syncFromMedia,
  };

  return (
    <div className="border-b border-line p-3">
      {asset.status === 'missing' ? (
        <p className="rounded-sm border border-danger/30 bg-danger/10 px-3 py-2 text-[10px] leading-relaxed text-danger">
          The source file is missing. Relink it from the Footage bin to play
          this moment.
        </p>
      ) : asset.kind === 'video' ? (
        <video
          ref={videoRef}
          src={sourceUrl(asset.id)}
          controls
          preload="metadata"
          playsInline
          className="aspect-video w-full rounded-sm border border-line bg-black"
          {...mediaEvents}
        />
      ) : (
        <audio
          ref={audioRef}
          src={sourceUrl(asset.id)}
          controls
          preload="metadata"
          className="w-full"
          {...mediaEvents}
        />
      )}
      {asset.status === 'missing' ? null : (
        <p className="mt-1.5 font-mono text-[8px] tracking-[0.04em] text-ink-faint uppercase">
          Source preview · {formatTimecode(currentFrame, rate)}
        </p>
      )}
    </div>
  );
});
