import { useState } from 'react';
import type { FormEvent } from 'react';
import { Clock3, FolderOpen, Pencil, Plus, Trash2 } from 'lucide-react';
import { KerfMark, Skeleton } from '@kerf/ui';
import { Button } from '@kerf/ui';
import { Dialog } from '@kerf/ui';
import { Field, Input, Select } from '@kerf/ui';
import {
  ASPECT_RATIO_PRESETS,
  DEFAULT_ASPECT_RATIO_PRESET,
  DEFAULT_FRAME_RATE_PRESET,
  FRAME_RATE_PRESETS,
  aspectRatioPresetById,
  formatFrameRate,
  frameRatePresetById,
} from '../shared/sequence-presets';
import type { ProjectCreateRequest, ProjectSummary } from '../shared/contracts';

export interface ProjectBrowserScreenProps {
  readonly projects: ProjectSummary[];
  readonly busy: boolean;
  readonly error: string | null;
  readonly onCreate: (request: ProjectCreateRequest) => Promise<void>;
  readonly onOpen: (id: string) => Promise<void>;
  readonly onRename: (id: string, name: string) => Promise<void>;
  readonly onDelete: (id: string) => Promise<void>;
  readonly onReveal: (id: string) => void;
  readonly onOpenAbout: () => void;
}

const relativeTime = new Intl.RelativeTimeFormat(undefined, {
  numeric: 'auto',
});

function formatRelative(timestamp: number): string {
  const seconds = Math.round((timestamp - Date.now()) / 1_000);
  if (Math.abs(seconds) < 45) {
    return 'just now';
  }
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) {
    return relativeTime.format(minutes, 'minute');
  }
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) {
    return relativeTime.format(hours, 'hour');
  }
  return relativeTime.format(Math.round(hours / 24), 'day');
}

function formatProjectMeta(project: ProjectSummary): string {
  return `${project.width} × ${project.height} · ${formatFrameRate(project.frameRate)}`;
}

