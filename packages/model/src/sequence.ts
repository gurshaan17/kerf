import { z } from 'zod';
import { clipSchema } from './clips';
import { idSchema, newId } from './ids';
import { frameRateSchema, FRAME_RATES } from './time';
import { hexColorSchema } from './style';

export const trackKindSchema = z.enum(['video', 'audio', 'caption', 'overlay']);
export type TrackKind = z.infer<typeof trackKindSchema>;

/**
 * `order` is ascending from the top of the timeline. Video and overlay tracks
 * composite in ascending order, so a higher order draws over a lower one.
 */
export const trackSchema = z.object({
  id: idSchema('track'),
  name: z.string().min(1),
  kind: trackKindSchema,
  order: z.number().int().nonnegative(),
  locked: z.boolean().default(false),
  muted: z.boolean().default(false),
  hidden: z.boolean().default(false),
  height: z.number().int().min(32).max(160).default(54),
  clips: z.array(clipSchema).default([]),
});

export type Track = z.infer<typeof trackSchema>;

export const markerKindSchema = z.enum(['marker', 'chapter', 'beat']);
export type MarkerKind = z.infer<typeof markerKindSchema>;

export const markerSchema = z.object({
  id: idSchema('marker'),
  frame: z.number().int().nonnegative(),
  label: z.string().default(''),
  kind: markerKindSchema.default('marker'),
  color: hexColorSchema.default('#c9a46a'),
});

export type Marker = z.infer<typeof markerSchema>;

export const sequenceSchema = z.object({
  id: idSchema('sequence'),
  name: z.string().min(1),
  frameRate: frameRateSchema,
  width: z.number().int().min(16).max(16_384).default(1920),
  height: z.number().int().min(16).max(16_384).default(1080),
  durationFrames: z.number().int().nonnegative().default(0),
  tracks: z.array(trackSchema).default([]),
  markers: z.array(markerSchema).default([]),
});

export type Sequence = z.infer<typeof sequenceSchema>;

export interface CreateTrackInput {
  kind: TrackKind;
  name?: string;
  order?: number;
  locked?: boolean;
  muted?: boolean;
  hidden?: boolean;
  height?: number;
}

export function createTrack(input: CreateTrackInput): Track {
  return trackSchema.parse({
    id: newId('track'),
    name: input.name ?? defaultTrackName(input.kind),
    kind: input.kind,
    order: input.order ?? 0,
    locked: input.locked,
    muted: input.muted,
    hidden: input.hidden,
    height: input.height,
  });
}

function defaultTrackName(kind: TrackKind): string {
  switch (kind) {
    case 'video':
      return 'Video 1';
    case 'audio':
      return 'Audio 1';
    case 'caption':
      return 'Captions';
    case 'overlay':
      return 'Overlay';
  }
}

export interface CreateMarkerInput {
  frame: number;
  label?: string;
  kind?: MarkerKind;
  color?: string;
}

export function createMarker(input: CreateMarkerInput): Marker {
  return markerSchema.parse({
    id: newId('marker'),
    frame: input.frame,
    label: input.label ?? '',
    kind: input.kind,
    color: input.color,
  });
}

export interface CreateSequenceInput {
  name: string;
  width?: number;
  height?: number;
  frameRate?: z.input<typeof frameRateSchema>;
  tracks?: Track[];
}

export function createSequence(input: CreateSequenceInput): Sequence {
  return sequenceSchema.parse({
    id: newId('sequence'),
    name: input.name,
    frameRate: input.frameRate ?? FRAME_RATES.film,
    width: input.width,
    height: input.height,
    tracks: input.tracks ?? [
      createTrack({ kind: 'video', name: 'Video 1', order: 0 }),
      createTrack({ kind: 'audio', name: 'Audio 1', order: 1 }),
      createTrack({ kind: 'audio', name: 'Audio 2', order: 2 }),
    ],
  });
}
