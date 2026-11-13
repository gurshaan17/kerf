import type { SqliteDatabase } from '../db/connection';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { stepCountIs, streamText, tool } from 'ai';
import type { LanguageModel, ModelMessage, ToolSet } from 'ai';
import { buildAgentSystemPrompt, credentialHint } from '@kerf/agent';
import { sequenceDurationFrames } from '@kerf/engine';
import { toolRegistry } from '@kerf/tools';
import type {
  ChatEvent,
  ChatAssetMention,
  ChatConversation,
  ChatTurn,
  ChatSendRequest,
  ChatStartResult,
  ChatToolActivity,
  ProjectSnapshot,
  ProviderAccount,
} from '../../shared/contracts';
import type { ToolService } from '../tools/service';

export interface AgentProviderSource {
  chatProvider(): ProviderAccount | null;
  chatModel(account: ProviderAccount): LanguageModel;
}

export interface AgentProjectSource {
  current(): ProjectSnapshot | null;
}

export interface AgentServiceOptions {
  readonly database?: SqliteDatabase;
  readonly projects: AgentProjectSource;
  readonly providers: AgentProviderSource;
  readonly tools: ToolService;
  readonly broadcast: (event: ChatEvent) => void;
  readonly now?: () => number;
  readonly createModel?: (account: ProviderAccount) => LanguageModel;
}

interface ActiveTurn {
  readonly turnId: string;
  readonly controller: AbortController;
  readonly startedAt: number;
}

interface ToolTiming {
  readonly input: unknown;
  readonly startedAt: number;
}

function errorMessage(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message;
  }
  return String(cause);
}

function errorHint(cause: unknown): string | null {
  const direct = credentialHint(cause);
  if (direct) {
    return direct;
  }
  const message = errorMessage(cause);
  if (/no chat provider|chat consent/i.test(message)) {
    return 'Open AI settings, add a provider and allow it to power chat.';
  }
  if (/select a model|choose a model/i.test(message)) {
    return 'Set a model for the chat provider in AI settings.';
  }
  return null;
}

/**
 * Render tools return a cache path. The model gets the PNG bytes as a file
 * part so it can actually see the captured overlay frame, with the structured
 * result kept as text for providers that prefer text tool results.
 */
function renderFrameModelOutput(output: unknown) {
  const frame = output as { path?: unknown; mimeType?: unknown };
  const text = JSON.stringify(output, null, 2);
  if (typeof frame.path === 'string') {
    try {
      return {
        type: 'content' as const,
        value: [
          { type: 'text' as const, text },
          {
            type: 'file' as const,
            mediaType:
              typeof frame.mimeType === 'string' ? frame.mimeType : 'image/png',
            data: {
              type: 'data' as const,
              data: readFileSync(frame.path).toString('base64'),
            },
          },
        ],
      };
    } catch {
      // Keep the path when the cache file has already been pruned.
    }
  }
  return { type: 'text' as const, value: text };
}

function chatModelMessage(
  message: string,
  mentions: readonly ChatAssetMention[] = [],
): string {
  if (!mentions.length) return message;
  return `${message}\n\nTagged source videos (use these exact asset IDs with tools; these are references, not uploaded files):\n${JSON.stringify(mentions.map((mention) => ({ assetId: mention.assetId, start: mention.start, end: mention.end, mention: message.slice(mention.start, mention.end) })))}`;
}

/**
 * Maps the shared tool catalog into the AI SDK's tool shape. Every tool keeps
 * its Zod validation at the registry boundary, so the model cannot hand raw
 * values to an edit command.
 */
export function createAgentToolSet(
  executor: Pick<ToolService, 'call'>,
): ToolSet {
  const tools: ToolSet = {};
  for (const definition of toolRegistry.list()) {
    const base = {
      description: definition.description,
      inputSchema: definition.input,
      execute: async (
        input: unknown,
        options: { abortSignal?: AbortSignal },
      ) => {
        if (options.abortSignal?.aborted) {
          throw new Error('The turn was stopped before this tool ran.');
        }
        return executor.call(definition.name, input, 'agent');
      },
    };
    tools[definition.name] =
      definition.name === 'renderFrame'
        ? tool({
            ...base,
            toModelOutput: ({ output }) => renderFrameModelOutput(output),
          })
        : tool(base);
  }
  return tools;
}

/**
 * Owns the saved conversation and streams one agent turn at a time. The
 * renderer receives coarse chat events; tool execution stays in the main
 * process and always goes through ToolService.
 */
export class AgentService {
  private readonly options: AgentServiceOptions;
  private readonly now: () => number;
  private sessionId = `chat_${randomUUID()}`;
  private readonly history: ModelMessage[] = [];
  private conversation: ChatConversation | null = null;
  private active: ActiveTurn | null = null;
  private projectId: string | null = null;

  constructor(options: AgentServiceOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
  }

