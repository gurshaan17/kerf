import type { ClipId } from '@kerf/model';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@kerf/ui';
import type { AudioFinishPlan, AudioMeasurement } from '@kerf/tools';
import { useStudio, useStudioStoreApi } from '../state/StudioProvider';

export function AudioFinishingPanel() {
  const snapshot = useStudio((s) => s.snapshot);
  const selection = useStudio((s) => s.selection.clipIds);
  const conversationId = useStudio((s) => s.chatConversationId);
  const store = useStudioStoreApi();
  const [open, setOpen] = useState(false);
  const [measurement, setMeasurement] = useState<AudioMeasurement | null>(null);
  const [plans, setPlans] = useState<readonly AudioFinishPlan[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState(-16);
  const [ceiling, setCeiling] = useState(-1);
  const [fade, setFade] = useState(50);
  const [speechIds, setSpeechIds] = useState<ClipId[]>([]);
  const [gain, setGain] = useState(35);
  const [attack, setAttack] = useState(100);
  const [release, setRelease] = useState(250);
  const requestId = useRef<string | null>(null);
  const version = useRef(0);
  const lock = useRef(false);
  const projectId = snapshot?.project.id;
  const clips = snapshot?.project.sequence.tracks.flatMap((t) => t.clips) ?? [];
  const media = clips.filter(
    (c) =>
      (c.type === 'audio' || c.type === 'video') &&
      snapshot?.assets.some(
        (a) => a.id === c.assetId && a.hasAudio && a.status === 'ready',
      ),
  );
  const selected = media.filter((c) => selection.includes(c.id));
  const speechAssets = new Set(
    snapshot?.transcripts
      .filter((t) => t.source === 'speech')
      .map((t) => t.assetId),
  );
  const speech = media.filter(
    (c) =>
      'assetId' in c &&
      snapshot?.transcripts.some(
        (t) =>
          t.assetId === c.assetId &&
          t.source === 'speech' &&
          t.status === 'reviewed',
      ),
  );
  const backgrounds = selected.filter(
    (c) => 'assetId' in c && !speechAssets.has(c.assetId),
  );
  const supported =
    selected.length > 0 &&
    selected.length <= 20 &&
    selected.every(
      (c) =>
        (c.type === 'audio' || c.type === 'video') &&
        c.speed === 1 &&
        !c.timeMap.length,
    );
  const label = (id: string) => clips.find((c) => c.id === id)?.label || id;

  useEffect(() => {
    let active = true;
    let generation = 0;
    const refresh = async () => {
      const id = ++generation;
      try {
        const result =
          (await window.kerf.audioFinishing?.reviews(conversationId)) ?? [];
        if (active && id === generation) setPlans(result);
      } catch (cause) {
        if (active) setError(String(cause));
      }
    };
    setPlans([]);
    setSpeechIds([]);
    setOpen(false);
    setError('');
    void refresh();
    const off = window.kerf.events.subscribe((event) => {
      if (['chat.tool', 'project.changed'].includes(event.type)) void refresh();
    });
    const timer = setInterval(() => void refresh(), 1500);
    return () => {
      active = false;
      off();
      clearInterval(timer);
    };
  }, [projectId, conversationId]);

  useEffect(() => {
    version.current++;
    lock.current = false;
    setBusy(false);
    setMeasurement(null);
    if (requestId.current)
      void window.kerf.audioFinishing?.cancel(requestId.current);
    requestId.current = null;
    return () => {
      version.current++;
      if (requestId.current)
        void window.kerf.audioFinishing?.cancel(requestId.current);
    };
  }, [
    projectId,
    conversationId,
    selection.join('|'),
    snapshot?.project.updatedAt,
  ]);

  const run = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    const token = ++version.current;
    try {
      await action();
    } catch (cause) {
      if (token === version.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (token === version.current) {
        lock.current = false;
        setBusy(false);
        requestId.current = null;
      }
    }
  };
  const current = () =>
    store.getState().snapshot?.project.id === projectId &&
    store.getState().chatConversationId === conversationId;
  const addPlan = (plan: AudioFinishPlan) => {
    if (current())
      setPlans((old) => [...old.filter((p) => p.id !== plan.id), plan]);
  };
  if (
    !snapshot ||
    !window.kerf.audioFinishing ||
    (!selected.length && !plans.length)
  )
    return null;
  return (
    <section
      className="grid gap-2 border-b border-line py-3 text-[11px] text-ink-muted"
      aria-label="Audio finishing"
    >
      {selected.length > 0 && (
        <Button
          size="sm"
          variant="secondary"
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
            if (!open)
              setSpeechIds(
                speech.filter((c) => selection.includes(c.id)).map((c) => c.id),
              );
          }}
        >
          Audio finishing
        </Button>
      )}
      {open && (
        <div className="grid gap-2">
          <p>
            Selected audio: {selected.map((c) => c.label || c.id).join(', ')}
          </p>
          {!supported && (
            <p>
              Select one to twenty normal-speed clips with ready source audio.
            </p>
          )}
          <Button
            size="sm"
            disabled={busy || !supported}
            onClick={() =>
              void run(async () => {
                const token = version.current;
                const id = crypto.randomUUID();
                requestId.current = id;
                const result = await window.kerf.audioFinishing!.measure({
                  clipIds: selected.map((c) => c.id),
                  requestId: id,
                });
                if (current() && token === version.current)
                  setMeasurement(result);
              })
            }
          >
            Measure selected audio
          </Button>
          {busy && requestId.current && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                if (requestId.current)
                  void window.kerf.audioFinishing?.cancel(requestId.current);
              }}
            >
              Cancel measurement
            </Button>
          )}
          {measurement && (
            <div aria-label="Audio measurements" className="grid gap-1">
              <p>
                Integrated loudness:{' '}
                {measurement.integratedLufs === null
                  ? 'Unavailable'
                  : `${measurement.integratedLufs.toFixed(2)} LUFS`}
              </p>
              <p>
                True peak:{' '}
                {measurement.truePeakDbtp === null
                  ? 'Unavailable'
                  : `${measurement.truePeakDbtp.toFixed(2)} dBTP`}
              </p>
              <p>
                Frames {measurement.startFrame}–{measurement.endFrame} ·
                revision {measurement.revision.slice(0, 8)}
              </p>
              <p>{measurement.note}</p>
              {measurement.status === 'measured' && (
                <>
                  <label className="grid gap-1">
                    Loudness target (LUFS)
                    <input
                      type="number"
                      min={-40}
                      max={-8}
                      value={target}
                      onChange={(e) => setTarget(Number(e.target.value))}
                      className="rounded-sm border border-line bg-surface-0 p-1.5 text-ink"
                    />
                  </label>
                  <label className="grid gap-1">
                    Peak ceiling (dBTP)
                    <input
                      type="number"
                      min={-24}
                      max={0}
                      value={ceiling}
                      onChange={(e) => setCeiling(Number(e.target.value))}
                      className="rounded-sm border border-line bg-surface-0 p-1.5 text-ink"
                    />
                  </label>
                  <label className="grid gap-1">
                    Minimum fades (ms)
                    <input
                      type="number"
                      min={0}
                      max={250}
                      value={fade}
                      onChange={(e) => setFade(Number(e.target.value))}
                      className="rounded-sm border border-line bg-surface-0 p-1.5 text-ink"
                    />
                  </label>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void run(async () =>
                        addPlan(
                          await window.kerf.audioFinishing!.gain({
                            measurementId: measurement.id,
                            targetLufs: target,
                            peakCeilingDbtp: ceiling,
                            fadeMs: fade,
                          }),
                        ),
                      )
                    }
                  >
                    Plan gain and fades
                  </Button>
                </>
              )}
            </div>
          )}
          {backgrounds.length > 0 && (
            <fieldset className="grid gap-2 border-t border-line pt-2">
              <legend>Speech-envelope ducking</legend>
              <p>
                Backgrounds from selection:{' '}
                {backgrounds.map((c) => c.label || c.id).join(', ')}
              </p>
              <div className="grid max-h-32 gap-1 overflow-auto">
                {speech.map((c) => (
                  <label key={c.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={speechIds.includes(c.id)}
                      onChange={(e) =>
                        setSpeechIds((ids) =>
                          e.target.checked
                            ? [...ids, c.id]
                            : ids.filter((id) => id !== c.id),
                        )
                      }
                    />
                    Speech: {c.label || c.id}
                  </label>
                ))}
              </div>
              {!speech.length && (
                <p>Review an indexed speech transcript before ducking.</p>
              )}
              <label className="grid gap-1">
                Background during speech (%)
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={gain}
                  onChange={(e) => setGain(Number(e.target.value))}
                  className="rounded-sm border border-line bg-surface-0 p-1.5 text-ink"
                />
              </label>
              <label className="grid gap-1">
                Attack (ms)
                <input
                  type="number"
                  min={20}
                  max={1000}
                  value={attack}
                  onChange={(e) => setAttack(Number(e.target.value))}
                  className="rounded-sm border border-line bg-surface-0 p-1.5 text-ink"
                />
              </label>
              <label className="grid gap-1">
                Release (ms)
                <input
                  type="number"
                  min={20}
                  max={2000}
                  value={release}
                  onChange={(e) => setRelease(Number(e.target.value))}
                  className="rounded-sm border border-line bg-surface-0 p-1.5 text-ink"
                />
              </label>
              <Button
                size="sm"
                disabled={busy || !speechIds.length || !supported}
                onClick={() =>
                  void run(async () =>
                    addPlan(
                      await window.kerf.audioFinishing!.duck({
                        speechClipIds: speechIds,
                        backgroundClipIds: backgrounds.map((c) => c.id),
                        gain: gain / 100,
                        attackMs: attack,
                        releaseMs: release,
                      }),
                    ),
                  )
                }
              >
                Plan speech ducking
              </Button>
            </fieldset>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      {plans.map((plan) => (
        <div
          key={plan.id}
          className="grid gap-1.5 border-t border-line pt-2"
          aria-label={`Audio plan ${plan.id}`}
        >
          <p className="font-semibold text-ink">
            {plan.kind === 'gain' ? 'Gain and fades' : 'Speech ducking'} ·{' '}
            {plan.status}
          </p>
          {plan.gainDb !== undefined && (
            <p>
              Target: {plan.targetLufs} LUFS · Ceiling: {plan.peakCeilingDbtp}{' '}
              dBTP
              <br />
              Estimated gain: {plan.gainDb.toFixed(2)} dB · Estimated peak:{' '}
              {plan.estimatedPeakDbtp?.toFixed(2)} dBTP
            </p>
          )}
          {plan.changes.map((c) => (
            <p key={c.clipId}>
              {label(c.clipId)} · {Math.round(c.beforeVolume * 100)}% →{' '}
              {Math.round(c.afterVolume * 100)}%
              {c.keyframeCount !== undefined
                ? ` · ${c.keyframeCount} envelope points`
                : ` · fades ${c.fadeInFrames}/${c.fadeOutFrames} frames`}
            </p>
          ))}
          {plan.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
          {plan.status !== 'applied' && (
            <Button
              size="sm"
              disabled={busy || plan.status !== 'ready'}
              onClick={() =>
                void run(async () => {
                  const result = await window.kerf.audioFinishing!.confirm(
                    plan.id,
                  );
                  if (current())
                    setPlans((old) =>
                      old.map((p) =>
                        p.id === plan.id
                          ? { ...p, status: 'applied', receipt: result.receipt }
                          : p,
                      ),
                    );
                })
              }
            >
              Apply reviewed audio changes
            </Button>
          )}
          {plan.receipt && (
            <p>
              Applied · One undo step. Listen to the timeline and remeasure to
              check the result.
            </p>
          )}
        </div>
      ))}
    </section>
  );
}
