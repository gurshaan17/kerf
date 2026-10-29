import { z } from 'zod';
import type {
  Clip,
  ClipId,
  EditCommand,
  FxOverlayClip,
  NormalizedRegion,
  OverlayKind,
  OverlayProps,
  Sequence,
} from '@kerf/model';
import {
  OVERLAY_KINDS,
  applyOverlayPropsPatch,
  clipPatchSchema,
  clipSchema,
  idSchema,
  newId,
  normalizedRegionSchema,
  overlayKindSchema,
  overlayPropsPatchSchema,
  overlayPropsSchema,
  secondsToFrames,
} from '@kerf/model';
import { ensureEffectsTrackCommands, findClip } from '@kerf/engine';
import { toolEditSummary } from './edit';
import type { ToolContext } from './types';

const clipIdSchema = idSchema('clip');
const FALLBACK_OVERLAY_SECONDS = 3;

/**
 * Default overlay regions are centred and sized per kind so an overlay added
 * with a single tool call looks sensible before the editor adjusts handles.
 */
export const DEFAULT_OVERLAY_REGIONS: Record<OverlayKind, NormalizedRegion> = {
  blur: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
  callout: { x: 0.3, y: 0.62, w: 0.4, h: 0.2 },
  spotlight: { x: 0.3, y: 0.25, w: 0.4, h: 0.5 },
  zoom: { x: 0.35, y: 0.3, w: 0.3, h: 0.4 },
};

const DEFAULT_OVERLAY_LABELS: Record<OverlayKind, string> = {
  blur: 'Blur',
  callout: 'Callout',
  spotlight: 'Spotlight',
  zoom: 'Zoom',
};

/** Fully parsed defaults for one overlay kind, including the default region. */
export function defaultOverlayProps(kind: OverlayKind): OverlayProps {
  return overlayPropsSchema.parse({
    kind,
    region: DEFAULT_OVERLAY_REGIONS[kind],
    transitionInFrames: 24,
    transitionOutFrames: 24,
  });
}

export const DEFAULT_OVERLAY_PROPS: Readonly<
  Record<OverlayKind, OverlayProps>
> = Object.fromEntries(
  OVERLAY_KINDS.map((kind) => [kind, defaultOverlayProps(kind)]),
) as Record<OverlayKind, OverlayProps>;

function requireSnapshot(context: ToolContext) {
  const snapshot = context.snapshot();
  if (!snapshot) {
    throw new Error('Open a project before using tools.');
  }
  return snapshot;
}

function requireSourceClip(sequence: Sequence, clipId: ClipId): Clip {
  const location = findClip(sequence, clipId);
  if (!location) {
    throw new Error('That linked clip is not in the sequence.');
  }
  if (location.clip.type === 'fxOverlay') {
    throw new Error('An overlay cannot be linked to another overlay.');
  }
  if (location.clip.type === 'audio') {
    throw new Error('An overlay cannot be linked to an audio clip.');
  }
  return location.clip;
}

function selectedSourceClip(context: ToolContext, sequence: Sequence) {
  for (const clipId of context.editor().selectedClipIds) {
    const location = findClip(sequence, clipId);
    if (
      location &&
      location.clip.type !== 'fxOverlay' &&
      location.clip.type !== 'audio'
    ) {
      return location.clip;
    }
  }
  return null;
}

function buildProps(
  kind: OverlayKind,
  region: NormalizedRegion | undefined,
  patch: z.infer<typeof overlayPropsPatchSchema> | undefined,
): OverlayProps {
  const base = overlayPropsSchema.parse({
    kind,
    region: region ?? DEFAULT_OVERLAY_REGIONS[kind],
  });
  return patch ? applyOverlayPropsPatch(base, patch) : base;
}

function overlaySummary(overlay: FxOverlayClip) {
  return {
    overlayId: overlay.id,
    trackId: overlay.trackId,
    overlayKind: overlay.props.kind,
    startFrame: overlay.startFrame,
    durationFrames: overlay.durationFrames,
    linkedItemId: overlay.linkedItemId,
  };
}

