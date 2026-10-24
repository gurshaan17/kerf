import { useState } from 'react';
import {
  Captions,
  CheckCircle2,
  Circle,
  FileVideo,
  Scissors,
  Upload,
  X,
} from 'lucide-react';
import { IconButton, cn } from '@kerf/ui';
import type { Asset } from '@kerf/model';
import type { AnalysisAssetStatus } from '../shared/contracts';
import { useStudio } from './state/StudioProvider';

const STORAGE_KEY = 'kerf:getting-started-dismissed';

export interface GettingStartedProps {
  readonly assets: readonly Asset[];
  readonly analysis: readonly AnalysisAssetStatus[];
  readonly onImport: () => Promise<void>;
  readonly onOpenExport: () => void;
}

interface Step {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly done: boolean;
  readonly icon: typeof Upload;
  readonly action?: {
    readonly label: string;
    readonly run: () => void;
  };
}

export function GettingStarted({
  assets,
  analysis,
  onImport,
  onOpenExport,
}: GettingStartedProps) {
  const sequence = useStudio(
    (state) => state.snapshot?.project.sequence ?? null,
  );
  const exports = useStudio((state) => state.exports);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });

  if (dismissed) {
    return null;
  }

  const hasClip =
    sequence?.tracks.some((track) => track.clips.length > 0) ?? false;
  const hasTranscript = analysis.some((entry) => entry.transcript);
  const hasExport = exports.some((record) => record.status === 'succeeded');

  const steps: Step[] = [
    {
      id: 'import',
      label: 'Import footage',
      detail: 'Video, audio or images from this machine.',
      done: assets.length > 0,
      icon: Upload,
      action:
        assets.length === 0
          ? { label: 'Import', run: () => void onImport() }
          : undefined,
    },
    {
      id: 'edit',
      label: 'Add a clip to the timeline',
      detail: 'Drag a ready asset onto the video track.',
      done: hasClip,
      icon: Scissors,
    },
    {
      id: 'analyze',
      label: 'Transcribe a clip',
      detail: 'Select a clip and choose Transcribe in Footage.',
      done: hasTranscript,
      icon: Captions,
    },
    {
      id: 'export',
      label: 'Export a cut',
      detail: 'Write an MP4 next to the project.',
      done: hasExport,
      icon: FileVideo,
      action: !hasExport
        ? { label: 'Open export', run: onOpenExport }
        : undefined,
    },
  ];
  const completed = steps.filter((step) => step.done).length;

  const dismiss = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // A private or restricted profile can still dismiss for this session.
    }
    setDismissed(true);
  };

  return (
    <section
      className="border-b border-line bg-surface-2/45 px-3 py-2.5"
      aria-label="Getting started"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-ink">Getting started</p>
          <p className="mt-0.5 text-[9px] text-ink-faint">
            {completed === steps.length
              ? 'All four steps are done.'
              : `${completed} of ${steps.length} complete`}
          </p>
        </div>
        <IconButton
          label="Dismiss getting started"
          tooltip="Dismiss"
          tooltipSide="bottom"
          size="sm"
          icon={<X size={12} />}
          onClick={dismiss}
        />
      </div>

      <div
        className="mt-2 h-0.5 overflow-hidden rounded-pill bg-surface-0"
        aria-hidden="true"
      >
        <div
          className="h-full rounded-pill bg-accent transition-[width] duration-200"
          style={{ width: `${(completed / steps.length) * 100}%` }}
        />
      </div>

      <ol className="mt-2 space-y-1">
        {steps.map((step) => {
          const Icon = step.icon;
          return (
            <li
              key={step.id}
              className="flex items-center gap-2 rounded-xs px-0.5 py-0.5"
            >
              <span
                className={cn(
                  'grid size-4 shrink-0 place-items-center rounded-full border',
                  step.done
                    ? 'border-ok/40 bg-ok/10 text-ok'
                    : 'border-line bg-surface-0 text-ink-faint',
                )}
                aria-hidden="true"
              >
                {step.done ? <CheckCircle2 size={11} /> : <Circle size={8} />}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    'flex items-center gap-1 text-[10px] leading-snug',
                    step.done ? 'text-ink-muted' : 'text-ink',
                  )}
                >
                  <Icon size={10} className="shrink-0 text-ink-faint" />
                  {step.label}
                </span>
                <span className="mt-0.5 block text-[9px] leading-snug text-ink-faint">
                  {step.detail}
                </span>
              </span>
              {step.action && !step.done ? (
                <button
                  type="button"
                  className="shrink-0 rounded-xs px-1.5 py-0.5 text-[9px] font-semibold text-accent-bright hover:bg-surface-2"
                  onClick={step.action.run}
                >
                  {step.action.label}
                </button>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
