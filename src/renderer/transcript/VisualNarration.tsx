import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Dialog, Input, Textarea } from '@kerf/ui';
import {
  fpsToNumber,
  secondsToFrames,
  type Asset,
  type FrameRate,
  type Transcript,
  type TranscriptSegment,
  type NarrationEdit,
} from '@kerf/model';
import type { ProviderAccount, ProjectSnapshot } from '../../shared/contracts';
import { useStudio, useStudioStoreApi } from '../state/StudioProvider';

export function VisualNarrationDialog({
  open,
  onClose,
  asset,
  onQueued,
}: {
  open: boolean;
  onClose: () => void;
  asset: Asset;
  onQueued: () => void;
}) {
  const snapshot = useStudio((s) => s.snapshot);
  const transcript = snapshot?.transcripts.find((t) => t.assetId === asset.id);
  const [providers, setProviders] = useState<ProviderAccount[]>([]);
  const [providerId, setProviderId] = useState('');
  const [start, setStart] = useState('0');
  const [end, setEnd] = useState(String(Math.min(asset.durationSeconds, 1200)));
  const [replaceEdited, setReplaceEdited] = useState(false);
  const [replaceEmptySpeech, setReplaceEmptySpeech] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const rate = asset.frameRate ??
    snapshot?.project.sequence.frameRate ?? { numerator: 24, denominator: 1 };
  useEffect(() => {
    if (open) {
      setError('');
      setReplaceEdited(false);
      setReplaceEmptySpeech(false);
      setProviderId('');
      setStart('0');
      setEnd(String(Math.min(asset.durationSeconds, 1200)));
      void window.kerf.analysis
        .providers()
        .then(setProviders)
        .catch((e) => setError(String(e)));
    }
  }, [open, asset.id, asset.durationSeconds]);
  const first = secondsToFrames(Number(start), rate),
    last = secondsToFrames(Number(end), rate);
  const edited =
    transcript?.segments.filter(
      (s) =>
        s.origin === 'edited' && s.startFrame >= first && s.endFrame <= last,
    ).length ?? 0;
  const manual =
    transcript?.segments.filter((s) => s.origin === 'manual').length ?? 0;
  const speech = transcript && transcript.source !== 'visual';
  const nonemptySpeech = Boolean(
    speech &&
    (transcript.text.trim() || transcript.segments.some((s) => s.text.trim())),
  );
  const valid =
    Number.isFinite(Number(start)) &&
    Number.isFinite(Number(end)) &&
    Number(start) >= 0 &&
    Number(end) > Number(start) &&
    Number(end) <= asset.durationSeconds &&
    Number(end) - Number(start) <= 1200;
  const generate = async () => {
    setPending(true);
    setError('');
    try {
      await window.kerf.narration.generate({
        assetId: asset.id,
        providerId,
        expectedRevision: transcript?.revision ?? null,
        startFrame: first,
        endFrame: last,
        replaceEdited,
        replaceEmptySpeech,
      });
      onQueued();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value && !pending) onClose();
      }}
      title="Generate visual narration"
      description="Create an editable AI draft from visible actions. Review its timing and wording before using it."
    >
      <div className="grid gap-3 p-4 text-xs">
        <label>
          Vision provider
          <select
            aria-label="Narration provider"
            value={providerId}
            onChange={(e) => setProviderId(e.target.value)}
            className="mt-1 block w-full rounded border border-line bg-surface-2 p-2"
          >
            <option value="">Choose a provider</option>
            {providers
              .filter((p) => p.enabled && p.visionConsent)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} · {p.model}
                </option>
              ))}
          </select>
        </label>
        {!providers.some((p) => p.enabled && p.visionConsent) && (
          <p>
            Enable a vision provider and allow image analysis in Analysis
            settings.
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <label>
            Start (seconds)
            <Input
              aria-label="Narration range start"
              type="number"
              min={0}
              step="0.1"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label>
            End (seconds)
            <Input
              aria-label="Narration range end"
              type="number"
              min={0}
              step="0.1"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
        </div>
        <p>
          Up to{' '}
          {valid
            ? Math.min(600, Math.ceil((Number(end) - Number(start)) * 4))
            : 600}{' '}
          unique frames, plus repeated boundary frames, may be sent to this
          provider. Provider charges may apply. Final sampling counts appear in
          job progress.
        </p>
        {transcript?.source === 'visual' && (
          <>
            <p>
              Generated rows in this range will be replaced. {edited} edited
              rows and {manual} manual rows are kept by default. Rows crossing
              the range boundary are kept.
            </p>
            <label className="flex gap-2">
              <input
                type="checkbox"
                checked={replaceEdited}
                onChange={(e) => setReplaceEdited(e.target.checked)}
              />
              Replace {edited} edited rows in this range. Manual rows stay.
            </label>
          </>
        )}
        {nonemptySpeech && (
          <p role="alert">
            This asset has a speech transcript. Visual narration cannot replace
            nonempty speech.
          </p>
        )}
        {speech && !nonemptySpeech && (
          <label className="flex gap-2">
            <input
              type="checkbox"
              checked={replaceEmptySpeech}
              onChange={(e) => setReplaceEmptySpeech(e.target.checked)}
            />
            Replace the empty speech result after successful generation.
          </label>
        )}
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
        <Button
          disabled={
            pending ||
            !providerId ||
            !valid ||
            nonemptySpeech ||
            Boolean(speech && !replaceEmptySpeech)
          }
          onClick={() => void generate()}
        >
          {pending ? 'Queueing…' : 'Send frames and generate draft'}
        </Button>
      </div>
    </Dialog>
  );
}

