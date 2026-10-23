import { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  Loader2,
  MessageSquare,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Square,
  X,
} from 'lucide-react';
import type { ChatToolActivity } from '../../shared/contracts';
import { Button, IconButton } from '@kerf/ui';
import { useStudio } from '../state/StudioProvider';

export interface ChatPanelProps {
  readonly settingsOpen: boolean;
  readonly onOpenSettings: () => void;
}

const SUGGESTIONS = [
  'Remove pauses and caption this',
  'Make a 20-second rough cut',
  'Cut this to the beat',
  'Give it a warmer grade from the reference',
];

function pretty(value: unknown): string {
  if (value === undefined) {
    return '—';
  }
  try {
    const text = JSON.stringify(value, null, 2);
    return text.length > 6_000 ? `${text.slice(0, 6_000)}\n…` : text;
  } catch {
    return String(value);
  }
}

function statusIcon(tool: ChatToolActivity) {
  if (tool.status === 'running') {
    return <Loader2 size={11} className="animate-spin text-accent" />;
  }
  if (tool.status === 'failed') {
    return <X size={11} className="text-danger" />;
  }
  return <Check size={11} className="text-ok" />;
}

function ToolCard({ tool }: { readonly tool: ChatToolActivity }) {
  return (
    <details
      className="group rounded-sm border border-line bg-surface-0"
      open={tool.status === 'failed'}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-2 py-1.5">
        {statusIcon(tool)}
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-ink">
          {tool.name}
        </span>
        {typeof tool.durationMs === 'number' ? (
          <span className="font-mono text-[9px] text-ink-faint">
            {(tool.durationMs / 1_000).toFixed(1)}s
          </span>
        ) : null}
        <ChevronDown
          size={11}
          className="text-ink-faint transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="grid gap-2 border-t border-line px-2 py-2">
        <div>
          <p className="mb-1 font-mono text-[9px] tracking-[0.08em] text-ink-faint uppercase">
            Input
          </p>
          <pre className="max-h-36 overflow-auto rounded-sm bg-surface-1 p-1.5 font-mono text-[9px] leading-relaxed whitespace-pre-wrap text-ink-muted">
            {pretty(tool.input)}
          </pre>
        </div>
        {tool.error ? (
          <p className="text-[10px] leading-relaxed text-danger">
            {tool.error}
          </p>
        ) : null}
        {tool.output !== undefined ? (
          <div>
            <p className="mb-1 font-mono text-[9px] tracking-[0.08em] text-ink-faint uppercase">
              Result
            </p>
            <pre className="max-h-48 overflow-auto rounded-sm bg-surface-1 p-1.5 font-mono text-[9px] leading-relaxed whitespace-pre-wrap text-ink-muted">
              {pretty(tool.output)}
            </pre>
          </div>
        ) : null}
      </div>
    </details>
  );
}

