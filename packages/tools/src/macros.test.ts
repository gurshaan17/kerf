import { describe, expect, it } from 'vitest';
import type {
  Asset,
  AssetId,
  EditCommand,
  Project,
  Transcript,
} from '@kerf/model';
import {
  assetSchema,
  createAsset,
  createCommandEnvelope,
  createProject,
  createTranscript,
  newId,
} from '@kerf/model';
import { applyCommand, sequenceDurationFrames } from '@kerf/engine';
import type { ToolContext, ToolEditResult, ToolSnapshot } from './types';
import { toolRegistry } from './index';

function asset(project: Project, name: string, kind: 'video' | 'audio'): Asset {
  return assetSchema.parse({
    ...createAsset({
      projectId: project.id,
      name,
      sourcePath: `/media/${name}`,
      kind,
      now: 1_000,
    }),
    status: 'ready',
    durationSeconds: 10,
    width: kind === 'video' ? 1920 : null,
    height: kind === 'video' ? 1080 : null,
    frameRate: { numerator: 24, denominator: 1 },
    hasVideo: kind === 'video',
    hasAudio: true,
  });
}

function transcriptFor(assetId: AssetId): Transcript {
  return createTranscript({
    assetId,
    now: 1_000,
    segments: [
      {
        id: newId('segment'),
        startFrame: 0,
        endFrame: 48,
        text: 'We begin with a take',
        words: [
          { text: 'We', startFrame: 0, endFrame: 8, confidence: 1 },
          { text: 'begin', startFrame: 8, endFrame: 24, confidence: 1 },
          { text: 'with', startFrame: 24, endFrame: 32, confidence: 1 },
          { text: 'a', startFrame: 32, endFrame: 36, confidence: 1 },
          { text: 'take', startFrame: 36, endFrame: 48, confidence: 1 },
        ],
      },
      {
        id: newId('segment'),
        startFrame: 48,
        endFrame: 96,
        text: 'We begin with a take',
        words: [
          { text: 'We', startFrame: 48, endFrame: 56, confidence: 1 },
          { text: 'begin', startFrame: 56, endFrame: 72, confidence: 1 },
          { text: 'with', startFrame: 72, endFrame: 80, confidence: 1 },
          { text: 'a', startFrame: 80, endFrame: 84, confidence: 1 },
          { text: 'take', startFrame: 84, endFrame: 96, confidence: 1 },
        ],
      },
      {
        id: newId('segment'),
        startFrame: 120,
        endFrame: 168,
        text: 'Then we finish',
        words: [
          { text: 'Then', startFrame: 120, endFrame: 128, confidence: 1 },
          { text: 'we', startFrame: 128, endFrame: 136, confidence: 1 },
          { text: 'finish', startFrame: 136, endFrame: 168, confidence: 1 },
        ],
      },
    ],
  });
}

interface Harness {
  readonly context: ToolContext;
  snapshot(): ToolSnapshot;
  commands(): readonly EditCommand[];
}

function harness(): Harness {
  const project = createProject({ name: 'Macro test', now: 1_000 });
  const video = asset(project, 'Interview.mp4', 'video');
  const music = asset(project, 'Music.mp3', 'audio');
  let snapshot: ToolSnapshot = {
    project,
    assets: [video, music],
    transcripts: [transcriptFor(video.id)],
    scenes: [],
    beatMaps: [],
    referenceProfiles: [],
    compositions: [],
  };
  let applied: EditCommand[] = [];
  const sourceDuration = (assetId: string) => {
    const current = snapshot.assets.find((item) => item.id === assetId);
    return current?.durationSeconds
      ? Math.floor(current.durationSeconds * 24)
      : undefined;
  };
  const apply = (
    command: EditCommand,
    options?: { actor?: 'agent' | 'mcp' | 'system' | 'user' },
  ): ToolEditResult => {
    const result = applyCommand(snapshot.project.sequence, command, {
      sourceDurationFrames: sourceDuration,
    });
    snapshot = {
      ...snapshot,
      project: {
        ...snapshot.project,
        sequence: result.sequence,
        updatedAt: snapshot.project.updatedAt + 1,
      },
    };
    applied = [...applied, command];
    return {
      snapshot,
      command: createCommandEnvelope({
        command,
        actor: options?.actor ?? 'agent',
        now: 2_000,
      }),
      inverse: result.inverse,
    };
  };
  return {
    snapshot: () => snapshot,
    commands: () => applied,
    context: {
      snapshot: () => snapshot,
      editor: () => ({
        playheadFrame: 0,
        selectedClipIds: [],
        selectedAssetId: video.id,
      }),
      apply: (command, options) => apply(command, options),
      applyBatch: (commands, options) =>
        apply(
          {
            type: 'batch',
            label: options?.label ?? 'Batch',
            commands: [...commands],
          },
          options,
        ),
      search: () => ({ results: [], vectorSearch: false }),
      renderer: () => null,
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
    },
  };
}

