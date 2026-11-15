import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { applyCommand, findClip, timelineDurationFrames } from '@kerf/engine';
import type { ClipPatch, EditCommand } from '@kerf/model';
import { VISUAL_REVIEW_LIMITS as LIMITS, verifyTimeline } from '@kerf/tools';
import type {
  StoryboardInput,
  StoryboardResult,
  ToolContext,
  ToolSnapshot,
  VisualFinding,
  VisualRepairInput,
  VisualRepairResult,
} from '@kerf/tools';

type Review = {
  id: string;
  actor: ToolContext['actor'];
  projectId: string;
  revision: string;
  createdAt: number;
  status: 'rendering' | 'ready' | 'repaired' | 'closed';
  width: number;
  requestedFrames: number[];
  objectIds: string[];
  objectsTruncated: boolean;
  frames: StoryboardResult['frames'];
  truncated: boolean;
  findings: VisualFinding[];
  commandId?: string;
  usedFrames: number;
  usedBytes: number;
  usedRenderMs: number;
};
const scope =
  'Sampled composited timeline frames only. Playback, pacing, audio, transitions and whole-video quality are not verified.';
function revision(snapshot: ToolSnapshot): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        project: snapshot.project,
        assets: snapshot.assets,
        compositions: snapshot.compositions,
      }),
    )
    .digest('hex');
}
function snapshot(context: ToolContext) {
  context.signal?.throwIfAborted();
  context.checkAccess?.();
  const current = context.snapshot();
  if (!current) throw new Error('Open a project before inspecting visuals.');
  return current;
}
function activeClipIds(current: ToolSnapshot, frame: number) {
  return current.project.sequence.tracks
    .filter((t) => !t.hidden)
    .flatMap((t) => t.clips)
    .filter(
      (c) =>
        c.type !== 'audio' &&
        c.startFrame <= frame &&
        frame < c.startFrame + c.durationFrames,
    )
    .map((c) => c.id);
}
function sampleFrames(
  context: ToolContext,
  current: ToolSnapshot,
  input: StoryboardInput,
) {
  const clips = (input.clipIds ?? []).map((id) => {
    const location = findClip(current.project.sequence, id);
    if (!location || location.track.hidden || location.clip.type === 'audio')
      throw new Error(
        'Choose existing visible visual clips for storyboard sampling.',
      );
    return location.clip;
  });
  if (input.frames) return { frames: input.frames, truncated: false };
  const chosen = clips.length
    ? clips
    : context
        .editor()
        .selectedClipIds.map(
          (id) => findClip(current.project.sequence, id)?.clip,
        )
        .filter((c) => c !== undefined && c.type !== 'audio');
  if (!chosen.length)
    throw new Error('Provide timeline frames or visual clip IDs to inspect.');
  const candidates = [
    ...new Set([
      ...chosen.map((c) =>
        ['caption', 'text', 'fxOverlay'].includes(c.type)
          ? c.startFrame + Math.floor(c.durationFrames / 2)
          : c.startFrame,
      ),
      ...chosen.flatMap((c) => [
        c.startFrame,
        c.startFrame + c.durationFrames - 1,
      ]),
    ]),
  ];
  return {
    frames: candidates.slice(0, LIMITS.framesPerPass),
    truncated: candidates.length > LIMITS.framesPerPass,
  };
}

