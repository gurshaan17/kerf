import { useCallback, useEffect, useState } from 'react';
import { Button, Input } from '@kerf/ui';
import {
  fpsToNumber,
  type Asset,
  type FrameRate,
  type Transcript,
} from '@kerf/model';
import type { TtsProvider, TtsProviderSave, TtsTake } from '../../shared/tts';
import { useStudio } from '../state/StudioProvider';

const providersByKind: { value: TtsProvider['kind']; label: string }[] = [
  { value: 'aws-polly', label: 'AWS Polly' },
  { value: 'google-cloud', label: 'Google Cloud TTS' },
  { value: 'smallest', label: 'Smallest.ai' },
  { value: 'lemonfox', label: 'LemonFox.ai' },
  { value: 'openai-compatible', label: 'OpenAI-compatible endpoint' },
];
const emptyProvider: TtsProviderSave = {
  kind: 'lemonfox',
  label: '',
  voice: '',
  model: '',
  endpoint: '',
  region: 'us-east-1',
  language: 'en-US',
  speed: 1,
};
const selectClass = 'block w-full rounded border border-line bg-surface-2 p-2';
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export function Voiceover({
  transcript,
  asset,
  rate,
  disabled = false,
}: {
  transcript: Transcript;
  asset: Asset;
  rate: FrameRate;
  disabled?: boolean;
}) {
  const bridge = window.kerf.tts;
  const snapshot = useStudio((s) => s.snapshot);
  const [providers, setProviders] = useState<TtsProvider[]>([]);
  const [providerId, setProviderId] = useState('');
  const [draft, setDraft] = useState<TtsProviderSave>(emptyProvider);
  const [credentials, setCredentials] = useState('');
  const [editing, setEditing] = useState(false);
  const [takes, setTakes] = useState<TtsTake[]>([]);
  const [rowId, setRowId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const jobs = snapshot?.jobs;
  const refreshTakes = useCallback(async () => {
    if (bridge) setTakes(await bridge.takes(transcript.id));
  }, [bridge, transcript.id]);

  useEffect(() => {
    if (!bridge) return;
    let active = true;
    void bridge
      .providers()
      .then((items) => {
        if (active) {
          setProviders(items);
          setProviderId((id) =>
            items.some((p) => p.id === id) ? id : (items[0]?.id ?? ''),
          );
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(errorMessage(cause));
      });
    return () => {
      active = false;
    };
  }, [bridge]);

  useEffect(() => {
    let active = true;
    if (bridge)
      void bridge
        .takes(transcript.id)
        .then((items) => {
          if (active) setTakes(items);
        })
        .catch((cause: unknown) => {
          if (active) setError(errorMessage(cause));
        });
    return () => {
      active = false;
    };
  }, [bridge, transcript.id, jobs]);

  if (!bridge) return null;
  const provider = providers.find((p) => p.id === providerId);
  const speechJobs = (jobs ?? []).filter(
    (job) =>
      job.kind === 'narration.tts' &&
      (job.status === 'queued' || job.status === 'running'),
  );
  const blocked = busy || disabled;
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  const save = () =>
    run(async () => {
      const saved = await bridge.saveProvider({
        ...draft,
        credentials: credentials.trim() || undefined,
      });
      setCredentials('');
      setProviders(await bridge.providers());
      setProviderId(saved.id);
      setEditing(false);
      setMessage('Voice settings saved.');
    });
  const generate = () =>
    run(async () => {
      const rows = rowId
        ? transcript.segments.filter((s) => s.id === rowId)
        : transcript.segments;
      let count = 0;
      try {
        for (const row of rows) {
          await bridge.generate({
            transcriptId: transcript.id,
            segmentId: row.id,
            expectedRevision: transcript.revision,
            providerId,
          });
          count++;
        }
      } finally {
        if (count)
          setMessage(
            `${count} ${count === 1 ? 'row' : 'rows'} queued. Follow progress in Jobs.`,
          );
      }
    });
  const update = <K extends keyof TtsProviderSave>(
    key: K,
    value: TtsProviderSave[K],
  ) => setDraft((previous) => ({ ...previous, [key]: value }));

  return (
    <details className="mb-4 border-y border-line py-3">
      <summary className="cursor-pointer font-medium">Generate voice</summary>
      <div className="mt-3 grid gap-3">
        <p className="text-ink-muted">
          Generate speech from saved narration, listen, then add it to the
          timeline. Your text is sent to the selected provider; provider charges
          may apply.
        </p>
        <label className="grid gap-1">
          Speech provider
          <select
            className={selectClass}
            value={providerId}
            disabled={busy}
            onChange={(e) => {
              setProviderId(e.target.value);
              setEditing(false);
              setCredentials('');
            }}
          >
            <option value="">Choose a speech provider</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} · {p.voice}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-1">
          <Button
            size="sm"
            disabled={busy}
            onClick={() => {
              setDraft(emptyProvider);
              setCredentials('');
              setEditing(true);
            }}
          >
            Add provider
          </Button>
          <Button
            size="sm"
            disabled={busy || !provider}
            onClick={() => {
              if (!provider) return;
              const { hasCredentials: _hasCredentials, ...settings } = provider;
              setDraft(settings);
              setCredentials('');
              setEditing(true);
            }}
          >
            Edit provider
          </Button>
          <Button
            size="sm"
            disabled={busy || !provider}
            onClick={() =>
              void run(async () => {
                await bridge.deleteProvider(providerId);
                const items = await bridge.providers();
                setProviders(items);
                setProviderId(items[0]?.id ?? '');
                setEditing(false);
                setCredentials('');
              })
            }
          >
            Delete provider
          </Button>
        </div>
        {editing && (
          <fieldset disabled={busy} className="grid min-w-0 gap-3">
            <legend className="mb-2 font-medium">
              {draft.id ? 'Edit speech provider' : 'New speech provider'}
            </legend>
            <label className="grid gap-1">
              Service
              <select
                className={selectClass}
                aria-label="Speech service"
                value={draft.kind}
                onChange={(e) => {
                  update('kind', e.target.value as TtsProvider['kind']);
                  setCredentials('');
                }}
                disabled={Boolean(draft.id)}
              >
                {providersByKind.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              Name
              <Input
                value={draft.label}
                aria-label="Speech provider name"
                maxLength={80}
                onChange={(e) => update('label', e.target.value)}
              />
            </label>
            {draft.kind === 'openai-compatible' && (
              <label className="grid gap-1">
                Speech endpoint URL
                <Input
                  value={draft.endpoint ?? ''}
                  placeholder="https://your-provider.example/v1/audio/speech"
                  onChange={(e) => update('endpoint', e.target.value)}
                />
                <span className="text-ink-muted">
                  Must accept the OpenAI speech request format and return audio.
                  HTTPS is required except on localhost.
                </span>
              </label>
            )}
            <div className="grid grid-cols-2 gap-2">
              {draft.kind !== 'google-cloud' && draft.kind !== 'lemonfox' && (
                <label className="grid gap-1">
                  Model / engine
                  <Input
                    value={draft.model ?? ''}
                    placeholder={
                      draft.kind === 'aws-polly'
                        ? 'neural'
                        : draft.kind === 'smallest'
                          ? 'lightning_v3.1'
                          : 'Provider model ID'
                    }
                    maxLength={200}
                    onChange={(e) => update('model', e.target.value)}
                  />
                </label>
              )}
              <label className="grid gap-1">
                Voice ID
                <Input
                  value={draft.voice}
                  maxLength={200}
                  onChange={(e) => update('voice', e.target.value)}
                />
              </label>
              {draft.kind === 'aws-polly' && (
                <label className="grid gap-1">
                  AWS region
                  <Input
                    value={draft.region ?? ''}
                    onChange={(e) => update('region', e.target.value)}
                  />
                </label>
              )}
              <label className="grid gap-1">
                Language code
                <Input
                  value={draft.language ?? ''}
                  onChange={(e) => update('language', e.target.value)}
                />
              </label>
              <label className="grid gap-1">
                Speech rate
                <Input
                  type="number"
                  min={0.5}
                  max={2}
                  step={0.1}
                  value={draft.speed ?? 1}
                  onChange={(e) => update('speed', Number(e.target.value))}
                />
              </label>
            </div>
            {draft.kind === 'aws-polly' && (
              <p className="text-ink-muted">
                Default engine: neural. Choose a voice available in your region
                and engine. Generative voices require speech rate 1.
              </p>
            )}
            {draft.kind === 'smallest' && (
              <p className="text-ink-muted">
                Default model: lightning_v3.1. Enter a voice ID from your
                Smallest.ai account.
              </p>
            )}
            {draft.kind === 'google-cloud' && (
              <p className="text-ink-muted">
                Google selects the model through the full voice name. Use a
                matching language code and a voice that supports speaking rate.
              </p>
            )}
            <label className="grid gap-1">
              {draft.kind === 'aws-polly'
                ? 'AWS credentials JSON'
                : draft.kind === 'google-cloud'
                  ? 'API key or service-account JSON'
                  : 'API key'}
              <Input
                type="password"
                aria-label="Speech credentials"
                autoComplete="new-password"
                value={credentials}
                maxLength={30000}
                onChange={(e) => setCredentials(e.target.value)}
              />
              <span className="text-ink-muted">
                Stored encrypted on this device. Leave blank to keep saved
                credentials.
              </span>
            </label>
            {draft.kind === 'aws-polly' && (
              <p className="break-words text-ink-muted">
                Paste JSON with accessKeyId, secretAccessKey, and optionally
                sessionToken. Credentials need permission to synthesize speech
                with Polly.
              </p>
            )}
            {draft.kind === 'google-cloud' && (
              <p className="text-ink-muted">
                Paste an API key or the full service-account JSON for a project
                with Cloud Text-to-Speech enabled.
              </p>
            )}
            <div className="flex gap-1">
              <Button
                size="sm"
                disabled={
                  !draft.label.trim() ||
                  !draft.voice.trim() ||
                  (!draft.id && !credentials.trim())
                }
                onClick={() => void save()}
              >
                Save voice settings
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setEditing(false);
                  setCredentials('');
                }}
              >
                Cancel
              </Button>
            </div>
          </fieldset>
        )}
        <label className="grid gap-1">
          Narration to generate
          <select
            className={selectClass}
            value={rowId}
            disabled={blocked}
            onChange={(e) => setRowId(e.target.value)}
          >
            <option value="">All {transcript.segments.length} rows</option>
            {transcript.segments.map((row, i) => (
              <option key={row.id} value={row.id}>
                {i + 1}. {row.text.slice(0, 90)}
              </option>
            ))}
          </select>
        </label>
        {disabled && (
          <p className="text-ink-muted">
            Save or clear narration edits before generating or placing speech.
          </p>
        )}
        <div className="flex flex-wrap gap-1">
          <Button
            size="sm"
            disabled={
              blocked || !provider || !transcript.segments.length || editing
            }
            onClick={() => void generate()}
          >
            Send text and generate voice
          </Button>
          <Button
            size="sm"
            disabled={busy}
            onClick={() => void run(refreshTakes)}
          >
            Refresh audio
          </Button>
        </div>
        {message && <p role="status">{message}</p>}
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
        {speechJobs.map((job) => (
          <div key={job.id} className="flex items-center justify-between gap-2">
            <p role="status">
              {job.stage || 'Speech generation queued'} ·{' '}
              {Math.round(job.progress * 100)}%
            </p>
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await window.kerf.jobs.cancel(job.id);
                })
              }
            >
              Cancel speech job
            </Button>
          </div>
        ))}
        {!takes.length && (
          <p className="text-ink-muted">
            Generated takes will appear here when speech generation finishes.
          </p>
        )}
        {takes.map((take) => {
          const row = transcript.segments.find((s) => s.id === take.segmentId);
          const audioAsset = snapshot?.assets.find(
            (a) => a.id === take.assetId,
          );
          const stale = !row || row.text !== take.text;
          const duration = audioAsset?.durationSeconds ?? 0;
          const available = row
            ? (row.endFrame - row.startFrame) /
              fpsToNumber(asset.frameRate ?? rate)
            : 0;
          const ready = audioAsset?.status === 'ready';
          return (
            <div
              key={take.id}
              className="grid min-w-0 gap-2 border-t border-line pt-3"
            >
              <p className="break-words">{take.text}</p>
              <p className="text-ink-muted">
                {take.voice} · {duration.toFixed(1)}s
                {stale
                  ? ' · Text changed; regenerate this row.'
                  : ` · ${available.toFixed(1)}s available`}
              </p>
              {ready && (
                <audio
                  controls
                  preload="none"
                  aria-label={`Voice-over: ${take.text}`}
                  className="w-full"
                  src={`kerfmedia://asset/${encodeURIComponent(take.assetId)}/source`}
                />
              )}
              {!ready && (
                <p className="text-ink-muted">
                  {audioAsset?.error || 'Preparing audio preview…'}
                </p>
              )}
              {!stale && duration > available && (
                <p className="text-ink-muted">
                  Speech exceeds this row by {(duration - available).toFixed(1)}
                  s. Shorten the text, increase speech rate, or extend the
                  narration interval before placing.
                </p>
              )}
              <Button
                size="sm"
                disabled={blocked || stale || !ready || duration > available}
                onClick={() =>
                  void run(async () => {
                    await bridge.place({
                      takeId: take.id,
                      expectedRevision: transcript.revision,
                    });
                    setMessage(
                      'Voice-over added to the timeline. Timeline Undo can restore the previous state.',
                    );
                  })
                }
              >
                Add / update voice-over
              </Button>
            </div>
          );
        })}
        <p className="text-ink-muted">
          Timing follows {asset.name}. Audio placement uses the source footage
          already on the timeline.
        </p>
      </div>
    </details>
  );
}
