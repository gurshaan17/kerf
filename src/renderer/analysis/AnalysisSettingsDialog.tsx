import { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  PlugZap,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import type {
  ChatProviderSetting,
  McpSettingsUpdate,
  McpStatus,
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
  const [mcp, setMcp] = useState<McpStatus | null>(null);
  const [mcpPort, setMcpPort] = useState('3919');
  const [showMcpToken, setShowMcpToken] = useState(false);
  const [mcpBusy, setMcpBusy] = useState(false);

  const refresh = async () => {
    const [nextProviders, nextModels, nextChatProvider, nextMcp] =
      await Promise.all([
        window.kerf.analysis.providers(),
        window.kerf.analysis.models(),
        window.kerf.chat.provider(),
        window.kerf.mcp.status(),
      ]);
    setProviders(nextProviders);
    setModels(nextModels);
    setChatProvider(nextChatProvider);
    setMcp(nextMcp);
    setMcpPort(String(nextMcp.port));
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

  const applyMcp = async (update: McpSettingsUpdate) => {
    setMcpBusy(true);
    try {
      const next = await window.kerf.mcp.update(update);
      setMcp(next);
      setMcpPort(String(next.port));
      if (next.error) {
        pushToast({
          title: 'MCP server could not start',
          description: next.error,
          tone: 'error',
        });
      }
    } catch (cause) {
      pushToast({
        title: 'Could not update the MCP server',
        description: cause instanceof Error ? cause.message : String(cause),
        tone: 'error',
      });
    } finally {
      setMcpBusy(false);
    }
  };

  const applyMcpPort = () => {
    const port = Number(mcpPort);
    if (!Number.isInteger(port) || port < 1_024 || port > 65_535) {
      pushToast({
        title: 'Choose a port between 1024 and 65535',
        description: 'Ports below 1024 need administrator rights.',
        tone: 'error',
      });
      return;
    }
    void applyMcp({ port });
  };

  const rotateMcpToken = async () => {
    setMcpBusy(true);
    try {
      const next = await window.kerf.mcp.rotateToken();
      setMcp(next);
      setShowMcpToken(true);
      pushToast({
        title: 'MCP token rotated',
        description: 'Every connected client was disconnected.',
        tone: 'success',
      });
    } catch (cause) {
      pushToast({
        title: 'Could not rotate the MCP token',
        description: cause instanceof Error ? cause.message : String(cause),
        tone: 'error',
      });
    } finally {
      setMcpBusy(false);
    }
  };

  const copyText = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      pushToast({
        title: `${label} copied`,
        description: 'Paste it into your MCP client.',
        tone: 'success',
      });
    } catch (cause) {
      pushToast({
        title: 'Could not copy to the clipboard',
        description: cause instanceof Error ? cause.message : String(cause),
        tone: 'error',
      });
    }
  };

  const mcpEndpoint =
    mcp?.endpoint ?? `http://127.0.0.1:${mcp?.port ?? 3919}/mcp`;
  const mcpToken = mcp?.token || '<token>';
  const claudeSnippet = `claude mcp add --transport http kerf ${mcpEndpoint} --header "Authorization: Bearer ${mcpToken}"`;
  const httpSnippet = JSON.stringify(
    {
      mcpServers: {
        kerf: {
          url: mcpEndpoint,
          headers: { Authorization: `Bearer ${mcpToken}` },
        },
      },
    },
    null,
    2,
  );
  const bridgeSnippet = JSON.stringify(
    {
      mcpServers: {
        kerf: {
          command: 'kerf-mcp-bridge',
          args: ['--url', mcpEndpoint, '--token', mcpToken],
        },
      },
    },
    null,
    2,
  );

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

        <section className="grid gap-2">
          <div>
            <h3 className="text-[12px] font-semibold text-ink">MCP server</h3>
            <p className="mt-0.5 text-[10px] leading-relaxed text-ink-faint">
              Expose Kerf's tool catalog to Claude Code, Cursor or another MCP
              client on this machine. The server binds only to 127.0.0.1 and
              every request needs the bearer token below.
            </p>
          </div>

          <div className="grid gap-2.5 rounded-sm border border-line bg-surface-0 p-3">
            <label className="flex items-start gap-2 text-[10px] leading-relaxed text-ink-muted">
              <input
                type="checkbox"
                checked={mcp?.enabled ?? false}
                disabled={mcpBusy || !mcp}
                onChange={(event) =>
                  void applyMcp({ enabled: event.target.checked })
                }
                className="mt-0.5 accent-[var(--color-accent)]"
              />
              <span>
                <span className="inline-flex items-center gap-1 font-medium text-ink">
                  <PlugZap size={11} /> Run the MCP server
                </span>
                <span className="mt-0.5 block text-ink-faint">
                  Starts a loopback HTTP listener. Disable it to close the
                  listener and disconnect every client.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-[10px] leading-relaxed text-ink-muted">
              <input
                type="checkbox"
                checked={mcp?.autoStart ?? true}
                disabled={mcpBusy || !mcp || !mcp.enabled}
                onChange={(event) =>
                  void applyMcp({ autoStart: event.target.checked })
                }
                className="mt-0.5 accent-[var(--color-accent)]"
              />
              <span>
                <span className="font-medium text-ink">Start with Kerf</span>
                <span className="mt-0.5 block text-ink-faint">
                  The listener starts when the editor opens. If the port is
                  busy, Kerf reports the error here and keeps running.
                </span>
              </span>
            </label>

            <FieldRow>
              <Field label="Port">
                <div className="flex items-center gap-1.5">
                  <Input
                    value={mcpPort}
                    inputMode="numeric"
                    disabled={mcpBusy || !mcp}
                    onChange={(event) => setMcpPort(event.target.value)}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={
                      mcpBusy || !mcp || mcpPort === String(mcp?.port ?? 3919)
                    }
                    onClick={applyMcpPort}
                  >
                    Apply
                  </Button>
                </div>
              </Field>
              <Field
                label="Status"
                hint={
                  mcp?.running
                    ? `${mcp.sessions} active ${mcp.sessions === 1 ? 'session' : 'sessions'}`
                    : 'Listener is stopped'
                }
              >
                <div className="flex h-8 items-center gap-2 rounded-sm border border-line bg-surface-1 px-2.5 font-mono text-[10px] text-ink-muted">
                  <span
                    className={`size-1.5 rounded-full ${
                      mcp?.running ? 'bg-ok' : 'bg-ink-faint'
                    }`}
                    aria-hidden="true"
                  />
                  {mcp?.running ? 'listening' : 'stopped'}
                </div>
              </Field>
            </FieldRow>

            {mcp?.error ? (
              <p
                role="alert"
                className="rounded-sm border border-danger/40 bg-danger/10 px-2.5 py-2 text-[10px] text-danger"
              >
                {mcp.error}
              </p>
            ) : null}

            <Field
              label="Endpoint"
              hint="Clients must connect to this exact loopback URL."
            >
              <div className="flex items-center gap-1.5">
                <Input readOnly value={mcpEndpoint} className="font-mono" />
                <Button
                  variant="secondary"
                  size="sm"
                  leadingIcon={<Copy size={11} />}
                  onClick={() => void copyText('Endpoint', mcpEndpoint)}
                >
                  Copy
                </Button>
              </div>
            </Field>

            <Field
              label="Bearer token"
              hint="Stored encrypted with the operating system credential store. Rotating it disconnects every client."
            >
              <div className="flex items-center gap-1.5">
                <Input
                  readOnly
                  type={showMcpToken ? 'text' : 'password'}
                  value={mcp?.token ?? ''}
                  className="font-mono"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={showMcpToken ? 'Hide token' : 'Show token'}
                  onClick={() => setShowMcpToken((visible) => !visible)}
                >
                  {showMcpToken ? <EyeOff size={11} /> : <Eye size={11} />}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  leadingIcon={<Copy size={11} />}
                  onClick={() => void copyText('Token', mcp?.token ?? '')}
                >
                  Copy
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={mcpBusy || !mcp}
                  leadingIcon={
                    mcpBusy ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      <RefreshCw size={11} />
                    )
                  }
                  onClick={() => void rotateMcpToken()}
                >
                  Rotate
                </Button>
              </div>
            </Field>

            <details className="rounded-sm border border-line bg-surface-1 px-2.5 py-2">
              <summary className="cursor-pointer text-[10px] font-medium text-ink">
                Claude Code (HTTP)
              </summary>
              <div className="mt-2 grid gap-1.5">
                <pre className="overflow-x-auto rounded-sm bg-surface-0 p-2 font-mono text-[9px] leading-relaxed text-ink-muted">
                  {claudeSnippet}
                </pre>
                <Button
                  variant="ghost"
                  size="sm"
                  leadingIcon={<Copy size={11} />}
                  onClick={() =>
                    void copyText('Claude Code command', claudeSnippet)
                  }
                >
                  Copy command
                </Button>
              </div>
            </details>
            <details className="rounded-sm border border-line bg-surface-1 px-2.5 py-2">
              <summary className="cursor-pointer text-[10px] font-medium text-ink">
                Cursor or another HTTP client (JSON)
              </summary>
              <div className="mt-2 grid gap-1.5">
                <pre className="overflow-x-auto rounded-sm bg-surface-0 p-2 font-mono text-[9px] leading-relaxed text-ink-muted">
                  {httpSnippet}
                </pre>
                <Button
                  variant="ghost"
                  size="sm"
                  leadingIcon={<Copy size={11} />}
                  onClick={() => void copyText('MCP config', httpSnippet)}
                >
                  Copy config
                </Button>
              </div>
            </details>
            <details className="rounded-sm border border-line bg-surface-1 px-2.5 py-2">
              <summary className="cursor-pointer text-[10px] font-medium text-ink">
                Stdio bridge (JSON)
              </summary>
              <div className="mt-2 grid gap-1.5">
                <p className="text-[9px] leading-relaxed text-ink-faint">
                  For clients that only speak stdio. Link the workspace bridge
                  first with{' '}
                  <code className="font-mono">
                    pnpm --filter @kerf/mcp-bridge link --global
                  </code>
                  .
                </p>
                <pre className="overflow-x-auto rounded-sm bg-surface-0 p-2 font-mono text-[9px] leading-relaxed text-ink-muted">
                  {bridgeSnippet}
                </pre>
                <Button
                  variant="ghost"
                  size="sm"
                  leadingIcon={<Copy size={11} />}
                  onClick={() => void copyText('Bridge config', bridgeSnippet)}
                >
                  Copy config
                </Button>
              </div>
            </details>
          </div>

          <div className="grid gap-1.5">
            <h4 className="text-[10px] font-medium text-ink">
              Recent activity
            </h4>
            {mcp && mcp.activity.length > 0 ? (
              <div className="grid max-h-44 gap-1 overflow-auto rounded-sm border border-line bg-surface-0 p-1.5">
                {mcp.activity.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-baseline gap-2 rounded-sm px-1.5 py-1 font-mono text-[9px]"
                  >
                    <span className={entry.ok ? 'text-ok' : 'text-danger'}>
                      {entry.kind}
                    </span>
                    {entry.tool ? (
                      <span className="text-ink-muted">{entry.tool}</span>
                    ) : null}
                    <span className="min-w-0 flex-1 truncate text-ink-faint">
                      {entry.message}
                    </span>
                    <time className="shrink-0 text-ink-faint">
                      {new Date(entry.at).toLocaleTimeString()}
                    </time>
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-sm border border-line bg-surface-0 px-3 py-3 text-[10px] text-ink-faint">
                No MCP requests yet. Tool calls, sessions and rejected tokens
                appear here, newest first.
              </p>
            )}
          </div>
        </section>
      </div>
    </Dialog>
  );
}
