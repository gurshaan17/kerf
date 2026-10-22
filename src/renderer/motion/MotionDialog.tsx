import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Clapperboard,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Trash2,
} from 'lucide-react';
import {
  DEFAULT_COMPOSITION_SOURCE,
  clipSchema,
  newId,
  type Composition,
} from '@kerf/model';
import { renderSceneTree, type SceneTree } from '@kerf/motion';
import { Button, Dialog, Field, FieldRow, Input, Textarea, cn } from '@kerf/ui';
import { useStudio } from '../state/StudioProvider';
import { createCompositionSandbox, type CompositionSandbox } from './sandbox';

export interface MotionDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

function freeStart(
  track: CompositionTrack,
  desired: number,
  durationFrames: number,
): number {
  let start = Math.max(0, Math.round(desired));
  const ordered = [...track.clips].sort(
    (left, right) => left.startFrame - right.startFrame,
  );
  for (const clip of ordered) {
    const end = clip.startFrame + clip.durationFrames;
    if (start + durationFrames <= clip.startFrame) {
      break;
    }
    if (start < end) {
      start = end;
    }
  }
  return start;
}

interface CompositionTrack {
  readonly id: string;
  readonly kind: string;
  readonly hidden: boolean;
  readonly locked: boolean;
  readonly clips: ReadonlyArray<{
    readonly startFrame: number;
    readonly durationFrames: number;
  }>;
}

