import { describe, expect, it, vi } from 'vitest';
import type { LanguageModel } from 'ai';
import { createProject } from '@kerf/model';
import type {
  ChatEvent,
  ProjectSnapshot,
  ProjectSummary,
  ProviderAccount,
} from '../../shared/contracts';
import type { ToolService } from '../tools/service';
import { AgentService, createAgentToolSet } from './service';

function snapshot(): ProjectSnapshot {
  const project = createProject({ name: 'Agent test', now: 1 });
  const summary: ProjectSummary = {
    id: project.id,
    name: project.name,
    folderPath: '/tmp/agent-test',
    width: project.sequence.width,
    height: project.sequence.height,
    frameRate: project.sequence.frameRate,
    durationFrames: project.sequence.durationFrames,
    assetCount: 0,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
  return {
    summary,
    project,
    assets: [],
    transcripts: [],
    scenes: [],
    beatMaps: [],
    compositions: [],
    jobs: [],
    history: {
      canUndo: false,
      canRedo: false,
      undoDepth: 0,
      redoDepth: 0,
      undo: null,
      redo: null,
      groupOpen: false,
    },
  };
}

function provider(): ProviderAccount {
  return {
    id: 'provider_test',
    kind: 'ollama',
    label: 'Test local model',
    baseUrl: null,
    model: 'test-model',
    chatModel: 'test-model',
    hasKey: false,
    enabled: true,
    visionConsent: false,
    chatConsent: true,
  };
}

function fakeModel(
  streams: readonly (readonly Record<string, unknown>[])[],
): LanguageModel {
  let index = 0;
  return {
    specificationVersion: 'v3',
    provider: 'test',
    modelId: 'test-model',
    supportedUrls: {},
    doGenerate: async () => {
      throw new Error('The test only uses streaming.');
    },
    doStream: async () => {
      const chunks = streams[Math.min(index, streams.length - 1)] ?? [];
      index += 1;
      return {
        stream: new ReadableStream({
          start(controller) {
            for (const chunk of chunks) {
              controller.enqueue(chunk);
            }
            controller.close();
          },
        }),
      };
    },
  } as unknown as LanguageModel;
}

function finish(reason: 'stop' | 'tool-calls'): Record<string, unknown> {
  return {
    type: 'finish',
    usage: {
      inputTokens: {
        total: 0,
        noCache: 0,
        cacheRead: 0,
        cacheWrite: 0,
      },
      outputTokens: { total: 0, text: 0, reasoning: 0 },
    },
    finishReason: { unified: reason, raw: reason },
  };
}

function textChunks(text: string): Record<string, unknown>[] {
  return [
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: 'text_1' },
    { type: 'text-delta', id: 'text_1', delta: text },
    { type: 'text-end', id: 'text_1' },
    finish('stop'),
  ];
}

function toolChunks(): Record<string, unknown>[] {
  return [
    { type: 'stream-start', warnings: [] },
    {
      type: 'tool-call',
      toolCallId: 'call_1',
      toolName: 'readTimeline',
      input: JSON.stringify({ includeMarkers: true }),
    },
    finish('tool-calls'),
  ];
}

function runner(
  events: ChatEvent[],
  resolveDone: () => void,
  tools: Pick<ToolService, 'call'> = { call: vi.fn(async () => ({})) },
) {
  const service = new AgentService({
    projects: { current: snapshot },
    providers: {
      chatProvider: provider,
      chatModel: () => fakeModel([toolChunks(), textChunks('Done')]),
    },
    tools: tools as ToolService,
    broadcast: (event) => {
      events.push(event);
      if (
        event.type === 'chat.done' ||
        event.type === 'chat.error' ||
        event.type === 'chat.aborted'
      ) {
        resolveDone();
      }
    },
    now: () => 10,
  });
  return { service, tools };
}

function waitForTurn() {
  const events: ChatEvent[] = [];
  let resolveDone: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    resolveDone = () => resolve();
  });
  return { events, done, resolveDone };
}

describe('AgentService', () => {
  it('maps the shared catalog into executable AI SDK tools', async () => {
    const call = vi.fn(async () => ({ ok: true }));
    const tools = createAgentToolSet({ call });
    const definition = tools['insertText'] as unknown as {
      execute: (
        input: unknown,
        options: { toolCallId: string; messages: unknown[] },
      ) => Promise<unknown>;
    };
    await expect(
      definition.execute(
        { text: 'Hello' },
        { toolCallId: 'call_1', messages: [] },
      ),
    ).resolves.toEqual({ ok: true });
    expect(call).toHaveBeenCalledWith('insertText', { text: 'Hello' }, 'agent');
  });

  it('refuses to start without a consented chat provider', () => {
    const service = new AgentService({
      projects: { current: snapshot },
      providers: {
        chatProvider: () => null,
        chatModel: () => fakeModel([textChunks('Never')]),
      },
      tools: { call: vi.fn() } as unknown as ToolService,
      broadcast: () => undefined,
    });
    expect(() => service.start({ message: 'Hello' })).toThrow(
      /No chat provider is configured/,
    );
  });

  it('streams text deltas and tool activity before finishing the turn', async () => {
    const { events, done, resolveDone } = waitForTurn();
    const call = vi.fn(async () => ({
      sequence: { id: 'sequence_a', durationFrames: 0 },
      tracks: [],
      markers: [],
    }));
    const { service } = runner(events, resolveDone, { call });
    const started = service.start({ message: 'Cut this together' });
    expect(started.turnId).toMatch(/^turn_/);
    await done;

    expect(events[0]).toMatchObject({
      type: 'chat.started',
      message: 'Cut this together',
      providerLabel: 'Test local model',
    });
    expect(
      events.filter(
        (event) =>
          event.type === 'chat.tool' && event.tool.status === 'running',
      ),
    ).toHaveLength(1);
    expect(
      events.filter(
        (event) =>
          event.type === 'chat.tool' && event.tool.status === 'succeeded',
      ),
    ).toHaveLength(1);
    expect(call).toHaveBeenCalledWith(
      'readTimeline',
      { includeMarkers: true },
      'agent',
    );
    const deltas = events
      .filter((event) => event.type === 'chat.delta')
      .map((event) => event.text)
      .join('');
    expect(deltas).toBe('Done');
    expect(events.at(-1)).toMatchObject({
      type: 'chat.done',
      text: 'Done',
    });
    expect(service.busy).toBe(false);
  });

  it('does not report an abort as a completed turn', async () => {
    const { events, done, resolveDone } = waitForTurn();
    const service = new AgentService({
      projects: { current: snapshot },
      providers: {
        chatProvider: provider,
        chatModel: () => fakeModel([textChunks('Partial reply')]),
      },
      tools: { call: vi.fn() } as unknown as ToolService,
      broadcast: (event) => {
        events.push(event);
        if (
          event.type === 'chat.done' ||
          event.type === 'chat.error' ||
          event.type === 'chat.aborted'
        ) {
          resolveDone();
        }
      },
    });
    service.start({ message: 'Hello' });
    expect(service.abort()).toBe(true);
    await done;
    expect(events.at(-1)?.type).toBe('chat.aborted');
    expect(events.some((event) => event.type === 'chat.done')).toBe(false);
    expect(service.abort()).toBe(false);
  });
});
