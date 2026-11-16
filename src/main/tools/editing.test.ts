import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProject, newId } from '@kerf/model';
import { toolRegistry } from '@kerf/tools';
import type { ToolContext } from '@kerf/tools';
import { openDatabase } from '../db';
import { EditingService } from './editing';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((fn) => fn()));
function fixture(kind: 'autoCut' | 'screenPolish' = 'autoCut') {
  const database = openDatabase({ filename: ':memory:' });
  cleanups.push(() => database.close());
  const project = createProject({ name: 'Review', now: 1 });
  const job = {
    id: newId('job'),
    projectId: project.id,
    kind: `analysis.${kind}`,
    status: 'succeeded' as import('../../shared/contracts').JobStatus,
    stage: 'Done',
    progress: 1,
    error: null as string | null,
    targetId: null,
    createdAt: 1,
    updatedAt: 1,
    startedAt: 1,
    finishedAt: 1,
  };
  const proposal = {
    projectId: project.id,
    clipId: newId('clip'),
    assetId: newId('asset'),
    fingerprint: 'original',
    providerId: 'provider',
    providerRevision: 'revision',
    purpose: '',
    startFrame: 0,
    endFrame: 100,
    frameRate: project.sequence.frameRate,
    removals: [
      {
        id: 'change-1',
        startFrame: 10,
        endFrame: 20,
        reason: 'Repeated section',
      },
    ],
    sampleCount: 2,
  };
  const suggestion = {
    id: 'change-1',
    clipId: proposal.clipId,
    startFrame: 10,
    durationFrames: 10,
    x: 0.5,
    y: 0.5,
    kind: 'zoom' as const,
    text: '',
    reason: 'Click',
    evidenceFrames: [10],
  };
  const command = {
    type: 'batch' as const,
    commands: [],
    label: 'Reviewed edit',
  };
  const prepare = vi.fn(() => command);
  const options = {
    projects: { current: () => ({ project }) },
    jobs: { get: () => job, list: () => [job], cancel: vi.fn(() => true) },
    autoCut: { generate: vi.fn(() => job), proposal: () => proposal, prepare },
    screenPolish: {
      generate: vi.fn(() => job),
      proposal: () => ({ ...proposal, suggestions: [suggestion] }),
      prepare,
    },
    providers: {
      list: () => [
        {
          id: 'provider',
          label: 'Provider',
          enabled: true,
          visionConsent: true,
          chatConsent: true,
        },
      ],
    },
    database: database.connection,
  };
  const service = new EditingService(options);
  return { service, options, job, proposal, prepare, command };
}

