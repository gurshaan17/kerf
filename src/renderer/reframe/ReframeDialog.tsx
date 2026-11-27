import { useEffect, useMemo, useRef, useState } from 'react';
import { buildReframedSequence, REFRAME_SIZES } from '@kerf/engine';
import type {
  ReframeFormat,
  ReframePoint,
  TrackedReframePoint,
} from '@kerf/engine';
import { assetMediaUrl } from '@kerf/canvas';
import { formatTimecode, framesToSeconds, sampleTransform } from '@kerf/model';
import type { VideoClip } from '@kerf/model';
import { Button, Dialog } from '@kerf/ui';
import type { ReframeReview } from '../../shared/reframe';
import { IsolatedPreview } from '../preview/IsolatedPreview';
import { useStudio } from '../state/StudioProvider';

const CENTER: TrackedReframePoint = {
  frame: 0,
  x: 0.5,
  y: 0.5,
  status: 'manual',
};

export function ReframeControl({
  clip,
  label = 'Reframe video',
}: {
  clip: VideoClip;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!window.kerf.reframe) return null;
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open && <ReframeDialog clip={clip} onClose={() => setOpen(false)} />}
    </>
  );
}

function editablePoint({ frame, x, y, hold }: ReframePoint): ReframePoint {
  return { frame, x, y, hold };
}

function warningPoints(points: readonly TrackedReframePoint[]) {
  return points.filter(
    (point, index) =>
      (point.status === 'uncertain' || point.status === 'scene-change') &&
      points[index - 1]?.status !== point.status,
  );
}

