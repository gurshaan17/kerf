import { useEffect, useRef, useState } from 'react';
import { fpsToNumber } from '@kerf/model';
import { assetMediaUrl } from '@kerf/canvas';
import type { EditingReview } from '@kerf/tools';
import { Button } from '@kerf/ui';
import { useStudio } from '../state/StudioProvider';

export function EditingReviews() {
  const snapshot = useStudio((s) => s.snapshot);
  const [reviews, setReviews] = useState<readonly EditingReview[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const result = (await window.kerf.editing?.reviews()) ?? [];
        if (active) setReviews(result);
      } catch (cause) {
        if (active) setError(String(cause));
      }
    };
    setReviews([]);
    void refresh();
    const timer = setInterval(() => void refresh(), 1500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [snapshot?.project.id]);
  if (!reviews.length && !error) return null;
  return (
    <div
      className="grid gap-2 border-b border-line p-3"
      aria-label="AI editing reviews"
    >
      <p className="text-[11px] font-semibold text-ink">Review AI edits</p>
      {error && (
        <p role="alert" className="text-[11px] text-danger">
          {error}
        </p>
      )}
      {reviews.map((review) => (
        <Review
          key={`${review.job.projectId}-${review.job.id}`}
          review={review}
        />
      ))}
    </div>
  );
}

function Review({ review }: { review: EditingReview }) {
  const snapshot = useStudio((s) => s.snapshot);
  const seek = useStudio((s) => s.setPlayhead);
  const video = useRef<HTMLVideoElement>(null);
  const [selected, setSelected] = useState<readonly string[]>(
    review.selectedIds,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState(review.receipt);
  const [cancelled, setCancelled] = useState(false);
  const [previewFrame, setPreviewFrame] = useState<number | null>(null);
  useEffect(() => {
    setSelected(review.selectedIds);
  }, [review.selectedIds.join('|')]);
  const proposal = review.proposal;
  const clip = snapshot?.project.sequence.tracks
    .flatMap((t) => t.clips)
    .find((c) => c.id === proposal?.clipId);
  const asset = snapshot?.assets.find((a) => a.id === proposal?.assetId);
  const fps = snapshot ? fpsToNumber(snapshot.project.sequence.frameRate) : 24;
  const terminal =
    cancelled ||
    receipt ||
    ['applied', 'cancelled'].includes(review.job.reviewStatus);
  const running = ['queued', 'running'].includes(review.job.status);
  const inspect = (frame: number, space: 'source' | 'sequence') => {
    if (!clip || !('sourceInFrame' in clip)) return;
    const sourceFrame =
      space === 'source' ? frame : frame - clip.startFrame + clip.sourceInFrame;
    setPreviewFrame(sourceFrame);
    if (video.current) video.current.currentTime = sourceFrame / fps;
    seek(
      space === 'source' ? clip.startFrame + frame - clip.sourceInFrame : frame,
    );
  };
  const apply = async () => {
    if (!window.kerf.editing) return;
    setBusy(true);
    setError('');
    try {
      setReceipt(
        (
          await window.kerf.editing.confirm({
            jobId: review.job.id,
            changeIds: selected,
          })
        ).receipt,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="grid gap-2 rounded-sm border border-line bg-surface-0 p-2 text-[11px] text-ink-muted">
      <p className="font-semibold text-ink">
        {review.job.kind === 'analysis.autoCut' ? 'Auto cut' : 'Screen polish'}{' '}
        · {review.job.status}
      </p>
      <p>
        {review.job.stage} · {Math.round(review.job.progress * 100)}%
      </p>
      {review.job.error && <p role="alert">{review.job.error}</p>}
      {(receipt || review.receipt) && (
        <p>
          Applied: {(receipt ?? review.receipt)!.label} · One undo step. Preview
          the timeline to check the result.
        </p>
      )}
      {(cancelled || review.job.reviewStatus === 'cancelled') && (
        <p>Cancelled. No further changes will apply.</p>
      )}
      {!terminal && proposal && (
        <>
          <p>Review each proposed change. Uncheck sections to retain them.</p>
          {asset && previewFrame !== null && (
            <video
              ref={video}
              src={assetMediaUrl(asset, 'source')}
              onLoadedMetadata={() => {
                if (video.current && previewFrame !== null)
                  video.current.currentTime = previewFrame / fps;
              }}
              controls
              preload="metadata"
              className="w-full rounded-sm"
              aria-label="Review source footage"
            />
          )}
          {!proposal.changes.length && <p>No changes suggested.</p>}
          <div className="grid max-h-56 gap-2 overflow-auto">
            {proposal.changes.map((change) => (
              <div key={change.id}>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={selected.includes(change.id)}
                    disabled={busy}
                    onChange={(e) =>
                      setSelected((ids) =>
                        e.target.checked
                          ? [...ids, change.id]
                          : ids.filter((id) => id !== change.id),
                      )
                    }
                  />
                  <span>
                    {change.description} · {change.reason}
                  </span>
                </label>
                <button
                  type="button"
                  className="text-accent"
                  onClick={() =>
                    inspect(change.startFrame, proposal.frameSpace)
                  }
                >
                  Inspect {proposal.frameSpace} frames {change.startFrame}–
                  {change.endFrame}
                </button>
                {change.evidenceFrames.map((frame) => (
                  <button
                    type="button"
                    key={frame}
                    className="ml-2 text-accent"
                    onClick={() => inspect(frame, 'source')}
                  >
                    Evidence {frame}
                  </button>
                ))}
              </div>
            ))}
          </div>
          <Button
            size="sm"
            disabled={busy || !selected.length}
            onClick={() => void apply()}
          >
            Apply {selected.length} reviewed{' '}
            {selected.length === 1 ? 'change' : 'changes'}
          </Button>
        </>
      )}
      {!terminal && (running || proposal) && (
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await window.kerf.editing?.cancel(review.job.id);
              setCancelled(true);
            } catch (cause) {
              setError(String(cause));
            } finally {
              setBusy(false);
            }
          }}
        >
          Cancel editing job
        </Button>
      )}
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
