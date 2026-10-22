import { useEffect, useMemo, useRef, useState } from 'react';
import { Clock3, FileVideo, FolderOpen, Loader2, Square } from 'lucide-react';
import type { ExportRecord } from '../../shared/contracts';
import {
  DEFAULT_EXPORT_PRESET_ID,
  EXPORT_PRESETS,
} from '../../shared/contracts';
import {
  clampExportWindow,
  resolveExportPreset,
} from '../../shared/export-plan';
import { formatTimecode, fpsToNumber } from '@kerf/model';
import { sequenceDurationFrames } from '@kerf/engine';
import {
  Button,
  Dialog,
  Field,
  FieldRow,
  IconButton,
  Input,
  Select,
  cn,
} from '@kerf/ui';
import { useStudio } from '../state/StudioProvider';
import { ExportCancelledError, renderExportFrames } from './render-export';

function secondsText(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function baseName(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? path;
}

function statusLabel(record: ExportRecord): string {
  switch (record.status) {
    case 'rendering':
      return 'Rendering';
    case 'encoding':
      return 'Encoding';
    case 'succeeded':
      return 'Complete';
    case 'failed':
      return 'Failed';
    case 'cancelled':
      return 'Cancelled';
  }
}

function presetName(id: string): string {
  return EXPORT_PRESETS.find((preset) => preset.id === id)?.name ?? id;
}

export interface ExportDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function ExportDialog({ open, onOpenChange }: ExportDialogProps) {
  const snapshot = useStudio((state) => state.snapshot);
  const playhead = useStudio((state) => state.playhead);
  const exports = useStudio((state) => state.exports);
  const startExport = useStudio((state) => state.startExport);
  const writeExportFrame = useStudio((state) => state.writeExportFrame);
  const compositionTrees = useStudio((state) => state.compositionTrees);
  const finishExport = useStudio((state) => state.finishExport);
  const cancelExport = useStudio((state) => state.cancelExport);
  const refreshExports = useStudio((state) => state.refreshExports);
  const pickExportPath = useStudio((state) => state.pickExportPath);
  const revealExport = useStudio((state) => state.revealExport);
  const exportOtio = useStudio((state) => state.exportOtio);

  const [presetId, setPresetId] = useState(DEFAULT_EXPORT_PRESET_ID);
  const [startInput, setStartInput] = useState('0');
  const [durationInput, setDurationInput] = useState('10');
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [renderedFrames, setRenderedFrames] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef(false);

  const sequence = snapshot?.project.sequence;
  const rate = sequence?.frameRate ?? { numerator: 24, denominator: 1 };
  const fps = fpsToNumber(rate);
  const durationFrames = sequence ? sequenceDurationFrames(sequence) : 0;
  const totalSeconds = durationFrames / fps;
  const preset = useMemo(
    () =>
      sequence
        ? resolveExportPreset(presetId, sequence.width, sequence.height)
        : null,
    [presetId, sequence],
  );
  const startSeconds = Math.max(
    0,
    Math.min(Number(startInput) || 0, totalSeconds),
  );
  const requestedDuration = Math.max(0, Number(durationInput) || 0);
  const window = clampExportWindow(
    Math.round(startSeconds * fps),
    Math.round((startSeconds + requestedDuration) * fps),
    durationFrames,
  );
  const active = exports.find(
    (record) => record.status === 'rendering' || record.status === 'encoding',
  );
  const activeRecord = runningId
    ? (exports.find((record) => record.id === runningId) ?? active)
    : active;
  const exporting = Boolean(activeRecord);
  const canExport =
    Boolean(sequence) &&
    !exporting &&
    totalSeconds >= 1 / fps &&
    requestedDuration >= 1 / fps;

  useEffect(() => {
    if (!open) {
      return;
    }
    void refreshExports();
    setError(null);
    setOutputPath(null);
    setPresetId(DEFAULT_EXPORT_PRESET_ID);
    setStartInput('0');
    setDurationInput(secondsText(Math.min(10, totalSeconds || 10)));
    setRenderedFrames(0);
    // Only reset when the dialog opens, not as the playhead moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const beginExport = async () => {
    if (!sequence || !snapshot || !canExport) {
      return;
    }
    setError(null);
    cancelRef.current = false;
    setRenderedFrames(0);
    const result = await startExport({
      presetId,
      startFrame: window.startFrame,
      endFrame: window.endFrame,
      outputPath,
    });
    if (!result) {
      setError('The export could not start.');
      return;
    }

    setRunningId(result.export.id);
    try {
      await renderExportFrames({
        result,
        sequence,
        assets: snapshot.assets,
        compositionTrees: new Map(Object.entries(compositionTrees)),
        writeFrame: (index, data) =>
          writeExportFrame(result.export.id, index, data),
        onProgress: (rendered) => setRenderedFrames(rendered),
        isCancelled: () => cancelRef.current,
      });
      if (cancelRef.current) {
        return;
      }
      const record = await finishExport(result.export.id);
      if (record?.status === 'failed') {
        setError(record.error ?? 'The encoder stopped early.');
      } else if (record?.status === 'succeeded') {
        setOutputPath(null);
      }
    } catch (cause) {
      if (cause instanceof ExportCancelledError || cancelRef.current) {
        return;
      }
      setError(
        cause instanceof Error ? cause.message : 'The export could not finish.',
      );
      await cancelExport(result.export.id);
    } finally {
      setRunningId(null);
      cancelRef.current = false;
    }
  };

  const stopExport = () => {
    if (!activeRecord) {
      return;
    }
    cancelRef.current = true;
    setRenderedFrames(0);
    void cancelExport(activeRecord.id);
  };

  const choosePath = async () => {
    const path = await pickExportPath(presetId);
    if (path) {
      setOutputPath(path);
    }
  };

  const progress = Math.max(0, Math.min(1, activeRecord?.progress ?? 0));
  const history = exports.slice(0, 6);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Export"
      panelClassName="k-dialog--export"
      description="Frames are composited by the same renderer as the preview, then encoded locally with FFmpeg."
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              void exportOtio();
            }}
            disabled={!sequence || exporting}
          >
            Export OTIO
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {exporting ? (
            <Button
              variant="danger"
              leadingIcon={<Square size={13} />}
              onClick={stopExport}
            >
              Cancel export
            </Button>
          ) : (
            <Button
              variant="primary"
              leadingIcon={<FileVideo size={14} />}
              onClick={() => {
                void beginExport();
              }}
              disabled={!canExport}
            >
              Export MP4
            </Button>
          )}
        </>
      }
    >
      {!sequence || !preset ? (
        <p className="k-export__empty">Open a project before exporting.</p>
      ) : (
        <div className="k-export">
          <Field label="Preset" hint={preset.description}>
            <Select
              value={presetId}
              options={EXPORT_PRESETS.map((option) => ({
                value: option.id,
                label: option.name,
              }))}
              disabled={exporting}
              onChange={(event) => {
                setPresetId(event.target.value);
                setOutputPath(null);
              }}
            />
          </Field>

          <Field label="Output file" optional>
            <div className="k-export__path">
              <Input
                readOnly
                value={outputPath ?? 'Project exports folder'}
                aria-label="Export output file"
              />
              <Button
                size="sm"
                onClick={() => {
                  void choosePath();
                }}
                disabled={exporting}
              >
                Choose…
              </Button>
            </div>
          </Field>

          <FieldRow>
            <Field label="Start (seconds)">
              <Input
                type="number"
                min={0}
                max={totalSeconds}
                step={0.1}
                value={startInput}
                disabled={exporting}
                onChange={(event) => setStartInput(event.target.value)}
              />
            </Field>
            <Field label="Duration (seconds)">
              <Input
                type="number"
                min={0.1}
                max={Math.max(0.1, totalSeconds - startSeconds)}
                step={0.1}
                value={durationInput}
                disabled={exporting}
                onChange={(event) => setDurationInput(event.target.value)}
              />
            </Field>
          </FieldRow>

          <div className="k-export__summary">
            <span>
              {preset.width} × {preset.height} · {secondsText(fps)} fps
            </span>
            <span>
              {formatTimecode(window.startFrame, rate)} →{' '}
              {formatTimecode(window.endFrame, rate)} · {window.frameCount}{' '}
              frames
            </span>
          </div>

          <div className="k-export__quick">
            <Button
              size="sm"
              variant="ghost"
              disabled={exporting}
              onClick={() => {
                setStartInput(secondsText(playhead / fps));
                setDurationInput(
                  secondsText(
                    Math.min(10, Math.max(0, totalSeconds - playhead / fps)),
                  ),
                );
              }}
            >
              From playhead · 10s
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={exporting}
              onClick={() => {
                setStartInput('0');
                setDurationInput(secondsText(totalSeconds));
              }}
            >
              Whole sequence
            </Button>
          </div>

          {activeRecord ? (
            <div className="k-export__progress" aria-live="polite">
              <div className="k-export__progress-head">
                <span className="k-export__progress-label">
                  {activeRecord.status === 'encoding' ? (
                    <Loader2 size={13} className="k-export__spin" />
                  ) : (
                    <Clock3 size={13} />
                  )}
                  {activeRecord.status === 'encoding'
                    ? 'Encoding MP4'
                    : `Rendering frames · ${renderedFrames}/${window.frameCount}`}
                </span>
                <span className="k-export__progress-value">
                  {Math.round(progress * 100)}%
                </span>
              </div>
              <div className="k-export__bar">
                <span style={{ width: `${progress * 100}%` }} />
              </div>
              <span className="k-export__progress-path">
                {baseName(activeRecord.outputPath)}
              </span>
            </div>
          ) : null}

          {error ? (
            <p className="k-export__error" role="alert">
              {error}
            </p>
          ) : null}

          <section className="k-export__history">
            <h3>Recent exports</h3>
            {history.length === 0 ? (
              <p className="k-export__empty">No exports yet.</p>
            ) : (
              <ul>
                {history.map((record) => (
                  <li key={record.id}>
                    <span
                      className={cn('k-export__status', `is-${record.status}`)}
                      aria-hidden="true"
                    />
                    <span className="k-export__history-name">
                      {baseName(record.outputPath)}
                      <small>
                        {presetName(record.preset)} ·{' '}
                        {new Date(record.createdAt).toLocaleString()}
                      </small>
                    </span>
                    <span className="k-export__history-state">
                      {statusLabel(record)}
                    </span>
                    <IconButton
                      label="Reveal export"
                      size="sm"
                      icon={<FolderOpen size={13} />}
                      disabled={!record.outputPath}
                      onClick={() => revealExport(record.id)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Dialog>
  );
}
