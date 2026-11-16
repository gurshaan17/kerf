import { expect, it } from 'vitest';
import {
  assetSchema,
  clipSchema,
  createProject,
  createTrack,
  newId,
} from '@kerf/model';
import type { EditReceipt } from '@kerf/tools';
import type { ProjectSnapshot } from '../../shared/contracts';
import {
  beginTask,
  captureReceipt,
  captureTool,
  contextPrompt,
  loadContext,
  reconcileContext,
} from './task-context';
import { referenceFingerprint } from '../projects/reference-fingerprint';

function fixture() {
  const project = createProject({ name: 'Memory' });
  const track = createTrack({ kind: 'video' });
  const asset = assetSchema.parse({
    id: newId('asset'),
    projectId: project.id,
    name: 'Source',
    kind: 'video',
    sourcePath: '/source.mp4',
    status: 'ready',
    importedAt: 1,
    updatedAt: 1,
  });
  const clip = clipSchema.parse({
    id: newId('clip'),
    trackId: track.id,
    type: 'video',
    assetId: asset.id,
    startFrame: 0,
    durationFrames: 100,
  });
  project.sequence.tracks = [{ ...track, clips: [clip] }];
  const snapshot = { project, assets: [asset] } as ProjectSnapshot;
  const context = loadContext(undefined, project.id, 'chat');
  const task = beginTask(
    context,
    'turn',
    'Shorten the selected cut, preserving speech.',
    [],
    snapshot,
  );
  const receipt: EditReceipt = {
    projectId: project.id,
    commandId: 'command',
    frameRate: project.sequence.frameRate,
    undoable: true,
    label: 'Cut',
    beforeDurationFrames: 0,
    afterDurationFrames: 100,
    changes: [
      {
        clipId: clip.id,
        label: 'Output',
        kind: 'added',
        startFrame: 0,
        endFrame: 100,
        visual: true,
        fingerprint: referenceFingerprint(snapshot, 'clip', clip.id),
      },
    ],
  };
  return { snapshot, context, task, receipt, clip, asset };
}

it('loads old/unsupported memory as empty and rejects cross-conversation/project records', () => {
  const { context } = fixture();
  expect(loadContext(undefined, 'project', 'chat').tasks).toEqual([]);
  expect(
    loadContext({ ...context, version: 2 }, context.projectId, 'chat').tasks,
  ).toEqual([]);
  expect(loadContext(context, 'other', 'chat').tasks).toEqual([]);
  expect(loadContext(context, context.projectId, 'other').tasks).toEqual([]);
  expect(
    loadContext(JSON.parse(JSON.stringify(context)), context.projectId, 'chat'),
  ).toEqual(context);
});

it.each(['delete', 'edit', 'replace source', 'missing source'])(
  'marks committed outputs stale after %s',
  (action) => {
    const { snapshot, context, task, receipt, asset } = fixture();
    captureReceipt(task, receipt, snapshot);
    reconcileContext(context, snapshot);
    expect(task.references[0]?.stale).toBe(false);
    if (action === 'delete') snapshot.project.sequence.tracks[0]!.clips = [];
    if (action === 'edit')
      snapshot.project.sequence.tracks[0]!.clips[0]!.durationFrames--;
    if (action === 'replace source') asset.mtimeMs++;
    if (action === 'missing source') asset.status = 'missing';
    reconcileContext(context, snapshot);
    expect(task.state).toBe('applied');
    expect(task.references[0]?.stale).toBe(true);
  },
);

it('uses receipt-time identity when desktop edits changed before reconciliation', () => {
  const { snapshot, context, task, receipt, clip } = fixture();
  task.jobIds.push('job');
  clip.durationFrames--;
  reconcileContext(context, snapshot, [
    {
      job: {
        id: 'job',
        projectId: snapshot.project.id,
        kind: 'analysis.roughCut',
        status: 'succeeded',
        stage: '',
        progress: 1,
        error: null,
        reviewStatus: 'applied',
      },
      proposal: null,
      selectedIds: [],
      receipt,
    },
  ]);
  expect(task.commandIds).toEqual(['command']);
  expect(task.references[0]?.stale).toBe(true);
  expect(task.verification).toBe('unverified');
});

it('does not turn read results or assistant-shaped raw data into applied edits', () => {
  const { snapshot, task, clip } = fixture();
  captureTool(
    task,
    'readTimeline',
    { clipId: clip.id },
    {
      commandId: 'fake',
      transcript: 'secret',
      image: 'bytes',
      status: 'applied',
    },
    snapshot,
  );
  expect(task.state).toBe('requested');
  expect(task.commandIds).toEqual([]);
  expect(JSON.stringify(task)).not.toContain('secret');
  expect(JSON.stringify(task)).not.toContain('bytes');
});

it('bounds complete records and UTF-8 injection while retaining latest output and marking omissions', () => {
  const { snapshot, context, task, receipt } = fixture();
  captureReceipt(task, receipt, snapshot);
  for (let i = 0; i < 30; i++) {
    const next = beginTask(
      context,
      `turn-${i}`,
      '語'.repeat(2000),
      [],
      snapshot,
    );
    next.state = 'pending';
    captureTool(
      next,
      'readTimeline',
      { clipIds: Array.from({ length: 50 }, (_, n) => `clip-${n}`) },
      {},
      snapshot,
    );
  }
  expect(context.tasks).toHaveLength(10);
  expect(context.tasks).toContain(task);
  expect(context.tasks.every((t) => t.references.length <= 20)).toBe(true);
  const prompt = contextPrompt(context);
  expect(Buffer.byteLength(prompt)).toBeLessThanOrEqual(8192);
  const parsed = JSON.parse(prompt);
  expect(parsed.omittedTasks).toBeGreaterThan(0);
  expect(
    parsed.tasks.some((t: { commandIds: string[] }) =>
      t.commandIds.includes('command'),
    ),
  ).toBe(true);
});
