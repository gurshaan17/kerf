import { useEffect, useState } from 'react';
import {
  Check,
  Download,
  KeyRound,
  Loader2,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import type {
  ChatProviderSetting,
  ProviderAccount,
  ProviderKind,
  WhisperModelInfo,
} from '../../shared/contracts';
import { Button, Dialog, Field, FieldRow, Input, Select } from '@kerf/ui';
import { useStudio } from '../state/StudioProvider';

export interface AnalysisSettingsDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

const PROVIDER_OPTIONS: Array<{ value: ProviderKind; label: string }> = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'google', label: 'Google Gemini' },
  { value: 'xai', label: 'xAI Grok' },
  { value: 'ollama', label: 'Ollama (local)' },
  { value: 'openai-compatible', label: 'OpenAI-compatible (local URL)' },
];

function formatSize(bytes: number): string {
  if (bytes <= 0) {
    return '0 MB';
  }
  return `${(bytes / 1_048_576).toFixed(0)} MB`;
}

export function AnalysisSettingsDialog({
  open,
  onOpenChange,
}: AnalysisSettingsDialogProps) {
  const pushToast = useStudio((state) => state.pushToast);
  const [providers, setProviders] = useState<ProviderAccount[]>([]);
  const [models, setModels] = useState<WhisperModelInfo[]>([]);
  const [chatProvider, setChatProvider] = useState<ChatProviderSetting | null>(
    null,
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [kind, setKind] = useState<ProviderKind>('openai');
  const [label, setLabel] = useState('OpenAI');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [chatModel, setChatModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [consent, setConsent] = useState(false);
  const [chatConsent, setChatConsent] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);

  const refresh = async () => {
    const [nextProviders, nextModels, nextChatProvider] = await Promise.all([
      window.kerf.analysis.providers(),
      window.kerf.analysis.models(),
      window.kerf.chat.provider(),
    ]);
    setProviders(nextProviders);
    setModels(nextModels);
    setChatProvider(nextChatProvider);
  };

  useEffect(() => {
    if (!open) {
      return;
    }
    void refresh().catch((cause: unknown) => {
      pushToast({
        title: 'Could not load analysis settings',
        description: cause instanceof Error ? cause.message : String(cause),
        tone: 'error',
      });
    });
  }, [open, pushToast]);

  useEffect(() => {
    if (!installing) {
      return;
    }
    const timer = setInterval(() => {
      void window.kerf.analysis
        .models()
        .then((next) => {
          setModels(next);
          if (next.find((entry) => entry.id === installing)?.installed) {
            setInstalling(null);
            pushToast({
              title: 'Whisper model installed',
              description: installing,
              tone: 'success',
            });
          }
        })
        .catch(() => undefined);
    }, 2_000);
    return () => clearInterval(timer);
  }, [installing, pushToast]);

  const selectProvider = (provider: ProviderAccount) => {
    setEditingId(provider.id);
    setKind(provider.kind);
    setLabel(provider.label);
    setBaseUrl(provider.baseUrl ?? '');
    setModel(provider.model ?? '');
    setChatModel(provider.chatModel ?? '');
    setApiKey('');
    setConsent(provider.visionConsent);
    setChatConsent(provider.chatConsent);
    setTestMessage(null);
  };

  const resetForm = () => {
    setEditingId(null);
    setKind('openai');
    setLabel('OpenAI');
    setBaseUrl('');
    setModel('');
    setChatModel('');
    setApiKey('');
    setConsent(false);
    setChatConsent(false);
    setTestMessage(null);
  };

  const save = async () => {
    try {
      const saved = await window.kerf.analysis.saveProvider({
        ...(editingId ? { id: editingId } : {}),
        kind,
        label: label.trim() || kind,
        baseUrl: baseUrl.trim() || null,
        model: model.trim() || null,
        chatModel: chatModel.trim() || null,
        apiKey: apiKey.trim() || null,
        visionConsent: consent,
        chatConsent,
      });
      setEditingId(saved.id);
      setApiKey('');
      await refresh();
      pushToast({
        title: 'Provider saved',
        description: saved.label,
        tone: 'success',
      });
    } catch (cause) {
      pushToast({
        title: 'Could not save the provider',
        description: cause instanceof Error ? cause.message : String(cause),
        tone: 'error',
      });
    }
  };

  const removeProvider = async (provider: ProviderAccount) => {
    try {
      await window.kerf.analysis.deleteProvider(provider.id);
      if (editingId === provider.id) {
        resetForm();
      }
      await refresh();
    } catch (cause) {
      pushToast({
        title: 'Could not remove the provider',
        description: cause instanceof Error ? cause.message : String(cause),
        tone: 'error',
      });
    }
  };

  const setDefaultChatProvider = async (id: string) => {
    try {
      const next = await window.kerf.chat.setProvider(id || null);
      setChatProvider(next);
      await refresh();
      pushToast({
        title: 'Chat provider updated',
        description: next.provider?.label ?? 'Automatic selection',
        tone: 'success',
      });
    } catch (cause) {
      pushToast({
        title: 'Could not set the chat provider',
        description: cause instanceof Error ? cause.message : String(cause),
        tone: 'error',
      });
    }
  };

  const test = async () => {
    if (!editingId) {
      setTestMessage('Save the provider first.');
      return;
    }
    setTesting(true);
    setTestMessage(null);
    try {
      const result = await window.kerf.analysis.testProvider(editingId);
      setTestMessage(
        result.ok ? `Connected: ${result.message}` : result.message,
      );
    } catch (cause) {
      setTestMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setTesting(false);
    }
  };

  const installModel = async (modelId: string) => {
    try {
      await window.kerf.analysis.downloadModel(modelId);
      setInstalling(modelId);
      await refresh();
    } catch (cause) {
      pushToast({
        title: 'Could not start the model download',
        description: cause instanceof Error ? cause.message : String(cause),
        tone: 'error',
      });
    }
  };

  const removeModel = async (modelId: string) => {
    try {
      await window.kerf.analysis.deleteModel(modelId);
      await refresh();
    } catch (cause) {
      pushToast({
        title: 'Could not delete the model',
        description: cause instanceof Error ? cause.message : String(cause),
        tone: 'error',
      });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="AI settings"
      description="Whisper models stay on this machine. Chat and cloud vision are opt-in per provider, and Kerf never falls back to another provider."
      panelClassName="max-w-[720px]"
      footer={
        <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
          Close
        </Button>
      }
    >
      <div className="grid max-h-[64vh] gap-5 overflow-auto pr-1">
        <section className="grid gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <h3 className="text-[12px] font-semibold text-ink">
                Speech recognition
              </h3>
              <p className="mt-0.5 text-[10px] leading-relaxed text-ink-faint">
                Kerf looks for whisper-cli, whisper-cpp or whisper on PATH. Set
                KERF_WHISPER_PATH to use a specific binary. Model downloads are
                resumable and stored under the app data folder.
              </p>
            </div>
          </div>
          <div className="grid gap-1.5">
            {models.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center gap-3 rounded-sm border border-line bg-surface-0 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-medium text-ink">
                    {entry.name}
                    <span className="ml-2 font-mono text-[9px] text-ink-faint">
                      {entry.installed
                        ? 'installed'
                        : `${formatSize(entry.downloadedBytes)} / ${formatSize(entry.sizeBytes)}`}
                    </span>
                  </p>
                  <p className="mt-0.5 font-mono text-[9px] text-ink-faint">
                    {entry.fileName}
                  </p>
                </div>
                {entry.installed ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    leadingIcon={<Trash2 size={11} />}
                    onClick={() => void removeModel(entry.id)}
                  >
                    Delete
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    leadingIcon={
                      installing === entry.id ? (
                        <Loader2 size={11} className="animate-spin" />
                      ) : (
                        <Download size={11} />
                      )
                    }
                    disabled={installing !== null}
                    onClick={() => void installModel(entry.id)}
                  >
                    {installing === entry.id ? 'Downloading' : 'Download'}
                  </Button>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <div>
              <h3 className="text-[12px] font-semibold text-ink">
                Vision and chat providers
              </h3>
              <p className="mt-0.5 text-[10px] leading-relaxed text-ink-faint">
                Keys are encrypted with the operating system credential store
                and written to Kerf's local database. They never enter a project
                folder, snapshot, export or log.
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={resetForm}>
              New
            </Button>
          </div>

          <Field
            label="Chat provider"
            hint="The assistant uses one provider at a time. Only providers with chat allowed are listed."
          >
            <Select
              value={chatProvider?.providerId ?? ''}
              onChange={(event) =>
                void setDefaultChatProvider(event.target.value)
              }
              options={[
                { value: '', label: 'Automatic (first allowed provider)' },
                ...providers
                  .filter(
                    (provider) => provider.enabled && provider.chatConsent,
                  )
                  .map((provider) => ({
                    value: provider.id,
                    label: `${provider.label} · ${provider.chatModel ?? provider.model ?? 'default model'}`,
                  })),
              ]}
            />
          </Field>

          {providers.length > 0 ? (
            <div className="grid gap-1.5">
              {providers.map((provider) => (
                <div
                  key={provider.id}
                  className="flex items-center gap-2 rounded-sm border border-line bg-surface-0 px-3 py-2"
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => selectProvider(provider)}
                  >
                    <p className="text-[11px] font-medium text-ink">
                      {provider.label}
                      {provider.visionConsent ? (
                        <span className="ml-2 inline-flex items-center gap-1 font-mono text-[8px] text-ok uppercase">
                          <Check size={9} /> vision
                        </span>
                      ) : null}
                      {provider.chatConsent ? (
                        <span className="ml-2 inline-flex items-center gap-1 font-mono text-[8px] text-accent uppercase">
                          <Check size={9} /> chat
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 truncate font-mono text-[9px] text-ink-faint">
                      {provider.kind} · {provider.model ?? 'default model'} ·{' '}
                      {provider.hasKey ? 'key stored' : 'no key'}
                    </p>
                  </button>
                  <Button
                    variant="ghost"
                    size="sm"
                    leadingIcon={<Trash2 size={11} />}
                    onClick={() => void removeProvider(provider)}
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-sm border border-line bg-surface-0 px-3 py-3 text-[10px] text-ink-faint">
              No provider is configured. Transcription, scenes, beats and
              lexical search still work locally.
            </p>
          )}

          <div className="mt-1 grid gap-2.5 rounded-sm border border-line bg-surface-0 p-3">
            <FieldRow>
              <Field label="Provider">
                <Select
                  value={kind}
                  options={PROVIDER_OPTIONS}
                  onChange={(event) => {
                    const next = event.target.value as ProviderKind;
                    setKind(next);
                    if (!editingId) {
                      setLabel(
                        PROVIDER_OPTIONS.find((option) => option.value === next)
                          ?.label ?? next,
                      );
                    }
                  }}
                />
              </Field>
              <Field label="Label">
                <Input
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                />
              </Field>
            </FieldRow>
            <FieldRow>
              <Field label="Base URL" optional>
                <Input
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder={
                    kind === 'ollama'
                      ? 'http://127.0.0.1:11434/v1'
                      : 'Provider default'
                  }
                />
              </Field>
              <Field label="Vision model" optional>
                <Input
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  placeholder="Use the provider default"
                />
              </Field>
            </FieldRow>
            <Field
              label="Chat model"
              hint="Used only by the assistant. When blank, Kerf falls back to the vision model."
              optional
            >
              <Input
                value={chatModel}
                onChange={(event) => setChatModel(event.target.value)}
                placeholder="Use the vision model or provider default"
              />
            </Field>
            <Field
              label="API key"
              hint="Leave blank to keep the existing key. Ollama does not need one."
              optional
            >
              <div className="relative">
                <KeyRound
                  size={12}
                  className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-faint"
                  aria-hidden="true"
                />
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={editingId ? 'Key already stored' : 'Paste key'}
                  className="pl-8"
                  autoComplete="off"
                />
              </div>
            </Field>
            <label className="flex items-start gap-2 rounded-sm border border-line bg-surface-1 px-2.5 py-2 text-[10px] leading-relaxed text-ink-muted">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
                className="mt-0.5 accent-[var(--color-accent)]"
              />
              <span>
                <span className="inline-flex items-center gap-1 font-medium text-ink">
                  <ShieldCheck size={11} /> Allow this provider to describe
                  keyframes
                </span>
                <span className="mt-0.5 block text-ink-faint">
                  Only the selected provider receives the keyframe and prompt.
                  Kerf does not proxy, log or fall back to another provider.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 rounded-sm border border-line bg-surface-1 px-2.5 py-2 text-[10px] leading-relaxed text-ink-muted">
              <input
                type="checkbox"
                checked={chatConsent}
                onChange={(event) => setChatConsent(event.target.checked)}
                className="mt-0.5 accent-[var(--color-accent)]"
              />
              <span>
                <span className="inline-flex items-center gap-1 font-medium text-ink">
                  <ShieldCheck size={11} /> Allow this provider to power chat
                </span>
                <span className="mt-0.5 block text-ink-faint">
                  Your prompts, tool results and the parts of the timeline the
                  assistant reads go to this provider. Cloud chat stays off
                  until you grant this consent explicitly.
                </span>
              </span>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" size="sm" onClick={() => void save()}>
                Save provider
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={!editingId || testing}
                leadingIcon={
                  testing ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : null
                }
                onClick={() => void test()}
              >
                Test connection
              </Button>
              {testMessage ? (
                <span className="text-[10px] text-ink-muted">
                  {testMessage}
                </span>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </Dialog>
  );
}
