import { autoCutContext } from '@kerf/engine';
import { fpsToNumber } from '@kerf/model';
import type { EditingReview } from '@kerf/tools';
import type { ProjectSnapshot, ProviderAccount } from '../../shared/contracts';

export type ChatStarter = {
  kind: 'import' | 'analyze' | 'review' | 'refine';
  label: string;
  message?: string;
  jobId?: string;
};
export function chatStarters(
  snapshot: ProjectSnapshot | null,
  selectedIds: readonly string[],
  provider: ProviderAccount | null | undefined,
  reviews: readonly EditingReview[],
): ChatStarter[] {
  if (!snapshot) return [];
  if (
    !snapshot.assets.length &&
    !snapshot.project.sequence.tracks.some((t) => t.clips.length)
  )
    return [{ kind: 'import', label: 'Import footage' }];
  const result: ChatStarter[] = [];
  const review = reviews.find(
    (r) =>
      r.proposal &&
      r.job.status === 'succeeded' &&
      !['applied', 'cancelled'].includes(r.job.reviewStatus),
  );
  if (review)
    result.push({
      kind: 'review',
      label: 'Review completed analysis',
      jobId: review.job.id,
    });
  if (!provider?.enabled || !provider.chatConsent) return result;
  const clips = snapshot.project.sequence.tracks.flatMap((t) => t.clips);
  if (selectedIds.length === 1 && provider.visionConsent) {
    const clip = clips.find((c) => c.id === selectedIds[0]);
    const asset =
      clip && 'assetId' in clip
        ? snapshot.assets.find((a) => a.id === clip.assetId)
        : null;
    const running = snapshot.jobs.some(
      (j) =>
        ['analysis.autoCut', 'analysis.screenPolish'].includes(j.kind) &&
        ['queued', 'running'].includes(j.status),
    );
    if (
      clip?.type === 'video' &&
      asset?.status === 'ready' &&
      asset.hasVideo &&
      clip.durationFrames / fpsToNumber(snapshot.project.sequence.frameRate) <=
        300 &&
      (!asset.hasAudio ||
        snapshot.transcripts.some(
          (t) => t.assetId === asset.id && t.source === 'speech',
        )) &&
      !running
    ) {
      try {
        autoCutContext(snapshot.project.sequence, clip.id);
        result.push({
          kind: 'analyze',
          label: 'Analyze selected footage',
          message:
            'Analyze the selected footage for an Auto cut proposal. Keep the main action and prepare it for review without applying it.',
        });
      } catch {
        /* Unsupported speed, effects or selection: offer no action. */
      }
    }
  }
  if (clips.length)
    result.push({
      kind: 'refine',
      label: 'Refine the existing cut',
      message:
        'Inspect the current cut and suggest one concrete improvement before editing.',
    });
  return result.slice(0, 3);
}