export const addOverlayTool = {
  name: 'addOverlay',
  description:
    'Add a timed blur, callout, spotlight or zoom overlay. Links to the selected clip when there is one, otherwise starts at the playhead. Creates the Effects track when needed, as one undo step.',
  input: z.object({
    kind: overlayKindSchema,
    region: normalizedRegionSchema.optional(),
    startFrame: z.number().int().nonnegative().optional(),
    durationFrames: z.number().int().positive().optional(),
    linkedItemId: clipIdSchema.nullable().optional(),
    label: z.string().optional(),
    props: overlayPropsPatchSchema.optional(),
  }),
  execute(
    context: ToolContext,
    input: {
      kind: OverlayKind;
      region?: NormalizedRegion;
      startFrame?: number;
      durationFrames?: number;
      linkedItemId?: ClipId | null;
      label?: string;
      props?: z.infer<typeof overlayPropsPatchSchema>;
    },
  ) {
    const snapshot = requireSnapshot(context);
    const sequence = snapshot.project.sequence;

    let linkedItemId: ClipId | null = null;
    if (input.linkedItemId !== undefined) {
      linkedItemId = input.linkedItemId;
    } else {
      linkedItemId = selectedSourceClip(context, sequence)?.id ?? null;
    }
    const source =
      linkedItemId === null ? null : requireSourceClip(sequence, linkedItemId);

    const startFrame =
      input.startFrame ?? source?.startFrame ?? context.editor().playheadFrame;
    const durationFrames =
      input.durationFrames ??
      source?.durationFrames ??
      Math.max(
        1,
        Math.round(
          secondsToFrames(FALLBACK_OVERLAY_SECONDS, sequence.frameRate),
        ),
      );
    const props = buildProps(input.kind, input.region, input.props);
    const effects = ensureEffectsTrackCommands(sequence);
    const overlay = clipSchema.parse({
      id: newId('clip'),
      trackId: effects.trackId,
      type: 'fxOverlay',
      startFrame: Math.max(0, Math.round(startFrame)),
      durationFrames: Math.max(1, Math.round(durationFrames)),
      label: input.label ?? DEFAULT_OVERLAY_LABELS[input.kind],
      linkedItemId,
      props,
    }) as FxOverlayClip;

    const commands: EditCommand[] = [
      ...effects.commands,
      { type: 'clip.insert', clip: overlay },
    ];
    const result = context.applyBatch(commands, {
      label: effects.created ? 'Add overlay and effects track' : 'Add overlay',
    });

    return {
      ...toolEditSummary(result),
      ...overlaySummary(overlay),
      trackCreated: effects.created,
    };
  },
};

export const updateOverlayTool = {
  name: 'updateOverlay',
  description:
    'Update an overlay timing, link, label or visual props. Partial props merge into the existing overlay and the overlay kind cannot change.',
  input: z.object({
    overlayId: clipIdSchema,
    startFrame: z.number().int().nonnegative().optional(),
    durationFrames: z.number().int().positive().optional(),
    linkedItemId: clipIdSchema.nullable().optional(),
    label: z.string().optional(),
    props: overlayPropsPatchSchema.optional(),
  }),
  execute(
    context: ToolContext,
    input: {
      overlayId: ClipId;
      startFrame?: number;
      durationFrames?: number;
      linkedItemId?: ClipId | null;
      label?: string;
      props?: z.infer<typeof overlayPropsPatchSchema>;
    },
  ) {
    const snapshot = requireSnapshot(context);
    const sequence = snapshot.project.sequence;
    const location = findClip(sequence, input.overlayId);
    if (!location || location.clip.type !== 'fxOverlay') {
      throw new Error('That overlay is not in the sequence.');
    }
    if (input.linkedItemId !== undefined && input.linkedItemId !== null) {
      requireSourceClip(sequence, input.linkedItemId);
    }

    const patch: z.infer<typeof clipPatchSchema> = {};
    if (input.startFrame !== undefined) {
      patch.startFrame = input.startFrame;
    }
    if (input.durationFrames !== undefined) {
      patch.durationFrames = input.durationFrames;
    }
    if (input.linkedItemId !== undefined) {
      patch.linkedItemId = input.linkedItemId;
    }
    if (input.label !== undefined) {
      patch.label = input.label;
    }
    if (input.props !== undefined) {
      patch.props = input.props;
    }
    if (Object.keys(patch).length === 0) {
      throw new Error('Provide at least one overlay field to update.');
    }

    const result = context.apply(
      { type: 'clip.update', clipId: input.overlayId, patch },
      { label: 'Update overlay' },
    );
    const updated = findClip(
      result.snapshot.project.sequence,
      input.overlayId,
    )?.clip;
    if (!updated || updated.type !== 'fxOverlay') {
      throw new Error('The overlay update did not return an overlay.');
    }
    return {
      ...toolEditSummary(result),
      ...overlaySummary(updated),
    };
  },
};

export const OVERLAY_TOOLS = [addOverlayTool, updateOverlayTool];
