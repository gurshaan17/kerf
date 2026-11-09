import { useEffect, useRef, useState } from 'react';
import { Captions, Check, Copy, X } from 'lucide-react';
import type { FrameRate, TranscriptSegment } from '@kerf/model';
import { framesToSeconds, secondsToFrames } from '@kerf/model';
import { IconButton, Panel } from '@kerf/ui';
import { SourcePreview } from '../analysis/SourcePreview';
import type { SourcePreviewHandle } from '../analysis/SourcePreview';
import { findSequenceFrame } from '../state/sequence-map';
import { useStudio } from '../state/StudioProvider';
import { SpeechTranscriptEditor } from './SpeechTranscriptEditor';
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

  const [currentFrame, setCurrentFrame] = useState(0);
  const [copied, setCopied] = useState(false);

  const previewRef = useRef<SourcePreviewHandle>(null);
  const copiedTimer = useRef<number | null>(null);

  useEffect(() => {
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

  const seek = (segment: TranscriptSegment) => {
    previewRef.current?.seekToFrame(segment.startFrame);
    const frame = sequence
      ? secondsToFrames(
          framesToSeconds(segment.startFrame, rate),
          sequence.frameRate,
        )
      : segment.startFrame;
    if (sequence && findSequenceFrame(sequence, assetId, frame) !== null)
      revealAssetFrame(assetId, frame);
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
            <SpeechTranscriptEditor
              key={assetId}
              currentFrame={currentFrame}
              transcript={transcript}
              asset={asset}
              rate={rate}
              seek={seek}
              previewCut={(start, end) =>
                previewRef.current?.previewCut(start, end)
              }
            />
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
