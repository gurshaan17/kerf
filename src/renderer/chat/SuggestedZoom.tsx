import { useState } from 'react';
import { Button } from '@kerf/ui';
import type { EditingReview } from '@kerf/tools';
import { ProposalPreviewDialog } from './ProposalPreviewDialog';

export function SuggestedZoom({ review }: { readonly review: EditingReview }) {
  const [open, setOpen] = useState(false);
  const [applied, setApplied] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const change = review.proposal?.changes[0];
  const editing = window.kerf.editing;
  if (
    !change ||
    !editing ||
    dismissed ||
    review.job.reviewStatus === 'cancelled'
  )
    return null;
  if (applied || review.job.reviewStatus === 'applied')
    return (
      <p role="status" className="text-[11px] text-ink-muted">
        Zoom applied
      </p>
    );
  const changeIds = [change.id];
  return (
    <div>
      {review.eligibility?.eligible && (
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          Preview zoom
        </Button>
      )}
      {open && (
        <ProposalPreviewDialog
          review={review}
          changeIds={changeIds}
          onClose={() => setOpen(false)}
          onDecision={async (decision) => {
            if (decision === 'apply') {
              await editing.confirm({ jobId: review.job.id, changeIds });
              setApplied(true);
            } else {
              await editing.cancel(review.job.id);
              setDismissed(true);
            }
          }}
        />
      )}
    </div>
  );
}