export function ChatPanel({ settingsOpen, onOpenSettings }: ChatPanelProps) {
  const turns = useStudio((state) => state.chatTurns);
  const activeTurnId = useStudio((state) => state.chatActiveTurnId);
  const chatError = useStudio((state) => state.chatError);
  const chatProvider = useStudio((state) => state.chatProvider);
  const sendChat = useStudio((state) => state.sendChat);
  const stopChat = useStudio((state) => state.stopChat);
  const refreshChatProvider = useStudio((state) => state.refreshChatProvider);
  const dismissChatError = useStudio((state) => state.dismissChatError);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const busy = activeTurnId !== null;

  useEffect(() => {
    if (!settingsOpen) {
      void refreshChatProvider();
    }
  }, [settingsOpen, refreshChatProvider]);

  useEffect(() => {
    const element = scrollRef.current;
    if (element) {
      element.scrollTop = element.scrollHeight;
    }
  }, [turns, activeTurnId]);

  const send = async (value: string) => {
    if (!value.trim() || busy) {
      return;
    }
    const ok = await sendChat(value);
    if (!ok) {
      setInput(value);
    }
  };

  const submit = () => {
    const value = input.trim();
    if (!value || busy) {
      return;
    }
    setInput('');
    void send(value);
  };

  const providerLabel = chatProvider?.provider?.label ?? null;

  return (
    <aside
      className="flex h-full min-h-0 flex-col bg-surface-1"
      aria-label="Assistant"
    >
      <header className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[9px] tracking-[0.12em] text-ink-faint uppercase">
            Assistant
          </p>
          <h2 className="mt-0.5 text-[12px] font-semibold text-ink">
            Kerf chat
          </h2>
        </div>
        <IconButton
          label="AI settings"
          tooltip="AI settings"
          size="sm"
          icon={<Settings size={14} />}
          onClick={onOpenSettings}
        />
      </header>

      <div className="border-b border-line px-3 py-2">
        <p className="flex items-center gap-1.5 text-[10px] text-ink-muted">
          <span
            className={
              providerLabel
                ? 'size-1.5 rounded-full bg-ok'
                : 'size-1.5 rounded-full bg-ink-faint'
            }
            aria-hidden="true"
          />
          {providerLabel ?? 'No chat model connected'}
        </p>
        <p className="mt-1 text-[9px] leading-relaxed text-ink-faint">
          Edits run against the open project and can be undone with ⌘Z. The
          assistant sees the timeline, not your media files.
        </p>
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto px-3 py-3"
        aria-live="polite"
      >
        {turns.length === 0 ? (
          <div className="grid gap-3">
            <div className="rounded-sm border border-line bg-surface-0 p-3">
              <div className="flex items-center gap-2 text-ink">
                <Sparkles
                  size={14}
                  className="text-accent"
                  aria-hidden="true"
                />
                <p className="text-[11px] font-semibold">
                  Edit by describing the cut
                </p>
              </div>
              <p className="mt-1.5 text-[10px] leading-relaxed text-ink-muted">
                Kerf plans with the tools it has, reads the timeline, then
                applies edits as ordinary undoable commands.
              </p>
            </div>
            <div className="grid gap-1.5">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className="rounded-sm border border-line bg-surface-0 px-2.5 py-2 text-left text-[10px] leading-relaxed text-ink-muted transition-colors hover:border-line-strong hover:text-ink disabled:opacity-40"
                  disabled={busy}
                  onClick={() => void send(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="grid gap-4">
            {turns.map((turn) => (
              <section key={turn.id} className="grid gap-2">
                <div className="ml-5 rounded-sm border border-accent/20 bg-accent/10 px-2.5 py-2">
                  <p className="text-[11px] leading-relaxed whitespace-pre-wrap text-ink">
                    {turn.message}
                  </p>
                </div>

                {turn.tools.length > 0 ? (
                  <div className="grid gap-1">
                    {turn.tools.map((tool) => (
                      <ToolCard key={tool.id} tool={tool} />
                    ))}
                  </div>
                ) : null}

                {turn.text ? (
                  <div className="flex items-start gap-2">
                    <MessageSquare
                      size={13}
                      className="mt-0.5 shrink-0 text-ink-faint"
                      aria-hidden="true"
                    />
                    <p className="text-[11px] leading-relaxed whitespace-pre-wrap text-ink-muted">
                      {turn.text}
                    </p>
                  </div>
                ) : turn.status === 'streaming' ? (
                  <p className="flex items-center gap-1.5 pl-5 text-[10px] text-ink-faint">
                    <Loader2 size={11} className="animate-spin" />
                    Working through the timeline…
                  </p>
                ) : null}

                {turn.status === 'aborted' ? (
                  <p className="pl-5 text-[10px] text-ink-faint">Stopped.</p>
                ) : null}

                {turn.error ? (
                  <div className="ml-5 rounded-sm border border-danger/30 bg-danger/10 px-2.5 py-2">
                    <p className="text-[10px] leading-relaxed text-danger">
                      {turn.error}
                    </p>
                    {turn.hint ? (
                      <p className="mt-1 text-[9px] leading-relaxed text-ink-muted">
                        {turn.hint}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </section>
            ))}
          </div>
        )}
      </div>

      {chatError ? (
        <div className="mx-3 mb-2 rounded-sm border border-danger/30 bg-danger/10 px-2.5 py-2">
          <div className="flex items-start gap-2">
            <p className="min-w-0 flex-1 text-[10px] leading-relaxed text-danger">
              {chatError.message}
            </p>
            <button
              type="button"
              className="text-ink-faint hover:text-ink"
              aria-label="Dismiss chat error"
              onClick={dismissChatError}
            >
              <X size={12} />
            </button>
          </div>
          {chatError.hint ? (
            <p className="mt-1 flex items-center gap-1 text-[9px] leading-relaxed text-ink-muted">
              <ShieldCheck size={10} aria-hidden="true" />
              {chatError.hint}
            </p>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            className="mt-1 px-0 text-[10px]"
            onClick={onOpenSettings}
          >
            Open AI settings
          </Button>
        </div>
      ) : null}

      <form
        className="grid gap-2 border-t border-line p-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          rows={3}
          className="min-h-[64px] w-full resize-none rounded-sm border border-line bg-surface-0 px-2.5 py-2 text-[11px] leading-relaxed text-ink transition-[border-color,box-shadow] placeholder:text-ink-faint hover:border-line-strong focus:border-accent-dim focus:ring-[3px] focus:ring-accent/15 focus:outline-none"
          placeholder="Describe the edit you want…"
          aria-label="Message the assistant"
          disabled={busy}
        />
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 text-[9px] leading-snug text-ink-faint">
            Enter sends · Shift+Enter adds a line
          </span>
          {busy ? (
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<Square size={11} />}
              onClick={() => void stopChat()}
            >
              Stop
            </Button>
          ) : (
            <Button
              type="submit"
              variant="primary"
              size="sm"
              leadingIcon={<Send size={11} />}
              disabled={!input.trim()}
            >
              Send
            </Button>
          )}
        </div>
      </form>
    </aside>
  );
}