async function call(
  value: Harness,
  name: string,
  input: unknown,
): Promise<Record<string, unknown>> {
  return (await toolRegistry.call(name, input, value.context)) as Record<
    string,
    unknown
  >;
}

describe('caption macros', () => {
  it('writes captions as one undoable batch', async () => {
    const test = harness();
    const video = test.snapshot().assets[0]!;
    await call(test, 'insertClip', { assetId: video.id });
    const before = test.commands().length;
    const result = await call(test, 'writeCaptions', {
      assetId: video.id,
      preset: 'bold',
    });
    expect(result.captionCount).toBe(3);
    expect(test.commands().length).toBe(before + 1);
    expect(test.commands().at(-1)?.type).toBe('batch');
    const captionTrack = test
      .snapshot()
      .project.sequence.tracks.find((track) => track.kind === 'caption');
    expect(captionTrack?.clips).toHaveLength(3);
    expect(sequenceDurationFrames(test.snapshot().project.sequence)).toBe(240);
  });

  it('replaces existing captions when run again', async () => {
    const test = harness();
    const video = test.snapshot().assets[0]!;
    await call(test, 'insertClip', { assetId: video.id });
    await call(test, 'writeCaptions', { assetId: video.id, preset: 'clean' });
    await call(test, 'writeCaptions', { assetId: video.id, preset: 'boxed' });
    const captionTrack = test
      .snapshot()
      .project.sequence.tracks.find((track) => track.kind === 'caption');
    expect(captionTrack?.clips).toHaveLength(3);
  });
});

describe('timing macros', () => {
  it('cuts silence and closes the gap atomically', async () => {
    const test = harness();
    const video = test.snapshot().assets[0]!;
    await call(test, 'insertClip', { assetId: video.id });
    const before = test.commands().length;
    const result = await call(test, 'cutSilences', {
      assetId: video.id,
      minSilenceFrames: 12,
      paddingFrames: 2,
    });
    expect(result.removedFrames).toBeGreaterThan(0);
    expect(test.commands().length).toBe(before + 1);
    expect(test.commands().at(-1)?.type).toBe('batch');
    const videoTrack = test
      .snapshot()
      .project.sequence.tracks.find((track) => track.kind === 'video');
    expect(videoTrack?.clips.length).toBe(2);
    expect(
      sequenceDurationFrames(test.snapshot().project.sequence),
    ).toBeLessThan(240);
  });

  it('ducks music under speech', async () => {
    const test = harness();
    const video = test.snapshot().assets[0]!;
    const music = test.snapshot().assets[1]!;
    await call(test, 'insertClip', { assetId: video.id });
    await call(test, 'insertAudio', { assetId: music.id });
    const result = await call(test, 'duckUnderSpeech', {
      assetId: video.id,
      gain: 0.25,
    });
    expect(result.duckedClipCount).toBe(1);
    const musicClip = test
      .snapshot()
      .project.sequence.tracks.flatMap((track) => track.clips)
      .find((clip) => clip.type === 'audio' && clip.assetId === music.id);
    expect(musicClip?.type === 'audio' ? musicClip.volume : null).toBe(0.25);
  });

  it('assembles a rough cut and drops a repeated take', async () => {
    const test = harness();
    const video = test.snapshot().assets[0]!;
    const result = await call(test, 'assembleRoughCut', {
      assetId: video.id,
      trackName: 'Rough cut',
    });
    expect(result.clipCount).toBe(2);
    expect(result.removedSegments).toBe(1);
    expect(result.durationFrames).toBe(96);
    const track = test
      .snapshot()
      .project.sequence.tracks.find(
        (candidate) => candidate.name === 'Rough cut',
      );
    expect(track?.clips).toHaveLength(2);
  });
});
