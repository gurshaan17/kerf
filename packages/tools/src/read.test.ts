import { describe, expect, it } from 'vitest';
import {
  createAsset,
  createProject,
  createTranscript,
  newId,
  sceneSchema,
} from '@kerf/model';
import type { ToolContext, ToolSnapshot } from './types';
import { toolRegistry } from './index';

function testSnapshot(): ToolSnapshot {
  const project = createProject({
    name: 'Tool test',
    now: 1_000,
    sequence: {
      ...createProject({ name: 'Base', now: 1_000 }).sequence,
      durationFrames: 240,
    },
  });
  const asset = {
    ...createAsset({
      projectId: project.id,
      name: 'Interview A.mp4',
      sourcePath: '/media/interview-a.mp4',
      kind: 'video',
      now: 1_000,
    }),
    status: 'ready' as const,
    durationSeconds: 10,
    width: 1920,
    height: 1080,
    frameRate: { numerator: 24, denominator: 1 },
    hasVideo: true,
    hasAudio: true,
  };
  const transcript = createTranscript({
    assetId: asset.id,
    now: 1_000,
    segments: [
      {
        id: newId('segment'),
        startFrame: 24,
        endFrame: 72,
        text: 'A spoken moment',
        words: [
          { text: 'A', startFrame: 24, endFrame: 32, confidence: 1 },
          { text: 'spoken', startFrame: 32, endFrame: 52, confidence: 1 },
          { text: 'moment', startFrame: 52, endFrame: 72, confidence: 1 },
        ],
      },
    ],
  });
  const scene = sceneSchema.parse({
    id: newId('scene'),
    assetId: asset.id,
    index: 0,
    startFrame: 0,
    endFrame: 120,
    description: 'A wide shot',
  });
  return {
    project,
    assets: [asset],
    transcripts: [transcript],
    scenes: [scene],
    beatMaps: [],
    referenceProfiles: [],
    compositions: [],
  };
}

function testContext(snapshot = testSnapshot()): ToolContext {
  return {
    snapshot: () => snapshot,
    editor: () => ({
      playheadFrame: 24,
      selectedClipIds: [],
      selectedAssetId: snapshot.assets[0]?.id ?? null,
    }),
    apply: () => {
      throw new Error('not used');
    },
    applyBatch: () => {
      throw new Error('not used');
    },
    search: () => ({
      results: [
        {
          id: 'transcript-hit',
          kind: 'transcript',
          assetId: snapshot.assets[0]?.id ?? '',
          assetName: 'Interview A.mp4',
          text: 'A spoken moment',
          startFrame: 24,
          endFrame: 72,
          score: 1,
        },
      ],
      vectorSearch: false,
    }),
    renderer: () => ({
      renderFrame: async (request) => ({
        frame: request.frame,
        width: 640,
        height: 360,
        mimeType: 'image/png',
        path: '/tmp/frame.png',
      }),
      previewComposition: async () => ({
        valid: true,
        sceneTree: null,
        error: null,
      }),
    }),
    exports: () => ({
      list: () => [],
      get: () => null,
      presets: () => [],
      start: async () => {
        throw new Error('not used');
      },
      reveal: async () => undefined,
    }),
    now: () => 2_000,
  };
}

describe('tool registry', () => {
  it('exposes the read catalog', () => {
    expect(toolRegistry.names()).toEqual([
      'readContext',
      'readAssets',
      'readAsset',
      'readTimeline',
      'readTranscript',
      'findInTranscript',
      'renderFrame',
      'readDuration',
      'listEffects',
    ]);
  });

  it('validates input before execution', async () => {
    await expect(
      toolRegistry.call('readAsset', { assetId: '' }, testContext()),
    ).rejects.toThrow();
    await expect(
      toolRegistry.call('missingTool', {}, testContext()),
    ).rejects.toThrow('Unknown tool');
  });
});

describe('read tools', () => {
  it('reads project context and editor state', async () => {
    const result = (await toolRegistry.call(
      'readContext',
      {},
      testContext(),
    )) as Record<string, unknown>;
    expect(result.project).toMatchObject({
      name: 'Tool test',
      width: 1920,
      height: 1080,
    });
    expect(result.editor).toMatchObject({
      playheadFrame: 24,
      selectedAssetId: expect.any(String),
    });
  });

  it('lists assets with analysis availability', async () => {
    const result = (await toolRegistry.call(
      'readAssets',
      {},
      testContext(),
    )) as { assets: Array<Record<string, unknown>>; total: number };
    expect(result.total).toBe(1);
    expect(result.assets[0]).toMatchObject({
      name: 'Interview A.mp4',
      kind: 'video',
      hasTranscript: true,
      hasBeatMap: false,
      sceneCount: 1,
    });
  });

  it('reads one asset by name', async () => {
    const result = (await toolRegistry.call(
      'readAsset',
      { name: 'interview a.mp4' },
      testContext(),
    )) as Record<string, unknown>;
    expect(result.asset).toMatchObject({ name: 'Interview A.mp4' });
    expect(result.transcript).toMatchObject({ segmentCount: 1 });
    expect(result.scenes).toHaveLength(1);
  });

  it('reads timeline clips and markers', async () => {
    const result = (await toolRegistry.call(
      'readTimeline',
      { includeMarkers: true },
      testContext(),
    )) as { tracks: unknown[]; sequence: Record<string, unknown> };
    expect(result.sequence.durationFrames).toBe(240);
    expect(result.tracks).toHaveLength(3);
  });

  it('reads transcript windows and durations', async () => {
    const snapshot = testSnapshot();
    const transcript = (await toolRegistry.call(
      'readTranscript',
      { assetId: snapshot.assets[0]?.id, startFrame: 33, endFrame: 51 },
      testContext(snapshot),
    )) as { segments: Array<Record<string, unknown>> };
    expect(transcript.segments).toHaveLength(1);
    const words = transcript.segments[0]?.words as Array<{ text: string }>;
    expect(words.map((word) => word.text)).toEqual(['spoken']);

    const duration = (await toolRegistry.call(
      'readDuration',
      {},
      testContext(),
    )) as Record<string, unknown>;
    expect(duration.frames).toBe(240);
    expect(duration.seconds).toBe(10);
  });

  it('finds transcript moments through the context search', async () => {
    const result = (await toolRegistry.call(
      'findInTranscript',
      { query: 'spoken' },
      testContext(),
    )) as { results: Array<Record<string, unknown>> };
    expect(result.results[0]).toMatchObject({
      kind: 'transcript',
      startFrame: 24,
      endFrame: 72,
    });
  });

  it('renders a frame through the renderer bridge', async () => {
    const result = (await toolRegistry.call(
      'renderFrame',
      { frame: 12 },
      testContext(),
    )) as Record<string, unknown>;
    expect(result).toMatchObject({
      frame: 12,
      width: 640,
      height: 360,
      mimeType: 'image/png',
    });
  });

  it('lists effect capabilities', async () => {
    const result = (await toolRegistry.call(
      'listEffects',
      {},
      testContext(),
    )) as { effects: string[]; keyframeProperties: string[] };
    expect(result.effects).toContain('brightness');
    expect(result.keyframeProperties).toContain('opacity');
  });
});
