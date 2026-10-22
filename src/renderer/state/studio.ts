import { create } from 'zustand';
import { useStore } from 'zustand';
import type { Clip, EditCommand } from '@kerf/model';
import { sequenceDurationFrames } from '@kerf/engine';
import type {
  EditResult,
  JobSummary,
  KerfBridge,
  KerfEvent,
  ProjectSnapshot,
  ProjectSummary,
} from '../../shared/contracts';

export type StudioTool = 'select' | 'blade' | 'text';
export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export interface StudioToast {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly tone: ToastTone;
}

export interface StudioSelection {
  readonly clipIds: readonly string[];
  readonly trackId: string | null;
}

export interface StudioState {
  readonly projects: ProjectSummary[];
  readonly snapshot: ProjectSnapshot | null;
  readonly busy: boolean;
  readonly error: string | null;
  readonly selection: StudioSelection;
  readonly playhead: number;
  readonly pixelsPerFrame: number;
  readonly snapEnabled: boolean;
  readonly rippleEnabled: boolean;
  readonly tool: StudioTool;
  readonly toasts: StudioToast[];
  readonly playing: boolean;

  hydrate: () => Promise<void>;
  handleEvent: (event: KerfEvent) => void;
  refreshProjects: () => Promise<void>;
  createProject: (name: string) => Promise<void>;
  openProject: (id: string) => Promise<void>;
  closeProject: () => Promise<void>;
  renameProject: (id: string, name: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  revealProject: (id: string) => void;
  importFootage: () => Promise<void>;
  relinkAsset: (assetId: string) => Promise<void>;
  refreshAssets: () => Promise<void>;
  cancelJob: (jobId: string) => Promise<void>;

  apply: (command: EditCommand, label?: string) => Promise<EditResult | null>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;

  selectClip: (clipId: string, additive?: boolean) => void;
  selectTrack: (trackId: string | null) => void;
  clearSelection: () => void;

  setPlayhead: (frame: number) => void;
  nudgePlayhead: (frames: number) => void;
  setPlaying: (playing: boolean) => void;
  togglePlaying: () => void;
  setPixelsPerFrame: (pixelsPerFrame: number) => void;
  zoomBy: (factor: number) => void;
  toggleSnap: () => void;
  toggleRipple: () => void;
  setTool: (tool: StudioTool) => void;

  pushToast: (
    toast: Omit<StudioToast, 'id'> & { readonly id?: string },
  ) => void;
  dismissToast: (id: string) => void;
}

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 16;
const MAX_TOASTS = 4;

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function sequenceEnd(snapshot: ProjectSnapshot | null): number {
  if (!snapshot) {
    return 0;
  }
  return sequenceDurationFrames(snapshot.project.sequence);
}

function jobMerge(jobs: readonly JobSummary[], job: JobSummary): JobSummary[] {
  const existing = jobs.findIndex((candidate) => candidate.id === job.id);
  if (existing === -1) {
    return [...jobs, job];
  }
  return jobs.map((candidate, index) => (index === existing ? job : candidate));
}

function assetJob(job: JobSummary): boolean {
  return job.kind === 'media.ingest' || job.kind.startsWith('media.');
}

let toastCounter = 0;

export function createStudioStore(bridge: KerfBridge) {
  return create<StudioState>()((set, get) => {
    const pushToast = (
      toast: Omit<StudioToast, 'id'> & { readonly id?: string },
    ) => {
      const id = toast.id ?? `toast_${Date.now()}_${toastCounter++}`;
      set((state) => ({
        toasts: [...state.toasts, { ...toast, id }].slice(-MAX_TOASTS),
      }));
      setTimeout(() => {
        if (get().toasts.some((item) => item.id === id)) {
          set((state) => ({
            toasts: state.toasts.filter((item) => item.id !== id),
          }));
        }
      }, 5200);
    };

    const fail = (cause: unknown, title = 'Something went wrong') => {
      const message = errorMessage(cause);
      set({ error: message });
      pushToast({ title, description: message, tone: 'error' });
    };

    const setSnapshot = (
      snapshot: ProjectSnapshot | null,
      options: { readonly clearSelection?: boolean } = {},
    ) => {
      const current = get();
      const end = sequenceEnd(snapshot);
      const existing = new Set<string>(
        snapshot?.project.sequence.tracks.flatMap((track) =>
          track.clips.map((clip) => clip.id),
        ) ?? [],
      );
      const clipIds = options.clearSelection
        ? []
        : current.selection.clipIds.filter((id) => existing.has(id));
      set({
        snapshot,
        selection: {
          clipIds,
          trackId:
            clipIds.length === 0 && options.clearSelection
              ? null
              : current.selection.trackId,
        },
        playhead: snapshot ? clamp(current.playhead, 0, end) : 0,
      });
    };

    return {
      projects: [],
      snapshot: null,
      busy: true,
      error: null,
      selection: { clipIds: [], trackId: null },
      playhead: 0,
      pixelsPerFrame: 1.35,
      snapEnabled: true,
      rippleEnabled: false,
      tool: 'select',
      toasts: [],
      playing: false,

      async hydrate() {
        set({ busy: true, error: null });
        try {
          const [projects, snapshot] = await Promise.all([
            bridge.projects.list(),
            bridge.projects.active(),
          ]);
          set({ projects });
          setSnapshot(snapshot);
          set({ busy: false });
        } catch (cause) {
          set({ busy: false });
          fail(cause, 'Could not load projects');
        }
      },

      handleEvent(event) {
        if (event.type === 'project.closed') {
          if (get().snapshot?.project.id === event.projectId) {
            setSnapshot(null, { clearSelection: true });
            set({ playing: false });
          }
          return;
        }

        if (event.type === 'jobs.changed') {
          const snapshot = get().snapshot;
          if (!snapshot || event.job.projectId !== snapshot.project.id) {
            return;
          }
          const jobs = jobMerge(snapshot.jobs, event.job);
          set({ snapshot: { ...snapshot, jobs } });
          if (
            assetJob(event.job) &&
            (event.job.status === 'succeeded' ||
              event.job.status === 'failed' ||
              event.job.status === 'cancelled')
          ) {
            void bridge.assets
              .list()
              .then((assets) => {
                const active = get().snapshot;
                if (active) {
                  set({ snapshot: { ...active, assets } });
                }
              })
              .catch(() => undefined);
          }
          return;
        }

        setSnapshot(event.snapshot);
        void get()
          .refreshProjects()
          .catch(() => undefined);
      },

      async refreshProjects() {
        const projects = await bridge.projects.list();
        set({ projects });
      },

      async createProject(name) {
        set({ busy: true, error: null });
        try {
          const snapshot = await bridge.projects.create(name);
          setSnapshot(snapshot, { clearSelection: true });
          set({ playhead: 0, playing: false });
          await get().refreshProjects();
          pushToast({
            title: 'Project created',
            description: snapshot.project.name,
            tone: 'success',
          });
        } catch (cause) {
          fail(cause, 'Could not create the project');
          throw cause;
        } finally {
          set({ busy: false });
        }
      },

      async openProject(id) {
        set({ busy: true, error: null });
        try {
          const snapshot = await bridge.projects.open(id);
          setSnapshot(snapshot, { clearSelection: true });
          set({ playhead: 0, playing: false });
          await get().refreshProjects();
        } catch (cause) {
          fail(cause, 'Could not open the project');
        } finally {
          set({ busy: false });
        }
      },

      async closeProject() {
        set({ busy: true, error: null, playing: false });
        try {
          await bridge.projects.close();
          setSnapshot(null, { clearSelection: true });
          await get().refreshProjects();
        } catch (cause) {
          fail(cause, 'Could not close the project');
        } finally {
          set({ busy: false });
        }
      },

      async renameProject(id, name) {
        set({ busy: true, error: null });
        try {
          await bridge.projects.rename(id, name);
          await get().refreshProjects();
          const snapshot = get().snapshot;
          if (snapshot?.project.id === id) {
            const bundle = await bridge.projects.active();
            if (bundle) {
              set({ snapshot: { ...snapshot, project: bundle.project } });
            }
          }
        } catch (cause) {
          fail(cause, 'Could not rename the project');
          throw cause;
        } finally {
          set({ busy: false });
        }
      },

      async deleteProject(id) {
        set({ busy: true, error: null });
        try {
          await bridge.projects.delete(id, true);
          if (get().snapshot?.project.id === id) {
            setSnapshot(null, { clearSelection: true });
          }
          await get().refreshProjects();
        } catch (cause) {
          fail(cause, 'Could not delete the project');
        } finally {
          set({ busy: false });
        }
      },

      revealProject(id) {
        void bridge.projects.reveal(id).catch((cause) => {
          fail(cause, 'Could not reveal the project folder');
        });
      },

      async importFootage() {
        set({ busy: true, error: null });
        try {
          const imported = await bridge.assets.pick();
          if (imported.length > 0) {
            const snapshot = await bridge.projects.active();
            setSnapshot(snapshot);
            pushToast({
              title:
                imported.length === 1
                  ? 'Footage imported'
                  : `${imported.length} clips imported`,
              description: 'Processing starts in the background.',
              tone: 'success',
            });
          }
        } catch (cause) {
          fail(cause, 'Could not import footage');
        } finally {
          set({ busy: false });
        }
      },

      async relinkAsset(assetId) {
        set({ busy: true, error: null });
        try {
          const relinked = await bridge.assets.relink(assetId);
          if (relinked) {
            const snapshot = await bridge.projects.active();
            setSnapshot(snapshot);
            pushToast({
              title: 'Media relinked',
              description: relinked.name,
              tone: 'success',
            });
          }
        } catch (cause) {
          fail(cause, 'Could not relink the media');
        } finally {
          set({ busy: false });
        }
      },

      async refreshAssets() {
        set({ busy: true, error: null });
        try {
          await bridge.assets.refresh();
          const snapshot = await bridge.projects.active();
          setSnapshot(snapshot);
        } catch (cause) {
          fail(cause, 'Could not refresh assets');
        } finally {
          set({ busy: false });
        }
      },

      async cancelJob(jobId) {
        try {
          await bridge.jobs.cancel(jobId);
        } catch (cause) {
          fail(cause, 'Could not cancel the job');
        }
      },

      async apply(command, label) {
        set({ error: null });
        try {
          const result = await bridge.edits.apply(command);
          setSnapshot(result.snapshot);
          return result;
        } catch (cause) {
          fail(
            cause,
            label ? `${label} failed` : 'The edit could not be applied',
          );
          return null;
        }
      },

      async undo() {
        try {
          const result = await bridge.edits.undo();
          if (result) {
            setSnapshot(result.snapshot);
          }
        } catch (cause) {
          fail(cause, 'Could not undo');
        }
      },

      async redo() {
        try {
          const result = await bridge.edits.redo();
          if (result) {
            setSnapshot(result.snapshot);
          }
        } catch (cause) {
          fail(cause, 'Could not redo');
        }
      },

      selectClip(clipId, additive = false) {
        const current = get().selection;
        const next = additive
          ? current.clipIds.includes(clipId)
            ? current.clipIds.filter((id) => id !== clipId)
            : [...current.clipIds, clipId]
          : [clipId];
        set({ selection: { clipIds: next, trackId: null } });
      },

      selectTrack(trackId) {
        set({ selection: { clipIds: [], trackId } });
      },

      clearSelection() {
        set({ selection: { clipIds: [], trackId: null } });
      },

      setPlayhead(frame) {
        const end = sequenceEnd(get().snapshot);
        set({ playhead: clamp(Math.round(frame), 0, Math.max(end, 0)) });
      },

      nudgePlayhead(frames) {
        get().setPlayhead(get().playhead + frames);
      },

      setPlaying(playing) {
        set({ playing });
      },

      togglePlaying() {
        if (!get().snapshot) {
          return;
        }
        get().setPlaying(!get().playing);
      },

      setPixelsPerFrame(pixelsPerFrame) {
        set({ pixelsPerFrame: clamp(pixelsPerFrame, MIN_ZOOM, MAX_ZOOM) });
      },

      zoomBy(factor) {
        get().setPixelsPerFrame(get().pixelsPerFrame * factor);
      },

      toggleSnap() {
        set({ snapEnabled: !get().snapEnabled });
      },

      toggleRipple() {
        set({ rippleEnabled: !get().rippleEnabled });
      },

      setTool(tool) {
        set({ tool });
      },

      pushToast,
      dismissToast(id) {
        set((state) => ({
          toasts: state.toasts.filter((toast) => toast.id !== id),
        }));
      },
    };
  });
}

export type StudioStore = ReturnType<typeof createStudioStore>;
export type StudioStoreApi = ReturnType<StudioStore['getState']>;

export function useStudio<T>(
  store: StudioStore,
  selector: (state: StudioState) => T,
): T {
  return useStore(store, selector);
}

export function selectedClips(
  snapshot: ProjectSnapshot | null,
  ids: readonly string[],
): Clip[] {
  if (!snapshot) {
    return [];
  }
  const selected = new Set(ids);
  return snapshot.project.sequence.tracks
    .flatMap((track) => track.clips)
    .filter((clip) => selected.has(clip.id));
}
