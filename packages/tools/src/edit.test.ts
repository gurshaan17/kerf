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
  readonly selection: string[];
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
  const selection: string[] = [];
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
    selection,
    context: {
      snapshot: () => snapshot,
      editor: () => ({
        playheadFrame: 0,
        selectedClipIds: selection,
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

describe('overlay tools', () => {
  async function withVideo() {
    const test = harness();
    const assetId = test.snapshot().assets[0]?.id;
    const inserted = await call(test, 'insertClip', { assetId });
    return { test, clipId: inserted.clipId as string };
  }

  it('creates the Effects track and first overlay in one undo step', async () => {
    const { test, clipId } = await withVideo();
    const result = await call(test, 'addOverlay', {
      kind: 'blur',
      linkedItemId: clipId,
      props: { mode: 'pixelate', amount: 40 },
    });

    expect(result).toMatchObject({
      overlayKind: 'blur',
      trackCreated: true,
      startFrame: 0,
      durationFrames: 240,
      linkedItemId: clipId,
    });
    expect(test.commands().at(-1)).toMatchObject({ type: 'batch' });

    const sequence = test.snapshot().project.sequence;
    const effects = sequence.tracks.find((track) => track.kind === 'effects');
    expect(effects).toBeDefined();
    expect(sequence.tracks[0]?.kind).toBe('effects');
    const overlay = effects?.clips[0];
    expect(overlay).toMatchObject({
      type: 'fxOverlay',
      linkedItemId: clipId,
      startFrame: 0,
      durationFrames: 240,
      props: {
        kind: 'blur',
        mode: 'pixelate',
        amount: 40,
        region: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
      },
    });
  });

  it('links to the selected clip by default', async () => {
    const { test, clipId } = await withVideo();
    test.selection.push(clipId);
    const result = await call(test, 'addOverlay', { kind: 'zoom' });

    expect(result).toMatchObject({
      overlayKind: 'zoom',
      linkedItemId: clipId,
      startFrame: 0,
      durationFrames: 240,
    });
  });

  it('defaults an unlinked overlay to the playhead and three seconds', async () => {
    const test = harness();
    const result = await call(test, 'addOverlay', {
      kind: 'callout',
      linkedItemId: null,
      startFrame: 12,
    });

    expect(result).toMatchObject({
      overlayKind: 'callout',
      trackCreated: true,
      startFrame: 12,
      durationFrames: 72,
      linkedItemId: null,
    });
    const effects = test
      .snapshot()
      .project.sequence.tracks.find((track) => track.kind === 'effects');
    const overlay = effects?.clips[0];
    expect(overlay?.type).toBe('fxOverlay');
    if (!overlay || overlay.type !== 'fxOverlay') {
      throw new Error('overlay not found');
    }
    expect(overlay.props).toMatchObject({ kind: 'callout', text: 'Callout' });
  });

  it('merges partial props without changing the kind', async () => {
    const { test, clipId } = await withVideo();
    const added = await call(test, 'addOverlay', {
      kind: 'blur',
      linkedItemId: clipId,
      props: { mode: 'pixelate', amount: 40 },
    });
    const updated = await call(test, 'updateOverlay', {
      overlayId: added.overlayId,
      durationFrames: 48,
      props: { amount: 12 },
    });

    expect(updated).toMatchObject({
      overlayKind: 'blur',
      durationFrames: 48,
      linkedItemId: clipId,
    });
    const overlay = clipById(test.snapshot(), added.overlayId);
    expect(overlay.type).toBe('fxOverlay');
    if (overlay.type !== 'fxOverlay') {
      throw new Error('overlay not found');
    }
    expect(overlay.props).toMatchObject({
      kind: 'blur',
      mode: 'pixelate',
      amount: 12,
    });

    await expect(
      call(test, 'updateOverlay', {
        overlayId: added.overlayId,
        props: { kind: 'zoom' },
      }),
    ).rejects.toThrow(/not valid|cannot change/i);
  });

  it('reports overlay details in readTimeline', async () => {
    const { test, clipId } = await withVideo();
    const added = await call(test, 'addOverlay', {
      kind: 'spotlight',
      linkedItemId: clipId,
      props: { dim: 0.8 },
    });
    const timeline = (await call(test, 'readTimeline', {
      includeMarkers: false,
    })) as {
      tracks: Array<{ kind: string; clips: Array<Record<string, unknown>> }>;
    };
    const effects = timeline.tracks.find((track) => track.kind === 'effects');
    const overlay = effects?.clips.find((clip) => clip.id === added.overlayId);

    expect(overlay).toMatchObject({
      type: 'fxOverlay',
      overlayKind: 'spotlight',
      linkedItemId: clipId,
      easing: 'ease-in-out',
      props: { kind: 'spotlight', dim: 0.8 },
    });
    expect(overlay?.region).toEqual({ x: 0.3, y: 0.25, w: 0.4, h: 0.5 });
  });
});
