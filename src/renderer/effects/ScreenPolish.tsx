import { useEffect, useRef, useState } from 'react';
import type { Sequence } from '@kerf/model';
import { fpsToNumber } from '@kerf/model';
import { screenPolishCommand, suggestScreenPolish } from '@kerf/engine';
import { assetMediaUrl } from '@kerf/canvas';
import { Button, Field, FieldRow, Input, Select } from '@kerf/ui';
import type { JobSummary, ProviderAccount } from '../../shared/contracts';
import {
  polishSuggestionSchema,
  type PolishSuggestion,
  type PolishProposal,
} from '../../shared/screen-polish';
import { useStudio } from '../state/StudioProvider';
import { selectSelectedClip } from '../state/selectors';

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export function ScreenPolish({
  sequence,
  onOpenSettings,
}: {
  sequence: Sequence;
  onOpenSettings: () => void;
}) {
  const snapshot = useStudio((s) => s.snapshot);
  const selected = useStudio(selectSelectedClip);
  const applyManual = useStudio((s) => s.apply);
  const seek = useStudio((s) => s.setPlayhead);
  const setPlaying = useStudio((s) => s.setPlaying);
  const [providers, setProviders] = useState<ProviderAccount[]>([]);
  const [providerId, setProviderId] = useState('');
  const [clipId, setClipId] = useState('');
  const [draft, setDraft] = useState<PolishSuggestion[]>([]);
  const [proposal, setProposal] = useState<PolishProposal | null>(null);
  const [job, setJob] = useState<JobSummary | null>(null);
  const [signature, setSignature] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [activeId, setActiveId] = useState('');
  const jobRef = useRef<string | null>(null);
  const mounted = useRef(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const clips = sequence.tracks
    .filter((t) => t.kind === 'video')
    .flatMap((t) => t.clips)
    .filter((c) => c.type === 'video');
  const source = clips.find((c) => c.id === clipId);
  const asset = snapshot?.assets.find((a) => a.id === source?.assetId);
  const currentSignature = JSON.stringify([sequence, snapshot?.assets]);
  const stale = Boolean(signature && signature !== currentSignature);
  const running = busy || job?.status === 'queued' || job?.status === 'running';
  const locked = sequence.tracks.some((t) => t.kind === 'effects' && t.locked);
  const eligible = providers.filter((p) => p.enabled && p.visionConsent);
  const active = draft.find((d) => d.id === activeId) ?? draft[0];
  const fps = fpsToNumber(sequence.frameRate);
  const loadProviders = async () => {
    try {
      const accounts = await window.kerf.analysis.providers();
      if (!mounted.current) return;
      setProviders(accounts);
      setProviderId((id) =>
        accounts.some((p) => p.id === id && p.enabled && p.visionConsent)
          ? id
          : (accounts.find((p) => p.enabled && p.visionConsent)?.id ?? ''),
      );
    } catch (err) {
      if (mounted.current) setError(message(err));
    }
  };
  useEffect(() => {
    mounted.current = true;
    void loadProviders();
    return () => {
      mounted.current = false;
      if (jobRef.current)
        void window.kerf.jobs.cancel(jobRef.current).catch(() => undefined);
    };
  }, []);
  useEffect(() => {
    if (!running && !draft.length && selected?.type === 'video')
      setClipId(selected.id);
  }, [selected?.id, running, draft.length]);
  useEffect(() => {
    if (!job || !['queued', 'running'].includes(job.status)) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const jobs = await window.kerf.jobs.list();
        const current = jobs.find((j) => j.id === job.id);
        if (cancelled || !current) return;

        if (current.status === 'succeeded') {
          const result = await window.kerf.screenPolish.proposal(job.id);
          if (cancelled || !result) return;
          setJob(current);
          setProposal(result);
          setDraft(result.suggestions);
          setActiveId(result.suggestions[0]?.id ?? '');
          setNotice(
            result.suggestions.length
              ? `${result.suggestions.length} suggestions from ${result.sampleCount} evidence frames. Review before applying.`
              : 'No clear screen interactions found. No edits were made.',
          );
          jobRef.current = null;
        } else if (
          current.status === 'failed' ||
          current.status === 'cancelled'
        ) {
          setError(current.error ?? 'Analysis cancelled. No edits were made.');
          jobRef.current = null;
        }
        setJob(current);
      } catch (err) {
        if (!cancelled) setError(message(err));
      }
    };
    const timer = setInterval(() => void poll(), 500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [job?.id, job?.status]);
  useEffect(() => {
    if (videoRef.current && active && source) {
      videoRef.current.currentTime =
        (active.evidenceFrames[0] ?? source.sourceInFrame) / fps;
    }
  }, [active?.id, source?.id]);
  const update = (id: string, patch: Partial<PolishSuggestion>) =>
    setDraft((items) =>
      items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  const generate = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    setDraft([]);
    setProposal(null);
    setPlaying(false);
    setSignature(currentSignature);
    try {
      const started = await window.kerf.screenPolish.generate({
        clipId,
        providerId,
      });
      if (!mounted.current) {
        await window.kerf.jobs.cancel(started.id);
        return;
      }
      jobRef.current = started.id;
      setJob(started);
    } catch (err) {
      if (mounted.current) setError(message(err));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      if (stale)
        throw new Error(
          'The timeline or source changed. Analyse again before applying.',
        );
      if (proposal && job)
        await window.kerf.screenPolish.apply({
          jobId: job.id,
          suggestions: draft,
        });
      else if (
        !(await applyManual(
          screenPolishCommand(sequence, draft),
          'Apply screen polish',
        ))
      )
        throw new Error(
          'Polish was not applied. Check the project status and try again.',
        );
      if (mounted.current) {
        setDraft([]);
        setProposal(null);
        setSignature('');
        setNotice(
          'Polish applied. Select an effect to refine it; Undo restores the previous edit.',
        );
      }
    } catch (err) {
      if (mounted.current) setError(message(err));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const showEvidence = (frame: number) => {
    if (videoRef.current) videoRef.current.currentTime = frame / fps;
    if (source) {
      setPlaying(false);
      seek(source.startFrame + frame - source.sourceInFrame);
    }
  };
  return (
    <section aria-label="Screen polish" className="grid gap-3">
      <div className="k-effects__section-title">Screen polish</div>
      <p className="k-inspector__hint">
        Find important screen interactions with AI, then review their focus and
        timing. Sampled frames are sent to your selected vision provider.
      </p>
      <Field label="Video clip">
        <Select
          disabled={running || draft.length > 0}
          aria-label="Video clip"
          value={clipId}
          onChange={(e) => setClipId(e.target.value)}
          options={[
            { value: '', label: 'Select a timeline video' },
            ...clips.map((c) => ({
              value: c.id,
              label:
                c.label ||
                snapshot?.assets.find((a) => a.id === c.assetId)?.name ||
                'Video',
            })),
          ]}
        />
      </Field>
      <Field label="Vision provider">
        <Select
          disabled={running}
          aria-label="Vision provider"
          value={providerId}
          onFocus={() => void loadProviders()}
          onChange={(e) => setProviderId(e.target.value)}
          options={[
            { value: '', label: 'Choose a vision provider' },
            ...eligible.map((p) => ({ value: p.id, label: p.label })),
          ]}
        />
      </Field>
      {!eligible.length && (
        <Button size="sm" variant="secondary" onClick={onOpenSettings}>
          Configure vision provider
        </Button>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={running || locked || !clipId || !providerId}
          onClick={() => void generate()}
        >
          Analyse screen recording
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={running || locked}
          onClick={() => {
            const suggestions = suggestScreenPolish(sequence)
              .filter((s) => s.clipId === (clipId || clips[0]?.id))
              .map((s, i) =>
                polishSuggestionSchema.parse({
                  ...s,
                  id: `manual_${i}`,
                  reason:
                    'Manual clip-start cue. Set focus on the interaction you want to emphasize.',
                  evidenceFrames: [
                    clips.find((c) => c.id === s.clipId)?.sourceInFrame ?? 0,
                  ],
                }),
              );
            if (suggestions[0]) setClipId(suggestions[0].clipId);
            setDraft(suggestions);
            setProposal(null);
            setJob(null);
            setSignature(currentSignature);
            setNotice(
              'Manual suggestions use clip starts, without AI analysis.',
            );
            setError(suggestions.length ? '' : 'No eligible video clips.');
          }}
        >
          Add manual suggestions
        </Button>
        {running && job && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              void window.kerf.jobs
                .cancel(job.id)
                .catch((err) => setError(message(err)))
            }
          >
            Cancel analysis
          </Button>
        )}
      </div>
      {running && (
        <p role="status" className="k-inspector__hint">
          {job?.stage || 'Starting analysis…'}{' '}
          {job ? `${Math.round(job.progress * 100)}%` : ''}
        </p>
      )}
      {notice && (
        <p role="status" className="k-inspector__hint">
          {notice}
        </p>
      )}
      {stale && draft.length > 0 && (
        <p role="alert" className="text-danger text-xs">
          The timeline or source changed. Analyse again before applying.
        </p>
      )}
      {active && asset && source && (
        <div className="grid gap-2">
          <button
            type="button"
            aria-label="Set focus on evidence"
            title="Click to adjust focus; use the fields below for precise coordinates"
            className="relative w-full overflow-hidden rounded-sm border border-line bg-surface-0 focus-visible:outline-accent"
            style={{ aspectRatio: `${sequence.width}/${sequence.height}` }}
            onClick={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              update(active.id, {
                x: Math.min(
                  1,
                  Math.max(0, (event.clientX - box.left) / box.width),
                ),
                y: Math.min(
                  1,
                  Math.max(0, (event.clientY - box.top) / box.height),
                ),
              });
            }}
          >
            <video
              ref={videoRef}
              src={assetMediaUrl(asset, 'source')}
              muted
              preload="auto"
              className="pointer-events-none h-full w-full object-contain"
              onLoadedMetadata={() => {
                if (videoRef.current)
                  videoRef.current.currentTime =
                    (active.evidenceFrames[0] ?? source.sourceInFrame) / fps;
              }}
            />
            <svg
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 h-full w-full"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              <rect
                x={
                  Math.min(
                    1 - (active.width ?? 0.4),
                    Math.max(0, active.x - (active.width ?? 0.4) / 2),
                  ) * 100
                }
                y={
                  Math.min(
                    1 - (active.height ?? 0.3),
                    Math.max(0, active.y - (active.height ?? 0.3) / 2),
                  ) * 100
                }
                width={(active.width ?? 0.4) * 100}
                height={(active.height ?? 0.3) * 100}
                fill="none"
                stroke="var(--color-accent, #c9a46a)"
                strokeWidth="0.8"
              />
            </svg>
          </button>
          <p className="k-inspector__hint">
            Focus preview · click to reposition. Review each evidence frame for
            scrolling or movement.
          </p>
          <div className="flex flex-wrap gap-2">
            {active.evidenceFrames.map((frame) => (
              <Button
                key={frame}
                size="sm"
                variant="secondary"
                onClick={() => showEvidence(frame)}
              >
                Evidence {(frame / fps).toFixed(2)}s
              </Button>
            ))}
          </div>
        </div>
      )}
      {draft.map((item, index) => (
        <div className="grid gap-3 border-t border-line pt-3" key={item.id}>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setActiveId(item.id);
              setPlaying(false);
              seek(item.startFrame);
            }}
          >
            Review suggestion {index + 1}
          </Button>
          <p className="text-xs text-ink-muted">{item.reason}</p>
          <Field label="Effect">
            <Select
              aria-label={`Effect ${index + 1}`}
              value={item.kind}
              onChange={(e) =>
                update(item.id, {
                  kind: e.target.value as PolishSuggestion['kind'],
                })
              }
              options={[
                { value: 'zoom', label: 'Zoom lens' },
                { value: 'spotlight', label: 'Spotlight' },
                { value: 'callout', label: 'Callout' },
              ]}
            />
          </Field>
          <FieldRow>
            {(['x', 'y'] as const).map((axis) => (
              <Field key={axis} label={`Focus ${axis.toUpperCase()} (%)`}>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={
                    Number.isFinite(item[axis])
                      ? Math.round(item[axis] * 1000) / 10
                      : ''
                  }
                  onChange={(e) =>
                    update(item.id, { [axis]: e.target.valueAsNumber / 100 })
                  }
                />
              </Field>
            ))}
          </FieldRow>
          <FieldRow>
            {(['width', 'height'] as const).map((axis) => (
              <Field key={axis} label={`Focus ${axis} (%)`}>
                <Input
                  type="number"
                  min="2"
                  max="100"
                  step="0.1"
                  value={
                    Number.isFinite(item[axis] ?? 0.4)
                      ? Math.round(
                          (item[axis] ?? (axis === 'width' ? 0.4 : 0.3)) * 1000,
                        ) / 10
                      : ''
                  }
                  onChange={(e) =>
                    update(item.id, { [axis]: e.target.valueAsNumber / 100 })
                  }
                />
              </Field>
            ))}
          </FieldRow>
          <FieldRow>
            <Field label="Start frame">
              <Input
                type="number"
                min="0"
                step="1"
                value={Number.isFinite(item.startFrame) ? item.startFrame : ''}
                onChange={(e) =>
                  update(item.id, { startFrame: e.target.valueAsNumber })
                }
              />
            </Field>
            <Field label="Duration (frames)">
              <Input
                type="number"
                min="1"
                step="1"
                value={
                  Number.isFinite(item.durationFrames)
                    ? item.durationFrames
                    : ''
                }
                onChange={(e) =>
                  update(item.id, { durationFrames: e.target.valueAsNumber })
                }
              />
            </Field>
          </FieldRow>
          <FieldRow>
            <Field label="Transition (frames)">
              <Input
                type="number"
                min="0"
                step="1"
                value={item.transitionFrames ?? Math.round(fps * 0.25)}
                onChange={(e) =>
                  update(item.id, { transitionFrames: e.target.valueAsNumber })
                }
              />
            </Field>
            {item.kind === 'zoom' && (
              <Field label="Zoom amount">
                <Input
                  type="number"
                  min="1"
                  max="8"
                  step="0.1"
                  value={item.zoom ?? 2}
                  onChange={(e) =>
                    update(item.id, { zoom: e.target.valueAsNumber })
                  }
                />
              </Field>
            )}
          </FieldRow>
          {item.kind === 'callout' && (
            <Field label="Callout text">
              <Input
                maxLength={300}
                value={item.text}
                onChange={(e) => update(item.id, { text: e.target.value })}
              />
            </Field>
          )}
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              setDraft((items) => items.filter((s) => s.id !== item.id))
            }
          >
            Dismiss suggestion {index + 1}
          </Button>
        </div>
      ))}
      {error && (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}
      {draft.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={running || locked || stale}
            onClick={() => void submit()}
          >
            {busy ? 'Applying…' : 'Apply screen polish'}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={running}
            onClick={() => {
              setDraft([]);
              setProposal(null);
              setSignature('');
            }}
          >
            Discard draft
          </Button>
        </div>
      )}
      {locked && (
        <p className="k-inspector__hint">
          Unlock the Effects track to apply polish.
        </p>
      )}
    </section>
  );
}
