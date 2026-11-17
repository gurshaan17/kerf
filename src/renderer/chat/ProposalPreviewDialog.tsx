import { useEffect, useRef, useState } from 'react';
import { Button, Dialog } from '@kerf/ui';
import type { EditingReview } from '@kerf/tools';
import type { ProposalPreview } from '../../shared/proposal-preview';
import { proposalPreviewRevision } from '../../shared/proposal-preview';
import { useStudio } from '../state/StudioProvider';
import { IsolatedPreview } from '../preview/IsolatedPreview';

export function ProposalPreviewDialog({
  review,
  changeIds,
  onClose,
}: {
  review: EditingReview;
  changeIds: readonly string[];
  onClose: () => void;
}) {
  const snapshot = useStudio((s) => s.snapshot);
  const trees = useStudio((s) => s.compositionTrees);
  const stopLivePlayback = useStudio((s) => s.setPlaying);
  const [candidate, setCandidate] = useState<ProposalPreview | null>(null);
  const [error, setError] = useState('');
  const revision = snapshot ? proposalPreviewRevision(snapshot) : '';
  const key = JSON.stringify([
    review.job.projectId,
    review.job.id,
    review.proposal?.fingerprint,
    review.job.reviewStatus,
    review.eligibility?.eligible,
    changeIds,
    revision,
  ]);
  const initialKey = useRef(key);
  const valid = key === initialKey.current && review.eligibility?.eligible;

  useEffect(() => {
    let active = true;
    stopLivePlayback(false);
    if (key !== initialKey.current || !review.eligibility?.eligible) {
      setCandidate(null);
      setError(
        'The selection, project or source changed. Close this preview and review the current proposal.',
      );
      return;
    }
    void window.kerf
      .editing!.preview({ jobId: review.job.id, changeIds })
      .then((result) => {
        if (!active) return;
        if (result.revisionKey !== revision || result.expiresAt <= Date.now()) {
          setError(
            'The project changed before preview was ready. Close this preview and try again.',
          );
          return;
        }
        setCandidate(result);
      })
      .catch((cause) => {
        if (active)
          setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      active = false;
    };
  }, [key, stopLivePlayback]);

  useEffect(() => {
    if (!candidate) return;
    const expire = () => {
      if (Date.now() >= candidate.expiresAt) {
        setCandidate(null);
        setError(
          'This preview expired. Close it and preview the current proposal again.',
        );
      }
    };
    const timer = setTimeout(
      expire,
      Math.max(0, candidate.expiresAt - Date.now()),
    );
    document.addEventListener('visibilitychange', expire);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', expire);
    };
  }, [candidate]);

  return (
    <div onKeyDown={(event) => event.stopPropagation()}>
      <Dialog
        open
        title="Rough-cut proposal preview"
        description="Audition the selected cut before applying it."
        size="workspace"
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        footer={<Button onClick={onClose}>Close preview</Button>}
      >
        <p className="mb-3 text-[12px] text-ink-muted">
          Proposal · {changeIds.length} selected{' '}
          {changeIds.length === 1 ? 'range' : 'ranges'} · Not applied. Starts at
          the proposed cut; earlier timeline content is available with the
          scrubber.
        </p>
        {error && (
          <p role="alert" className="text-[12px] text-danger">
            {error}
          </p>
        )}
        {!error && !candidate && (
          <p role="status" className="text-[12px] text-ink-muted">
            Preparing local preview…
          </p>
        )}
        {candidate && valid && candidate.expiresAt > Date.now() && (
          <div
            className="h-[55vh] min-h-[240px]"
            aria-label="Proposal playback"
          >
            <IsolatedPreview
              snapshot={candidate.snapshot}
              sequence={candidate.snapshot.project.sequence}
              frame={candidate.startFrame}
              compositionTrees={trees}
            />
          </div>
        )}
      </Dialog>
    </div>
  );
}
