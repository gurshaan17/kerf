import { z } from 'zod';
import type { EditCommand, ReferenceProfile } from '@kerf/model';
import {
  effectSchema,
  idSchema,
  newId,
  referenceProfileSchema,
} from '@kerf/model';
import { sequenceDurationFrames } from '@kerf/engine';
import type { ToolContext } from './types';

const assetIdSchema = idSchema('asset');
const referenceIdSchema = idSchema('reference');
const clipIdSchema = idSchema('clip');

function requireSnapshot(context: ToolContext) {
  const snapshot = context.snapshot();
  if (!snapshot) {
    throw new Error('Open a project before using tools.');
  }
  return snapshot;
}

function profileSummary(profile: ReferenceProfile) {
  return {
    id: profile.id,
    name: profile.name,
    sourceAssetId: profile.sourceAssetId,
    palette: profile.palette,
    mood: profile.mood,
    notes: profile.notes,
    metrics: {
      sceneCount: profile.sceneCount,
      averageShotLengthFrames: profile.averageShotLengthFrames,
      cutsPerMinute: profile.cutsPerMinute,
      meanLuma: profile.meanLuma,
      meanSaturation: profile.meanSaturation,
      meanContrast: profile.meanContrast,
    },
    analyzedAt: profile.analyzedAt,
    createdAt: profile.createdAt,
  };
}

function findProfile(
  context: ToolContext,
  profileId?: string,
): ReferenceProfile {
  const snapshot = requireSnapshot(context);
  const active = snapshot.project.sequence.reference;
  const profile = profileId
    ? snapshot.referenceProfiles.find((candidate) => candidate.id === profileId)
    : (snapshot.referenceProfiles.find(
        (candidate) =>
          candidate.id === active?.id ||
          candidate.sourceAssetId === active?.sourceAssetId,
      ) ?? active);
  if (!profile) {
    throw new Error(
      'No reference profile is available. Profile a reference first.',
    );
  }
  return profile;
}

function fallbackProfile(
  context: ToolContext,
  assetId: string,
  name?: string,
): ReferenceProfile {
  const snapshot = requireSnapshot(context);
  const asset = snapshot.assets.find((candidate) => candidate.id === assetId);
  if (!asset) {
    throw new Error('That reference asset is not in the open project.');
  }
  return referenceProfileSchema.parse({
    id: newId('reference'),
    name: name ?? asset.name,
    sourceAssetId: asset.id,
    createdAt: context.now(),
  });
}

export const useReferenceTool = {
  name: 'useReference',
  description:
    'Assign a reference asset to the sequence. The reference media is analyzed for style only and never enters the timeline or export.',
  input: z.object({
    assetId: assetIdSchema,
    name: z.string().min(1).optional(),
  }),
  async execute(
    context: ToolContext,
    input: { assetId: string; name?: string },
  ) {
    const snapshot = requireSnapshot(context);
    const asset = snapshot.assets.find(
      (candidate) => candidate.id === input.assetId,
    );
    if (!asset) {
      throw new Error('That reference asset is not in the open project.');
    }
    const existing = snapshot.referenceProfiles.find(
      (profile) => profile.sourceAssetId === asset.id,
    );
    const profile =
      existing?.analyzedAt !== null && existing?.analyzedAt !== undefined
        ? existing
        : context.profileReference
          ? await context.profileReference({
              assetId: asset.id,
              name: input.name,
            })
          : (existing ?? fallbackProfile(context, asset.id, input.name));
    const result = context.apply(
      { type: 'sequence.setReference', reference: profile },
      { label: `Use reference ${profile.name}` },
    );
    return {
      profile: profileSummary(profile),
      commandId: result.command.id,
      durationFrames: sequenceDurationFrames(result.snapshot.project.sequence),
    };
  },
};

export const profileReferenceTool = {
  name: 'profileReference',
  description:
    'Analyze a reference asset for shot rhythm, palette and colour statistics and persist the profile.',
  input: z.object({
    assetId: assetIdSchema,
    name: z.string().min(1).optional(),
  }),
  async execute(
    context: ToolContext,
    input: { assetId: string; name?: string },
  ) {
    requireSnapshot(context);
    if (!context.profileReference) {
      throw new Error('Reference profiling is not available in this session.');
    }
    const profile = await context.profileReference(input);
    return { profile: profileSummary(profile) };
  },
};