export function MotionDialog({ open, onOpenChange }: MotionDialogProps) {
  const snapshot = useStudio((state) => state.snapshot);
  const apply = useStudio((state) => state.apply);
  const saveComposition = useStudio((state) => state.saveComposition);
  const deleteComposition = useStudio((state) => state.deleteComposition);
  const setPlayhead = useStudio((state) => state.setPlayhead);
  const playhead = useStudio((state) => state.playhead);
  const selectClip = useStudio((state) => state.selectClip);
  const clearCompositionTrees = useStudio(
    (state) => state.clearCompositionTrees,
  );
  const pushToast = useStudio((state) => state.pushToast);

  const compositions = snapshot?.compositions ?? [];
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('Lower third');
  const [source, setSource] = useState(DEFAULT_COMPOSITION_SOURCE);
  const [width, setWidth] = useState(1920);
  const [height, setHeight] = useState(1080);
  const [durationFrames, setDurationFrames] = useState(120);
  const [tree, setTree] = useState<SceneTree | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [sandbox, setSandbox] = useState<CompositionSandbox | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const editing = useMemo(
    () =>
      compositions.find((composition) => composition.id === editingId) ?? null,
    [compositions, editingId],
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    let active = true;
    let created: CompositionSandbox | null = null;
    void createCompositionSandbox()
      .then((next) => {
        if (!active) {
          next.dispose();
          return;
        }
        created = next;
        setSandbox(next);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      active = false;
      created?.dispose();
      setSandbox(null);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    if (editing) {
      setName(editing.name);
      setSource(editing.source);
      setWidth(editing.width);
      setHeight(editing.height);
      setDurationFrames(editing.durationFrames);
    }
  }, [editing, open]);

  useEffect(() => {
    if (!open || !sandbox) {
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setEvaluating(true);
      setError(null);
      void sandbox
        .evaluate(source)
        .then((next) => {
          if (!cancelled) {
            setTree(next);
            setError(null);
          }
        })
        .catch((cause: unknown) => {
          if (!cancelled) {
            setTree(null);
            setError(cause instanceof Error ? cause.message : String(cause));
          }
        })
        .finally(() => {
          if (!cancelled) {
            setEvaluating(false);
          }
        });
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, sandbox, source]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !tree) {
      return;
    }
    const previewWidth = 640;
    const previewHeight = Math.max(
      1,
      Math.round((previewWidth * height) / Math.max(1, width)),
    );
    if (canvas.width !== previewWidth || canvas.height !== previewHeight) {
      canvas.width = previewWidth;
      canvas.height = previewHeight;
    }
    const context = canvas.getContext('2d');
    if (context) {
      renderSceneTree(context, tree, previewWidth, previewHeight);
    }
  }, [tree, width, height]);

  const reset = () => {
    setEditingId(null);
    setName('Lower third');
    setSource(DEFAULT_COMPOSITION_SOURCE);
    setWidth(1920);
    setHeight(1080);
    setDurationFrames(120);
    setTree(null);
    setError(null);
  };

  const selectExisting = (composition: Composition) => {
    setEditingId(composition.id);
    setName(composition.name);
    setSource(composition.source);
    setWidth(composition.width);
    setHeight(composition.height);
    setDurationFrames(composition.durationFrames);
  };

  const save = async (): Promise<Composition | null> => {
    if (error) {
      return null;
    }
    const result = await saveComposition({
      ...(editingId ? { id: editingId } : {}),
      name: name.trim() || 'Composition',
      source,
      width,
      height,
      durationFrames,
    });
    if (!result) {
      return null;
    }
    setEditingId(result.composition.id);
    return result.composition;
  };

  const insert = async () => {
    const saved = (editingId ? editing : null) ?? (await save());
    if (!saved) {
      return;
    }
    const sequence = snapshot?.project.sequence;
    if (!sequence) {
      return;
    }
    const track = sequence.tracks.find(
      (candidate) =>
        (candidate.kind === 'video' || candidate.kind === 'overlay') &&
        !candidate.locked &&
        !candidate.hidden,
    ) as CompositionTrack | undefined;
    if (!track) {
      pushToast({
        title: 'No video track is available',
        description:
          'Add or unlock a video track before inserting a composition.',
        tone: 'warning',
      });
      return;
    }
    const startFrame = freeStart(track, playhead, saved.durationFrames);
    const clip = clipSchema.parse({
      id: newId('clip'),
      trackId: track.id,
      type: 'composition',
      compositionId: saved.id,
      name: saved.name,
      label: saved.name,
      startFrame,
      durationFrames: saved.durationFrames,
    });
    const result = await apply(
      { type: 'clip.insert', clip },
      'Insert composition',
    );
    if (result) {
      clearCompositionTrees();
      selectClip(clip.id);
      setPlayhead(startFrame);
      pushToast({
        title: 'Composition inserted',
        description: saved.name,
        tone: 'success',
      });
    }
  };

  const remove = async () => {
    if (!editingId) {
      reset();
      return;
    }
    await deleteComposition(editingId);
    reset();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Compositions"
      description="Scene-tree compositions run in a sandboxed iframe. Source is a single expression that returns layout data."
      panelClassName="max-w-[920px]"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<Save size={12} />}
              disabled={Boolean(error) || evaluating}
              onClick={() => void save()}
            >
              Save
            </Button>
            <Button
              variant="primary"
              size="sm"
              leadingIcon={<Clapperboard size={12} />}
              disabled={Boolean(error) || evaluating}
              onClick={() => void insert()}
            >
              Insert on timeline
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={reset}>
              New
            </Button>
            <Button
              variant="ghost"
              size="sm"
              leadingIcon={<Trash2 size={12} />}
              onClick={() => void remove()}
            >
              Delete
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid grid-cols-[180px_minmax(0,1fr)] gap-4">
        <aside className="grid content-start gap-1.5">
          <p className="font-mono text-[8px] tracking-[0.05em] text-ink-faint uppercase">
            Project compositions
          </p>
          {compositions.length === 0 ? (
            <p className="rounded-sm border border-line bg-surface-0 px-2.5 py-3 text-[10px] leading-relaxed text-ink-faint">
              No compositions yet. Edit the source and save one.
            </p>
          ) : (
            compositions.map((composition) => (
              <button
                key={composition.id}
                type="button"
                className={cn(
                  'rounded-sm border px-2.5 py-2 text-left transition-colors',
                  composition.id === editingId
                    ? 'border-accent/60 bg-accent/10'
                    : 'border-line bg-surface-0 hover:border-line-strong',
                )}
                onClick={() => selectExisting(composition)}
              >
                <span className="block truncate text-[11px] font-medium text-ink">
                  {composition.name}
                </span>
                <span className="mt-0.5 block font-mono text-[8px] text-ink-faint">
                  {composition.width}×{composition.height} ·{' '}
                  {composition.durationFrames}f
                </span>
              </button>
            ))
          )}
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={<Plus size={11} />}
            onClick={reset}
          >
            New composition
          </Button>
        </aside>

        <section className="grid min-w-0 gap-3">
          <div className="relative overflow-hidden rounded-sm border border-line bg-surface-0">
            <canvas
              ref={canvasRef}
              className="block h-auto w-full"
              aria-label="Composition frame preview"
            />
            {evaluating ? (
              <span className="absolute top-2 right-2 inline-flex items-center gap-1.5 rounded-pill bg-surface-0/85 px-2 py-1 font-mono text-[8px] text-ink-muted">
                <Loader2 size={10} className="animate-spin" /> evaluating
              </span>
            ) : null}
            {error ? (
              <div className="absolute inset-x-2 bottom-2 flex items-start gap-2 rounded-sm border border-danger/40 bg-surface-0/95 px-2.5 py-2">
                <AlertTriangle
                  size={13}
                  className="mt-px shrink-0 text-danger"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-medium text-danger">
                    Composition error
                  </p>
                  <p className="mt-0.5 text-[9px] leading-relaxed text-ink-muted">
                    {error}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  leadingIcon={<RotateCcw size={10} />}
                  onClick={() => {
                    setError(null);
                    setSource((current) => `${current} `);
                  }}
                >
                  Retry
                </Button>
              </div>
            ) : null}
          </div>

          <FieldRow>
            <Field label="Name">
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field label="Duration (frames)">
              <Input
                type="number"
                min={1}
                max={100000}
                value={durationFrames}
                onChange={(event) =>
                  setDurationFrames(
                    Math.max(1, Number(event.target.value) || 1),
                  )
                }
              />
            </Field>
          </FieldRow>
          <FieldRow>
            <Field label="Width">
              <Input
                type="number"
                min={16}
                value={width}
                onChange={(event) =>
                  setWidth(Math.max(16, Number(event.target.value) || 16))
                }
              />
            </Field>
            <Field label="Height">
              <Input
                type="number"
                min={16}
                value={height}
                onChange={(event) =>
                  setHeight(Math.max(16, Number(event.target.value) || 16))
                }
              />
            </Field>
          </FieldRow>
          <Field
            label="Scene source"
            hint="Return an object with background and nodes. Coordinates are percentages. window, document, fetch, process and Function are rejected before evaluation."
          >
            <Textarea
              value={source}
              onChange={(event) => setSource(event.target.value)}
              spellCheck={false}
              className="min-h-[230px] font-mono text-[11px] leading-relaxed"
            />
          </Field>
        </section>
      </div>
    </Dialog>
  );
}
