import { pathToFileURL } from 'node:url';
import type { Asset, Clip, Project, Sequence } from '@kerf/model';
import { fpsToNumber } from '@kerf/model';
import { sourceFrameAt } from '@kerf/engine';

type OtioObject = Record<string, unknown>;

function rationalTime(value: number, rate: number): OtioObject {
  return {
    OTIO_SCHEMA: 'RationalTime.1',
    value: Math.round(value * 1_000_000) / 1_000_000,
    rate,
  };
}

function timeRange(start: number, duration: number, rate: number): OtioObject {
  return {
    OTIO_SCHEMA: 'TimeRange.1',
    start_time: rationalTime(start, rate),
    duration: rationalTime(duration, rate),
  };
}

function clipRange(clip: Clip): OtioObject {
  return timeRange(0, clip.durationFrames, 1);
}

function sourceRange(
  clip: Clip,
  asset: Asset | undefined,
  sequence: Sequence,
): OtioObject | null {
  if (clip.type !== 'video' && clip.type !== 'audio') {
    return null;
  }
  const sequenceFps = fpsToNumber(sequence.frameRate);
  const assetFps = fpsToNumber(asset?.frameRate ?? sequence.frameRate);
  const sourceSeconds = Math.max(
    0,
    sourceFrameAt(clip, clip.startFrame) / assetFps,
  );
  return timeRange(
    sourceSeconds * sequenceFps,
    clip.durationFrames,
    sequenceFps,
  );
}

function mediaReference(
  asset: Asset | undefined,
  sequence: Sequence,
): OtioObject {
  if (!asset) {
    return { OTIO_SCHEMA: 'MissingReference.1' };
  }
  const sequenceFps = fpsToNumber(sequence.frameRate);
  return {
    OTIO_SCHEMA: 'ExternalReference.1',
    name: asset.name,
    target_url: pathToFileURL(asset.sourcePath).href,
    available_range: timeRange(
      0,
      Math.max(0, asset.durationSeconds * sequenceFps),
      sequenceFps,
    ),
    metadata: {
      kerf: {
        assetId: asset.id,
        kind: asset.kind,
        hasVideo: asset.hasVideo,
        hasAudio: asset.hasAudio,
      },
    },
  };
}

function otioClip(
  clip: Clip,
  asset: Asset | undefined,
  sequence: Sequence,
): OtioObject {
  return {
    OTIO_SCHEMA: 'Clip.1',
    name: clip.label || `${clip.type} ${clip.id.slice(-4)}`,
    source_range: sourceRange(clip, asset, sequence) ?? clipRange(clip),
    media_reference: mediaReference(asset, sequence),
    metadata: {
      kerf: {
        id: clip.id,
        trackId: clip.trackId,
        type: clip.type,
        blendMode: clip.blendMode,
        ...(clip.type === 'video' || clip.type === 'audio'
          ? {
              assetId: clip.assetId,
              speed: clip.speed,
              volume: clip.volume,
              fade: clip.fade,
            }
          : {}),
        ...(clip.type === 'text' ? { text: clip.text } : {}),
        ...(clip.type === 'caption' ? { text: clip.text } : {}),
        ...(clip.type === 'shape' ? { shape: clip.shape } : {}),
      },
    },
  };
}

function otioTrack(
  sequence: Sequence,
  track: Sequence['tracks'][number],
  assets: ReadonlyMap<string, Asset>,
): OtioObject {
  const children: OtioObject[] = [];
  let cursor = 0;
  const clips = [...track.clips].sort(
    (left, right) => left.startFrame - right.startFrame,
  );
  for (const clip of clips) {
    if (clip.startFrame > cursor) {
      children.push({
        OTIO_SCHEMA: 'Gap.1',
        name: 'Gap',
        source_range: timeRange(0, clip.startFrame - cursor, 1),
      });
    }
    children.push(
      otioClip(
        clip,
        'assetId' in clip ? assets.get(clip.assetId) : undefined,
        sequence,
      ),
    );
    cursor = Math.max(cursor, clip.startFrame + clip.durationFrames);
  }

  return {
    OTIO_SCHEMA: 'Track.1',
    name: track.name,
    kind: track.kind === 'audio' ? 'Audio' : 'Video',
    children,
    metadata: {
      kerf: {
        id: track.id,
        kind: track.kind,
        order: track.order,
        muted: track.muted,
        hidden: track.hidden,
        locked: track.locked,
      },
    },
  };
}

/**
 * Serializes the sequence into the OpenTimelineIO JSON interchange format.
 * Every track becomes an OTIO track with explicit gaps, so editorial timing
 * survives a round-trip into another NLE.
 */
export function buildOtioTimeline(
  project: Project,
  assets: readonly Asset[],
): OtioObject {
  const sequence = project.sequence;
  const fps = fpsToNumber(sequence.frameRate);
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const duration = Math.max(
    0,
    ...sequence.tracks.flatMap((track) =>
      track.clips.map((clip) => clip.startFrame + clip.durationFrames),
    ),
  );

  return {
    OTIO_SCHEMA: 'Timeline.1',
    name: sequence.name,
    global_start_time: null,
    metadata: {
      kerf: {
        projectId: project.id,
        projectName: project.name,
        width: sequence.width,
        height: sequence.height,
        frameRate: sequence.frameRate,
        durationFrames: duration,
      },
    },
    tracks: {
      OTIO_SCHEMA: 'Stack.1',
      name: 'Tracks',
      children: [...sequence.tracks]
        .sort((left, right) => left.order - right.order)
        .map((track) => otioTrack(sequence, track, assetsById)),
      metadata: {
        kerf: { sequenceId: sequence.id, fps },
      },
    },
    markers: sequence.markers.map((marker) => ({
      OTIO_SCHEMA: 'Marker.1',
      name: marker.label || marker.kind,
      color: marker.color,
      marked_range: timeRange(marker.frame, 1, fps),
      metadata: { kerf: { id: marker.id, kind: marker.kind } },
    })),
  };
}
