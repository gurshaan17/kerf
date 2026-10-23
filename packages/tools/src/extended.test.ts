import { describe, expect, it } from 'vitest';
import type {
  Asset,
  EditCommand,
  Project,
  ReferenceProfile,
} from '@kerf/model';
import {
  assetSchema,
  beatMapSchema,
  createAsset,
  createCommandEnvelope,
  createProject,
  newId,
  referenceProfileSchema,
} from '@kerf/model';
import { applyCommand, sequenceDurationFrames } from '@kerf/engine';
import type {
  ToolContext,
  ToolEditResult,
  ToolExportRecord,
  ToolSnapshot,
} from './types';
import { toolRegistry } from './index';

function videoAsset(project: Project): Asset {
  return assetSchema.parse({
    ...createAsset({
      projectId: project.id,
      name: 'Beat source.mp4',
      sourcePath: '/media/beat-source.mp4',
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

interface Harness {
  readonly context: ToolContext;
  snapshot(): ToolSnapshot;
  commands(): readonly EditCommand[];
  inverse(): EditCommand | null;
  setReference(profile: ReferenceProfile): void;
}

function harness(): Harness {
  const project = createProject({ name: 'Extended tools', now: 1_000 });
  const video = videoAsset(project);
  let snapshot: ToolSnapshot = {
    project,
    assets: [video],
    transcripts: [],
    scenes: [],
    beatMaps: [],
    referenceProfiles: [],
    compositions: [],
  };
  let applied: EditCommand[] = [];
  let lastInverse: EditCommand | null = null;
  let reference: ReferenceProfile | null = null;
  let exportRecord: ToolExportRecord | null = null;
  const sourceDuration = () => 240;

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
    lastInverse = result.inverse;
    return {
      snapshot,
      command: createCommandEnvelope({
        command,
        actor: options?.actor ?? 'agent',
        now: 2_000,
      }),
      inverse: lastInverse,
    };
  };

  const context: ToolContext = {
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
    detectBeats: async (assetId) => {
      const map = beatMapSchema.parse({
        id: newId('beatmap'),
        assetId,
        bpm: 120,
        offsetFrames: 0,
        beats: [24, 48, 72, 96, 120, 144, 168, 192, 216].map((frame) => ({
          id: newId('beat'),
          frame,
          strength: 0.8,
        })),
        sections: [],
        createdAt: 2_000,
      });
      snapshot = { ...snapshot, beatMaps: [map] };
      return map;
    },
    profileReference: async (request) => {
      reference = referenceProfileSchema.parse({
        id: newId('reference'),
        name: request.name ?? 'Reference',
        sourceAssetId: request.assetId,
        palette: ['#c9a46a', '#ece6dc'],
        mood: ['measured'],
        sceneCount: 8,
        averageShotLengthFrames: 30,
        cutsPerMinute: 48,
        meanLuma: 0.6,
        meanSaturation: 0.5,
        meanContrast: 0.55,
        analyzedAt: 2_000,
        createdAt: 2_000,
      });
      snapshot = {
        ...snapshot,
        referenceProfiles: [reference],
      };
      return reference;
    },
    exports: () => ({
      list: () => (exportRecord ? [exportRecord] : []),
      get: (id) => (exportRecord?.id === id ? exportRecord : null),
      presets: () => [
        {
          id: 'sequence',
          name: 'Match sequence',
          description: 'Use the sequence frame size.',
          width: null,
          height: null,
        },
      ],
      start: async (request) => {
        exportRecord = {
          id: 'exp_test',
          preset: request.presetId,
          outputPath: '/tmp/export.mp4',
          status: 'rendering',
          progress: 0,
          error: null,
          createdAt: 2_000,
          completedAt: null,
        };
        return {
          export: exportRecord,
          width: 1920,
          height: 1080,
          frameRate: { numerator: 24, denominator: 1 },
          startFrame: request.startFrame,
          endFrame: request.endFrame,
          frameCount: request.endFrame - request.startFrame,
        };
      },
      reveal: async () => undefined,
    }),
    now: () => 2_000,
  };

  return {
    context,
    snapshot: () => snapshot,
    commands: () => applied,
    inverse: () => lastInverse,
    setReference: (profile) => {
      reference = profile;
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

describe('beat tools', () => {
  it('detects beats and cuts clips exactly on the beat grid', async () => {
    const test = harness();
    const video = test.snapshot().assets[0]!;
    await call(test, 'insertClip', { assetId: video.id });
    const detected = await call(test, 'detectBeats', { assetId: video.id });
    expect(detected.beatMap).toMatchObject({ bpm: 120, beatCount: 9 });

    const result = await call(test, 'cutToBeat', {
      assetId: video.id,
      density: 'dense',
    });
    expect(result.cutCount).toBe(9);
    expect(result.segmentCount).toBe(10);
    const clips = test.snapshot().project.sequence.tracks[0]?.clips ?? [];
    expect(clips).toHaveLength(10);
    expect(clips.every((clip) => clip.startFrame % 24 === 0)).toBe(true);
    expect(sequenceDurationFrames(test.snapshot().project.sequence)).toBe(240);
  });
});

describe('reference tools', () => {
  it('sets, reads and applies a measured reference profile', async () => {
    const test = harness();
    const video = test.snapshot().assets[0]!;
    await call(test, 'insertClip', { assetId: video.id });

    const used = await call(test, 'useReference', {
      assetId: video.id,
      name: 'Editorial reference',
    });
    expect(used.profile).toMatchObject({
      name: 'Editorial reference',
      metrics: { averageShotLengthFrames: 30, cutsPerMinute: 48 },
    });
    expect(test.snapshot().project.sequence.reference?.name).toBe(
      'Editorial reference',
    );
    expect(test.commands().at(-1)?.type).toBe('sequence.setReference');
    expect(test.snapshot().project.sequence.tracks[0]?.clips).toHaveLength(1);

    const read = await call(test, 'readReference', {});
    expect(read.profile).toMatchObject({
      name: 'Editorial reference',
      metrics: { meanLuma: 0.6 },
    });

    const copied = await call(test, 'copyReferenceLook', { strength: 1 });
    expect(copied).toMatchObject({
      appliedClipCount: 1,
      effectsAdded: 3,
      pacing: {
        averageShotLengthFrames: 30,
        cutsPerMinute: 48,
        targetShotLengthFrames: 30,
        suggestedCutFrames: [30, 60, 90, 120, 150, 180, 210],
      },
    });
    const clip = test.snapshot().project.sequence.tracks[0]?.clips[0];
    expect(clip?.effects).toHaveLength(3);
    expect(clip?.effects.map((effect) => effect.type)).toEqual([
      'brightness',
      'contrast',
      'saturate',
    ]);
    expect(clip?.effects[0]?.amount).toBeCloseTo(1.11, 2);
    expect(clip?.effects[1]?.amount).toBeCloseTo(1.12, 2);
    expect(clip?.effects[2]?.amount).toBeCloseTo(1.1, 2);

    const inverse = test.inverse();
    if (!inverse) {
      throw new Error('expected an inverse for the grade');
    }
    const restored = applyCommand(test.snapshot().project.sequence, inverse);
    expect(restored.sequence.tracks[0]?.clips[0]?.effects).toHaveLength(0);
  });
});

describe('export tools', () => {
  it('lists presets and starts an export for the sequence', async () => {
    const test = harness();
    const video = test.snapshot().assets[0]!;
    await call(test, 'insertClip', { assetId: video.id });

    const presets = await call(test, 'exportPresets', {});
    expect(presets.presets).toHaveLength(1);

    const started = (await call(test, 'startExport', {
      presetId: 'sequence',
    })) as { export: { id: string }; frameCount: number };
    expect(started.export.id).toBe('exp_test');
    expect(started.frameCount).toBe(240);

    const read = await call(test, 'readExport', {
      exportId: started.export.id,
    });
    expect(read.export).toMatchObject({ status: 'rendering', progress: 0 });

    const listed = (await call(test, 'readExport', {})) as {
      exports: unknown[];
    };
    expect(listed.exports).toHaveLength(1);
  });
});
