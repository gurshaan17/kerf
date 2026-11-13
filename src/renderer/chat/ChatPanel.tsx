import { useEffect, useRef, useState } from 'react';
import { ChatMarkdown } from './ChatMarkdown';
import { mentionQuery, updateMentions } from './mentions';
import {
  Check,
  Film,
  History,
  Plus,
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
import type {
  ChatAssetMention,
  ChatToolActivity,
} from '../../shared/contracts';
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
  const conversations = useStudio((state) => state.chatConversations);
  const loadHistory = useStudio((state) => state.loadChatHistory);
  const openChat = useStudio((state) => state.openChat);
  const newChat = useStudio((state) => state.newChat);
  const [historyOpen, setHistoryOpen] = useState(false);
  const turns = useStudio((state) => state.chatTurns);
  const activeTurnId = useStudio((state) => state.chatActiveTurnId);
  const chatError = useStudio((state) => state.chatError);
  const chatProvider = useStudio((state) => state.chatProvider);
  const sendChat = useStudio((state) => state.sendChat);
  const stopChat = useStudio((state) => state.stopChat);
  const refreshChatProvider = useStudio((state) => state.refreshChatProvider);
  const dismissChatError = useStudio((state) => state.dismissChatError);
  const [input, setInput] = useState('');
  const snapshot = useStudio((state) => state.snapshot);
  const [mentions, setMentions] = useState<ChatAssetMention[]>([]);
  const [caret, setCaret] = useState(0);
  const [mentionDismissed, setMentionDismissed] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const editStart = useRef<number | null>(null);
  const query = mentionDismissed ? null : mentionQuery(input, caret);
  const videos = (snapshot?.assets ?? []).filter(
    (asset) => asset.kind === 'video',
  );
  const matches = query
    ? videos.filter((asset) =>
        asset.name.toLowerCase().includes(query.query.toLowerCase()),
      )
    : [];
  const activeVideo = Math.min(selectedVideo, Math.max(0, matches.length - 1));
  const pickerOpen =
    query !== null &&
    !mentions.some(
      (mention) => query.start >= mention.start && query.start < mention.end,
    );

  useEffect(() => {
    setInput('');
    setMentions([]);
    setCaret(0);
  }, [snapshot?.project.id]);

  useEffect(() => {
    document
      .getElementById(`chat-video-option-${activeVideo}`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeVideo]);

  const pickVideo = (asset: (typeof videos)[number]) => {
    if (!query) return;
    const token = `@${asset.name}`;
    const next =
      input.slice(0, query.start) + token + ' ' + input.slice(query.end);
    const shifted = updateMentions(input, next, mentions, {
      start: query.start,
      end: query.end,
    });
    setMentions(
      [
        ...shifted,
        {
          assetId: asset.id,
          start: query.start,
          end: query.start + token.length,
        },
      ].sort((a, b) => a.start - b.start),
    );
    setInput(next);
    const position = query.start + token.length + 1;
    setCaret(position);
    setMentionDismissed(true);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(position, position);
    });
  };
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

  const send = async (
    value: string,
    tags: readonly ChatAssetMention[] = [],
  ) => {
    if (!value.trim() || busy) {
      return;
    }
    const ok = await sendChat(value, tags);
    if (!ok) {
      setInput(value);
      setMentions([...tags]);
    }
  };

  const submit = () => {
    const value = input;
    if (!value.trim() || busy) {
      return;
    }
    const tags = mentions;
    setInput('');
    setMentions([]);
    setMentionDismissed(true);
    void send(value, tags);
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
          label="New chat"
          tooltip="New chat"
          size="sm"
          icon={<Plus size={14} />}
          disabled={busy}
          onClick={() => {
            void newChat();
            setHistoryOpen(false);
          }}
        />
        <IconButton
          label="Chat history"
          tooltip="Chat history"
          size="sm"
          icon={<History size={14} />}
          disabled={busy}
          onClick={() => {
            setHistoryOpen(!historyOpen);
            void loadHistory();
          }}
        />
        <IconButton
          label="AI settings"
          tooltip="AI settings"
          tooltipSide="bottom"
          size="sm"
          icon={<Settings size={14} />}
          onClick={onOpenSettings}
        />
      </header>

      {historyOpen ? (
        <div
          className="max-h-64 overflow-auto border-b border-line p-3"
          aria-label="Chat history"
        >
          <p className="mb-2 text-[11px] font-semibold text-ink">
            Saved chats in this project
          </p>
          {conversations.length === 0 ? (
            <p className="text-[10px] text-ink-muted">No saved chats yet.</p>
          ) : (
            conversations.map((conversation) => (
              <button
                type="button"
                key={conversation.id}
                className="mb-1 block w-full rounded-sm border border-line px-2 py-2 text-left text-[11px] text-ink-muted hover:text-ink"
                onClick={() => {
                  void openChat(conversation.id);
                  setHistoryOpen(false);
                }}
              >
                <span className="block truncate">{conversation.title}</span>
                <span className="text-[9px] text-ink-faint">
                  {new Date(conversation.updatedAt).toLocaleString()}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
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
                    <div className="chat-markdown min-w-0 flex-1 text-[11px] leading-relaxed text-ink-muted">
                      <ChatMarkdown text={turn.text} />
                    </div>
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
        {pickerOpen ? (
          <div
            className="max-h-48 overflow-auto rounded-sm border border-line bg-surface-0"
            id="chat-video-options"
            role="listbox"
            aria-label="Source videos"
          >
            <p className="px-2.5 py-2 text-[10px] text-ink-muted">
              Tag a source video
            </p>
            {matches.length === 0 ? (
              <p className="px-2.5 pb-2 text-[11px] text-ink-muted">
                {videos.length
                  ? 'No matching videos.'
                  : 'Import a video to tag it here.'}
              </p>
            ) : (
              matches.map((asset, index) => (
                <button
                  key={asset.id}
                  id={`chat-video-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={index === activeVideo}
                  tabIndex={-1}
                  className={`flex w-full items-center gap-2 px-2.5 py-2 text-left text-[11px] text-ink hover:bg-surface-2 ${index === activeVideo ? 'bg-surface-2' : ''}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pickVideo(asset)}
                >
                  <Film
                    size={13}
                    className="shrink-0 text-ink-muted"
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{asset.name}</span>
                    <span className="block truncate text-[9px] text-ink-muted">
                      {asset.id}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        ) : null}
        <textarea
          ref={inputRef}
          aria-autocomplete="list"
          aria-controls={pickerOpen ? 'chat-video-options' : undefined}
          aria-activedescendant={
            pickerOpen && matches.length
              ? `chat-video-option-${activeVideo}`
              : undefined
          }
          value={input}
          onPaste={(event) => {
            editStart.current = event.currentTarget.selectionStart;
          }}
          onCut={(event) => {
            editStart.current = event.currentTarget.selectionStart;
          }}
          onBeforeInput={(event) => {
            editStart.current = event.currentTarget.selectionStart;
          }}
          onChange={(event) => {
            const value = event.target.value;
            const end =
              event.target.selectionStart - (value.length - input.length);
            setMentions(
              updateMentions(
                input,
                value,
                mentions,
                editStart.current === null
                  ? undefined
                  : {
                      start: Math.min(
                        editStart.current,
                        event.target.selectionStart,
                      ),
                      end,
                    },
              ),
            );
            editStart.current = null;
            setInput(value);
            setCaret(event.target.selectionStart);
            setMentionDismissed(false);
            setSelectedVideo(0);
          }}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
          onBlur={() => setMentionDismissed(true)}
          onKeyDown={(event) => {
            editStart.current = event.currentTarget.selectionStart;
            if (event.nativeEvent.isComposing) return;
            if (pickerOpen) {
              if (event.key === 'Escape') {
                event.preventDefault();
                setMentionDismissed(true);
                return;
              }
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                setSelectedVideo(
                  (activeVideo +
                    (event.key === 'ArrowDown' ? 1 : -1) +
                    Math.max(1, matches.length)) %
                    Math.max(1, matches.length),
                );
                return;
              }
              if (
                (event.key === 'Enter' && !event.shiftKey) ||
                (event.key === 'Tab' && matches.length)
              ) {
                event.preventDefault();
                if (matches[activeVideo]) pickVideo(matches[activeVideo]);
                return;
              }
            }
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          rows={3}
          className="min-h-[64px] w-full resize-none rounded-sm border border-line bg-surface-0 px-2.5 py-2 text-[11px] leading-relaxed text-ink transition-[border-color,box-shadow] placeholder:text-ink-faint hover:border-line-strong focus:border-accent-dim focus:ring-[3px] focus:ring-accent/15 focus:outline-none"
          placeholder="Describe an edit, or @ tag a video…"
          aria-label="Message the assistant"
          disabled={busy}
        />
        {mentions.length ? (
          <div className="flex flex-wrap gap-1" aria-label="Tagged videos">
            {mentions.map((mention) => (
              <button
                key={`${mention.assetId}-${mention.start}`}
                type="button"
                className="flex min-w-0 max-w-full items-center gap-1 rounded-sm border border-accent/20 bg-accent/10 px-1.5 py-1 text-[10px] text-ink hover:border-accent focus-visible:outline-2 focus-visible:outline-accent"
                title={mention.assetId}
                aria-label={`Remove tag ${input.slice(mention.start + 1, mention.end)}`}
                onClick={() => {
                  const next =
                    input.slice(0, mention.start) + input.slice(mention.end);
                  setMentions(
                    updateMentions(input, next, mentions, {
                      start: mention.start,
                      end: mention.end,
                    }),
                  );
                  setInput(next);
                  setMentionDismissed(true);
                  inputRef.current?.focus();
                }}
              >
                <Film size={11} className="shrink-0" aria-hidden="true" />
                <span className="truncate">
                  {input.slice(mention.start + 1, mention.end)}
                </span>
                <X size={10} className="shrink-0" aria-hidden="true" />
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 text-[9px] leading-snug text-ink-faint">
            @ tags a video · Enter sends · Shift+Enter adds a line
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
