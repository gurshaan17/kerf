import type { ChatVisualReview } from '../../shared/contracts';
import { useStudio } from '../state/StudioProvider';

export function VisualReviewCard({ review }: { review: ChatVisualReview }) {
  const seek = useStudio((state) => state.setPlayhead);
  const sequence = useStudio((state) => state.snapshot?.project.sequence);
  const clips = sequence?.tracks.flatMap((t) => t.clips) ?? [];
  const title =
    review.pass === 'recheck'
      ? 'Visual recheck'
      : review.pass === 'initial'
        ? 'Visual inspection'
        : review.status === 'repaired'
          ? 'Visual repairs applied'
          : 'Visual findings';
  const note =
    review.status === 'ready'
      ? review.pass === 'recheck'
        ? 'Rendered the same sampled frames after the repair.'
        : 'Rendered sampled frames for visual inspection.'
      : review.status === 'repaired'
        ? 'Applied one undoable repair batch. A sampled recheck follows.'
        : review.status === 'reviewed'
          ? 'Inspection recorded without changes.'
          : review.status === 'no-change'
            ? 'No changes applied: a proposed repair would not affect the object.'
            : review.note;
  return (
    <section
      className="grid gap-2 rounded-sm border border-line bg-surface-0 p-2 text-[11px] text-ink-muted"
      aria-label={title}
    >
      <p className="font-semibold text-ink">{title}</p>
      <p>{note}</p>
      {review.samplingTruncated && (
        <p>
          Some candidate frames were omitted to stay within the sampling limit.
        </p>
      )}
      {review.objectsTruncated && (
        <p>
          Some object metadata was omitted. Narrow the objects in a new review
          before making more changes.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {review.previews.map((preview) => (
          <button
            key={preview.frame}
            type="button"
            className="w-28 text-left text-accent"
            onClick={() => seek(preview.frame)}
          >
            <img
              src={preview.dataUrl}
              alt={`${title} at frame ${preview.frame}`}
              className="w-full rounded-sm"
            />
            Frame {preview.frame}
          </button>
        ))}
      </div>
      {review.findings.map((finding, index) => (
        <button
          key={index}
          type="button"
          className="text-left"
          onClick={() => seek(finding.frame)}
        >
          <span className="block font-semibold text-ink">
            {clips.find((c) => c.id === finding.clipId)?.label ||
              finding.clipId}{' '}
            · frame {finding.frame}
          </span>
          {review.pass === 'recheck' ? 'Initial observation: ' : ''}
          {finding.observation}
          {review.status === 'repaired' && finding.patch && (
            <span className="block">
              Repaired: {Object.keys(finding.patch).join(', ')} · undo available
            </span>
          )}
        </button>
      ))}
      {review.structuralFindings.map((finding, index) => (
        <button
          key={index}
          type="button"
          className="text-left"
          onClick={() => seek(finding.startFrame)}
        >
          {finding.severity}: {finding.message} · frame {finding.startFrame}
        </button>
      ))}
      <p className="text-[10px] text-ink-faint">{review.scope}</p>
    </section>
  );
}
