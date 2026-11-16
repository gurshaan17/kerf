import { expect, it } from 'vitest';
import { applyCommand } from '@kerf/engine';
import { clipSchema, createProject, newId } from '@kerf/model';
import type { EditReceipt } from '@kerf/tools';
import { createEditScope, validateChatScope } from './edit-scope';

function fixture() {
  const project = createProject({ name: 'Scope', now: 1 });
  const track = project.sequence.tracks[0]!;
  const a = clipSchema.parse({
    id: newId('clip'),
    trackId: track.id,
    type: 'text',
    text: 'A',
    startFrame: 0,
    durationFrames: 48,
  });
  const b = clipSchema.parse({
    ...a,
    id: newId('clip'),
    text: 'B',
    startFrame: 60,
  });
  track.clips = [a, b];
  const snapshot = { project, assets: [] };
  const scope = {
    kind: 'targets' as const,
    clipIds: [a.id],
    assetIds: [],
    revision: project.updatedAt,
  };
  return { snapshot, scope, a, b };
}
it('rejects missing, empty and stale scope before provider work', () => {
  const { snapshot, scope } = fixture();
  expect(() => validateChatScope(scope, snapshot)).not.toThrow();
  expect(() => validateChatScope({ ...scope, clipIds: [] }, snapshot)).toThrow(
    'Choose project scope',
  );
  expect(() =>
    validateChatScope({ ...scope, clipIds: [newId('clip')] }, snapshot),
  ).toThrow('missing');
  expect(() =>
    validateChatScope({ ...scope, revision: scope.revision + 1 }, snapshot),
  ).toThrow('selection changed');
});
it('allows scoped edits but rejects indirect changes, track mutations and global edits without mutation', () => {
  const { snapshot, scope, a, b } = fixture();
  const guard = createEditScope(scope, snapshot, () => snapshot);
  const before = JSON.stringify(snapshot);
  expect(() =>
    guard.checkCommand({
      type: 'clip.update',
      clipId: a.id,
      patch: { text: 'Updated' },
    }),
  ).not.toThrow();
  expect(() =>
    guard.checkCommand({
      type: 'batch',
      commands: [
        { type: 'clip.update', clipId: a.id, patch: { text: 'Updated' } },
        { type: 'clip.move', clipId: b.id, startFrame: 120 },
      ],
    }),
  ).toThrow('outside the submitted scope');
  expect(() =>
    guard.checkCommand({ type: 'sequence.rename', name: 'Other' }),
  ).toThrow('outside the submitted scope');
  expect(() =>
    guard.checkCommand({
      type: 'track.update',
      trackId: a.trackId,
      patch: { hidden: true },
    }),
  ).toThrow('outside the submitted scope');
  expect(JSON.stringify(snapshot)).toBe(before);
});
it('tracks its own commits and detects external changes to scoped objects', () => {
  const { snapshot, scope, a } = fixture();
  const guard = createEditScope(scope, snapshot, () => snapshot);
  const command = {
    type: 'clip.update' as const,
    clipId: a.id,
    patch: { text: 'Updated' },
  };
  guard.checkCommand(command);
  snapshot.project.sequence = applyCommand(
    snapshot.project.sequence,
    command,
  ).sequence;
  const receipt: EditReceipt = {
    commandId: 'command',
    projectId: snapshot.project.id,
    label: 'Edit',
    frameRate: snapshot.project.sequence.frameRate,
    undoable: true,
    beforeDurationFrames: 108,
    afterDurationFrames: 108,
    changes: [
      {
        clipId: a.id,
        label: 'A',
        kind: 'changed',
        startFrame: 0,
        endFrame: 48,
        visual: true,
      },
    ],
  };
  expect(() => guard.checkCommand(command)).toThrow('changed during this turn');
  guard.committed(receipt);
  expect(() => guard.checkCommand(command)).not.toThrow();
});
it('keeps project scope compatible with ordinary global edits', () => {
  const { snapshot } = fixture();
  expect(() =>
    createEditScope({ kind: 'project' }, snapshot, () => snapshot).checkCommand(
      { type: 'sequence.rename', name: 'Other' },
    ),
  ).not.toThrow();
});