export function ReframeDialog({
  clip,
  onClose,
}: {
  clip: VideoClip;
  onClose: () => void;
}) {
  const active = useStudio((state) => state.snapshot);
  const [snapshot] = useState(active);
  const setPlaying = useStudio((state) => state.setPlaying);
  const openProject = useStudio((state) => state.openProject);
  const bridge = window.kerf.reframe;
  const asset = snapshot?.assets.find((item) => item.id === clip.assetId);
  const sequence = snapshot?.project.sequence;
  const [review, setReview] = useState<ReframeReview | null>(null);
  const [format, setFormat] = useState<ReframeFormat>('vertical');
  const [points, setPoints] = useState<readonly TrackedReframePoint[]>([
    CENTER,
  ]);
  const [frame, setFrame] = useState(0);
  const [jump, setJump] = useState({ frame: 0, version: 0 });
  const [picked, setPicked] = useState(false);
  const [operation, setOperation] = useState<'track' | 'create' | null>(null);
  const [result, setResult] = useState<{
    projectId: string;
    name: string;
  } | null>(null);
  const [error, setError] = useState('');
  const reviewId = useRef<string | null>(null);
  const media = useRef<HTMLVideoElement>(null);
  const stale =
    active?.project !== snapshot?.project &&
    active?.project.updatedAt !== snapshot?.project.updatedAt;

  useEffect(() => {
    if (!bridge) return;
    setPlaying(false);
    const id = crypto.randomUUID();
    reviewId.current = id;
    void bridge.prepare({ reviewId: id, clipId: clip.id }).then(
      (value) => {
        if (reviewId.current === id) setReview(value);
      },
      (cause: unknown) => {
        if (reviewId.current === id)
          setError(cause instanceof Error ? cause.message : String(cause));
      },
    );
    return () => {
      reviewId.current = null;
      void bridge.cancel(id).catch(() => {});
    };
  }, [bridge, clip.id, setPlaying]);

  const candidate = useMemo(
    () =>
      review && sequence
        ? buildReframedSequence(
            sequence,
            clip.id,
            review.source,
            format,
            points,
          )
        : null,
    [clip.id, format, points, review, sequence],
  );
  const framed = candidate?.tracks
    .flatMap((track) => track.clips)
    .find((item) => item.type === 'video');
  const currentTransform =
    framed && sampleTransform(framed.transform, framed.keyframes, frame);
  const size = REFRAME_SIZES[format];
  const cover = review
    ? Math.max(
        size.width / review.source.width,
        size.height / review.source.height,
      )
    : 1;
  const crop = review &&
    currentTransform && {
      width: size.width / (review.source.width * cover),
      height: size.height / (review.source.height * cover),
      x: 0.5 - currentTransform.x / (review.source.width * cover),
      y: 0.5 - currentTransform.y / (review.source.height * cover),
    };
  const selected = points.find((point) => point.frame === frame);
  const focus = selected ?? crop ?? CENTER;
  const sourceTime =
    review && sequence
      ? review.sourceStartSeconds + framesToSeconds(frame, sequence.frameRate)
      : 0;

  useEffect(() => {
    if (media.current?.readyState) media.current.currentTime = sourceTime;
  }, [sourceTime]);

  const reposition = (next: number) => {
    setFrame(next);
    setJump((current) => ({ frame: next, version: current.version + 1 }));
  };
  const correct = (x: number, y: number) => {
    setPicked(true);
    setPoints((previous) => {
      const point: TrackedReframePoint = {
        frame,
        x,
        y,
        status: 'manual',
        hold: selected?.hold,
        shotStart: selected?.shotStart,
      };
      return [...previous.filter((item) => item.frame !== frame), point].sort(
        (a, b) => a.frame - b.frame,
      );
    });
    setJump((current) => ({ ...current, frame }));
    setError('');
  };
  const run = async (next: 'track' | 'create') => {
    const id = reviewId.current;
    if (!bridge || !id || operation || stale) return;
    setOperation(next);
    setError('');
    try {
      if (next === 'track') {
        const anchors = points
          .filter((point) => point.status === 'manual')
          .map(editablePoint);
        const tracked = await bridge.track({ reviewId: id, anchors });
        if (reviewId.current === id) {
          setPoints(tracked);
          reposition(frame);
        }
      } else {
        const output = await bridge.create({
          reviewId: id,
          format,
          points: points.map(editablePoint),
        });
        if (reviewId.current === id) setResult(output);
      }
    } catch (cause) {
      if (reviewId.current === id)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (reviewId.current === id) setOperation(null);
    }
  };
  const warnings = warningPoints(points);
  const disabled = Boolean(operation || result || stale);

  return (
    <div onKeyDown={(event) => event.stopPropagation()}>
      <Dialog
        open
        size="workspace"
        title="Reframe video"
        description="Pick a subject, review the crop, and create an editable version."
        onOpenChange={(open) => {
          if (!open && operation !== 'create') onClose();
        }}
        footer={
          result ? (
            <Button
              onClick={() => {
                onClose();
                void openProject(result.projectId);
              }}
            >
              Open {format} project
            </Button>
          ) : (
            <>
              <Button
                variant="secondary"
                disabled={operation === 'create'}
                onClick={onClose}
              >
                {operation === 'track' ? 'Cancel tracking' : 'Close'}
              </Button>
              <Button
                disabled={!review || disabled}
                onClick={() => void run('create')}
              >
                {operation === 'create'
                  ? 'Creating version…'
                  : `Create ${format} project`}
              </Button>
            </>
          )
        }
      >
        {result ? (
          <p role="status">Created {result.name}</p>
        ) : (
          <>
            {error && (
              <p role="alert" className="mb-3 text-sm text-danger">
                {error}
              </p>
            )}
            {stale && (
              <p role="alert" className="mb-3 text-sm text-danger">
                The timeline changed. Reopen this preview before continuing.
              </p>
            )}
            {!review && !error && <p role="status">Reading source video…</p>}
            {review && snapshot && sequence && asset && candidate && (
              <div className="grid gap-4">
                <div className="flex flex-wrap items-center gap-2">
                  <div
                    role="group"
                    aria-label="Output shape"
                    className="flex gap-2"
                  >
                    {(['vertical', 'square'] as const).map((shape) => (
                      <Button
                        key={shape}
                        size="sm"
                        variant={format === shape ? 'primary' : 'secondary'}
                        disabled={disabled}
                        aria-pressed={format === shape}
                        onClick={() => {
                          setFormat(shape);
                          setJump((current) => ({ ...current, frame }));
                        }}
                      >
                        {shape === 'vertical' ? 'Vertical 9:16' : 'Square 1:1'}
                      </Button>
                    ))}
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={disabled || !picked}
                    onClick={() => void run('track')}
                  >
                    {operation === 'track'
                      ? 'Tracking subject…'
                      : 'Track subject'}
                  </Button>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="grid content-start gap-2">
                    <p className="text-xs font-semibold">
                      Source · {formatTimecode(frame, sequence.frameRate)}
                    </p>
                    <button
                      type="button"
                      disabled={disabled}
                      aria-label="Pick subject in source frame"
                      className="relative mx-auto block w-full cursor-crosshair overflow-hidden rounded border border-line bg-black"
                      style={{
                        aspectRatio: review.source.width / review.source.height,
                        maxWidth: `min(100%, ${(36 * review.source.width) / review.source.height}vh)`,
                      }}
                      onClick={(event) => {
                        const bounds =
                          event.currentTarget.getBoundingClientRect();
                        const unit = (value: number) =>
                          Math.max(0, Math.min(1, value));
                        correct(
                          event.detail
                            ? unit((event.clientX - bounds.left) / bounds.width)
                            : 0.5,
                          event.detail
                            ? unit((event.clientY - bounds.top) / bounds.height)
                            : 0.5,
                        );
                      }}
                    >
                      <video
                        ref={media}
                        muted
                        playsInline
                        preload="auto"
                        className="absolute inset-0 size-full object-contain"
                        src={assetMediaUrl(
                          asset,
                          asset.cache.proxyPath ? 'proxy' : 'source',
                        )}
                        onLoadedMetadata={(event) => {
                          event.currentTarget.currentTime = sourceTime;
                        }}
                      />
                      {crop && (
                        <span
                          aria-hidden
                          className="pointer-events-none absolute border-2 border-accent"
                          style={{
                            left: `${(crop.x - crop.width / 2) * 100}%`,
                            top: `${(crop.y - crop.height / 2) * 100}%`,
                            width: `${crop.width * 100}%`,
                            height: `${crop.height * 100}%`,
                          }}
                        />
                      )}
                    </button>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="grid gap-1 text-xs">
                        Horizontal focus
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={Math.round(focus.x * 100)}
                          disabled={disabled}
                          onChange={(event) =>
                            correct(Number(event.target.value) / 100, focus.y)
                          }
                        />
                      </label>
                      <label className="grid gap-1 text-xs">
                        Vertical focus
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={Math.round(focus.y * 100)}
                          disabled={disabled}
                          onChange={(event) =>
                            correct(focus.x, Number(event.target.value) / 100)
                          }
                        />
                      </label>
                    </div>
                  </div>
                  <div
                    className="h-[44vh] min-h-[230px]"
                    aria-label="Reframed playback"
                  >
                    <IsolatedPreview
                      key={jump.version}
                      snapshot={snapshot}
                      sequence={candidate}
                      frame={jump.frame}
                      initialSafeZones
                      onFrameChange={setFrame}
                    />
                  </div>
                </div>
                {warnings.length > 0 && (
                  <div
                    className="grid gap-2 border-t border-line pt-2"
                    aria-label="Framing to review"
                  >
                    <p className="text-xs">
                      Review these moments and choose the subject again where
                      needed.
                    </p>
                    <div className="flex max-h-24 flex-wrap gap-1 overflow-auto">
                      {warnings.map((point) => (
                        <Button
                          key={point.frame}
                          size="sm"
                          variant="secondary"
                          disabled={disabled}
                          onClick={() => reposition(point.frame)}
                        >
                          {formatTimecode(point.frame, sequence.frameRate)} ·{' '}
                          {point.status === 'scene-change'
                            ? 'New shot'
                            : 'Subject unclear'}
                        </Button>
                      ))}
                    </div>
                    <details className="text-xs text-ink-muted">
                      <summary>Technical details</summary>
                      {warnings.map((point) => (
                        <p key={point.frame}>
                          {formatTimecode(point.frame, sequence.frameRate)} ·{' '}
                          {point.confidence === undefined
                            ? 'No reliable match'
                            : `Match score ${point.confidence.toFixed(2)}`}
                        </p>
                      ))}
                    </details>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </Dialog>
    </div>
  );
}