describe('editing review lifecycle', () => {
  it.each(['autoCut', 'screenPolish'] as const)(
    'requests review without edits, then applies stored %s changes once across restart',
    (kind) => {
      const f = fixture(kind);
      const apply = vi.fn(() => ({ command: {}, inverse: {} }));
      const context = { apply } as unknown as ToolContext;
      expect(f.service.proposal(f.job.id)?.changes[0]?.reason).toBe(
        kind === 'autoCut' ? 'Repeated section' : 'Click',
      );
      expect(f.service.requestApply(f.job.id, ['change-1']).status).toBe(
        'awaiting-review',
      );
      expect(apply).not.toHaveBeenCalled();
      f.service.confirm(f.job.id, ['change-1'], context);
      expect(apply).toHaveBeenCalledOnce();
      expect(apply).toHaveBeenCalledWith(f.command, {
        label: 'Apply reviewed AI edits',
      });
      const reopened = new EditingService(f.options);
      expect(reopened.read(f.job.id).reviewStatus).toBe('applied');
      expect(() => reopened.confirm(f.job.id, ['change-1'], context)).toThrow(
        'already',
      );
      if (kind === 'screenPolish')
        expect(f.prepare).toHaveBeenCalledWith(
          expect.objectContaining({
            suggestions: [expect.objectContaining({ reason: 'Click', x: 0.5 })],
          }),
        );
    },
  );
  it('rejects cross-project, forged, duplicate and cancelled jobs', () => {
    const f = fixture();
    expect(() => f.service.requestApply(f.job.id, ['forged'])).toThrow(
      'unique',
    );
    expect(() =>
      f.service.requestApply(f.job.id, ['change-1', 'change-1']),
    ).toThrow('unique');
    f.job.projectId = newId('project');
    expect(() => f.service.read(f.job.id)).toThrow('open project');
    f.job.projectId = f.proposal.projectId;
    f.service.cancel(f.job.id);
    expect(f.service.cancel(f.job.id).reviewStatus).toBe('cancelled');
    expect(() => f.service.requestApply(f.job.id, ['change-1'])).toThrow(
      'cancelled',
    );
  });
  it('cannot review or apply an unfinished job', () => {
    const f = fixture();
    const service = new EditingService({
      ...f.options,
      jobs: { ...f.options.jobs, get: () => ({ ...f.job, status: 'running' }) },
    });
    expect(service.proposal(f.job.id)).toBeNull();
    expect(() => service.requestApply(f.job.id, ['change-1'])).toThrow(
      'succeed',
    );
  });
  it('revalidates before commit and rolls back approval on failed apply', () => {
    const f = fixture();
    f.service.requestApply(f.job.id, ['change-1']);
    f.prepare.mockImplementation(() => {
      throw new Error('Source or consent changed');
    });
    const apply = vi.fn();
    expect(() =>
      f.service.confirm(f.job.id, ['change-1'], {
        apply,
      } as unknown as ToolContext),
    ).toThrow('changed');
    expect(apply).not.toHaveBeenCalled();
    expect(f.service.read(f.job.id).reviewStatus).toBe('awaiting-review');
  });
  it('dispatches the six shared tools without exposing desktop confirmation', async () => {
    const f = fixture();
    const context = { editing: () => f.service } as unknown as ToolContext;
    const input = { clipId: f.proposal.clipId, providerId: 'provider' };
    await toolRegistry.call('planAutoCut', input, context);
    expect(f.options.autoCut.generate).toHaveBeenCalledWith({
      ...input,
      purpose: '',
    });
    await toolRegistry.call('planScreenPolish', input, context);
    expect(f.options.screenPolish.generate).toHaveBeenCalledWith(input);
    expect(
      await toolRegistry.call('readEditingJob', { jobId: f.job.id }, context),
    ).toMatchObject({ status: 'succeeded' });
    expect(
      await toolRegistry.call('readEditProposal', { jobId: f.job.id }, context),
    ).toMatchObject({ fingerprint: 'original' });
    expect(
      await toolRegistry.call(
        'applyEditProposal',
        { jobId: f.job.id, changeIds: ['change-1'] },
        context,
      ),
    ).toMatchObject({ status: 'awaiting-review' });
    expect(toolRegistry.names()).not.toContain('confirmEditing');
    await toolRegistry.call('cancelEditingJob', { jobId: f.job.id }, context);
    expect(f.service.read(f.job.id).reviewStatus).toBe('cancelled');
  });
  it('keeps provider use and review requests non-read-only in the shared registry', async () => {
    for (const name of [
      'planAutoCut',
      'planScreenPolish',
      'cancelEditingJob',
      'applyEditProposal',
    ])
      expect(toolRegistry.require(name).readOnly).toBe(false);
    for (const name of ['readEditingJob', 'readEditProposal'])
      expect(toolRegistry.require(name).readOnly).toBe(true);
    await expect(
      toolRegistry.call(
        'planAutoCut',
        { clipId: newId('clip'), providerId: 'provider' },
        {} as ToolContext,
      ),
    ).rejects.toThrow('unavailable');
  });
});

function origin(f: ReturnType<typeof fixture>) {
  return {
    projectId: f.job.projectId,
    conversationId: 'chat-origin',
    taskId: 'turn-origin',
    turnId: 'turn-origin',
    toolName: 'planAutoCut',
    input: { clipId: f.proposal.clipId, providerId: 'provider', purpose: '' },
  };
}

it('persists job ownership independently of chat task retention and rejects other chats/projects', () => {
  const f = fixture();
  f.service.associate(f.job.id, origin(f));
  const restarted = new EditingService(f.options);
  expect(restarted.reviews()[0]?.origin).toEqual(origin(f));
  expect(() =>
    restarted.continuation(
      f.job.id,
      'other-project',
      'chat-origin',
      'continue',
      'click',
    ),
  ).toThrow('another project or conversation');
  expect(() =>
    restarted.continuation(
      f.job.id,
      f.job.projectId,
      'other-chat',
      'continue',
      'click',
    ),
  ).toThrow('another project or conversation');
  expect(() =>
    restarted.associate(f.job.id, {
      ...origin(f),
      conversationId: 'other-chat',
    }),
  ).toThrow('another chat turn');
  expect(
    restarted.continuation(
      f.job.id,
      f.job.projectId,
      'chat-origin',
      'continue',
      'click',
    ),
  ).toEqual(origin(f));
});

