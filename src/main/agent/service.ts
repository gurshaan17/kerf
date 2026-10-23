import { randomUUID } from 'node:crypto';
import { stepCountIs, streamText, tool } from 'ai';
import type { LanguageModel, ModelMessage, ToolSet } from 'ai';
import { buildAgentSystemPrompt, credentialHint } from '@kerf/agent';
import { sequenceDurationFrames } from '@kerf/engine';
import { toolRegistry } from '@kerf/tools';
import type {
  ChatEvent,
  ChatSendRequest,
  ChatStartResult,
  ChatToolActivity,
  ProjectSnapshot,
  ProviderAccount,
} from '../../shared/contracts';
import type { ToolService } from '../tools/service';

export interface AgentProviderSource {
  chatProvider(): ProviderAccount | null;
  model(account: ProviderAccount): LanguageModel;
}

export interface AgentProjectSource {
  current(): ProjectSnapshot | null;
}

export interface AgentServiceOptions {
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
 * Maps the shared tool catalog into the AI SDK's tool shape. Every tool keeps
 * its Zod validation at the registry boundary, so the model cannot hand raw
 * values to an edit command.
 */
export function createAgentToolSet(
  executor: Pick<ToolService, 'call'>,
): ToolSet {
  const tools: ToolSet = {};
  for (const definition of toolRegistry.list()) {
    tools[definition.name] = tool({
      description: definition.description,
      inputSchema: definition.input,
      execute: async (input: unknown, options) => {
        if (options.abortSignal?.aborted) {
          throw new Error('The turn was stopped before this tool ran.');
        }
        return executor.call(definition.name, input, 'agent');
      },
    });
  }
  return tools;
}

/**
 * Owns the in-memory conversation and streams one agent turn at a time. The
 * renderer receives coarse chat events; tool execution stays in the main
 * process and always goes through ToolService.
 */
export class AgentService {
  private readonly options: AgentServiceOptions;
  private readonly now: () => number;
  private readonly sessionId = `chat_${randomUUID()}`;
  private readonly history: ModelMessage[] = [];
  private active: ActiveTurn | null = null;
  private projectId: string | null = null;

  constructor(options: AgentServiceOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
  }

  get busy(): boolean {
    return this.active !== null;
  }

  start(request: ChatSendRequest): ChatStartResult {
    const message = request.message.trim();
    if (message.length === 0) {
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
      this.history.length = 0;
      this.projectId = snapshot.project.id;
    }
    this.active = turn;
    this.options.broadcast({
      type: 'chat.started',
      turnId: turn.turnId,
      sessionId: this.sessionId,
      message,
      providerLabel: provider.label,
    });
    void this.run(turn, provider, model, snapshot, message);
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
        : this.options.providers.model(account);
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
        messages: [...this.history, { role: 'user', content: message }],
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
            this.options.broadcast({
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
            this.options.broadcast({
              type: 'chat.tool',
              turnId: turn.turnId,
              tool: activity,
            });
            break;
          }
          case 'tool-result': {
            const timing = toolTimings.get(part.toolCallId);
            this.options.broadcast({
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
            this.options.broadcast({
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
        this.options.broadcast({ type: 'chat.aborted', turnId: turn.turnId });
        return;
      }

      this.history.push(
        { role: 'user', content: message },
        { role: 'assistant', content: text },
      );
      if (this.history.length > 40) {
        this.history.splice(0, this.history.length - 40);
      }
      this.options.broadcast({
        type: 'chat.done',
        turnId: turn.turnId,
        text,
        durationMs: this.now() - turn.startedAt,
      });
    } catch (cause) {
      if (turn.controller.signal.aborted) {
        this.options.broadcast({ type: 'chat.aborted', turnId: turn.turnId });
        return;
      }
      this.options.broadcast({
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