export function VisualNarrationJob({ assetId }: { assetId: string }) {
  const job = useStudio((s) =>
    s.snapshot?.jobs.find(
      (j) => j.kind === 'analysis.visualNarration' && j.targetId === assetId,
    ),
  );
  const pushToast = useStudio((s) => s.pushToast);
  if (!job) return null;
  const active = job.status === 'queued' || job.status === 'running';
  return (
    <div role="status" className="border-b border-line p-2 text-xs">
      {job.stage || job.status} · {Math.round(job.progress * 100)}%{' '}
      {job.error && <span className="text-danger">{job.error}</span>}
      {active && (
        <Button
          size="sm"
          onClick={() =>
            void window.kerf.jobs.cancel(job.id).catch((e) =>
              pushToast({
                title: 'Could not cancel',
                description: String(e),
                tone: 'error',
              }),
            )
          }
        >
          Cancel generation
        </Button>
      )}
    </div>
  );
}

function NarrationRow({
  row,
  rate,
  selected,
  onSelect,
  disabled,
  save,
  seek,
  currentFrame,
  onDirty,
}: {
  row: TranscriptSegment;
  rate: FrameRate;
  selected: boolean;
  onSelect: () => void;
  disabled: boolean;
  save: (fields: RowAction) => Promise<void>;
  seek: (frame: number) => void;
  currentFrame: number;
  onDirty: (id: string, dirty: boolean) => void;
}) {
  const fps = fpsToNumber(rate);
  const [text, setText] = useState(row.text);
  const [start, setStart] = useState(String(row.startFrame / fps));
  const [end, setEnd] = useState(String(row.endFrame / fps));
  const savedText = useRef(row.text);
  const savedTiming = useRef({
    start: String(row.startFrame / fps),
    end: String(row.endFrame / fps),
  });
  useEffect(() => {
    const previous = savedText.current;
    setText((current) => (current === previous ? row.text : current));
    savedText.current = row.text;
  }, [row.text]);
  useEffect(() => {
    const previous = savedTiming.current;
    setStart((current) =>
      current === previous.start ? String(row.startFrame / fps) : current,
    );
    setEnd((current) =>
      current === previous.end ? String(row.endFrame / fps) : current,
    );
    savedTiming.current = {
      start: String(row.startFrame / fps),
      end: String(row.endFrame / fps),
    };
  }, [row.startFrame, row.endFrame, fps]);
  const dirty =
    text !== row.text ||
    start.trim() === '' ||
    end.trim() === '' ||
    secondsToFrames(Number(start), rate) !== row.startFrame ||
    secondsToFrames(Number(end), rate) !== row.endFrame;
  useEffect(() => onDirty(row.id, dirty), [row.id, dirty, onDirty]);
  useEffect(() => () => onDirty(row.id, false), [row.id, onDirty]);
  return (
    <li
      className="grid gap-2 rounded border border-line p-2"
      data-narration-row={row.id}
    >
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          aria-label={`Select narration ${row.id}`}
          checked={selected}
          onChange={onSelect}
        />
        <button className="text-accent" onClick={() => seek(row.startFrame)}>
          Play {(row.startFrame / fps).toFixed(2)}s
        </button>
        <span className="text-ink-faint">{row.origin}</span>
        {row.evidenceFrames.length > 0 && (
          <button onClick={() => seek(row.evidenceFrames[0]!)}>
            View evidence ({row.evidenceFrames.length})
          </button>
        )}
      </div>
      {row.evidenceFrames.length > 0 && (
        <details className="text-ink-muted">
          <summary>Evidence timestamps</summary>
          <div className="flex flex-wrap gap-2">
            {[...new Set(row.evidenceFrames)].map((frame) => (
              <button key={frame} onClick={() => seek(frame)}>
                {(frame / fps).toFixed(2)}s
              </button>
            ))}
          </div>
        </details>
      )}
      <Textarea
        aria-label="Narration text"
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex gap-2">
        <label>
          Start (s)
          <Input
            aria-label="Row start seconds"
            type="number"
            step="0.1"
            value={start}
            disabled={disabled}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label>
          End (s)
          <Input
            aria-label="Row end seconds"
            type="number"
            step="0.1"
            value={end}
            disabled={disabled}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          disabled={disabled || !text.trim() || text === row.text}
          onClick={() =>
            void save({ type: 'updateText', segmentId: row.id, text })
          }
        >
          Save text
        </Button>
        <Button
          size="sm"
          disabled={
            disabled ||
            !Number.isFinite(Number(start)) ||
            !Number.isFinite(Number(end))
          }
          onClick={() =>
            void save({
              type: 'setTiming',
              segmentId: row.id,
              startFrame: secondsToFrames(Number(start), rate),
              endFrame: secondsToFrames(Number(end), rate),
            })
          }
        >
          Set timing
        </Button>
        <Button
          size="sm"
          disabled={
            disabled ||
            dirty ||
            currentFrame <= row.startFrame ||
            currentFrame >= row.endFrame
          }
          onClick={() =>
            void save({
              type: 'split',
              segmentId: row.id,
              splitFrame: currentFrame,
            })
          }
        >
          Split at playhead
        </Button>
        <Button
          size="sm"
          disabled={disabled}
          onClick={() => void save({ type: 'delete', segmentId: row.id })}
        >
          Delete
        </Button>
      </div>
    </li>
  );
}

