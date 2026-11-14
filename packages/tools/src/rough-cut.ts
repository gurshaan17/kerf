import { z } from 'zod';
import { fpsToNumber, idSchema, secondsToFrames } from '@kerf/model';
import type { FrameRate } from '@kerf/model';
import { sequenceDurationFrames } from '@kerf/engine';
import type {
  EditingProposal,
  ToolContext,
  ToolSearchResponse,
  ToolSnapshot,
} from './types';

export const roughCutPlanSchema = z
  .object({
    assetIds: z
      .array(idSchema('asset'))
      .min(1)
      .max(20)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        'Choose unique assets.',
      ),
    intent: z.string().trim().min(1).max(1000),
    targetDurationSeconds: z.number().positive().max(1800).optional(),
    selections: z
      .array(
        z
          .object({
            evidenceId: z.string().min(1),
            reason: z.string().trim().min(1).max(600),
          })
          .strict(),
      )
      .min(1)
      .max(40)
      .optional(),
  })
  .strict();
export type RoughCutPlanRequest = z.infer<typeof roughCutPlanSchema>;
export interface SourceEvidence {
  readonly id: string;
  readonly kind: 'transcript' | 'scene';
  readonly assetId: string;
  readonly text: string;
  readonly startFrame: number;
  readonly endFrame: number;
  readonly frameRate: FrameRate;
}

/** Complete speech segments or described silent scenes, in native source-frame units. */
export function roughCutEvidence(
  snapshot: ToolSnapshot,
  assetIds: readonly string[],
): SourceEvidence[] {
  const evidence: SourceEvidence[] = [];
  for (const assetId of assetIds) {
    const asset = snapshot.assets.find((a) => a.id === assetId);
    if (
      !asset ||
      asset.kind !== 'video' ||
      !asset.hasVideo ||
      asset.status !== 'ready'
    )
      throw new Error('Select ready source videos for the rough cut.');
    if (
      assetId === snapshot.project.sequence.reference?.sourceAssetId ||
      assetId === snapshot.project.reference?.sourceAssetId ||
      snapshot.referenceProfiles.some((p) => p.sourceAssetId === assetId)
    )
      throw new Error('Reference footage is not eligible for a rough cut.');
    if (!asset.frameRate)
      throw new Error(
        'Rough-cut planning needs known source frame rates. Probe or relink the footage first.',
      );
    const rate = asset.frameRate;
    const speech = snapshot.transcripts.filter(
      (t) =>
        t.assetId === assetId &&
        t.source === 'speech' &&
        t.status === 'reviewed',
    );
    const rows = speech.length
      ? speech.flatMap((t) =>
          t.segments.map((s) => ({ ...s, kind: 'transcript' as const })),
        )
      : asset.hasAudio
        ? []
        : snapshot.scenes
            .filter((s) => s.assetId === assetId && s.description?.trim())
            .map((s) => ({
              ...s,
              text: s.description!,
              kind: 'scene' as const,
            }));
    for (const row of rows) {
      if (
        !row.text.trim() ||
        row.endFrame <= row.startFrame ||
        row.endFrame > secondsToFrames(asset.durationSeconds, rate, 'ceil')
      )
        continue;
      evidence.push({
        id: row.id,
        kind: row.kind,
        assetId,
        text: row.text,
        startFrame: row.startFrame,
        endFrame: row.endFrame,
        frameRate: rate,
      });
      if (evidence.length >= 2000) return evidence;
    }
  }
  return evidence;
}