it('deduplicates continuation requests durably but allows an explicit retry after a failed turn', () => {
  const f = fixture();
  f.service.associate(f.job.id, origin(f));
  f.service.claimContinuation(f.job.id, 'continued', 'continue', 'click-1');
  expect(() =>
    f.service.continuation(
      f.job.id,
      f.job.projectId,
      'chat-origin',
      'continue',
      'click-2',
    ),
  ).toThrow('already continued');
  f.service.releaseContinuation(f.job.id, 'continued', 'continue');
  const restarted = new EditingService(f.options);
  expect(() =>
    restarted.continuation(
      f.job.id,
      f.job.projectId,
      'chat-origin',
      'continue',
      'click-1',
    ),
  ).toThrow('already handled');
  expect(
    restarted.continuation(
      f.job.id,
      f.job.projectId,
      'chat-origin',
      'continue',
      'click-2',
    ),
  ).toBeDefined();
});

it.each(['source changed', 'consent revoked'])(
  'blocks continuation when %s and exposes an explicit reanalysis path',
  (reason) => {
    const f = fixture();
    f.service.associate(f.job.id, origin(f));
    f.prepare.mockImplementation(() => {
      throw new Error(reason);
    });
    expect(f.service.reviews()[0]?.eligibility).toEqual({
      eligible: false,
      reason,
    });
    expect(() =>
      f.service.continuation(
        f.job.id,
        f.job.projectId,
        'chat-origin',
        'continue',
        'click',
      ),
    ).toThrow(reason);
    expect(
      f.service.continuation(
        f.job.id,
        f.job.projectId,
        'chat-origin',
        'reanalyze',
        'retry',
      ),
    ).toBeDefined();
    expect(f.options.autoCut.generate).not.toHaveBeenCalled();
  },
);

it('reports interrupted and cancelled jobs without retrying them', () => {
  const f = fixture();
  f.service.associate(f.job.id, origin(f));
  f.job.status = 'failed';
  f.job.error = 'Auto cut was interrupted. Analyse again explicitly.';
  expect(f.service.reviews()[0]?.job).toMatchObject({
    status: 'failed',
    error: f.job.error,
  });
  expect(() =>
    f.service.continuation(
      f.job.id,
      f.job.projectId,
      'chat-origin',
      'continue',
      'click',
    ),
  ).toThrow('interrupted');
  expect(
    f.service.continuation(
      f.job.id,
      f.job.projectId,
      'chat-origin',
      'reanalyze',
      'retry',
    ),
  ).toBeDefined();
  f.service.cancel(f.job.id);
  expect(f.service.reviews()[0]?.job.reviewStatus).toBe('cancelled');
  expect(f.options.autoCut.generate).not.toHaveBeenCalled();
});

it('filters ownership before limiting results so other chats cannot hide a result', () => {
  const f = fixture();
  const unowned = { ...f.job, id: newId('job') };
  const other = Array.from({ length: 45 }, () => ({
    ...f.job,
    id: newId('job'),
  }));
  const jobs = [unowned, ...other, f.job];
  const service = new EditingService({
    ...f.options,
    jobs: {
      ...f.options.jobs,
      get: (id) => jobs.find((j) => j.id === id) ?? null,
      list: () => jobs,
    },
  });
  service.associate(f.job.id, origin(f));
  for (const job of other)
    service.associate(job.id, { ...origin(f), conversationId: 'other-chat' });
  expect(service.reviews().some((r) => r.job.id === f.job.id)).toBe(false);
  expect(service.reviews('chat-origin').map((r) => r.job.id)).toEqual([
    f.job.id,
    unowned.id,
  ]);
  expect(service.reviews(null).map((r) => r.job.id)).toEqual([unowned.id]);
});

it('checks the submitted scope before creating a desktop review request', () => {
  const f = fixture();
  expect(() =>
    f.service.requestApply(f.job.id, ['change-1'], () => {
      throw new Error('Outside scope');
    }),
  ).toThrow('Outside scope');
  expect(f.service.read(f.job.id).reviewStatus).toBe('none');
});
