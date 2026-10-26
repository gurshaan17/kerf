import { useEffect, useState } from 'react';
import { Button, Dialog, Field, FieldRow, Select } from '@kerf/ui';
import {
  ASPECT_RATIO_PRESETS,
  DEFAULT_ASPECT_RATIO_PRESET,
  DEFAULT_FRAME_RATE_PRESET,
  FRAME_RATE_PRESETS,
  aspectRatioPresetById,
  aspectRatioPresetForSize,
  formatFrameRate,
  frameRatePresetById,
  frameRatePresetForRate,
} from '../../shared/sequence-presets';
import { useStudio } from '../state/StudioProvider';

export interface SequenceSettingsDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function SequenceSettingsDialog({
  open,
  onOpenChange,
}: SequenceSettingsDialogProps) {
  const sequence = useStudio(
    (state) => state.snapshot?.project.sequence ?? null,
  );
  const apply = useStudio((state) => state.apply);
  const pushToast = useStudio((state) => state.pushToast);
  const [aspectRatioId, setAspectRatioId] = useState(
    DEFAULT_ASPECT_RATIO_PRESET.id,
  );
  const [frameRateId, setFrameRateId] = useState(DEFAULT_FRAME_RATE_PRESET.id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !sequence) {
      return;
    }
    setAspectRatioId(
      aspectRatioPresetForSize(sequence.width, sequence.height)?.id ?? 'custom',
    );
    setFrameRateId(frameRatePresetForRate(sequence.frameRate)?.id ?? 'custom');
    setError(null);
  }, [
    open,
    sequence,
    sequence?.height,
    sequence?.width,
    sequence?.frameRate.denominator,
    sequence?.frameRate.numerator,
  ]);

  const aspectRatio = aspectRatioPresetById(aspectRatioId);
  const frameRate = frameRatePresetById(frameRateId);
  // A custom canvas or rate keeps its current value so the other control can
  // still be changed on its own.
  const targetWidth = aspectRatio?.width ?? sequence?.width ?? 0;
  const targetHeight = aspectRatio?.height ?? sequence?.height ?? 0;
  const targetRate = frameRate?.frameRate ?? sequence?.frameRate ?? null;
  const changed =
    sequence !== null &&
    targetRate !== null &&
    (sequence.width !== targetWidth ||
      sequence.height !== targetHeight ||
      sequence.frameRate.numerator !== targetRate.numerator ||
      sequence.frameRate.denominator !== targetRate.denominator);

  const submit = async () => {
    if (!sequence || !targetRate || !changed) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await apply(
        {
          type: 'sequence.setCanvas',
          width: targetWidth,
          height: targetHeight,
          frameRate: targetRate,
        },
        'Sequence settings',
      );
      if (!result) {
        setError('The sequence settings could not be updated.');
        return;
      }
      pushToast({
        title: 'Sequence updated',
        description: `${targetWidth} × ${targetHeight} · ${formatFrameRate(targetRate)}`,
        tone: 'success',
      });
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  const aspectOptions = [
    ...(sequence && !aspectRatioPresetForSize(sequence.width, sequence.height)
      ? [
          {
            value: 'custom',
            label: `Custom · ${sequence.width} × ${sequence.height}`,
            disabled: true,
          },
        ]
      : []),
    ...ASPECT_RATIO_PRESETS.map((preset) => ({
      value: preset.id,
      label: `${preset.ratio} · ${preset.width} × ${preset.height}`,
    })),
  ];
  const frameRateOptions = [
    ...(sequence && !frameRatePresetForRate(sequence.frameRate)
      ? [
          {
            value: 'custom',
            label: `Custom · ${formatFrameRate(sequence.frameRate)}`,
            disabled: true,
          },
        ]
      : []),
    ...FRAME_RATE_PRESETS.map((preset) => ({
      value: preset.id,
      label: preset.label,
    })),
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Sequence settings"
      description="Set the canvas size and timeline rate for the open sequence."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            disabled={!changed || busy}
            loading={busy}
          >
            Apply
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <FieldRow>
          <Field label="Aspect ratio">
            <Select
              value={aspectRatioId}
              onChange={(event) => setAspectRatioId(event.target.value)}
              options={aspectOptions}
              disabled={busy}
            />
          </Field>
          <Field label="Frame rate">
            <Select
              value={frameRateId}
              onChange={(event) => setFrameRateId(event.target.value)}
              options={frameRateOptions}
              disabled={busy}
            />
          </Field>
        </FieldRow>

        <div className="rounded-sm border border-line bg-surface-1 px-3 py-2.5">
          <p className="font-mono text-[9px] tracking-[0.1em] text-ink-faint uppercase">
            Canvas
          </p>
          <p className="mt-1 text-[13px] font-semibold">
            {targetWidth} × {targetHeight}
            {targetRate ? ` · ${formatFrameRate(targetRate)}` : ''}
          </p>
        </div>

        <p className="text-[11px] leading-relaxed text-ink-faint">
          Changing the frame rate keeps clips, keyframes, markers, and captions
          at the same time in seconds.
        </p>

        {error ? (
          <p className="text-[11px] text-danger" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