export function buildRoughCutPlan(
  snapshot: ToolSnapshot,
  request: RoughCutPlanRequest,
  search: (query: string) => ToolSearchResponse,
): Omit<EditingProposal, 'jobId'> {
  const evidence = roughCutEvidence(snapshot, request.assetIds);
  const warnings: string[] = [];
  for (const id of request.assetIds)
    if (!evidence.some((e) => e.assetId === id))
      warnings.push(
        `No usable speech transcript or described silent scene for ${id}. Analyse this source first.`,
      );
  if (evidence.length >= 2000)
    warnings.push(
      'Evidence was limited to 2000 ranges. Narrow the selected sources.',
    );
  let chosen: { evidence: SourceEvidence; reason: string }[];
  if (request.selections) {
    if (
      new Set(request.selections.map((s) => s.evidenceId)).size !==
      request.selections.length
    )
      throw new Error('Choose unique evidence IDs.');
    chosen = request.selections.map((s) => {
      const row = evidence.find((e) => e.id === s.evidenceId);
      if (!row)
        throw new Error(
          'Every selection must cite existing evidence from the selected sources.',
        );
      return { evidence: row, reason: s.reason };
    });
  } else {
    const hits = search(request.intent).results;
    const matches = evidence.filter((e) =>
      hits.some(
        (h) =>
          h.assetId === e.assetId &&
          h.kind === e.kind &&
          h.startFrame < e.endFrame &&
          h.endFrame > e.startFrame,
      ),
    );
    const candidates = matches.length ? matches : evidence;
    if (!matches.length)
      warnings.push(
        'No indexed intent matches. Draft uses source order; review its relevance or provide explicit evidence selections.',
      );
    chosen = [];
    let seconds = 0;
    for (const row of candidates) {
      if (
        chosen.some(
          (s) =>
            s.evidence.assetId === row.assetId &&
            s.evidence.startFrame < row.endFrame &&
            s.evidence.endFrame > row.startFrame,
        )
      )
        continue;
      chosen.push({
        evidence: row,
        reason: matches.length
          ? `Indexed evidence matches the requested intent: ${request.intent}`
          : 'Complete source range in selected-source order.',
      });
      seconds += (row.endFrame - row.startFrame) / fpsToNumber(row.frameRate);
      if (
        chosen.length >= 40 ||
        (request.targetDurationSeconds &&
          seconds >= request.targetDurationSeconds)
      )
        break;
    }
  }
  if (!chosen.length)
    throw new Error(
      'No usable evidence. Transcribe sources with audio or describe scenes in silent footage before planning.',
    );
  for (let i = 0; i < chosen.length; i++)
    for (const other of chosen.slice(i + 1)) {
      const row = chosen[i]!.evidence;
      if (
        row.assetId === other.evidence.assetId &&
        row.startFrame < other.evidence.endFrame &&
        row.endFrame > other.evidence.startFrame
      )
        throw new Error(
          'Overlapping source selections are unsupported. Choose distinct complete evidence ranges.',
        );
    }
  const rate = snapshot.project.sequence.frameRate;
  const changes = chosen.map(({ evidence: row, reason }) => {
    const sourceInFrame = secondsToFrames(
      row.startFrame / fpsToNumber(row.frameRate),
      rate,
      'floor',
    );
    const asset = snapshot.assets.find((a) => a.id === row.assetId)!;
    const end = Math.min(
      secondsToFrames(row.endFrame / fpsToNumber(row.frameRate), rate, 'ceil'),
      secondsToFrames(asset.durationSeconds, rate, 'floor'),
    );
    if (end <= sourceInFrame)
      throw new Error('An evidence range is shorter than one sequence frame.');
    return {
      id: row.id,
      evidenceId: row.id,
      evidenceKind: row.kind,
      assetId: row.assetId,
      startFrame: row.startFrame,
      endFrame: row.endFrame,
      sourceFrameRate: row.frameRate,
      sourceInFrame,
      durationFrames: end - sourceInFrame,
      reason,
      evidenceFrames: [],
      description: row.text,
    };
  });
  const frames = changes.reduce((n, c) => n + c.durationFrames, 0);
  const seconds = frames / fpsToNumber(rate);
  if (
    request.targetDurationSeconds &&
    Math.abs(seconds - request.targetDurationSeconds) > 1 / fpsToNumber(rate)
  )
    warnings.push(
      `Target ${request.targetDurationSeconds}s; complete evidence ranges produce ${seconds.toFixed(2)}s. Speech was not truncated to hit the target.`,
    );
  return {
    projectId: snapshot.project.id,
    clipId: '',
    assetId: changes[0]!.assetId,
    fingerprint: '',
    kind: 'roughCut',
    frameSpace: 'source',
    changes,
    roughCut: {
      intent: request.intent,
      assetIds: request.assetIds,
      targetDurationSeconds: request.targetDurationSeconds,
      estimatedDurationFrames: frames,
      estimatedDurationSeconds: seconds,
      appendAtFrame: sequenceDurationFrames(snapshot.project.sequence),
      unmetConstraints: warnings,
    },
  };
}

export const planRoughCutTool = {
  name: 'planRoughCut',
  description:
    'Plan an editable multi-source rough cut from existing evidence. Select ready asset IDs, intent and optional target duration. Optional ordered selections must cite evidence IDs from findInTranscript/readTranscript. Returns a job and ordered proposal; no timeline mutation. Uses complete speech segments or described silent scenes at normal speed, appending after existing content. Request applyEditProposal then review in Kerf.',
  input: roughCutPlanSchema,
  readOnly: false,
  execute(context: ToolContext, input: RoughCutPlanRequest) {
    if (!context.editing?.().planRoughCut)
      throw new Error('Rough-cut planning is unavailable in this session.');
    return context.editing().planRoughCut!(input);
  },
};

export const readSourceFilmstripTool = {
  name: 'readSourceFilmstrip',
  description:
    'Read up to six existing source-scene thumbnails with midpoint timestamps and source-frame rate. These are cached source images, not composited timeline previews. Reports unavailable thumbnails without inventing imagery.',
  input: z.object({
    assetId: idSchema('asset'),
    limit: z.number().int().min(1).max(6).default(4),
  }),
  readOnly: true,
  execute(context: ToolContext, input: { assetId: string; limit: number }) {
    const snapshot = context.snapshot();
    const asset = snapshot?.assets.find((a) => a.id === input.assetId);
    if (!snapshot || !asset)
      throw new Error('That source is not in the open project.');
    const scenes = snapshot.scenes
      .filter((s) => s.assetId === input.assetId && s.thumbnailPath)
      .sort((a, b) => a.startFrame - b.startFrame);
    const frames = Array.from(
      { length: Math.min(input.limit, scenes.length) },
      (_, i) =>
        scenes[
          Math.floor((i * scenes.length) / Math.min(input.limit, scenes.length))
        ]!,
    ).map((s) => ({
      frame: (s.startFrame + s.endFrame) / 2,
      frameRate: asset.frameRate ?? snapshot.project.sequence.frameRate,
      path: s.thumbnailPath!,
      mimeType: 'image/jpeg' as const,
      sceneId: s.id,
    }));
    return {
      assetId: asset.id,
      frames,
      note: frames.length
        ? 'Cached source-scene midpoints; these do not verify timeline edits.'
        : 'No cached scene thumbnails. Run scene detection first.',
    };
  },
};
