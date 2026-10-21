import type { Clip, ClipType, Track, TrackKind } from '@kerf/model';
import { EngineError } from './errors';

export const CLIP_TYPES_BY_TRACK_KIND = {
  video: ['video', 'image', 'text', 'shape', 'composition'],
  audio: ['audio'],
  caption: ['caption'],
  overlay: ['video', 'image', 'text', 'caption', 'shape', 'composition'],
} as const satisfies Record<TrackKind, readonly ClipType[]>;

export function allowedClipTypes(kind: TrackKind): readonly ClipType[] {
  return CLIP_TYPES_BY_TRACK_KIND[kind];
}

export function isClipCompatible(kind: TrackKind, clipType: ClipType): boolean {
  return (allowedClipTypes(kind) as readonly ClipType[]).includes(clipType);
}

export function compatibleTrackKinds(clipType: ClipType): TrackKind[] {
  return (Object.keys(CLIP_TYPES_BY_TRACK_KIND) as TrackKind[]).filter((kind) =>
    isClipCompatible(kind, clipType),
  );
}

export function trackKindLabel(kind: TrackKind): string {
  switch (kind) {
    case 'video':
      return 'video';
    case 'audio':
      return 'audio';
    case 'caption':
      return 'caption';
    case 'overlay':
      return 'overlay';
  }
}

export function assertClipCompatible(track: Track, clip: Clip): void {
  if (isClipCompatible(track.kind, clip.type)) {
    return;
  }

  throw new EngineError(
    'incompatible-track',
    `A ${clip.type} clip cannot live on the ${trackKindLabel(
      track.kind,
    )} track "${track.name}".`,
    `Move it to a ${compatibleTrackKinds(clip.type)
      .map(trackKindLabel)
      .join(' or ')} track.`,
  );
}
