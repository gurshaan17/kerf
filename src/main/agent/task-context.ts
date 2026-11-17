import type { ChatScope } from '../../shared/chat-scope';
import { referenceFingerprint as fingerprint } from '../projects/reference-fingerprint';
import type { EditReceipt, EditingReview } from '@kerf/tools';
import type { ChatAssetMention, ProjectSnapshot } from '../../shared/contracts';
import { editingContextSchema } from '../../shared/editing-context';
import type { EditingContext, EditingTask } from '../../shared/editing-context';

export function loadContext(
  value: unknown,
  projectId: string,
  conversationId: string,
): EditingContext {
  const parsed = editingContextSchema.safeParse(value);
  return parsed.success &&
    parsed.data.projectId === projectId &&
    parsed.data.conversationId === conversationId
    ? parsed.data
    : { version: 1, projectId, conversationId, tasks: [], omittedTasks: 0 };
}

export function beginTask(
  context: EditingContext,
  turnId: string,
  request: string,
  mentions: readonly ChatAssetMention[],
  snapshot: ProjectSnapshot,
  scope?: ChatScope,
): EditingTask {
  const task: EditingTask = {
    turnId,
    request: request.slice(0, 1200),
    requestTruncated: request.length > 1200,
    state: 'requested',
    turnState: 'streaming',
    references: [],
    omittedReferences: 0,
    omittedDetails: false,
    highlightJobIds: [],
    highlightOutputs: [],
    audioPlanIds: [],
    audioMeasurementIds: [],
    commandIds: [],
    jobIds: [],
    proposalJobIds: [],
    verification: 'unverified',
    unresolvedConstraints: [],
  };
  if (scope?.kind === 'targets') {
    for (const id of scope.clipIds)
      addReference(task, snapshot, 'clip', id, 'scope');
    for (const id of scope.assetIds)
      addReference(task, snapshot, 'asset', id, 'scope');
  }
  context.tasks.push(task);
  for (const mention of mentions)
    addReference(task, snapshot, 'asset', mention.assetId, 'scope');
  // Retain pending work before older completed tasks, while always retaining this turn.
  const latestOutput = [...context.tasks]
    .reverse()
    .find((t) => t.commandIds.length);
  while (context.tasks.length > 10) {
    const index = context.tasks.findIndex(
      (t) => t !== task && t !== latestOutput && t.state !== 'pending',
    );
    context.tasks.splice(
      index < 0
        ? context.tasks.findIndex((t) => t !== task && t !== latestOutput)
        : index,
      1,
    );
    context.omittedTasks++;
  }
  return task;
}

function addReference(
  task: EditingTask,
  snapshot: ProjectSnapshot,
  kind: 'clip' | 'asset',
  id: string,
  role: EditingTask['references'][number]['role'],
) {
  const reference = {
    kind,
    id,
    role,
    fingerprint: fingerprint(snapshot, kind, id),
    stale: false,
  };
  const existing = task.references.findIndex(
    (r) => r.kind === kind && r.id === id,
  );
  if (existing >= 0) {
    if (role === 'output' || role === 'removed')
      task.references[existing] = reference;
    return;
  }
  if (task.references.length === 20) {
    if (role !== 'output' && role !== 'removed') {
      task.omittedReferences++;
      return;
    }
    task.references.shift();
    task.omittedReferences++;
  }
  task.references.push(reference);
}

export function captureReceipt(
  task: EditingTask,
  receipt: EditReceipt,
  snapshot: ProjectSnapshot,
  retained = false,
) {
  if (
    receipt.projectId !== snapshot.project.id ||
    task.commandIds.includes(receipt.commandId)
  )
    return;
  task.omittedDetails ||= task.commandIds.length >= 20;
  task.commandIds = [...task.commandIds, receipt.commandId].slice(-20);
  task.state = 'applied';
  task.verification = 'unverified';
  for (const change of receipt.changes) {
    addReference(
      task,
      snapshot,
      'clip',
      change.clipId,
      change.kind === 'removed' ? 'removed' : 'output',
    );
    const reference = task.references.find(
      (r) => r.kind === 'clip' && r.id === change.clipId,
    );
    if (reference && (retained || change.fingerprint !== undefined))
      reference.fingerprint = change.fingerprint ?? null;
  }
}

