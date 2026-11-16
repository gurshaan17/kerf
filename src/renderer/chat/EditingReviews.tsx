import { useEffect, useRef, useState } from 'react';
import { fpsToNumber } from '@kerf/model';
import { assetMediaUrl } from '@kerf/canvas';
import type { ChatEditVerification } from '../../shared/contracts';
import type { EditingReview } from '@kerf/tools';
import { Button } from '@kerf/ui';
import { useStudio } from '../state/StudioProvider';

export function useEditingReviews() {
  const snapshot = useStudio((s) => s.snapshot);
  const conversationId = useStudio((s) => s.chatConversationId);
  const [reviews, setReviews] = useState<readonly EditingReview[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let revision = 0;
    const refresh = async () => {
      const request = ++revision;
      try {
        const result =
          (await window.kerf.editing?.reviews(conversationId)) ?? [];
        if (active && request === revision) {
          setReviews(
            result.filter(
              (r) => !r.origin || r.origin.conversationId === conversationId,
            ),
          );
          setError('');
        }
      } catch (cause) {
        if (active && request === revision) setError(String(cause));
      }
    };
    setReviews([]);
    setError('');
    void refresh();
    const unsubscribe = window.kerf.events.subscribe((event) => {
      if (
        event.type === 'jobs.changed' ||
        event.type === 'chat.done' ||
        event.type === 'chat.tool'
      )
        void refresh();
    });
    const timer = setInterval(() => void refresh(), 1500);
    return () => {
      active = false;
      clearInterval(timer);
      unsubscribe();
    };
  }, [snapshot?.project.id, conversationId]);
  return { reviews, error };
}

export function EditingReviews({
  reviews,
  error,
  reviewJobId,
}: {
  reviews: readonly EditingReview[];
  error: string;
  reviewJobId?: string | null;
}) {
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
      {reviews.map((review) =>
        review.origin ? (
          <ChatJob
            key={`${review.job.projectId}-${review.job.id}`}
            review={review}
            reveal={reviewJobId === review.job.id}
          />
        ) : (
          <Review
            key={`${review.job.projectId}-${review.job.id}`}
            review={review}
          />
        ),
      )}
    </div>
  );
}

