import { useEffect, useRef, useState } from 'react';
import { fpsToNumber } from '@kerf/model';
import type { ClipDiscoveryReview, HighlightSelection } from '@kerf/tools';
import { assetMediaUrl } from '@kerf/canvas';
import { Button } from '@kerf/ui';
import type { ProviderAccount } from '../../shared/contracts';
import { useStudio } from '../state/StudioProvider';

const field =
  'w-full rounded-sm border border-line bg-surface-0 p-1.5 text-ink';
export function HighlightsPanel() {
  const snapshot = useStudio((s) => s.snapshot);
  const conversationId = useStudio((s) => s.chatConversationId);
  const [open, setOpen] = useState(false);
  const [sourceId, setSourceId] = useState('');
  const [providers, setProviders] = useState<ProviderAccount[]>([]);
  const [providerId, setProviderId] = useState('');
  const [count, setCount] = useState(3);
  const [min, setMin] = useState(20);
  const [max, setMax] = useState(60);
  const [topic, setTopic] = useState('');
  const [reviews, setReviews] = useState<readonly ClipDiscoveryReview[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const generation = useRef(0);
  const projectId = snapshot?.project.id;
  const sources =
    snapshot?.assets.filter(
      (a) => a.kind === 'video' && a.hasAudio && a.status === 'ready',
    ) ?? [];
  useEffect(() => {
    const token = ++generation.current;
    let request = 0;
    setReviews([]);
    setOpen(false);
    setError('');
    setSourceId('');
    setBusy(false);
    lock.current = false;
    const refresh = async () => {
      const id = ++request;
      try {
        const result =
          (await window.kerf.highlights?.reviews(conversationId)) ?? [];
        if (generation.current === token && id === request) setReviews(result);
      } catch (cause) {
        if (generation.current === token) setError(String(cause));
      }
    };
    void refresh();
    const off = window.kerf.events.subscribe((event) => {
      if (['jobs.changed', 'chat.tool', 'project.changed'].includes(event.type))
        void refresh();
    });
    const timer = setInterval(() => void refresh(), 1500);
    return () => {
      generation.current++;
      off();
      clearInterval(timer);
    };
  }, [projectId, conversationId]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    void window.kerf.analysis
      .providers()
      .then((result) => {
        if (active)
          setProviders(result.filter((p) => p.enabled && p.chatConsent));
      })
      .catch((cause) => {
        if (active) setError(String(cause));
      });
    return () => {
      active = false;
    };
  }, [open]);
  if (
    !snapshot ||
    !window.kerf.highlights ||
    (!sources.length && !reviews.length)
  )
    return null;
  const start = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    const token = generation.current;
    try {
      const source = sources.find((a) => a.id === sourceId);
      if (!source) throw new Error('Choose a source video.');
      const result = await window.kerf.highlights!.start({
        assetId: source.id,
        providerId,
        count,
        minSeconds: min,
        maxSeconds: max,
        topic,
      });
      if (token === generation.current)
        setReviews((old) => [result, ...old.filter((r) => r.id !== result.id)]);
    } catch (cause) {
      if (token === generation.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (token === generation.current) {
        lock.current = false;
        setBusy(false);
      }
    }
  };
  return (
    <section
      className="grid gap-2 border-b border-line py-3 text-[11px] text-ink-muted"
      aria-label="Highlights"
    >
      <Button
        size="sm"
        variant="secondary"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Discover highlights
      </Button>
      {open && (
        <div className="grid gap-2">
          <p>
            Find complete thoughts in one transcribed video. Review candidates
            before creating separate editable projects.
          </p>
          <label className="grid gap-1">
            Highlight source
            <select
              className={field}
              aria-label="Highlight source"
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
            >
              <option value="">Choose video</option>
              {sources.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            Discovery provider
            <select
              className={field}
              aria-label="Discovery provider"
              value={providerId}
              onChange={(e) => setProviderId(e.target.value)}
            >
              <option value="">Choose text provider</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          {!providers.length && (
            <p>
              Enable a provider with chat consent in AI settings. Discovery
              sends transcript text to that provider.
            </p>
          )}
          <label className="grid gap-1">
            Number of highlights
            <input
              className={field}
              type="number"
              min={1}
              max={6}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1">
              Minimum seconds
              <input
                className={field}
                type="number"
                min={1}
                max={180}
                value={min}
                onChange={(e) => setMin(Number(e.target.value))}
              />
            </label>
            <label className="grid gap-1">
              Maximum seconds
              <input
                className={field}
                type="number"
                min={1}
                max={180}
                value={max}
                onChange={(e) => setMax(Number(e.target.value))}
              />
            </label>
          </div>
          <label className="grid gap-1">
            Topic or audience (optional)
            <input
              className={field}
              value={topic}
              maxLength={600}
              onChange={(e) => setTopic(e.target.value)}
            />
          </label>
          <p>Source framing is preserved. No automatic crop or export.</p>
          <Button
            size="sm"
            disabled={busy || !providerId || !sourceId}
            onClick={() => void start()}
          >
            {busy ? 'Starting discovery…' : 'Find candidate moments'}
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      {reviews.map((review) => (
        <HighlightReview
          key={`${projectId}-${conversationId}-${review.id}`}
          review={review}
          onChange={(next) =>
            setReviews((old) => old.map((r) => (r.id === next.id ? next : r)))
          }
        />
      ))}
    </section>
  );
}
function HighlightReview({
  review,
  onChange,
}: {
  review: ClipDiscoveryReview;
  onChange: (next: ClipDiscoveryReview) => void;
}) {
  const snapshot = useStudio((s) => s.snapshot);
  const openProject = useStudio((s) => s.openProject);
  const stopPlayback = useStudio((s) => s.setPlaying);
  const activeTurn = useStudio((s) => s.chatActiveTurnId);
  const [expanded, setExpanded] = useState(!review.origin);
  const [selected, setSelected] = useState<HighlightSelection['selections']>(
    [],
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const player = useRef<HTMLVideoElement>(null);
  const [preview, setPreview] = useState<{
    start: number;
    end: number;
    key: string;
  } | null>(null);
  useEffect(() => {
    if (review.requestedSelections && !review.applied)
      setSelected(review.requestedSelections);
  }, [JSON.stringify(review.requestedSelections)]);
  const proposal = review.proposal;
  const asset = snapshot?.assets.find((a) => a.id === proposal?.assetId);
  const fps = proposal ? fpsToNumber(proposal.sourceFrameRate) : 24;
  useEffect(() => {
    if (!review.eligible) {
      player.current?.pause();
      setPreview(null);
    }
  }, [review.eligible]);
  useEffect(() => {
    const element = player.current;
    let handle = 0;
    const tick = () => {
      if (
        element &&
        preview &&
        !element.paused &&
        element.currentTime >= preview.end
      ) {
        element.pause();
        element.currentTime = preview.end;
      }
      handle = requestAnimationFrame(tick);
    };
    if (element && preview) handle = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(handle);
      if (element) {
        element.pause();
        element.removeAttribute('src');
        element.load();
      }
    };
  }, [preview?.key, expanded]);
  const apply = async () => {
    if (lock.current || !review.eligible || !selected.length) return;
    lock.current = true;
    setBusy(true);
    setError('');
    player.current?.pause();
    try {
      const result = await window.kerf.highlights!.confirm({
        jobId: review.id,
        selections: selected,
      });
      onChange({
        ...review,
        applied: true,
        eligible: false,
        outputs: result.outputs,
        reason: 'Outputs created. Open one explicitly to refine it.',
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <div
      className="grid gap-2 border-t border-line pt-2"
      aria-label={`Highlight job ${review.id}`}
    >
      <Button
        size="sm"
        variant="secondary"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        Highlights ·{' '}
        {review.applied
          ? 'Created'
          : review.cancelled
            ? 'Cancelled'
            : review.status}
      </Button>
      {expanded && (
        <>
          <p>{review.stage}</p>
          {review.error && (
            <p role="alert" className="text-danger">
              {review.error}
            </p>
          )}
          {review.reason && <p>{review.reason}</p>}
          {proposal?.warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
          {proposal && (
            <p>
              Revision {proposal.fingerprint.slice(0, 8)} · source{' '}
              {proposal.assetId} · {proposal.sourceFrameRate.numerator}/
              {proposal.sourceFrameRate.denominator} fps
            </p>
          )}
          {proposal?.candidates.map((c) => {
            const value = selected.find((s) => s.candidateId === c.id);
            const startId = value?.startEvidenceId ?? c.startEvidenceId;
            const endId = value?.endEvidenceId ?? c.endEvidenceId;
            const start = proposal.evidence.find((e) => e.id === startId)!;
            const end = proposal.evidence.find((e) => e.id === endId)!;
            const excerpt = proposal.evidence
              .filter(
                (e) =>
                  e.startFrame >= start.startFrame &&
                  e.endFrame <= end.endFrame,
              )
              .map((e) => e.text)
              .join(' ');
            const update = (
              patch: Partial<HighlightSelection['selections'][number]>,
            ) => {
              player.current?.pause();
              setPreview(null);
              setSelected((old) =>
                old.map((s) =>
                  s.candidateId === c.id ? { ...s, ...patch } : s,
                ),
              );
            };
            return (
              <div
                key={c.id}
                className="grid gap-2 border-t border-line pt-2"
                aria-label={`Candidate ${c.id}`}
              >
                <label className="flex items-start gap-2 font-semibold text-ink">
                  <input
                    type="checkbox"
                    disabled={!review.eligible || busy}
                    checked={!!value}
                    onChange={(e) =>
                      setSelected((old) =>
                        e.target.checked
                          ? [...old, { candidateId: c.id }]
                          : old.filter((s) => s.candidateId !== c.id),
                      )
                    }
                  />
                  {c.title}
                </label>
                <p>
                  {((end.endFrame - start.startFrame) / fps).toFixed(2)} seconds
                  · source frames {start.startFrame}–{end.endFrame}
                </p>
                <p>Opening: {start.text}</p>
                <p>{c.rationale}</p>
                <details>
                  <summary>Transcript evidence</summary>
                  <p>{excerpt}</p>
                  <p>Evidence: {c.evidenceIds.join(', ')}</p>
                </details>
                {c.warnings.map((w) => (
                  <p key={w}>{w}</p>
                ))}
                {value && review.eligible && (
                  <>
                    <label className="grid gap-1">
                      Start evidence
                      <select
                        className={field}
                        aria-label="Start evidence"
                        value={startId}
                        onChange={(e) =>
                          update({ startEvidenceId: e.target.value })
                        }
                      >
                        {proposal.evidence.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.id} · {e.text.slice(0, 65)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-1">
                      End evidence
                      <select
                        className={field}
                        aria-label="End evidence"
                        value={endId}
                        onChange={(e) =>
                          update({ endEvidenceId: e.target.value })
                        }
                      >
                        {proposal.evidence.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.id} · {e.text.slice(0, 65)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={
                    !review.eligible || end.endFrame <= start.startFrame
                  }
                  onClick={() => {
                    player.current?.pause();
                    stopPlayback(false);
                    setPreview({
                      start: start.startFrame / fps,
                      end: end.endFrame / fps,
                      key: `${c.id}-${startId}-${endId}`,
                    });
                  }}
                >
                  Preview {c.title}
                </Button>
              </div>
            );
          })}
          {preview && asset && review.eligible && (
            <video
              key={preview.key}
              ref={player}
              controls
              preload="metadata"
              aria-label="Highlight source preview"
              className="w-full rounded-sm"
              src={assetMediaUrl(asset, 'source')}
              onLoadedMetadata={(e) => {
                e.currentTarget.currentTime = preview.start;
              }}
              onPlay={(e) => {
                if (
                  e.currentTarget.currentTime >= preview.end ||
                  e.currentTarget.currentTime < preview.start
                )
                  e.currentTarget.currentTime = preview.start;
              }}
              onSeeking={(e) => {
                if (
                  e.currentTarget.currentTime < preview.start ||
                  e.currentTarget.currentTime > preview.end
                )
                  e.currentTarget.currentTime = preview.start;
              }}
              onTimeUpdate={(e) => {
                if (e.currentTarget.currentTime >= preview.end)
                  e.currentTarget.pause();
              }}
            />
          )}
          {review.eligible && (
            <>
              <p>
                Selected candidates become separate projects using source
                framing and linked media. Unchecked candidates create nothing.
                The source timeline stays intact. Remove an output through the
                normal project browser; later timeline edits use Undo.
              </p>
              <Button
                size="sm"
                disabled={busy || !selected.length}
                onClick={() => void apply()}
              >
                Create selected projects
              </Button>
            </>
          )}
          {!review.applied &&
            !review.cancelled &&
            ['queued', 'running', 'succeeded'].includes(review.status) && (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={async () => {
                  try {
                    onChange(await window.kerf.highlights!.cancel(review.id));
                  } catch (cause) {
                    setError(String(cause));
                  }
                }}
              >
                Cancel highlight discovery
              </Button>
            )}
          {review.outputs.map((o) => (
            <div
              key={o.projectId}
              className="grid gap-1 border-t border-line pt-2"
            >
              <p>
                {o.name} · {o.exists ? 'Created project' : 'Deleted project'}
              </p>
              <p className="break-all">
                Project: {o.projectId}
                <br />
                Video: {o.videoClipId}
                <br />
                Audio: {o.audioClipId}
              </p>
              <Button
                size="sm"
                variant="secondary"
                disabled={!o.exists || busy || !!activeTurn}
                onClick={() => {
                  player.current?.pause();
                  void openProject(o.projectId);
                }}
              >
                Open {o.name}
              </Button>
            </div>
          ))}
          {error && (
            <p role="alert" className="text-danger">
              {error}
            </p>
          )}
        </>
      )}
    </div>
  );
}