type RowAction = NarrationEdit extends infer T
  ? T extends NarrationEdit
    ? Omit<T, 'transcriptId' | 'expectedRevision'>
    : never
  : never;
export function VisualNarrationEditor({
  transcript,
  asset,
  rate,
  currentFrame,
  seek,
}: {
  transcript: Transcript;
  asset: Asset;
  rate: FrameRate;
  currentFrame: number;
  seek: (frame: number) => void;
}) {
  const store = useStudioStoreApi();
  const [requestPending, setPending] = useState(false);
  const generationActive = useStudio(
    (s) =>
      s.snapshot?.jobs.some(
        (job) =>
          job.kind === 'analysis.visualNarration' &&
          job.targetId === asset.id &&
          (job.status === 'queued' || job.status === 'running'),
      ) ?? false,
  );
  const pending = requestPending || generationActive;
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<TranscriptSegment['id'][]>([]);
  const [generate, setGenerate] = useState(false);
  const [captionPreview, setCaptionPreview] = useState<{
    existing: number;
    proposed: number;
    revision: number;
  } | null>(null);
  const [manualText, setManualText] = useState('');
  const [dirtyRows, setDirtyRows] = useState<Record<string, boolean>>({});
  const onDirty = useCallback(
    (id: string, dirty: boolean) =>
      setDirtyRows((previous) =>
        previous[id] === dirty ? previous : { ...previous, [id]: dirty },
      ),
    [],
  );
  const unsaved =
    Boolean(manualText.trim()) ||
    transcript.segments.some((row) => dirtyRows[row.id]);
  const perform = async (action: RowAction) => {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      const request = {
        ...action,
        transcriptId: transcript.id,
        expectedRevision: transcript.revision,
      };
      // Dispatch to a fixed, narrow bridge operation. Main validates the payload again.
      let next: ProjectSnapshot;
      switch (request.type) {
        case 'updateText':
          next = await window.kerf.narration.updateText(request);
          break;
        case 'setTiming':
          next = await window.kerf.narration.setTiming(request);
          break;
        case 'split':
          next = await window.kerf.narration.split(request);
          break;
        case 'merge':
          next = await window.kerf.narration.merge(request);
          break;
        case 'add':
          next = await window.kerf.narration.add(request);
          break;
        case 'delete':
          next = await window.kerf.narration.delete(request);
          break;
        case 'undo':
          next = await window.kerf.narration.undo(request);
          break;
        case 'redo':
          next = await window.kerf.narration.redo(request);
          break;
        case 'review':
          next = await window.kerf.narration.review(request);
          break;
      }
      store.getState().handleEvent({
        type: 'project.changed',
        snapshot: next,
        reason: 'analysis',
      });
      setSelected([]);
      setCaptionPreview(null);
      if (action.type === 'add') setManualText('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      const fresh = await window.kerf.projects.active().catch(() => null);
      if (fresh)
        store.getState().handleEvent({
          type: 'project.changed',
          snapshot: fresh,
          reason: 'analysis',
        });
    } finally {
      setPending(false);
    }
  };
  const captions = async (confirm: boolean) => {
    setPending(true);
    setError('');
    try {
      const revision = confirm ? captionPreview!.revision : transcript.revision;
      const result = await window.kerf.narration.captions({
        transcriptId: transcript.id,
        expectedRevision: revision,
        confirm,
      });
      setCaptionPreview(confirm ? null : { ...result, revision });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };
  const end = secondsToFrames(asset.durationSeconds, rate);
  return (
    <div className="min-h-0 flex-1 overflow-auto p-3 text-xs">
      <p className="mb-2">
        Visual narration ·{' '}
        {transcript.status === 'draft'
          ? 'AI draft — review timing'
          : 'Reviewed'}{' '}
        · {transcript.segments.length} rows
      </p>
      {transcript.model && (
        <p className="mb-2 text-ink-faint">
          Last generated with {transcript.model}
        </p>
      )}
      <p className="mb-3 text-ink-muted">
        Evidence shows sampled frames. Narration ranges are inferred and may
        need adjustment. Caption clips change only when you explicitly update
        them.
      </p>
      <div className="mb-3 flex flex-wrap gap-1">
        <Button
          size="sm"
          disabled={pending || unsaved || !transcript.undoStates.length}
          onClick={() => void perform({ type: 'undo' })}
        >
          Undo narration
        </Button>
        <Button
          size="sm"
          disabled={pending || unsaved || !transcript.redoStates.length}
          onClick={() => void perform({ type: 'redo' })}
        >
          Redo narration
        </Button>
        <Button
          size="sm"
          disabled={pending || unsaved || selected.length < 2}
          onClick={() => void perform({ type: 'merge', segmentIds: selected })}
        >
          Merge selected
        </Button>
        <Button
          size="sm"
          disabled={pending || unsaved}
          onClick={() => setGenerate(true)}
        >
          Regenerate range
        </Button>
        <Button
          size="sm"
          disabled={pending || unsaved || transcript.status === 'reviewed'}
          onClick={() => void perform({ type: 'review' })}
        >
          Mark reviewed
        </Button>
        <Button
          size="sm"
          disabled={
            pending ||
            unsaved ||
            !transcript.segments.length ||
            transcript.status !== 'reviewed'
          }
          onClick={() => void captions(false)}
        >
          Create / update captions
        </Button>
      </div>
      {unsaved && (
        <p className="mb-2 text-ink-muted">
          Save or clear unsaved changes before reviewing, regenerating or
          updating captions.
        </p>
      )}
      {captionPreview && (
        <div className="mb-3 border border-line p-2" role="alert">
          <p>
            Create {captionPreview.proposed} captions and replace{' '}
            {captionPreview.existing} linked generated clips. Edits to those
            clips will be replaced. Other caption clips stay.
          </p>
          <Button
            size="sm"
            disabled={pending || unsaved}
            onClick={() => void captions(true)}
          >
            Confirm caption update
          </Button>
          <Button
            size="sm"
            disabled={pending}
            onClick={() => setCaptionPreview(null)}
          >
            Cancel
          </Button>
        </div>
      )}
      {error && (
        <p className="mb-2 text-danger" role="alert">
          {error}
        </p>
      )}
      <ol className="grid gap-2">
        {transcript.segments.map((row) => (
          <NarrationRow
            key={row.id}
            row={row}
            rate={rate}
            currentFrame={currentFrame}
            selected={selected.includes(row.id)}
            onSelect={() =>
              setSelected((ids) =>
                ids.includes(row.id)
                  ? ids.filter((id) => id !== row.id)
                  : [...ids, row.id],
              )
            }
            disabled={pending}
            save={perform}
            seek={seek}
            onDirty={onDirty}
          />
        ))}
      </ol>
      <div className="mt-3 grid gap-2">
        <Textarea
          aria-label="New manual narration"
          disabled={pending}
          placeholder="Add a manual description at the playhead"
          value={manualText}
          onChange={(e) => setManualText(e.target.value)}
        />
        <Button
          size="sm"
          disabled={pending || !manualText.trim() || currentFrame >= end}
          onClick={() =>
            void perform({
              type: 'add',
              startFrame: currentFrame,
              endFrame: Math.min(end, currentFrame + secondsToFrames(3, rate)),
              text: manualText,
            })
          }
        >
          Add at playhead
        </Button>
      </div>
      <VisualNarrationDialog
        open={generate}
        onClose={() => setGenerate(false)}
        asset={asset}
        onQueued={() => undefined}
      />
    </div>
  );
}