export const readReferenceTool = {
  name: 'readReference',
  description:
    'Read the active reference profile, or one profile by id, including its measurements.',
  input: z
    .object({
      profileId: referenceIdSchema.optional(),
    })
    .default({}),
  readOnly: true,
  execute(context: ToolContext, input: { profileId?: string }) {
    return { profile: profileSummary(findProfile(context, input.profileId)) };
  },
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function lookEffects(profile: ReferenceProfile) {
  const effects: Array<{
    type: 'brightness' | 'contrast' | 'saturate';
    amount: number;
  }> = [];
  if (profile.meanLuma !== null) {
    effects.push({
      type: 'brightness',
      amount: clamp(0.9 + profile.meanLuma * 0.35, 0.75, 1.35),
    });
  }
  if (profile.meanContrast !== null) {
    effects.push({
      type: 'contrast',
      amount: clamp(0.9 + profile.meanContrast * 0.4, 0.7, 1.5),
    });
  }
  if (profile.meanSaturation !== null) {
    effects.push({
      type: 'saturate',
      amount: clamp(0.8 + profile.meanSaturation * 0.6, 0.6, 1.6),
    });
  }
  return effects;
}

function pacing(
  profile: ReferenceProfile,
  sequence: Parameters<typeof sequenceDurationFrames>[0],
) {
  const durationFrames = sequenceDurationFrames(sequence);
  const fps = sequence.frameRate.numerator / sequence.frameRate.denominator;
  const targetShotLengthFrames =
    profile.cutsPerMinute > 0
      ? Math.max(1, Math.round((60 / profile.cutsPerMinute) * fps))
      : 0;
  const suggestedCutFrames =
    targetShotLengthFrames > 0
      ? Array.from(
          {
            length: Math.min(
              200,
              Math.floor((durationFrames - 1) / targetShotLengthFrames),
            ),
          },
          (_, index) => (index + 1) * targetShotLengthFrames,
        )
      : [];
  return {
    averageShotLengthFrames: profile.averageShotLengthFrames,
    cutsPerMinute: profile.cutsPerMinute,
    sceneCount: profile.sceneCount,
    targetShotLengthFrames: targetShotLengthFrames || null,
    suggestedCutFrames,
  };
}

export const copyReferenceLookTool = {
  name: 'copyReferenceLook',
  description:
    'Apply the active reference profile colour treatment to visual clips as one undo step, and return its pacing targets.',
  input: z.object({
    profileId: referenceIdSchema.optional(),
    clipIds: z.array(clipIdSchema).min(1).optional(),
    strength: z.number().min(0).max(1).default(1),
  }),
  execute(
    context: ToolContext,
    input: { profileId?: string; clipIds?: string[]; strength: number },
  ) {
    const snapshot = requireSnapshot(context);
    const profile = findProfile(context, input.profileId);
    const effects = lookEffects(profile).map((effect) => ({
      type: effect.type,
      amount: 1 + (effect.amount - 1) * input.strength,
    }));
    if (effects.length === 0) {
      return {
        appliedClipCount: 0,
        effectsAdded: 0,
        pacing: pacing(profile, snapshot.project.sequence),
      };
    }
    const targetIds = input.clipIds ? new Set(input.clipIds) : null;
    const commands: EditCommand[] = [];
    let appliedClipCount = 0;
    let effectsAdded = 0;
    for (const track of snapshot.project.sequence.tracks) {
      if (track.hidden || track.kind === 'audio') {
        continue;
      }
      for (const clip of track.clips) {
        if (targetIds && !targetIds.has(clip.id)) {
          continue;
        }
        if (clip.type === 'audio') {
          continue;
        }
        const existing = new Set(clip.effects.map((effect) => effect.type));
        let added = 0;
        for (const effect of effects) {
          if (existing.has(effect.type)) {
            continue;
          }
          const parsed = effectSchema.parse({
            id: newId('effect'),
            type: effect.type,
            amount: effect.amount,
          });
          commands.push({
            type: 'clip.addEffect',
            clipId: clip.id,
            effect: parsed,
          });
          existing.add(effect.type);
          added += 1;
        }
        if (added > 0) {
          appliedClipCount += 1;
          effectsAdded += added;
        }
      }
    }
    if (commands.length === 0) {
      return {
        appliedClipCount: 0,
        effectsAdded: 0,
        pacing: pacing(profile, snapshot.project.sequence),
      };
    }
    const result = context.applyBatch(commands, {
      label: 'Copy reference look',
    });
    return {
      commandId: result.command.id,
      appliedClipCount,
      effectsAdded,
      pacing: pacing(profile, snapshot.project.sequence),
      durationFrames: sequenceDurationFrames(result.snapshot.project.sequence),
    };
  },
};

export const REFERENCE_TOOLS = [
  useReferenceTool,
  profileReferenceTool,
  readReferenceTool,
  copyReferenceLookTool,
];
