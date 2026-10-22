import type { Asset, Sequence } from '@kerf/model';
import { fpsToNumber } from '@kerf/model';
import { sourceFrameAt } from '@kerf/engine';

export interface ExportAudioClip {
  readonly path: string;
  readonly sourceStartSeconds: number;
  readonly sourceDurationSeconds: number;
  readonly delaySeconds: number;
  readonly timelineDurationSeconds: number;
  readonly speed: number;
  readonly reversed: boolean;
  readonly volume: number;
  readonly fadeInSeconds: number;
  readonly fadeOutSeconds: number;
}

function mediaRate(asset: Asset | undefined, sequence: Sequence): number {
  return fpsToNumber(asset?.frameRate ?? sequence.frameRate);
}

/**
 * Flattens every audible media clip in the export window into deterministic
 * ffmpeg inputs. Video clips contribute their source audio unless the track is
 * muted, matching the preview monitor.
 */
export function buildExportAudioPlan(
  sequence: Sequence,
  assets: readonly Asset[],
  startFrame: number,
  endFrame: number,
): ExportAudioClip[] {
  const sequenceFps = fpsToNumber(sequence.frameRate);
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const clips: ExportAudioClip[] = [];

  for (const track of sequence.tracks) {
    if (track.muted || (track.kind !== 'audio' && track.kind !== 'video')) {
      continue;
    }
    for (const clip of track.clips) {
      if (clip.type !== 'audio' && clip.type !== 'video') {
        continue;
      }
      const asset = assetsById.get(clip.assetId);
      if (!asset || !asset.hasAudio || !asset.sourcePath) {
        continue;
      }

      const clipStart = Math.max(clip.startFrame, startFrame);
      const clipEnd = Math.min(clip.startFrame + clip.durationFrames, endFrame);
      if (clipEnd <= clipStart) {
        continue;
      }

      const rate = mediaRate(asset, sequence);
      const sourceA = Math.max(0, sourceFrameAt(clip, clipStart) / rate);
      const sourceB = Math.min(
        Math.max(0, asset.durationSeconds || Number.POSITIVE_INFINITY),
        Math.max(0, sourceFrameAt(clip, clipEnd) / rate),
      );
      const sourceStart = Math.min(sourceA, sourceB);
      const sourceDuration = Math.abs(sourceB - sourceA);
      const timelineDuration = (clipEnd - clipStart) / sequenceFps;
      if (sourceDuration <= 0.001 || timelineDuration <= 0.001) {
        continue;
      }

      const includesClipStart = clipStart === clip.startFrame;
      const includesClipEnd = clipEnd === clip.startFrame + clip.durationFrames;
      clips.push({
        path: asset.sourcePath,
        sourceStartSeconds: sourceStart,
        sourceDurationSeconds: sourceDuration,
        delaySeconds: (clipStart - startFrame) / sequenceFps,
        timelineDurationSeconds: timelineDuration,
        speed: sourceDuration / timelineDuration,
        reversed: sourceB < sourceA,
        volume: Math.max(0, Math.min(4, clip.volume)),
        fadeInSeconds: includesClipStart
          ? Math.min(clip.fade.inFrames, clip.durationFrames) / sequenceFps
          : 0,
        fadeOutSeconds: includesClipEnd
          ? Math.min(clip.fade.outFrames, clip.durationFrames) / sequenceFps
          : 0,
      });
    }
  }

  return clips.sort(
    (left, right) =>
      left.delaySeconds - right.delaySeconds ||
      left.path.localeCompare(right.path),
  );
}