function ChatJob({
  review,
  reveal,
}: {
  review: EditingReview;
  reveal?: boolean;
}) {
  const send = useStudio((s) => s.sendChat);
  const activeTurn = useStudio((s) => s.chatActiveTurnId);
  const sending = useStudio((s) => s.chatSending);
  const provider = useStudio((s) => s.chatProvider?.provider);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (reveal) setExpanded(true);
  }, [reveal]);
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const origin = review.origin!;
  const running =
    ['queued', 'running'].includes(review.job.status) &&
    review.job.reviewStatus !== 'cancelled';
  const interrupted =
    review.job.status === 'failed' &&
    /interrupted/i.test(review.job.error ?? '');
  const canContinue = review.eligibility?.eligible && !origin.continuedTurnId;
  const canRetry =
    !running && review.job.reviewStatus !== 'applied' && !origin.retryTurnId;
  const disabled =
    pending ||
    sending ||
    activeTurn !== null ||
    !provider?.enabled ||
    !provider.chatConsent;
  const act = async (action: 'continue' | 'reanalyze') => {
    if (lock.current || disabled) return;
    lock.current = true;
    setPending(true);
    try {
      await send(
        action === 'continue'
          ? 'Continue with this result and show it for review.'
          : 'Reanalyze this job explicitly using its original request.',
        [],
        {
          projectId: origin.projectId,
          conversationId: origin.conversationId,
          jobId: review.job.id,
          requestId: crypto.randomUUID(),
          action,
        },
      );
    } finally {
      setPending(false);
      lock.current = false;
    }
  };
  return (
    <div
      className="grid gap-2 border-b border-line py-2 text-[11px] text-ink-muted"
      id={`editing-job-${review.job.id}`}
      aria-label={`Editing job ${review.job.id}`}
    >
      <p className="font-semibold text-ink">
        {review.job.kind === 'analysis.roughCut'
          ? 'Rough cut'
          : review.job.kind === 'analysis.autoCut'
            ? 'Auto cut'
            : 'Screen polish'}{' '}
        ·{' '}
        {review.job.reviewStatus === 'applied'
          ? 'Applied'
          : review.job.reviewStatus === 'cancelled'
            ? 'Cancelled'
            : interrupted
              ? 'Interrupted'
              : review.job.status === 'succeeded'
                ? 'Completed'
                : review.job.status}
      </p>
      <p>
        {review.job.stage} · {Math.round(review.job.progress * 100)}%
      </p>
      {review.eligibility?.reason && !running && (
        <p>{review.eligibility.reason}</p>
      )}
      {origin.continuedTurnId &&
        !['applied', 'cancelled'].includes(review.job.reviewStatus) && (
          <p>Continued in chat. Apply remains in review.</p>
        )}
      {origin.retryTurnId && <p>Reanalysis requested in chat.</p>}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Hide result' : 'Review result'}
        </Button>
        {canContinue && (
          <Button
            size="sm"
            disabled={disabled}
            onClick={() => void act('continue')}
          >
            Continue with this result
          </Button>
        )}
        {canRetry && (
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled}
            onClick={() => void act('reanalyze')}
          >
            Reanalyze
          </Button>
        )}
      </div>
      {(activeTurn || sending) && (
        <p>Wait for the current response or stop it before continuing.</p>
      )}
      {!provider?.chatConsent && (
        <p>Enable a chat provider in AI settings to continue.</p>
      )}
      {expanded && <Review review={review} />}
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
  const [finishNote, setFinishNote] = useState('');
  const [verification, setVerification] = useState<ChatEditVerification | null>(
    null,
  );
  const [receipt, setReceipt] = useState(review.receipt);
  const [cancelled, setCancelled] = useState(false);
  const [preview, setPreview] = useState<{
    assetId: string;
    seconds: number;
  } | null>(null);
  useEffect(() => {
    setSelected(review.selectedIds);
  }, [review.selectedIds.join('|')]);
  useEffect(() => {
    if (video.current && preview) {
      video.current.pause();
      video.current.currentTime = preview.seconds;
    }
  }, [preview?.assetId, preview?.seconds]);
  const proposal = review.proposal;
  const clip = snapshot?.project.sequence.tracks
    .flatMap((t) => t.clips)
    .find((c) => c.id === proposal?.clipId);
  const asset = snapshot?.assets.find(
    (a) => a.id === (preview?.assetId ?? proposal?.assetId),
  );
  const fps = snapshot ? fpsToNumber(snapshot.project.sequence.frameRate) : 24;
  const terminal =
    cancelled ||
    receipt ||
    ['applied', 'cancelled'].includes(review.job.reviewStatus);
  const running = ['queued', 'running'].includes(review.job.status);
  const inspect = (
    frame: number,
    space: 'source' | 'sequence',
    change?: NonNullable<EditingReview['proposal']>['changes'][number],
  ) => {
    if (proposal?.kind === 'roughCut' && change?.assetId) {
      setPreview({
        assetId: change.assetId,
        seconds:
          frame /
          fpsToNumber(
            change.sourceFrameRate ?? snapshot!.project.sequence.frameRate,
          ),
      });
      return;
    }
    if (!clip || !('sourceInFrame' in clip)) return;
    const sourceFrame =
      space === 'source' ? frame : frame - clip.startFrame + clip.sourceInFrame;
    if (asset) setPreview({ assetId: asset.id, seconds: sourceFrame / fps });
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
    <section
      id={review.origin ? undefined : `editing-job-${review.job.id}`}
      className="grid gap-2 rounded-sm border border-line bg-surface-0 p-2 text-[11px] text-ink-muted"
    >
      <p className="font-semibold text-ink">
        {review.job.kind === 'analysis.roughCut'
          ? 'Rough cut'
          : review.job.kind === 'analysis.autoCut'
            ? 'Auto cut'
            : 'Screen polish'}{' '}
        · {review.job.status}
      </p>
      <p>
        {review.job.stage} · {Math.round(review.job.progress * 100)}%
      </p>
      {review.job.error && <p role="alert">{review.job.error}</p>}
      {!terminal && !running && review.eligibility?.reason && (
        <p>{review.eligibility.reason}</p>
      )}
      {(receipt || review.receipt) && (
        <p>
          Applied: {(receipt ?? review.receipt)!.label} · One undo step. Preview
          the timeline to check the result.
        </p>
      )}
      {proposal?.kind === 'roughCut' && (receipt || review.receipt) && (
        <>
          <p>Finish this cut in separate undoable steps.</p>
          {(['captions', 'duck', 'verify'] as const).map((stage) => (
            <Button
              key={stage}
              size="sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  const result = await window.kerf.editing!.finish({
                    jobId: review.job.id,
                    stage,
                  });
                  setFinishNote(
                    result.note ?? result.verification?.note ?? 'Done.',
                  );
                  setVerification(result.verification ?? null);
                } catch (cause) {
                  setError(
                    cause instanceof Error ? cause.message : String(cause),
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              {stage === 'captions'
                ? 'Caption this cut'
                : stage === 'duck'
                  ? 'Duck background audio'
                  : 'Verify this cut'}
            </Button>
          ))}
          {finishNote && <p>{finishNote}</p>}
          {verification?.findings.map((finding, index) => (
            <button
              type="button"
              key={index}
              className="text-left"
              onClick={() => seek(finding.startFrame)}
            >
              {finding.severity}: {finding.message} · frame {finding.startFrame}
            </button>
          ))}
          <div className="flex flex-wrap gap-2">
            {verification?.previews.map((p) => (
              <button
                type="button"
                className="w-28"
                key={p.frame}
                onClick={() => seek(p.frame)}
              >
                <img src={p.dataUrl} alt={`Cut preview at frame ${p.frame}`} />
                Frame {p.frame}
              </button>
            ))}
          </div>
        </>
      )}
      {(cancelled || review.job.reviewStatus === 'cancelled') && (
        <p>Cancelled. No further changes will apply.</p>
      )}
      {!terminal && proposal && (
        <>
          <p>
            {proposal.kind === 'roughCut'
              ? 'Review the ordered source ranges. Uncheck ranges to leave them out of this cut.'
              : 'Review each proposed change. Uncheck sections to retain them.'}
          </p>
          {proposal.roughCut && (
            <>
              <p>{proposal.roughCut.intent}</p>
              <p>
                Selected cut:{' '}
                {(
                  proposal.changes
                    .filter((c) => selected.includes(c.id))
                    .reduce((n, c) => n + (c.durationFrames ?? 0), 0) / fps
                ).toFixed(2)}
                s · Appends at sequence frame {proposal.roughCut.appendAtFrame}
              </p>
              {proposal.roughCut.targetDurationSeconds && (
                <p>
                  Target: {proposal.roughCut.targetDurationSeconds}s · Complete
                  source ranges determine the final duration.
                </p>
              )}
              {proposal.roughCut.unmetConstraints.map((note) => (
                <p key={note}>{note}</p>
              ))}
            </>
          )}
          {asset && preview !== null && (
            <video
              key={asset.id}
              ref={video}
              src={assetMediaUrl(asset, 'source')}
              onLoadedMetadata={() => {
                if (video.current && preview)
                  video.current.currentTime = preview.seconds;
              }}
              controls
              preload="metadata"
              className="w-full rounded-sm"
              aria-label="Review source footage"
            />
          )}
          {!proposal.changes.length && <p>No changes suggested.</p>}
          <div className="grid max-h-56 gap-2 overflow-auto">
            {proposal.changes.map((change, index) => (
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
                    {proposal.kind === 'roughCut' &&
                      `${index + 1}. ${snapshot?.assets.find((a) => a.id === change.assetId)?.name ?? change.assetId} · `}
                    {change.description} · {change.reason}
                  </span>
                </label>
                <button
                  type="button"
                  className="text-accent"
                  onClick={() =>
                    inspect(change.startFrame, proposal.frameSpace, change)
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
                    onClick={() => inspect(frame, 'source', change)}
                  >
                    Evidence {frame}
                  </button>
                ))}
              </div>
            ))}
          </div>
          <Button
            size="sm"
            disabled={
              busy || !selected.length || review.eligibility?.eligible === false
            }
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
