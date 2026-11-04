import { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Scissors, Square } from 'lucide-react';
import { autoCutKeptRanges, fpsToNumber } from '@kerf/model';
import { autoCutContext, findClip } from '@kerf/engine';
import { assetMediaUrl } from '@kerf/canvas';
import { Button, Dialog, Field, Select, Textarea } from '@kerf/ui';
import type { AutoCutProposal } from '../../shared/auto-cut';
import type { JobSummary, ProviderAccount } from '../../shared/contracts';
import { useStudio } from '../state/StudioProvider';
import { autoCutPreviewDestination } from './preview';

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
function duration(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
}

export function AutoCutDialog({
  clipId,
  onClose,
  onOpenSettings,
}: {
  clipId: string;
  onClose: () => void;
  onOpenSettings: () => void;
}) {
  const snapshot = useStudio((state) => state.snapshot);
  const setPlaying = useStudio((state) => state.setPlaying);
  const pushToast = useStudio((state) => state.pushToast);
  const [providers, setProviders] = useState<ProviderAccount[]>([]);
  const [providerId, setProviderId] = useState('');
  const [purpose, setPurpose] = useState('');
  const [job, setJob] = useState<JobSummary | null>(null);
  const [proposal, setProposal] = useState<AutoCutProposal | null>(null);
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [requestSignature, setRequestSignature] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loadingProviders, setLoadingProviders] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [applying, setApplying] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const jobRef = useRef<string | null>(null);
  const mounted = useRef(true);
  const clip = snapshot && findClip(snapshot.project.sequence, clipId)?.clip;
  const asset =
    clip?.type === 'video'
      ? snapshot?.assets.find((a) => a.id === clip.assetId)
      : null;
  const currentJob = snapshot?.jobs.find((j) => j.id === job?.id) ?? job;
  const running =
    submitting ||
    currentJob?.status === 'queued' ||
    currentJob?.status === 'running';
  const eligibleProviders = providers.filter(
    (p) => p.enabled && p.visionConsent && p.chatConsent,
  );
  const fps = proposal
    ? fpsToNumber(proposal.frameRate)
    : snapshot
      ? fpsToNumber(snapshot.project.sequence.frameRate)
      : 24;
  const signature = JSON.stringify([
    snapshot?.project.id,
    snapshot?.project.updatedAt,
    snapshot?.project.sequence,
    asset,
    snapshot?.transcripts.filter(
      (t) => t.assetId === asset?.id && t.source === 'speech',
    ),
  ]);
  const stale = Boolean(requestSignature && requestSignature !== signature);
  let unavailable: string | null = null;
  if (!snapshot || !clip || clip.type !== 'video' || !asset)
    unavailable = 'Select a video clip on the timeline.';
  else {
    try {
      autoCutContext(snapshot.project.sequence, clipId);
    } catch (error) {
      unavailable = message(error);
    }
    if (asset.status !== 'ready')
      unavailable = 'Wait for the source video to be ready.';
    if (clip.durationFrames / fps > 300)
      unavailable = 'Choose a clip up to five minutes long.';
  }
  const removals = useMemo(
    () => proposal?.removals.filter((r) => removedIds.includes(r.id)) ?? [],
    [proposal, removedIds],
  );
  const kept = useMemo(
    () =>
      proposal
        ? autoCutKeptRanges(proposal.startFrame, proposal.endFrame, removals)
        : [],
    [proposal, removals],
  );
  const originalFrames = proposal
    ? proposal.endFrame - proposal.startFrame
    : (clip?.durationFrames ?? 0);
  const removedFrames = removals.reduce(
    (sum, r) => sum + r.endFrame - r.startFrame,
    0,
  );

  useEffect(() => {
    mounted.current = true;
    setPlaying(false);
    void window.kerf.analysis
      .providers()
      .then((accounts) => {
        if (!mounted.current) return;
        setProviders(accounts);
        setProviderId(
          accounts.find((p) => p.enabled && p.visionConsent && p.chatConsent)
            ?.id ?? '',
        );
      })
      .catch((error) => {
        if (mounted.current) setError(message(error));
      })
      .finally(() => {
        if (mounted.current) setLoadingProviders(false);
      });
    return () => {
      mounted.current = false;
      videoRef.current?.pause();
      if (jobRef.current)
        void window.kerf.jobs.cancel(jobRef.current).catch(() => undefined);
    };
  }, [setPlaying]);

  useEffect(() => {
    if (
      !currentJob ||
      !['succeeded', 'failed', 'cancelled'].includes(currentJob.status)
    )
      return;
    let cancelled = false;
    if (currentJob.status === 'succeeded') {
      void window.kerf.autoCut
        .proposal(currentJob.id)
        .then((result) => {
          if (cancelled || !result) return;
          setProposal(result);
          setRemovedIds(result.removals.map((r) => r.id));
        })
        .catch((error) => {
          if (!cancelled) setError(message(error));
        });
    } else if (currentJob.status === 'failed')
      setError(
        currentJob.error ??
          'Analysis failed. Try again or choose another configured provider.',
      );
    return () => {
      cancelled = true;
    };
  }, [currentJob?.id, currentJob?.status, currentJob?.error]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !previewing) return;
    let handle = 0;
    const tick = () => {
      const frame = video.currentTime * fps;
      const destination = autoCutPreviewDestination(frame, kept);
      if (destination === null || stale) {
        video.pause();
        setPreviewing(false);
        return;
      }
      if (destination > frame + 0.5) video.currentTime = destination / fps;
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [previewing, kept, fps, stale]);

  useEffect(() => {
    const video = videoRef.current;
    return () => video?.pause();
  }, [proposal]);

  const stop = () => {
    videoRef.current?.pause();
    setPreviewing(false);
  };
  const generate = async () => {
    stop();
    setSubmitting(true);
    setError(null);
    setProposal(null);
    setRemovedIds([]);
    setJob(null);
    setRequestSignature(signature);
    try {
      const started = await window.kerf.autoCut.generate({
        clipId,
        providerId,
        purpose,
      });
      if (!mounted.current) {
        await window.kerf.jobs.cancel(started.id);
        return;
      }
      jobRef.current = started.id;
      setJob(started);
    } catch (error) {
      if (mounted.current) setError(message(error));
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  };
  const preview = async () => {
    const video = videoRef.current;
    if (!video || !kept.length) return;
    setError(null);
    video.currentTime = kept[0]!.startFrame / fps;
    setPreviewing(true);
    try {
      await video.play();
    } catch (error) {
      setPreviewing(false);
      setError(`Preview could not play: ${message(error)}`);
    }
  };
  const apply = async () => {
    if (!job) return;
    stop();
    setApplying(true);
    setError(null);
    try {
      await window.kerf.autoCut.apply({
        jobId: job.id,
        removalIds: removedIds,
      });
      pushToast({
        title: 'Auto cut applied',
        description: `${duration(originalFrames / fps)} → ${duration((originalFrames - removedFrames) / fps)} · Undo restores the full edit.`,
        tone: 'success',
      });
      onClose();
    } catch (error) {
      if (mounted.current) setError(message(error));
    } finally {
      if (mounted.current) setApplying(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !applying) onClose();
      }}
      panelClassName="flex max-h-[calc(100dvh-50px)] flex-col [&>header]:shrink-0 [&>div]:min-h-0 [&>div]:overflow-y-auto [&>footer]:shrink-0"
      title="Auto cut"
      description="Keep the useful moments. Review every cut before changing the timeline."
      footer={
        <>
          <Button variant="ghost" disabled={applying} onClick={onClose}>
            Close
          </Button>
          {proposal ? (
            <Button
              variant="primary"
              leadingIcon={<Scissors size={14} />}
              disabled={running || stale || !!unavailable || !removedIds.length}
              loading={applying}
              onClick={() => void apply()}
            >
              Apply cuts
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={
                running || !!unavailable || !providerId || loadingProviders
              }
              loading={running}
              onClick={() => void generate()}
            >
              {running ? 'Analysing…' : 'Analyse clip'}
            </Button>
          )}
        </>
      }
    >
      <div className="grid gap-4 text-[12px]">
        <p className="truncate text-ink-muted" title={asset?.name}>
          {asset?.name ?? 'No video selected'} ·{' '}
          {duration(originalFrames / fps)}
        </p>
        {unavailable && (
          <p role="alert" className="text-danger">
            {unavailable}
          </p>
        )}
        {!proposal && (
          <>
            <Field
              label="What should this edit keep?"
              optional
              hint="Leave blank to keep the main action and useful explanation."
            >
              <Textarea
                value={purpose}
                maxLength={1000}
                disabled={running}
                placeholder="For example: keep the product demonstration"
                onChange={(event) => setPurpose(event.target.value)}
              />
            </Field>
            <Field label="Analysis provider">
              <Select
                value={providerId}
                disabled={running || loadingProviders}
                onChange={(event) => setProviderId(event.target.value)}
                options={
                  eligibleProviders.length
                    ? eligibleProviders.map((p) => ({
                        value: p.id,
                        label: `${p.label} · ${p.model ?? 'default model'}`,
                      }))
                    : [
                        {
                          value: '',
                          label: loadingProviders
                            ? 'Loading providers…'
                            : 'No eligible provider',
                        },
                      ]
                }
              />
            </Field>
            <p className="text-ink-muted">
              Analysis sends sampled frames, speech text and your purpose to the
              selected provider. Speech transcription runs locally. Duration
              follows the content.
            </p>
            {!loadingProviders && !eligibleProviders.length && (
              <div className="grid justify-items-start gap-2">
                <p>
                  Enable Vision and Chat consent for a vision-capable provider
                  in AI settings.
                </p>
                <Button size="sm" onClick={onOpenSettings}>
                  Open AI settings
                </Button>
              </div>
            )}
          </>
        )}
        {running && (
          <div className="grid gap-2" role="status" aria-live="polite">
            <p>
              {currentJob?.stage || 'Preparing analysis'} ·{' '}
              {Math.round((currentJob?.progress ?? 0) * 100)}%
            </p>
            <progress
              className="h-1 w-full accent-accent"
              aria-label="Auto cut analysis progress"
              value={currentJob?.progress ?? 0}
              max={1}
            />
            <Button
              size="sm"
              className="justify-self-start"
              disabled={!job}
              onClick={() => {
                if (job)
                  void window.kerf.jobs
                    .cancel(job.id)
                    .catch((error) => setError(message(error)));
              }}
            >
              Cancel analysis
            </Button>
          </div>
        )}
        {currentJob?.status === 'cancelled' && (
          <p role="status" className="text-ink-muted">
            Analysis cancelled. You can analyse the clip again.
          </p>
        )}
        {proposal && (
          <>
            <div role="status" className="grid gap-1 border-y border-line py-3">
              <p className="text-[18px] font-semibold tabular-nums">
                {duration(originalFrames / fps)} →{' '}
                {duration((originalFrames - removedFrames) / fps)}
              </p>
              <p className="text-ink-muted">
                {removedIds.length}{' '}
                {removedIds.length === 1 ? 'section' : 'sections'} removed ·{' '}
                {(removedFrames / fps).toFixed(1)}s shorter
              </p>
            </div>
            {!proposal.removals.length && (
              <p>
                No clearly irrelevant sections found. The full clip is kept.
              </p>
            )}
            {asset && (
              <div className="grid gap-2">
                <video
                  ref={videoRef}
                  src={assetMediaUrl(asset, 'source')}
                  controls
                  preload="metadata"
                  playsInline
                  className="aspect-video w-full rounded-sm bg-surface-0"
                  aria-label="Auto cut source preview"
                  onPause={() => setPreviewing(false)}
                  onEnded={() => setPreviewing(false)}
                />
                <p className="text-[11px] text-ink-muted">
                  Source preview · Preview edit skips selected removals.
                </p>
                <Button
                  size="sm"
                  className="justify-self-start"
                  leadingIcon={
                    previewing ? <Square size={13} /> : <Play size={13} />
                  }
                  disabled={stale}
                  onClick={() => {
                    if (previewing) stop();
                    else void preview();
                  }}
                >
                  {previewing ? 'Stop preview' : 'Preview edit'}
                </Button>
              </div>
            )}
            {proposal.removals.length > 0 && (
              <fieldset className="grid gap-2">
                <legend className="mb-2 font-semibold">
                  Proposed removals
                </legend>
                <p className="text-ink-muted">Uncheck a section to keep it.</p>
                <ul className="max-h-44 overflow-y-auto divide-y divide-line">
                  {proposal.removals.map((range, index) => (
                    <li key={range.id} className="grid gap-2 py-3">
                      <label className="flex cursor-pointer items-start gap-3">
                        <input
                          className="mt-0.5 accent-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                          type="checkbox"
                          aria-label={`Remove section ${index + 1}`}
                          checked={removedIds.includes(range.id)}
                          disabled={applying || stale}
                          onChange={(event) => {
                            stop();
                            setRemovedIds((ids) =>
                              event.target.checked
                                ? [...ids, range.id]
                                : ids.filter((id) => id !== range.id),
                            );
                          }}
                        />
                        <span className="grid gap-1">
                          <span className="font-mono tabular-nums">
                            {duration(
                              (range.startFrame - proposal.startFrame) / fps,
                            )}
                            –
                            {duration(
                              (range.endFrame - proposal.startFrame) / fps,
                            )}{' '}
                            ·{' '}
                            {(
                              (range.endFrame - range.startFrame) /
                              fps
                            ).toFixed(1)}
                            s
                          </span>
                          <span className="text-ink-muted">{range.reason}</span>
                        </span>
                      </label>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="justify-self-start"
                        disabled={stale}
                        onClick={() => {
                          stop();
                          const video = videoRef.current;
                          if (video) {
                            video.currentTime = range.startFrame / fps;
                            void video
                              .play()
                              .catch((error) => setError(message(error)));
                          }
                        }}
                      >
                        View section {index + 1}
                      </Button>
                    </li>
                  ))}
                </ul>
              </fieldset>
            )}
            <p className="text-[11px] text-ink-muted">
              Cuts include matching source audio. Later timeline content shifts
              together. Apply creates one undo step.
            </p>
            <Button
              size="sm"
              className="justify-self-start"
              disabled={running || applying}
              onClick={() => {
                stop();
                setProposal(null);
                setRequestSignature('');
                setJob(null);
                setError(null);
              }}
            >
              Change purpose or analyse again
            </Button>
          </>
        )}
        {stale && (
          <p role="alert" className="text-danger">
            The timeline, transcript or source changed. Analyse again before
            applying.
          </p>
        )}
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
