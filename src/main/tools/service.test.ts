import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_TEXT_STYLE,
  clipSchema,
  createAsset,
  createCommandEnvelope,
  createProject,
  newId,
  referenceProfileSchema,
  type EditCommand,
  type ReferenceProfile,
} from '@kerf/model';
import type {
  EditResult,
  ExportRecord,
  ExportStartRequest,
  ProjectSnapshot,
  ProjectSummary,
  SearchResponse,
} from '../../shared/contracts';
import { ToolService } from './service';

function makeSnapshot(): ProjectSnapshot {
  const project = createProject({ name: 'Tools test', now: 1 });
  const summary: ProjectSummary = {
    id: project.id,
    name: project.name,
    folderPath: '/tmp/tools-test',
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

function withTextClip(snapshot: ProjectSnapshot): ProjectSnapshot {
  const track = snapshot.project.sequence.tracks.find(
    (candidate) => candidate.kind === 'video',
  );
  if (!track) {
    throw new Error('test snapshot needs a video track');
  }
  const clip = clipSchema.parse({
    id: newId('clip'),
    trackId: track.id,
    startFrame: 0,
    durationFrames: 48,
    label: 'Card',
    type: 'text',
    text: 'Hello',
    style: DEFAULT_TEXT_STYLE,
  });
  const sequence = {
    ...snapshot.project.sequence,
    tracks: snapshot.project.sequence.tracks.map((candidate) =>
      candidate.id === track.id ? { ...candidate, clips: [clip] } : candidate,
    ),
  };
  return { ...snapshot, project: { ...snapshot.project, sequence } };
}

function exportRecord(overrides: Partial<ExportRecord> = {}): ExportRecord {
  return {
    id: 'export_test',
    projectId: 'project_test',
    preset: 'sequence',
    outputPath: '/tmp/export.mp4',
    status: 'rendering',
    progress: 0,
    error: null,
    createdAt: 1,
    completedAt: null,
    ...overrides,
  };
}

function makeService(snapshot: ProjectSnapshot = withTextClip(makeSnapshot())) {
  const profiles: ReferenceProfile[] = [];
  const applied: {
    command: EditCommand;
    actor?: string;
    label?: string;
  }[] = [];
  const started: ExportStartRequest[] = [];
  const searchResponse: SearchResponse = {
    results: [
      {
        id: 'transcript_t',
        kind: 'transcript',
        assetId: 'asset_a',
        assetName: 'Interview',
        text: 'A line of speech',
        startFrame: 10,
        endFrame: 40,
        score: 0.9,
        thumbnailPath: null,
      },
    ],
    vectorSearch: false,
  };
  const renderExport = vi.fn(async () => undefined);

  const service = new ToolService({
    projects: {
      current: () => snapshot,
      apply(command: unknown, options) {
        applied.push({
          command: command as EditCommand,
          actor: options?.actor,
          label: options?.label,
        });
        const result: EditResult = {
          snapshot,
          command: createCommandEnvelope({
            command: command as EditCommand,
            actor: options?.actor,
            label: options?.label,
            now: 2,
          }),
          inverse: null,
        };
        return result;
      },
      refresh: () => snapshot,
    },
    repository: {
      listReferenceProfiles: () => profiles,
      saveReferenceProfile: (_projectId, profile) => {
        const index = profiles.findIndex((entry) => entry.id === profile.id);
        if (index >= 0) {
          profiles[index] = profile;
        } else {
          profiles.push(profile);
        }
        return profile;
      },
    },
    analysis: {
      query: () => searchResponse,
      detectBeats: async () => {
        throw new Error('not used');
      },
      profileReference: async (assetId, name) => {
        const existing = profiles.find(
          (profile) => profile.sourceAssetId === assetId,
        );
        const profile = referenceProfileSchema.parse({
          id: existing?.id ?? newId('reference'),
          name: name ?? existing?.name ?? 'Reference.mp4',
          sourceAssetId: assetId,
          palette: ['#202020', '#dcd4c0'],
          sceneCount: 6,
          averageShotLengthFrames: 24,
          cutsPerMinute: 50,
          meanLuma: 0.54,
          meanSaturation: 0.42,
          meanContrast: 0.31,
          analyzedAt: 100,
          createdAt: existing?.createdAt ?? 100,
        });
        const index = profiles.findIndex((entry) => entry.id === profile.id);
        if (index >= 0) {
          profiles[index] = profile;
        } else {
          profiles.push(profile);
        }
        return profile;
      },
    },
    exports: {
      list: () => [exportRecord()],
      get: (id) => (id === 'export_test' ? exportRecord() : null),
      start: (request) => {
        started.push(request);
        return {
          export: exportRecord(),
          width: 1920,
          height: 1080,
          frameRate: snapshot.project.sequence.frameRate,
          startFrame: request.startFrame,
          endFrame: request.endFrame,
          frameCount: request.endFrame - request.startFrame,
        };
      },
      cancel: () => true,
    },
    renderExport,
    now: () => 100,
  });
  return { service, applied, profiles, searchResponse, started, renderExport };
}

describe('ToolService', () => {
  it('reads the live project through the tool registry', async () => {
    const { service } = makeService();
    const result = (await service.call('readTimeline', {})) as {
      sequence: { durationFrames: number };
      tracks: unknown[];
    };
    expect(result.sequence.durationFrames).toBe(48);
    expect(result.tracks).toHaveLength(3);
  });

  it('routes agent edits through the current playhead and actor', async () => {
    const { service, applied } = makeService();
    service.setEditorContext({
      playheadFrame: 72,
      selectedClipIds: [],
      selectedAssetId: null,
    });
    const result = (await service.call('insertText', {
      text: 'Lower third',
    })) as { startFrame: number };
    expect(result.startFrame).toBe(72);
    expect(applied).toHaveLength(1);
    expect(applied[0]?.actor).toBe('agent');
    expect(applied[0]?.command).toMatchObject({
      type: 'clip.insert',
      clip: { type: 'text', startFrame: 72 },
    });
  });

  it('maps search results without leaking thumbnail data', async () => {
    const { service, searchResponse } = makeService();
    const result = (await service.call('findInTranscript', {
      query: 'hello',
    })) as { results: { id: string; assetName: string }[] };
    expect(result.results).toEqual([
      expect.objectContaining({
        id: searchResponse.results[0]?.id,
        assetName: 'Interview',
      }),
    ]);
    expect(result.results[0]).not.toHaveProperty('thumbnail');
  });

  it('creates and updates a reference profile for an imported asset', async () => {
    const base = makeSnapshot();
    const asset = createAsset({
      projectId: base.project.id,
      name: 'Reference.mp4',
      sourcePath: '/tmp/reference.mp4',
      kind: 'video',
      now: 1,
    });
    const snapshot = { ...base, assets: [asset] };
    const { service, profiles } = makeService(snapshot);
    const first = (await service.call('profileReference', {
      assetId: asset.id,
    })) as {
      profile: {
        id: string;
        name: string;
        sourceAssetId: string;
        analyzedAt: number | null;
        metrics: { sceneCount: number; meanLuma: number | null };
      };
    };
    expect(first.profile.sourceAssetId).toBe(asset.id);
    expect(first.profile.metrics.sceneCount).toBe(6);
    expect(first.profile.metrics.meanLuma).toBeCloseTo(0.54);
    expect(first.profile.analyzedAt).toBe(100);
    expect(profiles).toHaveLength(1);

    const second = (await service.call('profileReference', {
      assetId: asset.id,
      name: 'Editorial look',
    })) as typeof first;
    expect(second.profile.id).toBe(first.profile.id);
    expect(second.profile.name).toBe('Editorial look');
    expect(second.profile.analyzedAt).toBe(100);
    expect(profiles).toHaveLength(1);
  });

  it('starts an export and hands the render pass to the editor', async () => {
    const { service, started, renderExport } = makeService();
    const result = (await service.call('startExport', {
      presetId: 'sequence',
      startFrame: 0,
      endFrame: 48,
    })) as { frameCount: number };
    expect(result.frameCount).toBe(48);
    expect(started[0]).toMatchObject({
      presetId: 'sequence',
      startFrame: 0,
      endFrame: 48,
    });
    expect(renderExport).toHaveBeenCalledTimes(1);
  });
});

describe('committed edit receipts', () => {
  it('captures engine changes once per batch and preserves the inverse', async () => {
    const { applyCommand } = await import('@kerf/engine');
    let state = withTextClip(makeSnapshot());
    const before = state.project.sequence;
    let inverse: EditCommand | null = null;
    const service = new ToolService({
      projects: {
        current: () => state,
        refresh: () => state,
        apply(command, options) {
          const result = applyCommand(
            state.project.sequence,
            command as EditCommand,
          );
          inverse = result.inverse;
          state = {
            ...state,
            project: { ...state.project, sequence: result.sequence },
          };
          return {
            snapshot: state,
            inverse,
            command: createCommandEnvelope({
              command: command as EditCommand,
              ...options,
              now: 2,
            }),
          };
        },
      },
      repository: {
        listReferenceProfiles: () => [],
        saveReferenceProfile: (_id, profile) => profile,
      },
      exports: {
        list: () => [],
        get: () => null,
        cancel: () => false,
        start: () => {
          throw new Error('unused');
        },
      },
    });
    const committed = vi.fn();
    const clip = before.tracks.flatMap((t) => t.clips)[0]!;
    await service.call(
      'applyBatch',
      {
        label: 'Update caption',
        commands: [
          {
            type: 'clip.update',
            clipId: clip.id,
            patch: { text: 'Updated caption' },
          },
          {
            type: 'clip.update',
            clipId: clip.id,
            patch: { label: 'Updated title' },
          },
        ],
      },
      'agent',
      committed,
    );
    expect(committed).toHaveBeenCalledTimes(1);
    expect(committed.mock.calls[0]![0]).toMatchObject({
      projectId: state.project.id,
      undoable: true,
      changes: [
        expect.objectContaining({
          clipId: clip.id,
          kind: 'changed',
          visual: true,
        }),
      ],
    });
    expect(inverse).not.toBeNull();
    expect(applyCommand(state.project.sequence, inverse!).sequence).toEqual(
      before,
    );
    committed.mockClear();
    await expect(
      service.call(
        'editClip',
        { clipId: 'missing', patch: { text: 'No' } },
        'agent',
        committed,
      ),
    ).rejects.toThrow();
    expect(committed).not.toHaveBeenCalled();
  });
});

it.each(['insertText', 'applyBatch'])(
  'rechecks turn access immediately before %s commits',
  async (name) => {
    const state = withTextClip(makeSnapshot());
    const { service, applied } = makeService(state);
    const clip = state.project.sequence.tracks.flatMap((t) => t.clips)[0]!;
    let checks = 0;
    const input =
      name === 'insertText'
        ? { text: 'Title', durationFrames: 48 }
        : {
            commands: [
              {
                type: 'clip.update',
                clipId: clip.id,
                patch: { text: 'Changed' },
              },
              {
                type: 'clip.update',
                clipId: clip.id,
                patch: { label: 'Changed' },
              },
            ],
          };
    await expect(
      service.call(name, input, 'agent', undefined, {
        checkAccess: () => {
          if (++checks > 1) throw new Error('Project changed');
        },
      }),
    ).rejects.toThrow('Project changed');
    expect(checks).toBe(2);
    expect(applied).toEqual([]);
  },
);
