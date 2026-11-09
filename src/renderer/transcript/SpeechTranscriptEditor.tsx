import { useEffect, useMemo, useState } from 'react';
import type {
  Asset,
  FrameRate,
  Transcript,
  TranscriptSegment,
} from '@kerf/model';
import { formatTimecode, framesToSeconds, secondsToFrames } from '@kerf/model';
import {
  transcriptEditCommand,
  transcriptOccurrences,
  type TranscriptAction,
} from '@kerf/engine';
import { Button, Input, Textarea } from '@kerf/ui';
import { useStudio } from '../state/StudioProvider';

export function SpeechTranscriptEditor({
  transcript,
  asset,
  rate,
  seek,
  previewCut,
  currentFrame,
}: {
  transcript: Transcript;
  asset: Asset;
  rate: FrameRate;
  currentFrame: number;
  seek: (segment: TranscriptSegment) => void;
  previewCut: (start: number, end: number) => void;
}) {
  const sequence = useStudio((s) => s.snapshot!.project.sequence);
  const apply = useStudio((s) => s.apply),
    undo = useStudio((s) => s.undo);
  const setPlayhead = useStudio((s) => s.setPlayhead);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'source' | 'timeline'>('timeline');
  const [occurrence, setOccurrence] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [action, setAction] = useState<TranscriptAction>('remove');
  const [text, setText] = useState<string | null>(null);
  const [review, setReview] = useState(false);
  const [bounds, setBounds] = useState<{
    startFrame: number;
    endFrame: number;
  } | null>(null);
  useEffect(() => {
    setReview(false);
    setBounds(null);
  }, [sequence]);
  const rows = transcript.segments.filter((s) => selected.includes(s.id));
  const range = rows.length
    ? {
        startFrame: Math.min(...rows.map((s) => s.startFrame)),
        endFrame: Math.max(...rows.map((s) => s.endFrame)),
      }
    : null;
  const matches = range
    ? transcriptOccurrences(sequence, asset.id, range, rate)
    : [];
  const originalMatch =
    matches.find((m) => m.clipId === occurrence) ?? matches[0];
  const match = originalMatch ? { ...originalMatch, ...bounds } : undefined;
  const timelineRows = useMemo(
    () =>
      transcript.segments
        .flatMap((segment) => {
          const seen = new Set<string>();
          return transcriptOccurrences(sequence, asset.id, segment, rate)
            .filter((m) => {
              const key = `${m.startFrame}:${m.endFrame}`;
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            })
            .map((m) => ({ segment, match: m }));
        })
        .sort((a, b) => a.match.startFrame - b.match.startFrame),
    [sequence, transcript, asset.id, rate],
  );
  const visible = (
    view === 'timeline' && timelineRows.length
      ? timelineRows
      : transcript.segments.map((segment) => ({ segment, match: null }))
  ).filter((r) => r.segment.text.toLowerCase().includes(query.toLowerCase()));
  const changeSelection = (segment: TranscriptSegment, clipId?: string) => {
    setSelected((old) =>
      old.includes(segment.id)
        ? old.filter((id) => id !== segment.id)
        : [...old, segment.id],
    );
    if (clipId) setOccurrence(clipId);
    setReview(false);
    setBounds(null);
    setError('');
    setText(null);
  };
  const run = async () => {
    if (!match) return;
    setPending(true);
    setError('');
    try {
      const result = await apply(
        transcriptEditCommand(
          sequence,
          match.startFrame,
          match.endFrame,
          action,
          asset.id,
        ),
      );
      if (result) {
        setSelected([]);
        setReview(false);
        setPlayhead(match.startFrame);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };
  const correct = async (type: 'updateText' | 'undo' | 'redo') => {
    setPending(true);
    setError('');
    try {
      const base = {
        transcriptId: transcript.id,
        expectedRevision: transcript.revision,
      };
      if (type === 'updateText' && rows[0] && text?.trim())
        await window.kerf.narration.updateText({
          ...base,
          segmentId: rows[0].id,
          text: text.trim(),
        });
      else if (type !== 'updateText') await window.kerf.narration[type](base);
      setText(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid max-h-[60%] shrink-0 gap-2 overflow-auto border-b border-line p-2.5">
        <Input
          aria-label="Find in transcript"
          placeholder="Find in transcript"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            aria-pressed={view === 'timeline'}
            onClick={() => setView('timeline')}
          >
            Timeline
          </Button>
          <Button
            size="sm"
            aria-pressed={view === 'source'}
            onClick={() => setView('source')}
          >
            Full source
          </Button>
          <Button size="sm" disabled={pending} onClick={() => void undo()}>
            Undo media edit
          </Button>
        </div>
        {rows.length > 0 && (
          <>
            <p className="text-xs text-ink-muted">
              {rows.length} selected. The passage includes everything between
              these segments.
            </p>
            <select
              aria-label="Timeline occurrence"
              className="w-full min-w-0 rounded border border-line bg-surface-2 p-2 text-xs"
              value={match?.clipId ?? ''}
              onChange={(e) => {
                setOccurrence(e.target.value);
                setReview(false);
              }}
            >
              {!matches.length && (
                <option value="">This passage is not on the timeline</option>
              )}
              {matches.map((m) => (
                <option key={m.clipId} value={m.clipId}>
                  {m.trackName} ·{' '}
                  {formatTimecode(m.startFrame, sequence.frameRate)}–
                  {formatTimecode(m.endFrame, sequence.frameRate)}
                </option>
              ))}
            </select>
            <select
              aria-label="Transcript media action"
              className="w-full rounded border border-line bg-surface-2 p-2 text-xs"
              value={action}
              onChange={(e) => {
                setAction(e.target.value as TranscriptAction);
                setReview(false);
              }}
            >
              <option value="remove">Remove and close gap</option>
              <option value="extract">Extract copy to timeline end</option>
              <option value="move">Move to timeline end</option>
              <option value="mute">Mute speech, keep visuals</option>
            </select>
            <Button
              size="sm"
              disabled={!match || pending}
              onClick={() => {
                setReview(true);
                if (match) setPlayhead(match.startFrame);
              }}
            >
              Review passage
            </Button>
            {review && match && (
              <div
                className="grid gap-2 rounded border border-line p-2 text-xs"
                role="region"
                aria-label="Proposed transcript edit"
              >
                <p>
                  {action === 'remove' || action === 'move'
                    ? 'All tracks and markers will close this gap.'
                    : action === 'extract'
                      ? 'A copy across all tracks will be appended.'
                      : 'Matching source audio will be silenced. Visual timing stays the same.'}{' '}
                  One media undo restores the edit.
                </p>
                <p>
                  Reviewing this timeline occurrence only. Trimmed segments may
                  appear as partial passages.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <label>
                    Start frame
                    <Input
                      aria-label="Passage start frame"
                      type="number"
                      min={0}
                      value={match.startFrame}
                      onChange={(e) =>
                        setBounds({
                          ...match,
                          startFrame: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    End frame
                    <Input
                      aria-label="Passage end frame"
                      type="number"
                      min={match.startFrame + 1}
                      value={match.endFrame}
                      onChange={(e) =>
                        setBounds({
                          ...match,
                          endFrame: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                </div>
                <p className={action === 'remove' ? 'line-through' : ''}>
                  {rows.map((s) => s.text).join(' ')}
                </p>
                {(action === 'remove' || action === 'move') && (
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={() => {
                      const clip = sequence.tracks
                        .flatMap((t) => t.clips)
                        .find((c) => c.id === match.clipId);
                      if (
                        clip &&
                        (clip.type === 'video' || clip.type === 'audio')
                      ) {
                        const sourceFrame = (frame: number) =>
                          secondsToFrames(
                            framesToSeconds(
                              clip.sourceInFrame +
                                (frame - clip.startFrame) * clip.speed,
                              sequence.frameRate,
                            ),
                            rate,
                          );
                        previewCut(
                          sourceFrame(match.startFrame),
                          sourceFrame(match.endFrame),
                        );
                      }
                    }}
                  >
                    Preview source join
                  </Button>
                )}
                <Button
                  size="sm"
                  disabled={
                    pending ||
                    !Number.isInteger(match.startFrame) ||
                    !Number.isInteger(match.endFrame) ||
                    match.endFrame <= match.startFrame ||
                    match.startFrame < 0
                  }
                  onClick={() => void run()}
                >
                  {pending ? 'Applying…' : 'Apply media edit'}
                </Button>
              </div>
            )}
            {rows.length === 1 && (
              <Button
                size="sm"
                disabled={pending}
                onClick={() => setText(rows[0]!.text)}
              >
                Correct transcript text
              </Button>
            )}
            {text !== null && (
              <>
                <Textarea
                  aria-label="Corrected transcript text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
                <p className="text-xs text-ink-muted">
                  Text correction changes the transcript only. Speech and
                  existing captions stay unchanged.
                </p>
                <Button
                  size="sm"
                  disabled={pending || !text.trim()}
                  onClick={() => void correct('updateText')}
                >
                  Save text correction
                </Button>
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() => setText(null)}
                >
                  Cancel correction
                </Button>
              </>
            )}
            <Button
              size="sm"
              disabled={pending}
              onClick={() => {
                setSelected([]);
                setReview(false);
                setText(null);
              }}
            >
              Clear selection
            </Button>
          </>
        )}
        {transcript.undoStates.length > 0 && (
          <Button
            size="sm"
            disabled={pending}
            onClick={() => void correct('undo')}
          >
            Undo text correction
          </Button>
        )}
        {transcript.redoStates.length > 0 && (
          <Button
            size="sm"
            disabled={pending}
            onClick={() => void correct('redo')}
          >
            Redo text correction
          </Button>
        )}
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
      </div>
      {view === 'timeline' && !timelineRows.length && (
        <p className="px-3 py-2 text-xs text-ink-muted">
          No passages on the timeline. Showing the full source.
        </p>
      )}
      <ol className="min-h-0 flex-1 overflow-auto p-2">
        {visible.map(({ segment, match: item }, index) => (
          <li
            key={`${segment.id}:${item?.clipId ?? index}`}
            className="flex items-start gap-2 py-1"
          >
            <input
              type="checkbox"
              aria-label={`Select passage: ${segment.text}`}
              checked={selected.includes(segment.id)}
              disabled={pending}
              onChange={() => changeSelection(segment, item?.clipId)}
              className="mt-2 accent-accent"
            />
            <button
              type="button"
              data-transcript-segment
              data-active={
                (currentFrame >= segment.startFrame &&
                  currentFrame < segment.endFrame) ||
                undefined
              }
              className="min-w-0 flex-1 rounded p-1 text-left text-xs text-ink-muted hover:bg-surface-2 focus-visible:outline focus-visible:outline-accent"
              onClick={() => {
                seek(segment);
                if (item) setPlayhead(item.startFrame);
              }}
            >
              <span className="mr-2 font-mono text-ink-faint">
                {formatTimecode(
                  item?.startFrame ?? segment.startFrame,
                  item ? sequence.frameRate : rate,
                )}
              </span>
              {segment.text}
            </button>
          </li>
        ))}
        {!visible.length && (
          <li className="p-4 text-xs text-ink-muted">
            No segments match this search.
          </li>
        )}
      </ol>
      <p className="border-t border-line p-2 text-xs text-ink-muted">
        {transcript.segments.length} segments ·{' '}
        {transcript.language.toUpperCase()} · Segment-level editing
      </p>
    </div>
  );
}
