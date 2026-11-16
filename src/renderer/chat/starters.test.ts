import { expect, it } from 'vitest';
import { assetSchema, clipSchema, createProject, newId } from '@kerf/model';
import type { ProjectSnapshot, ProviderAccount } from '../../shared/contracts';
import { chatStarters } from './starters';
import { composerScope, scopeError } from './scope';
function fixture() {
  const project = createProject({ name: 'Starters', now: 1 });
  const asset = assetSchema.parse({
    id: newId('asset'),
    projectId: project.id,
    name: 'Footage',
    kind: 'video',
    status: 'ready',
    sourcePath: '/source.mp4',
    hasVideo: true,
    importedAt: 1,
    updatedAt: 1,
    durationSeconds: 10,
  });
  const track = project.sequence.tracks[0]!;
  const clip = clipSchema.parse({
    id: newId('clip'),
    trackId: track.id,
    type: 'video',
    assetId: asset.id,
    startFrame: 0,
    durationFrames: 100,
  });
  track.clips = [clip];
  const snapshot: ProjectSnapshot = {
    project,
    assets: [asset],
    jobs: [],
    transcripts: [],
    scenes: [],
    beatMaps: [],
    compositions: [],
    summary: {
      id: project.id,
      name: project.name,
      folderPath: '/test',
      width: project.sequence.width,
      height: project.sequence.height,
      frameRate: project.sequence.frameRate,
      durationFrames: 100,
      assetCount: 1,
      createdAt: 1,
      updatedAt: 1,
    },
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
  const provider: ProviderAccount = {
    id: 'provider',
    kind: 'ollama',
    label: 'Local',
    baseUrl: null,
    model: 'model',
    chatModel: 'model',
    hasKey: false,
    enabled: true,
    visionConsent: true,
    chatConsent: true,
  };
  return { snapshot, clip, asset, provider };
}
it('offers analysis only for supported selected footage and consent', () => {
  const { snapshot, clip, asset, provider } = fixture();
  const kinds = (account = provider) =>
    chatStarters(snapshot, [clip.id], account, []).map((s) => s.kind);
  expect(kinds()).toContain('analyze');
  expect(kinds({ ...provider, visionConsent: false })).not.toContain('analyze');
  asset.hasAudio = true;
  expect(kinds()).not.toContain('analyze');
  asset.hasAudio = false;
  if (clip.type !== 'video') throw new Error('Expected video');
  clip.speed = 2;
  expect(kinds()).not.toContain('analyze');
  expect(kinds({ ...provider, chatConsent: false })).toEqual([]);
});
it('offers local import in an empty project without a provider', () => {
  const { snapshot } = fixture();
  snapshot.assets.splice(0);
  snapshot.project.sequence.tracks.forEach((t) => {
    t.clips = [];
  });
  expect(chatStarters(snapshot, [], null, []).map((s) => s.kind)).toEqual([
    'import',
  ]);
});
it('captures stable scope IDs and marks explicitly frozen scope stale', () => {
  const { snapshot, clip } = fixture();
  const scoped = composerScope(snapshot, [clip.id], undefined, []);
  expect(scoped).toMatchObject({ kind: 'targets', clipIds: [clip.id] });
  expect(composerScope(snapshot, [], scoped, [])).toEqual(scoped);
  snapshot.project.updatedAt++;
  expect(scopeError(scoped, snapshot)).toContain('selection changed');
  expect(composerScope(snapshot, [clip.id], { kind: 'project' }, [])).toEqual({
    kind: 'project',
  });
});
