import { z } from 'zod';

export const ID_PREFIXES = {
  project: 'prj',
  sequence: 'seq',
  command: 'cmd',
  track: 'trk',
  clip: 'clp',
  asset: 'ast',
  marker: 'mrk',
  job: 'job',
  export: 'exp',
  reference: 'ref',
  transcript: 'tx',
  scene: 'scn',
  beat: 'beat',
  beatmap: 'bmap',
  section: 'sec',
  segment: 'seg',
  composition: 'cmp',
  effect: 'fx',
  mask: 'msk',
  keyframe: 'kf',
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

declare const idBrand: unique symbol;

export type Id<Kind extends IdKind> = string & {
  readonly [idBrand]: Kind;
};

export type ProjectId = Id<'project'>;
export type SequenceId = Id<'sequence'>;
export type CommandId = Id<'command'>;
export type TrackId = Id<'track'>;
export type ClipId = Id<'clip'>;
export type AssetId = Id<'asset'>;
export type MarkerId = Id<'marker'>;
export type JobId = Id<'job'>;
export type ExportId = Id<'export'>;
export type ReferenceId = Id<'reference'>;
export type TranscriptId = Id<'transcript'>;
export type SceneId = Id<'scene'>;
export type BeatId = Id<'beat'>;
export type BeatMapId = Id<'beatmap'>;
export type SectionId = Id<'section'>;
export type SegmentId = Id<'segment'>;
export type CompositionId = Id<'composition'>;
export type EffectId = Id<'effect'>;
export type MaskId = Id<'mask'>;
export type KeyframeId = Id<'keyframe'>;

const TOKEN_LENGTH = 12;

function token(): string {
  return globalThis.crypto
    .randomUUID()
    .replaceAll('-', '')
    .slice(0, TOKEN_LENGTH);
}

/**
 * Creates a prefixed, URL-safe identifier. The prefix makes logs and persisted
 * rows readable without a lookup table.
 */
export function newId<Kind extends IdKind>(kind: Kind): Id<Kind> {
  return `${ID_PREFIXES[kind]}_${token()}` as Id<Kind>;
}

export function idPattern(kind: IdKind): RegExp {
  return new RegExp(`^${ID_PREFIXES[kind]}_[a-z0-9]{${TOKEN_LENGTH}}$`);
}

export function isId<Kind extends IdKind>(
  value: string,
  kind: Kind,
): value is Id<Kind> {
  return idPattern(kind).test(value);
}

export function idSchema<Kind extends IdKind>(kind: Kind) {
  return z
    .string()
    .regex(idPattern(kind), `Expected a ${kind} identifier`)
    .transform((value) => value as Id<Kind>);
}