/** Only explicitly selected identifiers and typed editing results enter memory. */
export function captureTool(
  task: EditingTask,
  name: string,
  input: unknown,
  output: unknown,
  snapshot: ProjectSnapshot,
) {
  if (input && typeof input === 'object') {
    const fields = input as Record<string, unknown>;
    for (const [field, kind] of [
      ['clipId', 'clip'],
      ['assetId', 'asset'],
      ['clipIds', 'clip'],
      ['speechClipIds', 'clip'],
      ['backgroundClipIds', 'clip'],
      ['assetIds', 'asset'],
    ] as const) {
      const values = Array.isArray(fields[field])
        ? fields[field]
        : [fields[field]];
      for (const id of values)
        if (typeof id === 'string')
          addReference(task, snapshot, kind, id, 'input');
    }
  }
  if (!output || typeof output !== 'object') return;
  const result = output as Record<string, unknown>;
  if (
    ['startClipDiscovery', 'readClipDiscovery', 'cancelClipDiscovery'].includes(
      name,
    ) &&
    result.projectId === snapshot.project.id &&
    typeof result.id === 'string'
  ) {
    task.highlightJobIds = [
      ...new Set([...task.highlightJobIds, result.id]),
    ].slice(-20);
    if (!task.commandIds.length && !task.highlightOutputs.length)
      task.state =
        result.cancelled || result.status === 'cancelled'
          ? 'cancelled'
          : result.status === 'failed'
            ? 'failed'
            : 'pending';
  }
  if (
    ['readClipOutputs', 'readClipDiscovery'].includes(name) &&
    result.projectId === snapshot.project.id &&
    Array.isArray(result.outputs)
  )
    captureHighlightOutputs(task, result.outputs);

  if (
    result.projectId === snapshot.project.id &&
    typeof result.id === 'string'
  ) {
    if (name === 'measureAudio') {
      task.omittedDetails ||= task.audioMeasurementIds.length >= 20;
      task.audioMeasurementIds = [
        ...new Set([...task.audioMeasurementIds, result.id]),
      ].slice(-20);
    }
    if (name === 'planAudioGain' || name === 'planAudioDucking') {
      task.omittedDetails ||= task.audioPlanIds.length >= 20;
      task.audioPlanIds = [...new Set([...task.audioPlanIds, result.id])].slice(
        -20,
      );
      if (!task.commandIds.length)
        task.state = result.status === 'unattainable' ? 'failed' : 'pending';
      if (result.status === 'unattainable' && Array.isArray(result.warnings))
        task.unresolvedConstraints = result.warnings
          .filter((w): w is string => typeof w === 'string')
          .slice(0, 20)
          .map((w) => w.slice(0, 200));
    }
  }
  if (name === 'planRoughCut' && result.proposal)
    captureTool(task, 'readEditProposal', {}, result.proposal, snapshot);
  if (
    [
      'planAutoCut',
      'planScreenPolish',
      'planRoughCut',
      'readEditingJob',
      'cancelEditingJob',
    ].includes(name) &&
    result.projectId === snapshot.project.id &&
    typeof result.id === 'string'
  ) {
    task.omittedDetails ||=
      !task.jobIds.includes(result.id) && task.jobIds.length >= 20;
    task.jobIds = [...new Set([...task.jobIds, result.id])].slice(-20);
    if (!task.commandIds.length)
      task.state =
        result.status === 'failed'
          ? 'failed'
          : result.reviewStatus === 'cancelled' || result.status === 'cancelled'
            ? 'cancelled'
            : 'pending';
  }
  if (
    name === 'readEditProposal' &&
    result.projectId === snapshot.project.id &&
    typeof result.jobId === 'string'
  ) {
    if (typeof result.assetId === 'string')
      addReference(task, snapshot, 'asset', result.assetId, 'input');
    if (typeof result.clipId === 'string')
      addReference(task, snapshot, 'clip', result.clipId, 'input');
    task.omittedDetails ||=
      !task.proposalJobIds.includes(result.jobId) &&
      task.proposalJobIds.length >= 20;
    task.proposalJobIds = [
      ...new Set([...task.proposalJobIds, result.jobId]),
    ].slice(-20);
    if (result.roughCut && typeof result.roughCut === 'object') {
      const constraints = (result.roughCut as { unmetConstraints?: unknown })
        .unmetConstraints;
      if (Array.isArray(constraints)) {
        task.omittedDetails ||=
          constraints.length > 20 ||
          constraints.some((c) => typeof c === 'string' && c.length > 200);
        task.unresolvedConstraints = constraints
          .filter((c): c is string => typeof c === 'string')
          .slice(0, 20)
          .map((c) => c.slice(0, 200));
      }
    }
  }
}

