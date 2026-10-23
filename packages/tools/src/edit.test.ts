import { describe, expect, it } from 'vitest';
import type { Asset, Clip, EditCommand, Project } from '@kerf/model';
import {
  assetSchema,
  createAsset,
  createCommandEnvelope,
  createProject,
  newId,
} from '@kerf/model';
import { applyCommand, sequenceDurationFrames } from '@kerf/engine';
import type { ToolContext, ToolEditResult, ToolSnapshot } from './types';
import { toolRegistry } from './index';

function videoAsset(project: Project, name: string): Asset {
  return assetSchema.parse({
    ...createAsset({
      projectId: project.id,
      name,
      sourcePath: `/media/${name}`,
      kind: 'video',
      now: 1_000,
    }),
    status: 'ready',
    durationSeconds: 10,
    width: 1920,
    height: 1080,
    frameRate: { numerator: 24, denominator: 1 },
    hasVideo: true,
    hasAudio: true,
  });
}

function audioAsset(project: Project, name: string): Asset {
  return assetSchema.parse({
    ...createAsset({
      projectId: project.id,
      name,
      sourcePath: `/media/${name}`,
      kind: 'audio',
      now: 1_000,
    }),
    status: 'ready',
    durationSeconds: 10,
    frameRate: { numerator: 24, denominator: 1 },
    hasAudio: true,
  });
}

interface TestHarness {
  readonly context: ToolContext;
  snapshot(): ToolSnapshot;
  commands(): readonly EditCommand[];
}