export function ProjectBrowserScreen({
  projects,
  busy,
  error,
  onCreate,
  onOpen,
  onRename,
  onDelete,
  onReveal,
  onOpenAbout,
}: ProjectBrowserScreenProps) {
  const [name, setName] = useState('');
  const [aspectRatioId, setAspectRatioId] = useState(
    DEFAULT_ASPECT_RATIO_PRESET.id,
  );
  const [frameRateId, setFrameRateId] = useState(DEFAULT_FRAME_RATE_PRESET.id);
  const [formError, setFormError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<ProjectSummary | null>(null);
  const [renameName, setRenameName] = useState('');
  const [deleting, setDeleting] = useState<ProjectSummary | null>(null);

  const submitCreate = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setFormError('Give the project a name.');
      return;
    }
    setFormError(null);
    const aspectRatio =
      aspectRatioPresetById(aspectRatioId) ?? DEFAULT_ASPECT_RATIO_PRESET;
    const frameRate =
      frameRatePresetById(frameRateId) ?? DEFAULT_FRAME_RATE_PRESET;
    try {
      await onCreate({
        name: trimmed,
        width: aspectRatio.width,
        height: aspectRatio.height,
        frameRate: frameRate.frameRate,
      });
      setName('');
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const submitRename = async (event: FormEvent) => {
    event.preventDefault();
    if (!renaming) {
      return;
    }
    const trimmed = renameName.trim();
    if (!trimmed) {
      return;
    }
    await onRename(renaming.id, trimmed);
    setRenaming(null);
  };

  return (
    <div className="grid h-full w-full place-items-center overflow-auto bg-surface-0 p-8 text-ink">
      <div className="w-full max-w-3xl">
        <header className="flex items-start gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-md border border-line bg-surface-1 text-accent">
            <KerfMark size={28} />
          </span>
          <div className="min-w-0">
            <p className="font-mono text-[10px] tracking-[0.12em] text-ink-faint uppercase">
              Kerf
            </p>
            <h1 className="mt-1 font-display text-[32px] leading-none font-medium tracking-[-0.01em]">
              Your projects
            </h1>
            <p className="mt-2 max-w-[46ch] text-[12px] leading-relaxed text-ink-muted">
              Local-first editing for footage on this machine. Nothing is
              uploaded and no account is needed.
            </p>
          </div>
        </header>

        <section className="mt-8 overflow-hidden rounded-lg border border-line bg-surface-1 shadow-2">
          <div className="border-b border-line px-4 py-3.5">
            <div>
              <h2 className="text-[12px] font-semibold tracking-[0.02em]">
                Recent projects
              </h2>
              <p className="mt-0.5 text-[11px] text-ink-faint">
                {projects.length === 0
                  ? 'Start with a blank sequence.'
                  : `${projects.length} on this machine`}
              </p>
            </div>
            <form
              className="mt-3 flex flex-wrap items-end gap-2"
              onSubmit={(event) => void submitCreate(event)}
            >
              <Field label="Project name" className="min-w-52 flex-1">
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="New project"
                  disabled={busy}
                />
              </Field>
              <Field label="Aspect ratio" className="w-44">
                <Select
                  value={aspectRatioId}
                  onChange={(event) => setAspectRatioId(event.target.value)}
                  options={ASPECT_RATIO_PRESETS.map((preset) => ({
                    value: preset.id,
                    label: `${preset.ratio} · ${preset.width} × ${preset.height}`,
                  }))}
                  disabled={busy}
                />
              </Field>
              <Field label="Frame rate" className="w-28">
                <Select
                  value={frameRateId}
                  onChange={(event) => setFrameRateId(event.target.value)}
                  options={FRAME_RATE_PRESETS.map((preset) => ({
                    value: preset.id,
                    label: preset.label,
                  }))}
                  disabled={busy}
                />
              </Field>
              <Button
                type="submit"
                variant="primary"
                leadingIcon={<Plus size={14} />}
                disabled={busy}
              >
                Create
              </Button>
            </form>
            <p className="mt-2 text-[10px] text-ink-faint">
              The canvas and frame rate can be changed later in Sequence
              Settings.
            </p>
          </div>

          {formError || error ? (
            <p className="border-b border-danger/30 bg-danger/10 px-4 py-2 text-[11px] text-danger">
              {formError ?? error}
            </p>
          ) : null}

          {busy && projects.length === 0 ? (
            <div
              className="space-y-4 px-4 py-5"
              role="status"
              aria-label="Loading projects"
              aria-busy="true"
            >
              {[0, 1, 2].map((index) => (
                <div
                  key={index}
                  className="flex items-center justify-between gap-4"
                >
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-3.5 w-2/5" />
                    <Skeleton className="h-2.5 w-3/5" />
                  </div>
                  <Skeleton className="h-7 w-16" />
                </div>
              ))}
            </div>
          ) : projects.length === 0 ? (
            <div className="grid justify-items-center px-6 py-14 text-center">
              <span className="grid size-16 place-items-center rounded-lg border border-line bg-surface-0 text-accent">
                <KerfMark size={38} />
              </span>
              <h3 className="mt-5 font-display text-[24px] leading-tight font-medium">
                No projects yet
              </h3>
              <p className="mt-2 max-w-[38ch] text-[12px] leading-relaxed text-ink-muted">
                Name a project above to create its folder and a blank sequence.
                Import footage once the project opens.
              </p>
            </div>
          ) : (
            <ul>
              {projects.map((project) => (
                <li
                  key={project.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-line px-4 py-3 last:border-b-0 hover:bg-surface-2"
                >
                  <button
                    type="button"
                    className="min-w-0 text-left focus-visible:outline-none"
                    onClick={() => void onOpen(project.id)}
                    disabled={busy}
                  >
                    <span className="block overflow-hidden text-[13px] font-semibold text-ellipsis whitespace-nowrap">
                      {project.name}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] text-ink-faint">
                      <span>{formatProjectMeta(project)}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {project.assetCount}{' '}
                        {project.assetCount === 1 ? 'asset' : 'assets'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1">
                        <Clock3 size={10} aria-hidden="true" />
                        {formatRelative(project.updatedAt)}
                      </span>
                    </span>
                  </button>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => void onOpen(project.id)}
                      disabled={busy}
                    >
                      Open
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onReveal(project.id)}
                      title="Reveal project folder"
                    >
                      <FolderOpen size={14} />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setRenaming(project);
                        setRenameName(project.name);
                      }}
                      title="Rename project"
                    >
                      <Pencil size={13} />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDeleting(project)}
                      title="Delete project"
                    >
                      <Trash2 size={13} />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center font-mono text-[9px] tracking-[0.02em] text-ink-faint">
          <span>Projects live in your Videos folder</span>
          <span aria-hidden="true">·</span>
          <span>Assets never leave this machine</span>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            className="rounded-xs underline-offset-2 hover:text-ink hover:underline"
            onClick={onOpenAbout}
          >
            About Kerf
          </button>
        </div>
      </div>

      <Dialog
        open={renaming !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRenaming(null);
          }
        }}
        title="Rename project"
        description="The project folder keeps its current location."
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="rename-project"
              disabled={busy || renameName.trim().length === 0}
            >
              Rename
            </Button>
          </>
        }
      >
        <form
          id="rename-project"
          onSubmit={(event) => void submitRename(event)}
        >
          <Field label="Project name">
            <Input
              value={renameName}
              onChange={(event) => setRenameName(event.target.value)}
              autoFocus
            />
          </Field>
        </form>
      </Dialog>

      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleting(null);
          }
        }}
        title="Delete project?"
        description={
          deleting
            ? `“${deleting.name}” and its cache will be removed. Original media stays on disk.`
            : undefined
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (!deleting) {
                  return;
                }
                const id = deleting.id;
                setDeleting(null);
                void onDelete(id);
              }}
            >
              Delete project
            </Button>
          </>
        }
      >
        <p className="text-[12px] leading-relaxed text-ink-muted">
          This removes the project and generated proxies but never deletes your
          source footage.
        </p>
      </Dialog>
    </div>
  );
}
