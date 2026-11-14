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
    status: 'succeeded' as const,
    stage: 'Done',
    progress: 1,
    error: null,
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
