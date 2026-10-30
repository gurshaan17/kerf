import { useEffect, useMemo, useRef, useState } from 'react';
import { Captions, Check, Copy, X } from 'lucide-react';
import type { FrameRate, TranscriptSegment } from '@kerf/model';
import { formatTimecode, framesToSeconds, secondsToFrames } from '@kerf/model';
import { IconButton, Input, Panel, cn } from '@kerf/ui';
import { SourcePreview } from '../analysis/SourcePreview';
import type { SourcePreviewHandle } from '../analysis/SourcePreview';
import { findSequenceFrame } from '../state/sequence-map';
import { useStudio } from '../state/StudioProvider';
import { VisualNarrationEditor, VisualNarrationJob } from './VisualNarration';

export interface TranscriptPanelProps {
  readonly assetId: string;
  readonly onClose: () => void;
}

const FALLBACK_RATE: FrameRate = { numerator: 24, denominator: 1 };

export function TranscriptPanel({ assetId, onClose }: TranscriptPanelProps) {
  const snapshot = useStudio((state) => state.snapshot);
  const revealAssetFrame = useStudio((state) => state.revealAssetFrame);
  const pushToast = useStudio((state) => state.pushToast);

  const asset =
    snapshot?.assets.find((candidate) => candidate.id === assetId) ?? null;
  const transcript =
    snapshot?.transcripts.find((candidate) => candidate.assetId === assetId) ??
    null;
  const sequence = snapshot?.project.sequence ?? null;

  const rate = asset?.frameRate ?? sequence?.frameRate ?? FALLBACK_RATE;

  const [query, setQuery] = useState('');
  const [currentFrame, setCurrentFrame] = useState(0);
  const [copied, setCopied] = useState(false);

  const previewRef = useRef<SourcePreviewHandle>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const copiedTimer = useRef<number | null>(null);

  const segments = useMemo(() => transcript?.segments ?? [], [transcript]);
  const wordCount = useMemo(
    () =>
      segments.reduce(
        (total, segment) =>
          total +
          (segment.words.length > 0
            ? segment.words.length
            : segment.text.split(/\s+/).filter(Boolean).length),
        0,
      ),
    [segments],
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return segments;
    }
    return segments.filter((segment) =>
      segment.text.toLowerCase().includes(needle),
    );
  }, [segments, query]);

  const activeSegmentId =
    segments.find(
      (segment) =>
        currentFrame >= segment.startFrame && currentFrame < segment.endFrame,
    )?.id ?? null;

  useEffect(() => {
    setQuery('');
    setCurrentFrame(0);
    setCopied(false);
  }, [assetId]);

  useEffect(
    () => () => {
      if (copiedTimer.current !== null) {
        window.clearTimeout(copiedTimer.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!activeSegmentId) {
      return;
    }
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeSegmentId]);

  const seek = (segment: TranscriptSegment) => {
    previewRef.current?.seekToFrame(segment.startFrame);
    if (
      sequence &&
      findSequenceFrame(sequence, assetId, segment.startFrame) !== null
    ) {
      revealAssetFrame(assetId, segment.startFrame);
    }
  };

  const copyTranscript = async () => {
    if (!transcript) {
      return;
    }
    try {
      await navigator.clipboard.writeText(transcript.text);
      setCopied(true);
      if (copiedTimer.current !== null) {
        window.clearTimeout(copiedTimer.current);
      }
      copiedTimer.current = window.setTimeout(() => setCopied(false), 1600);
    } catch (cause) {
      pushToast({
        title: 'Could not copy the transcript',
        description: cause instanceof Error ? cause.message : String(cause),
        tone: 'error',
      });
    }
  };

  return (
    <Panel
      title={
        transcript?.source === 'visual' ? 'Visual narration' : 'Transcript'
      }
      subtitle={asset?.name ?? 'Unknown asset'}
      bodyClassName="flex min-h-0 flex-col p-0"
      actions={
        <>
          <IconButton
            label="Copy transcript"
            tooltip="Copy transcript"
            tooltipSide="bottom"
            size="sm"
            disabled={!transcript}
            icon={copied ? <Check size={14} /> : <Copy size={14} />}
            onClick={() => void copyTranscript()}
          />
          <IconButton
            label="Close transcript"
            tooltip="Close transcript"
            tooltipSide="bottom"
            size="sm"
            icon={<X size={14} />}
            onClick={onClose}
          />
        </>
      }
    >
      <VisualNarrationJob assetId={assetId} />
      {transcript && asset ? (
        <>
          {asset.kind === 'video' || asset.kind === 'audio' ? (
            <SourcePreview
              ref={previewRef}
              asset={asset}
              rate={rate}
              onFrameChange={setCurrentFrame}
            />
          ) : null}

          {transcript.source === 'visual' ? (
            <VisualNarrationEditor
              transcript={transcript}
              asset={asset}
              rate={rate}
              currentFrame={currentFrame}
              seek={(frame) => {
                previewRef.current?.seekToFrame(frame);
                const timelineSourceFrame = sequence
                  ? secondsToFrames(
                      framesToSeconds(frame, rate),
                      sequence.frameRate,
                    )
                  : frame;
                if (
                  sequence &&
                  findSequenceFrame(sequence, assetId, timelineSourceFrame) !==
                    null
                )
                  revealAssetFrame(assetId, timelineSourceFrame);
              }}
            />
          ) : (
            <>
              <div className="border-b border-line p-2.5">
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Find in transcript"
                  aria-label="Find in transcript"
                  className="h-8"
                />
              </div>

              <div ref={listRef} className="min-h-0 flex-1 overflow-auto p-1.5">
                {filtered.length === 0 ? (
                  <p className="px-2 py-6 text-center text-[11px] text-ink-faint">
                    {segments.length === 0
                      ? 'The transcript has no segments.'
                      : `No segments match “${query.trim()}”.`}
                  </p>
                ) : (
                  <ol className="grid gap-0.5">
                    {filtered.map((segment) => {
                      const active = segment.id === activeSegmentId;
                      return (
                        <li key={segment.id}>
                          <button
                            type="button"
                            data-transcript-segment
                            data-active={active || undefined}
                            onClick={() => seek(segment)}
                            title="Play from this moment"
                            className={cn(
                              'flex w-full items-start gap-2 rounded-sm border border-transparent px-2 py-1.5 text-left transition-colors duration-150 ease-k hover:bg-surface-2 focus-visible:outline-none',
                              active && 'border-accent/30 bg-accent/10',
                            )}
                          >
                            <span
                              className={cn(
                                'mt-px shrink-0 font-mono text-[9px]',
                                active
                                  ? 'text-accent-bright'
                                  : 'text-ink-faint',
                              )}
                            >
                              {formatTimecode(segment.startFrame, rate)}
                            </span>
                            <span
                              className={cn(
                                'min-w-0 flex-1 text-[11px] leading-relaxed',
                                active ? 'text-ink' : 'text-ink-muted',
                              )}
                            >
                              {segment.text}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>

              <footer className="border-t border-line px-3 py-2 font-mono text-[8px] tracking-[0.04em] text-ink-faint uppercase">
                {segments.length}{' '}
                {segments.length === 1 ? 'segment' : 'segments'} · {wordCount}{' '}
                words · {transcript.language.toUpperCase()}
                {transcript.model ? ` · ${transcript.model}` : ''}
              </footer>
            </>
          )}
        </>
      ) : (
        <div className="grid flex-1 place-content-center gap-1 p-6 text-center">
          <Captions
            size={22}
            className="mx-auto text-ink-faint"
            aria-hidden="true"
          />
          <p className="text-[12px] text-ink-muted">No transcript yet</p>
          <span className="text-[10px] leading-relaxed text-ink-faint">
            Select the asset in the Footage bin and choose Transcribe or Visual
            narration.
          </span>
        </div>
      )}
    </Panel>
  );
}