function harness(): TestHarness {
  const project = createProject({ name: 'Edit test', now: 1_000 });
  const assets = [
    videoAsset(project, 'A roll.mp4'),
    audioAsset(project, 'Music.mp3'),
  ];
  let snapshot: ToolSnapshot = {
    project,
    assets,
    transcripts: [],
    scenes: [],
    beatMaps: [],
    referenceProfiles: [],
    compositions: [],
  };
  let applied: EditCommand[] = [];
  const sourceDuration = (assetId: string) => {
    const asset = snapshot.assets.find((candidate) => candidate.id === assetId);
    return asset?.durationSeconds
      ? Math.floor(asset.durationSeconds * 24)
      : undefined;
  };

  const apply = (
    command: EditCommand,
    options?: { actor?: 'agent' | 'mcp' | 'system' | 'user' },
  ): ToolEditResult => {
    const result = applyCommand(snapshot.project.sequence, command, {
      sourceDurationFrames: sourceDuration,
    });
    const nextProject: Project = {
      ...snapshot.project,
      sequence: result.sequence,
      updatedAt: snapshot.project.updatedAt + 1,
    };
    snapshot = { ...snapshot, project: nextProject };
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
        selectedAssetId: assets[0]?.id ?? null,
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
  harnessValue: TestHarness,
  name: string,
  input: unknown,
): Promise<Record<string, unknown>> {
  return (await toolRegistry.call(name, input, harnessValue.context)) as Record<
    string,
    unknown
  >;
}

function clipById(snapshot: ToolSnapshot, clipId: unknown): Clip {
  for (const track of snapshot.project.sequence.tracks) {
    for (const clip of track.clips) {
      if (clip.id === clipId) {
        return clip;
      }
    }
  }
  throw new Error('clip not found');
}

function trackIdFor(snapshot: ToolSnapshot, kind: 'video' | 'audio'): string {
  const track = snapshot.project.sequence.tracks.find(
    (candidate) => candidate.kind === kind,
  );
  if (!track) {
    throw new Error('track not found');
  }
  return track.id;
}

describe('insertion tools', () => {
  it('inserts compatible media and reports the mapped command', async () => {
    const test = harness();
    const assetId = test.snapshot().assets[0]?.id;
    const result = await call(test, 'insertClip', { assetId });
    expect(result).toMatchObject({
      trackId: trackIdFor(test.snapshot(), 'video'),
      startFrame: 0,
      clipDurationFrames: 240,
    });
    expect(test.commands()[0]).toMatchObject({ type: 'clip.insert' });
    expect(clipById(test.snapshot(), result.clipId).type).toBe('video');
  });

  it('inserts audio, text and reports sequence duration', async () => {
    const test = harness();
    const audioId = test.snapshot().assets[1]?.id;
    const audio = await call(test, 'insertAudio', { assetId: audioId });
    expect(clipById(test.snapshot(), audio.clipId).type).toBe('audio');

    const text = await call(test, 'insertText', {
      text: 'A title',
      startFrame: 24,
      durationFrames: 48,
    });
    expect(clipById(test.snapshot(), text.clipId).type).toBe('text');
    expect(sequenceDurationFrames(test.snapshot().project.sequence)).toBe(240);
  });
});

describe('clip edit tools', () => {
  async function withClip() {
    const test = harness();
    const assetId = test.snapshot().assets[0]?.id;
    const inserted = await call(test, 'insertClip', { assetId });
    const clipId = inserted.clipId as string;
    return { test, clipId };
  }

  it('edits, moves, trims, splits and duplicates a clip', async () => {
    const { test, clipId } = await withClip();
    await call(test, 'editClip', {
      clipId,
      patch: { label: 'Opening', transform: { scale: 1.2 } },
    });
    expect(clipById(test.snapshot(), clipId).label).toBe('Opening');

    await call(test, 'moveClip', { clipId, startFrame: 12 });
    expect(clipById(test.snapshot(), clipId).startFrame).toBe(12);

    await call(test, 'trimClip', { clipId, edge: 'out', frames: -24 });
    expect(clipById(test.snapshot(), clipId).durationFrames).toBe(216);

    await call(test, 'splitClip', { clipId, frame: 72 });
    const clips = test.snapshot().project.sequence.tracks[0]?.clips ?? [];
    expect(clips).toHaveLength(2);

    await call(test, 'duplicateClip', {
      clipId,
      offsetFrames: 300,
    });
    expect(test.snapshot().project.sequence.tracks[0]?.clips).toHaveLength(3);
  });

  it('removes clips atomically and slips source timing', async () => {
    const { test, clipId } = await withClip();
    const text = await call(test, 'insertText', {
      text: 'Remove me',
      startFrame: 300,
    });
    await call(test, 'trimClip', { clipId, edge: 'out', frames: -48 });
    await call(test, 'slipClip', { clipId, deltaFrames: 12 });
    const slipped = clipById(test.snapshot(), clipId);
    expect(slipped.type === 'video' ? slipped.sourceInFrame : 0).toBe(12);

    const before = test.commands().length;
    await call(test, 'removeClips', { clipIds: [clipId, text.clipId] });
    expect(test.commands().length).toBe(before + 1);
    expect(test.commands().at(-1)?.type).toBe('batch');
  });
});

describe('property and marker tools', () => {
  it('sets speed maps, keyframes and markers', async () => {
    const test = harness();
    const assetId = test.snapshot().assets[0]?.id;
    const inserted = await call(test, 'insertClip', { assetId });
    const clipId = inserted.clipId as string;

    await call(test, 'setSpeedMap', {
      clipId,
      speed: 0.5,
      points: [
        { frame: 0, sourceFrame: 0 },
        { frame: 60, sourceFrame: 120 },
      ],
    });
    const clip = clipById(test.snapshot(), clipId);
    expect(clip.type === 'video' ? clip.speed : null).toBe(0.5);

    await call(test, 'animateProperty', {
      clipId,
      property: 'opacity',
      keyframes: [
        { frame: 0, value: 0 },
        { frame: 24, value: 1 },
      ],
    });
    expect(clipById(test.snapshot(), clipId).keyframes.opacity).toHaveLength(2);

    const marker = await call(test, 'markMoment', {
      frame: 30,
      label: 'Best moment',
    });
    expect(marker).toMatchObject({ frame: 30 });
    expect(test.snapshot().project.sequence.markers).toHaveLength(1);
  });

  it('applies batches through one command envelope', async () => {
    const test = harness();
    const before = test.commands().length;
    await call(test, 'applyBatch', {
      label: 'Two markers',
      commands: [
        {
          type: 'marker.add',
          marker: {
            id: newId('marker'),
            frame: 10,
            label: 'One',
            kind: 'marker',
            color: '#c9a46a',
          },
        },
        {
          type: 'marker.add',
          marker: {
            id: newId('marker'),
            frame: 20,
            label: 'Two',
            kind: 'marker',
            color: '#c9a46a',
          },
        },
      ],
    });
    expect(test.commands().length).toBe(before + 1);
    expect(test.snapshot().project.sequence.markers).toHaveLength(2);
  });
});