export function reconcileContext(
  context: EditingContext,
  snapshot: ProjectSnapshot,
  reviews: readonly EditingReview[] = [],
) {
  if (context.projectId !== snapshot.project.id) return;
  for (const task of context.tasks) {
    for (const review of reviews) {
      if (
        review.job.projectId !== context.projectId ||
        !task.jobIds.includes(review.job.id)
      )
        continue;
      if (review.receipt) captureReceipt(task, review.receipt, snapshot, true);
      if (!task.commandIds.length)
        task.state =
          review.job.reviewStatus === 'cancelled' ||
          review.job.status === 'cancelled'
            ? 'cancelled'
            : review.job.status === 'failed'
              ? 'failed'
              : 'pending';
    }
    for (const reference of task.references) {
      const current = fingerprint(snapshot, reference.kind, reference.id);
      reference.stale =
        reference.role === 'removed'
          ? current !== null
          : !current || current !== reference.fingerprint;
    }
  }
}

export function contextPrompt(context: EditingContext): string {
  const tasks: EditingTask[] = [];
  const latestOutput = [...context.tasks]
    .reverse()
    .find((t) => t.commandIds.length);
  const latest = context.tasks.at(-1);
  const priority = (t: EditingTask) =>
    t === latestOutput ? 3 : t === latest ? 2 : t.state === 'pending' ? 1 : 0;
  const candidates = [...context.tasks]
    .reverse()
    .sort((a, b) => priority(b) - priority(a));
  const serialize = () =>
    JSON.stringify({
      ...context,
      tasks,
      omittedTasks: context.omittedTasks + context.tasks.length - tasks.length,
    });
  for (const task of candidates) {
    tasks.push({
      ...task,
      request: task.request.slice(0, 500),
      requestTruncated: task.requestTruncated || task.request.length > 500,
    });
    if (Buffer.byteLength(serialize(), 'utf8') > 8192) tasks.pop();
  }
  return serialize();
}

export function captureHighlightOutputs(
  task: EditingTask,
  outputs: readonly unknown[],
) {
  for (const value of outputs) {
    if (!value || typeof value !== 'object') continue;
    const o = value as Record<string, unknown>;
    if (
      typeof o.projectId !== 'string' ||
      typeof o.candidateId !== 'string' ||
      typeof o.videoClipId !== 'string' ||
      typeof o.audioClipId !== 'string'
    )
      continue;
    task.omittedDetails ||= task.highlightOutputs.length >= 20;
    task.highlightOutputs = [
      ...task.highlightOutputs.filter((p) => p.projectId !== o.projectId),
      {
        projectId: o.projectId,
        candidateId: o.candidateId,
        videoClipId: o.videoClipId,
        audioClipId: o.audioClipId,
      },
    ].slice(-20);
    task.state = 'applied';
    task.verification = 'unverified';
  }
}
