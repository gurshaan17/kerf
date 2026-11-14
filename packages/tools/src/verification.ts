import { z } from 'zod';
import { clipSourceRange, sequenceDurationFrames } from '@kerf/engine';
import { secondsToFrames } from '@kerf/model';
import type { ToolContext, ToolSnapshot } from './types';

export interface TimelineFinding {
  readonly code: 'missing-asset' | 'source-bounds' | 'gap' | 'overlap';
  readonly severity: 'error' | 'info';
  readonly message: string;
  readonly clipId?: string;
  readonly startFrame: number;
  readonly endFrame: number;
}

export function verifyTimeline(snapshot: ToolSnapshot) {
  const sequence = snapshot.project.sequence;
  const findings: TimelineFinding[] = [];
  for (const track of sequence.tracks) {
    let end = 0;
    for (const clip of [...track.clips].sort(
      (a, b) => a.startFrame - b.startFrame,
    )) {
      const range = {
        startFrame: clip.startFrame,
        endFrame: clip.startFrame + clip.durationFrames,
      };
      if (clip.startFrame > end)
        findings.push({
          code: 'gap',
          severity: 'info',
          message: `Empty span on ${track.name}; may be intentional.`,
          startFrame: end,
          endFrame: clip.startFrame,
        });
      if (clip.startFrame < end)
        findings.push({
          code: 'overlap',
          severity: 'info',
          message: `Overlap on ${track.name}; may be intentional.`,
          clipId: clip.id,
          startFrame: clip.startFrame,
          endFrame: Math.min(end, range.endFrame),
        });
      end = Math.max(end, range.endFrame);
      if (!('assetId' in clip)) continue;
      const asset = snapshot.assets.find((a) => a.id === clip.assetId);
      if (!asset) {
        findings.push({
          code: 'missing-asset',
          severity: 'error',
          message: 'Referenced asset is missing.',
          clipId: clip.id,
          ...range,
        });
      } else if (clip.type === 'video' || clip.type === 'audio') {
        const source = clipSourceRange(clip);
        const points = clip.timeMap.map((p) => p.sourceFrame);
        const min = Math.min(source.startFrame, ...points);
        const max = Math.max(source.endFrame, ...points);
        const limit = secondsToFrames(
          asset.durationSeconds,
          sequence.frameRate,
        );
        if (min < 0 || max > limit)
          findings.push({
            code: 'source-bounds',
            severity: 'error',
            message: 'Clip exceeds available source frames.',
            clipId: clip.id,
            ...range,
          });
      }
    }
  }
  return {
    projectId: snapshot.project.id,
    durationFrames: sequenceDurationFrames(sequence),
    valid: !findings.some((f) => f.severity === 'error'),
    findings,
    scope:
      'Structural checks only; gaps and overlaps may be intentional. Visual quality and audio are not verified.',
  };
}

export const verifyTimelineTool = {
  name: 'verifyTimeline',
  description:
    'Check missing asset references, source bounds, and informational track gaps/overlaps. Does not verify visual or audio quality.',
  input: z.object({}).default({}),
  readOnly: true,
  execute(context: ToolContext) {
    const snapshot = context.snapshot();
    if (!snapshot)
      throw new Error('Open a project before verifying the timeline.');
    return verifyTimeline(snapshot);
  },
};
