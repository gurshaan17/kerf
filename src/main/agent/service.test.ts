import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import { openDatabase } from '../db';
import { ProjectRepository } from '../projects';

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
  it('saves streamed turns and tool activity in the project database', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kerf-chat-write-'));
    const database = openDatabase({ filename: join(root, 'test.db') });
    try {
      const repository = new ProjectRepository({
        database: database.connection,
        projectsRoot: join(root, 'projects'),
      });
      const project = repository.create({ name: 'Chat write' }).project;
      const current = { ...snapshot(), project };
      const { done, resolveDone } = waitForTurn();
      const service = new AgentService({
        database: database.connection,
        projects: { current: () => current },
        providers: {
          chatProvider: provider,
          chatModel: () =>
            fakeModel([toolChunks(), textChunks('Saved response')]),
        },
        tools: { call: vi.fn(async () => ({})) } as unknown as ToolService,
        broadcast: (event) => {
          if (event.type === 'chat.done' || event.type === 'chat.error')
            resolveDone();
        },
      });
      service.start({ message: 'Remember this question' });
      await done;
      const [conversation] = service.conversations();
      expect(conversation?.title).toBe('Remember this question');
      expect(conversation?.turns[0]).toMatchObject({
        message: 'Remember this question',
        text: 'Saved response',
        status: 'done',
      });
      expect(conversation?.turns[0]?.tools[0]?.status).toBe('succeeded');
      service.newConversation();
      const reopened = service.openConversation(conversation!.id);
      expect(reopened.turns[0]?.text).toBe('Saved response');
    } finally {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

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

  it('returns a rendered frame to the model as image content', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'kerf-agent-frame-'));
    const path = join(directory, 'frame.png');
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    writeFileSync(path, png);
    try {
      const call = vi.fn(async () => ({
        frame: 12,
        width: 2,
        height: 2,
        mimeType: 'image/png',
        path,
      }));
      const tools = createAgentToolSet({ call });
      const definition = tools['renderFrame'] as unknown as {
        execute: (
          input: unknown,
          options: { toolCallId: string; messages: unknown[] },
        ) => Promise<unknown>;
        toModelOutput: (options: {
          toolCallId: string;
          input: unknown;
          output: unknown;
        }) => unknown;
      };
      const output = await definition.execute(
        { frame: 12 },
        { toolCallId: 'call_1', messages: [] },
      );
      const modelOutput = await definition.toModelOutput({
        toolCallId: 'call_1',
        input: { frame: 12 },
        output,
      });

      expect(modelOutput).toMatchObject({
        type: 'content',
        value: [
          { type: 'text' },
          {
            type: 'file',
            mediaType: 'image/png',
            data: { type: 'data', data: png.toString('base64') },
          },
        ],
      });
      expect(call).toHaveBeenCalledWith('renderFrame', { frame: 12 }, 'agent');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
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
      expect.any(Function),
      undefined,
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

describe('edit receipt verification', () => {
  it.each([false, true])(
    'persists committed edits with renderer unavailable=%s',
    async (unavailable) => {
      const state = snapshot();
      const folder = mkdtempSync(join(tmpdir(), 'kerf-receipt-'));
      const path = join(folder, 'preview.png');
      writeFileSync(path, Buffer.from('preview'));
      const events: ChatEvent[] = [];
      const call: ToolService['call'] = async (
        name,
        _input,
        _actor,
        onCommit,
      ) => {
        if (name === 'verifyTimeline')
          return { findings: [], durationFrames: 48 };
        if (name === 'renderFrame') {
          if (unavailable) throw new Error('Preview unavailable');
          return {
            path,
            frame: 24,
            width: 480,
            height: 270,
            mimeType: 'image/png',
          };
        }
        onCommit?.({
          commandId: 'command-test',
          projectId: state.project.id,
          label: 'Caption',
          frameRate: state.project.sequence.frameRate,
          undoable: true,
          beforeDurationFrames: 48,
          afterDurationFrames: 48,
          changes: [
            {
              clipId: 'caption',
              label: 'Caption',
              kind: 'added',
              startFrame: 0,
              endFrame: 48,
              visual: true,
            },
          ],
        });
        return {};
      };
      let done!: () => void;
      const completed = new Promise<void>((resolve) => {
        done = resolve;
      });
      const service = new AgentService({
        projects: { current: () => state },
        providers: {
          chatProvider: provider,
          chatModel: () => fakeModel([toolChunks(), textChunks('Done')]),
        },
        tools: { call } as ToolService,
        broadcast: (event) => {
          events.push(event);
          if (event.type === 'chat.done' || event.type === 'chat.error') done();
        },
      });
      try {
        service.start({ message: 'Caption this' });
        await completed;
        const receipts = events.filter(
          (e) => e.type === 'chat.tool' && e.tool.receipt,
        );
        expect(receipts).toHaveLength(2);
        const last = receipts.at(-1);
        if (last?.type !== 'chat.tool') throw new Error('Missing receipt');
        expect(last.tool.status).toBe('succeeded');
        expect(last.tool.verification?.status).toBe(
          unavailable ? 'partial' : 'checked',
        );
        expect(last.tool.verification?.previews).toHaveLength(
          unavailable ? 0 : 1,
        );
        expect(last.tool.receipt?.commandId).toBe('command-test');
      } finally {
        rmSync(folder, { recursive: true, force: true });
      }
    },
  );
});

it('cancels analysis created while a chat turn is being stopped', async () => {
  const state = snapshot();
  const jobId = 'job_test';
  const call = vi.fn(async (name: string) => {
    if (name === 'planAutoCut') {
      queueMicrotask(() => service.abort());
      return { id: jobId };
    }
    return {};
  });
  const chunks = [
    { type: 'stream-start', warnings: [] },
    {
      type: 'tool-call',
      toolCallId: 'plan_1',
      toolName: 'planAutoCut',
      input: JSON.stringify({
        clipId: 'clp_abcdefghijkl',
        providerId: 'provider',
      }),
    },
    finish('tool-calls'),
  ];
  const service = new AgentService({
    projects: { current: () => state },
    providers: {
      chatProvider: provider,
      chatModel: () => fakeModel([chunks, textChunks('Started')]),
    },
    tools: { call } as unknown as ToolService,
    broadcast: () => undefined,
  });
  service.start({ message: 'Cut this clip' });
  await vi.waitFor(() =>
    expect(call).toHaveBeenCalledWith('cancelEditingJob', { jobId }, 'agent'),
  );
});

it('requires source-image consent and delivers cached filmstrip bytes to the model', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'kerf-source-filmstrip-'));
  const path = join(directory, 'scene.jpg');
  writeFileSync(path, Buffer.from([0xff, 0xd8, 0xff]));
  try {
    const output = { frames: [{ path, mimeType: 'image/jpeg', frame: 12 }] };
    const call = vi.fn(async () => output);
    type Adapter = {
      execute(
        input: unknown,
        options: { toolCallId: string; messages: unknown[] },
      ): Promise<unknown>;
      toModelOutput(input: { output: unknown }): unknown;
    };
    const denied = createAgentToolSet({ call })[
      'readSourceFilmstrip'
    ] as unknown as Adapter;
    await expect(
      denied.execute({}, { toolCallId: 'filmstrip', messages: [] }),
    ).rejects.toThrow('vision consent');
    expect(call).not.toHaveBeenCalled();
    const allowed = createAgentToolSet({ call }, { sourceImages: true })[
      'readSourceFilmstrip'
    ] as unknown as Adapter;
    await allowed.execute({}, { toolCallId: 'filmstrip', messages: [] });
    expect(JSON.stringify(allowed.toModelOutput({ output }))).toContain(
      Buffer.from([0xff, 0xd8, 0xff]).toString('base64'),
    );
    rmSync(path);
    expect(JSON.stringify(allowed.toModelOutput({ output }))).toContain(
      'No source images',
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