/** Evidence and budgets live at the shared tool boundary, including for MCP clients. */
export class VisualReviewService {
  private readonly reviews = new Map<string, Review>();
  private existing(context: ToolContext, id: string) {
    const review = this.reviews.get(id);
    const current = snapshot(context);
    if (
      !review ||
      review.projectId !== current.project.id ||
      review.actor !== context.actor
    )
      throw new Error(
        'That visual review is unavailable in this project or tool session.',
      );
    if (context.now() - review.createdAt > LIMITS.lifetimeMs) {
      review.status = 'closed';
      throw new Error('Visual evidence expired. Start a new review.');
    }
    if (review.revision !== revision(current)) {
      review.status = 'closed';
      throw new Error(
        'The project changed after visual inspection. Start a new review.',
      );
    }
    return { review, current };
  }
  async render(
    context: ToolContext,
    input: StoryboardInput,
  ): Promise<StoryboardResult> {
    let review: Review;
    let current: ToolSnapshot;
    const pass = input.recheckOf ? 'recheck' : 'initial';
    if (input.recheckOf) {
      ({ review, current } = this.existing(context, input.recheckOf));
      if (review.status !== 'repaired')
        throw new Error(
          'Only one recheck after one committed visual repair is allowed.',
        );
    } else {
      current = snapshot(context);
      if (!context.renderer())
        throw new Error('Visual inspection requires the open editor preview.');
      const samples = sampleFrames(context, current, input);
      const duration = timelineDurationFrames(current.project.sequence);
      if (samples.frames.some((frame) => frame >= duration))
        throw new Error('Storyboard frames must fall inside the timeline.');
      for (const [id, old] of this.reviews)
        if (context.now() - old.createdAt > LIMITS.lifetimeMs)
          this.reviews.delete(id);
      while (this.reviews.size >= 20)
        this.reviews.delete(this.reviews.keys().next().value!);
      const allObjectIds = [
        ...new Set([
          ...(input.clipIds ?? []),
          ...samples.frames.flatMap((frame) => activeClipIds(current, frame)),
        ]),
      ];
      review = {
        objectIds: allObjectIds.slice(0, LIMITS.objects),
        objectsTruncated: allObjectIds.length > LIMITS.objects,
        id: `visual_${randomUUID()}`,
        actor: context.actor,
        projectId: current.project.id,
        revision: revision(current),
        createdAt: context.now(),
        status: 'rendering',
        width: input.maxWidth,
        requestedFrames: [...samples.frames],
        frames: [],
        truncated: samples.truncated,
        findings: [],
        usedFrames: 0,
        usedBytes: 0,
        usedRenderMs: 0,
      };
      this.reviews.set(review.id, review);
    }
    review.status = 'rendering';
    const structural = verifyTimeline(current);
    const frames: StoryboardResult['frames'][number][] = [];
    let status: StoryboardResult['status'] = 'ready';
    let note =
      pass === 'initial'
        ? 'Inspect the delivered images before reporting findings or requesting a repair.'
        : 'Single recheck complete. Report any remaining issues and stop; no further repair batch is allowed.';
    const began = context.now();
    if (!structural.valid) {
      review.status = 'closed';
      status = 'blocked';
      note =
        'Resolve structural errors before visual refinement. No visual repairs are allowed from this review.';
    } else {
      try {
        const renderer = context.renderer();
        if (!renderer) throw new Error('Preview renderer unavailable.');
        for (const frame of review.requestedFrames) {
          this.existing(context, review.id);
          const remaining = Math.min(
            LIMITS.renderMsPerPass - (context.now() - began),
            LIMITS.renderMsPerReview - review.usedRenderMs,
          );
          if (remaining <= 0 || review.usedFrames >= LIMITS.framesPerReview)
            throw new Error('Visual rendering budget exhausted.');
          const signal = AbortSignal.any([
            ...(context.signal ? [context.signal] : []),
            AbortSignal.timeout(Math.max(1, Math.floor(remaining))),
          ]);
          review.usedFrames++;
          const rendered = await abortable(
            renderer.renderFrame({ frame, maxWidth: review.width, signal }),
            signal,
          );
          this.existing(context, review.id);
          if (
            context.now() - began > LIMITS.renderMsPerPass ||
            review.usedRenderMs + context.now() - began >
              LIMITS.renderMsPerReview
          )
            throw new Error('Visual rendering budget exhausted.');
          if (
            rendered.frame !== frame ||
            rendered.width <= 0 ||
            rendered.width > review.width ||
            rendered.height <= 0 ||
            rendered.mimeType !== 'image/png'
          )
            throw new Error(
              'The renderer returned mismatched storyboard metadata.',
            );
          const size = statSync(rendered.path).size;
          if (size <= 0 || size > LIMITS.imageBytes - review.usedBytes)
            throw new Error('Storyboard image budget exhausted.');
          const bytes = readFileSync(rendered.path);
          if (bytes.length > LIMITS.imageBytes - review.usedBytes)
            throw new Error('Storyboard image budget exhausted.');
          review.usedBytes += bytes.length;
          frames.push({ ...rendered, clipIds: activeClipIds(current, frame) });
        }
        review.frames = frames;
        review.status = pass === 'initial' ? 'ready' : 'closed';
      } catch (cause) {
        review.status = 'closed';
        status = 'partial';
        note = `Visual refinement stopped: ${cause instanceof Error ? cause.message : String(cause)} No further repair is allowed from this review.`;
      } finally {
        review.usedRenderMs += Math.max(0, context.now() - began);
      }
    }
    return {
      storyboardId: review.id,
      projectId: review.projectId,
      revision: review.revision,
      frameRate: current.project.sequence.frameRate,
      pass,
      status,
      frames,
      canvas: {
        width: current.project.sequence.width,
        height: current.project.sequence.height,
      },
      objectsTruncated: review.objectsTruncated,
      objects: current.project.sequence.tracks
        .flatMap((t) => t.clips)
        .filter((c) => frames.some((frame) => frame.clipIds.includes(c.id)))
        .map((c) => ({
          clipId: c.id,
          type: c.type,
          label: c.label,
          startFrame: c.startFrame,
          endFrame: c.startFrame + c.durationFrames,
          transform: c.transform,
          style:
            c.type === 'text' || c.type === 'caption' ? c.style : undefined,
          fit: c.type === 'image' ? c.fit : undefined,
          props:
            c.type === 'fxOverlay'
              ? {
                  ...c.props,
                  ...(c.props.kind === 'callout'
                    ? { text: c.props.text.slice(0, 500) }
                    : {}),
                }
              : undefined,
          text:
            c.type === 'text' || c.type === 'caption'
              ? c.text.slice(0, 500)
              : undefined,
          keyframeProperties: Object.entries(c.keyframes)
            .filter(([, points]) => points.length)
            .map(([property]) => property),
        })),
      structuralFindings: structural.findings,
      findings: review.findings,
      repairCommandId: review.commandId,
      samplingTruncated: review.truncated,
      scope,
      note,
      budgets: {
        remainingFrames: Math.max(
          0,
          LIMITS.framesPerReview - review.usedFrames,
        ),
        remainingImageBytes: Math.max(0, LIMITS.imageBytes - review.usedBytes),
        remainingRenderMs: Math.max(
          0,
          LIMITS.renderMsPerReview - review.usedRenderMs,
        ),
      },
    };
  }
  repair(context: ToolContext, input: VisualRepairInput): VisualRepairResult {
    const { review, current } = this.existing(context, input.storyboardId);
    if (review.status !== 'ready')
      throw new Error(
        'This visual review is closed or already used. Only one repair batch is allowed.',
      );
    if (!context.renderer()) {
      review.status = 'closed';
      throw new Error(
        'Preview renderer unavailable; visual refinement stopped.',
      );
    }
    const changes = input.findings.filter((f) => f.patch);
    if (
      changes.length > LIMITS.repairs ||
      new Set(changes.map((f) => f.clipId)).size !== changes.length
    )
      throw new Error(
        'Choose at most four distinct objects for one visual repair batch.',
      );
    for (const finding of input.findings) {
      const frame = review.frames.find(
        (f) => f.frame === finding.frame && f.clipIds.includes(finding.clipId),
      );
      if (!frame)
        throw new Error(
          'Every finding must cite an object and exact frame returned by this storyboard.',
        );
      try {
        if (!statSync(frame.path).isFile()) throw new Error('Missing file');
      } catch {
        review.status = 'closed';
        throw new Error(
          'Storyboard evidence is unavailable. Start a new review.',
        );
      }
    }
    const commands: EditCommand[] = [];
    for (const finding of changes) {
      const location = findClip(current.project.sequence, finding.clipId)!;
      const clip = location.clip;
      if (location.track.locked || clip.locked)
        throw new Error('Unlock the affected object before a visual repair.');
      const proposed = finding.patch!;
      const patch: ClipPatch = {};
      if (
        proposed.transform &&
        Object.entries(clip.keyframes).some(
          ([property, points]) =>
            points.length && Object.hasOwn(proposed.transform!, property),
        )
      )
        throw new Error(
          'This visual property is animated. Review its motion separately instead of overriding a keyframed property.',
        );
      if (proposed.transform)
        patch.transform = { ...clip.transform, ...proposed.transform };
      if (proposed.style) {
        if (clip.type !== 'text' && clip.type !== 'caption')
          throw new Error(
            'Text-style repairs require a text or caption object.',
          );
        patch.style = { ...clip.style, ...proposed.style };
      }
      if (proposed.fit) {
        if (clip.type !== 'image')
          throw new Error(
            'Fit repairs require an image object; use transforms for video framing.',
          );
        patch.fit = proposed.fit;
      }
      if (proposed.props) {
        if (clip.type !== 'fxOverlay')
          throw new Error(
            'Overlay appearance repairs require an overlay object.',
          );
        patch.props = proposed.props;
      }
      const command: EditCommand = {
        type: 'clip.update',
        clipId: clip.id,
        patch,
      };
      const trial = applyCommand(current.project.sequence, command);
      if (
        JSON.stringify(findClip(trial.sequence, clip.id)?.clip) ===
        JSON.stringify(clip)
      ) {
        review.status = 'closed';
        return {
          storyboardId: review.id,
          status: 'no-change',
          findings: input.findings,
          recheckRequired: false,
          note: 'A proposed patch would not change the object. No edits were committed; refinement stopped.',
        };
      }
      commands.push(command);
    }
    review.findings = input.findings;
    if (!commands.length) {
      review.status = 'closed';
      return {
        storyboardId: review.id,
        status: 'reviewed',
        findings: input.findings,
        recheckRequired: false,
        note: `Inspection recorded without changes. ${scope}`,
      };
    }
    this.existing(context, review.id);
    const batch: EditCommand = {
      type: 'batch',
      label: 'Repair inspected visuals',
      commands,
    };
    applyCommand(current.project.sequence, batch);
    const result = context.apply(batch, { label: 'Repair inspected visuals' });
    review.revision = revision(result.snapshot);
    review.commandId = result.command.id;
    review.status = 'repaired';
    return {
      storyboardId: review.id,
      status: 'repaired',
      commandId: result.command.id,
      findings: input.findings,
      recheckRequired: true,
      note: 'One visual repair batch applied as one undo step. Render the single recheck before reporting the result.',
    };
  }
}

function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () =>
      reject(signal.reason ?? new Error('Visual rendering stopped.'));
    if (signal.aborted) {
      void work.catch(() => undefined);
      reject(signal.reason);
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (cause) => {
        signal.removeEventListener('abort', abort);
        reject(cause);
      },
    );
  });
}