  conversations(): ChatConversation[] {
    const projectId = this.options.projects.current()?.project.id;
    if (!projectId) return [];
    const rows = this.options.database
      ?.prepare(
        'SELECT payload_json FROM chat_conversations WHERE project_id = ?',
      )
      .all(projectId) as { payload_json: string }[] | undefined;
    return (rows ?? [])
      .map((row) => {
        const conversation = JSON.parse(row.payload_json) as ChatConversation;
        return {
          ...conversation,
          turns: conversation.turns.map((turn) =>
            turn.status === 'streaming'
              ? { ...turn, status: 'aborted' as const }
              : turn,
          ),
        };
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  openConversation(id: string): ChatConversation {
    if (this.active)
      throw new Error('Stop the current response before switching chats.');
    const conversation = this.conversations().find((item) => item.id === id);
    if (!conversation)
      throw new Error('The conversation was not found in this project.');
    this.newConversation();
    this.conversation = conversation;
    this.sessionId = conversation.id;
    this.history.push(
      ...conversation.turns
        .filter((turn) => turn.status === 'done')
        .slice(-20)
        .flatMap((turn) => [
          {
            role: 'user' as const,
            content: chatModelMessage(turn.message, turn.mentions),
          },
          { role: 'assistant' as const, content: turn.text },
        ]),
    );
    return conversation;
  }

  newConversation(): void {
    if (this.active)
      throw new Error('Stop the current response before starting a new chat.');
    this.history.length = 0;
    this.conversation = null;
    this.projectId = this.options.projects.current()?.project.id ?? null;
    this.sessionId = `chat_${randomUUID()}`;
  }

  private emit(event: ChatEvent): void {
    if (event.type === 'chat.started') {
      const turn: ChatTurn = {
        id: event.turnId,
        message: event.message,
        mentions: event.mentions,
        text: '',
        tools: [],
        status: 'streaming',
        providerLabel: event.providerLabel,
        error: null,
        hint: null,
        durationMs: null,
      };
      this.conversation = {
        id: this.sessionId,
        title: this.conversation?.title ?? event.message.slice(0, 80),
        updatedAt: this.now(),
        turns: [...(this.conversation?.turns ?? []), turn],
      };
    } else if (this.conversation) {
      this.conversation = {
        ...this.conversation,
        updatedAt: this.now(),
        turns: this.conversation.turns.map((turn) => {
          if (turn.id !== event.turnId) return turn;
          switch (event.type) {
            case 'chat.delta':
              return { ...turn, text: turn.text + event.text };
            case 'chat.tool':
              return {
                ...turn,
                tools: [
                  ...turn.tools.filter((tool) => tool.id !== event.tool.id),
                  event.tool,
                ],
              };
            case 'chat.done':
              return {
                ...turn,
                text: event.text,
                status: 'done',
                durationMs: event.durationMs,
              };
            case 'chat.aborted':
              return { ...turn, status: 'aborted' };
            case 'chat.error':
              return {
                ...turn,
                status: 'error',
                error: event.error,
                hint: event.hint,
              };
          }
        }),
      };
    }
    if (this.conversation && this.projectId) {
      this.options.database
        ?.prepare(
          'INSERT INTO chat_conversations (id, project_id, payload_json) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload_json = excluded.payload_json',
        )
        .run(
          this.conversation.id,
          this.projectId,
          JSON.stringify(this.conversation),
        );
    }
    this.options.broadcast(event);
  }

  get busy(): boolean {
    return this.active !== null;
  }

  start(request: ChatSendRequest): ChatStartResult {
    const message = request.message;
    if (message.trim().length === 0) {
      throw new Error('Write a message before sending it.');
    }
    if (message.length > 8_000) {
      throw new Error('Keep the message under 8,000 characters.');
    }
    if (this.active) {
      throw new Error('Wait for the current turn to finish or stop it first.');
    }
    const snapshot = this.options.projects.current();
    if (!snapshot) {
      throw new Error('Open a project before chatting.');
    }
    const mentions = request.mentions ?? [];
    if (mentions.length > 50)
      throw new Error('Tag up to 50 videos per message.');
    let previousEnd = 0;
    for (const mention of mentions) {
      if (
        !Number.isInteger(mention.start) ||
        !Number.isInteger(mention.end) ||
        mention.start < previousEnd ||
        mention.end <= mention.start ||
        mention.end > message.length ||
        message[mention.start] !== '@'
      ) {
        throw new Error(
          'A video tag is invalid. Remove it and tag the video again.',
        );
      }
      if (
        !snapshot.assets.some(
          (asset) => asset.id === mention.assetId && asset.kind === 'video',
        )
      ) {
        throw new Error(
          'A tagged video is no longer in this project. Remove the tag and choose another source.',
        );
      }
      previousEnd = mention.end;
    }
    const provider = this.options.providers.chatProvider();
    if (!provider) {
      throw new Error(
        'No chat provider is configured. Add a provider and grant chat consent in AI settings.',
      );
    }
    const model = this.createModel(provider);
    const turn: ActiveTurn = {
      turnId: `turn_${randomUUID()}`,
      controller: new AbortController(),
      startedAt: this.now(),
    };
    if (this.projectId !== snapshot.project.id) {
      this.newConversation();
    }
    this.active = turn;
    this.emit({
      type: 'chat.started',
      mentions,
      turnId: turn.turnId,
      sessionId: this.sessionId,
      message,
      providerLabel: provider.label,
    });
    void this.run(turn, provider, model, snapshot, message, mentions);
    return {
      turnId: turn.turnId,
      sessionId: this.sessionId,
      provider: {
        id: provider.id,
        label: provider.label,
        kind: provider.kind,
        model: provider.model,
      },
    };
  }

  abort(): boolean {
    if (!this.active) {
      return false;
    }
    this.active.controller.abort();
    return true;
  }

  private createModel(account: ProviderAccount): LanguageModel {
    try {
      return this.options.createModel
        ? this.options.createModel(account)
        : this.options.providers.chatModel(account);
    } catch (cause) {
      const hint = errorHint(cause);
      throw new Error(hint ?? errorMessage(cause));
    }
  }

  private async run(
    turn: ActiveTurn,
    provider: ProviderAccount,
    model: LanguageModel,
    snapshot: ProjectSnapshot,
    message: string,
    mentions: readonly ChatAssetMention[],
  ): Promise<void> {
    const toolTimings = new Map<string, ToolTiming>();
    let text = '';
    let aborted = false;
    try {
      const result = streamText({
        model,
        system: buildAgentSystemPrompt({
          projectName: snapshot.project.name,
          durationFrames: sequenceDurationFrames(snapshot.project.sequence),
          providerLabel: provider.label,
          referenceName: snapshot.project.sequence.reference?.name ?? null,
        }),
        messages: [
          ...this.history,
          { role: 'user', content: chatModelMessage(message, mentions) },
        ],
        tools: createAgentToolSet(this.options.tools),
        stopWhen: stepCountIs(12),
        toolCallConcurrency: 1,
        maxRetries: 1,
        abortSignal: turn.controller.signal,
      });

      for await (const part of result.stream) {
        if (turn.controller.signal.aborted) {
          aborted = true;
          break;
        }
        switch (part.type) {
          case 'text-delta':
            text += part.text;
            this.emit({
              type: 'chat.delta',
              turnId: turn.turnId,
              text: part.text,
            });
            break;
          case 'tool-call': {
            const activity: ChatToolActivity = {
              id: part.toolCallId,
              name: part.toolName,
              status: 'running',
              input: part.input,
            };
            toolTimings.set(part.toolCallId, {
              input: part.input,
              startedAt: this.now(),
            });
            this.emit({
              type: 'chat.tool',
              turnId: turn.turnId,
              tool: activity,
            });
            break;
          }
          case 'tool-result': {
            const timing = toolTimings.get(part.toolCallId);
            this.emit({
              type: 'chat.tool',
              turnId: turn.turnId,
              tool: {
                id: part.toolCallId,
                name: part.toolName,
                status: 'succeeded',
                input: timing?.input,
                output: part.output,
                durationMs: timing ? this.now() - timing.startedAt : undefined,
              },
            });
            toolTimings.delete(part.toolCallId);
            break;
          }
          case 'tool-error': {
            const timing = toolTimings.get(part.toolCallId);
            this.emit({
              type: 'chat.tool',
              turnId: turn.turnId,
              tool: {
                id: part.toolCallId,
                name: part.toolName,
                status: 'failed',
                input: timing?.input,
                error: errorMessage(part.error),
                durationMs: timing ? this.now() - timing.startedAt : undefined,
              },
            });
            toolTimings.delete(part.toolCallId);
            break;
          }
          case 'abort':
            aborted = true;
            break;
          case 'error':
            throw part.error instanceof Error
              ? part.error
              : new Error(errorMessage(part.error));
          default:
            break;
        }
      }

      if (aborted || turn.controller.signal.aborted) {
        this.emit({ type: 'chat.aborted', turnId: turn.turnId });
        return;
      }

      this.history.push(
        { role: 'user', content: chatModelMessage(message, mentions) },
        { role: 'assistant', content: text },
      );
      if (this.history.length > 40) {
        this.history.splice(0, this.history.length - 40);
      }
      this.emit({
        type: 'chat.done',
        turnId: turn.turnId,
        text,
        durationMs: this.now() - turn.startedAt,
      });
    } catch (cause) {
      if (turn.controller.signal.aborted) {
        this.emit({ type: 'chat.aborted', turnId: turn.turnId });
        return;
      }
      this.emit({
        type: 'chat.error',
        turnId: turn.turnId,
        error: errorMessage(cause),
        hint: errorHint(cause),
      });
    } finally {
      if (this.active?.turnId === turn.turnId) {
        this.active = null;
      }
    }
  }
}
