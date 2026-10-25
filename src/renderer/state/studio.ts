import { create } from 'zustand';
import { useStore } from 'zustand';
import type { Clip, EditCommand } from '@kerf/model';
import type { SceneTree } from '@kerf/motion';
import { sequenceDurationFrames } from '@kerf/engine';
import { findSequenceFrame } from './sequence-map';
import type {
  AnalysisKind,
  ChatProviderSetting,
  ChatToolActivity,
  CompositionSaveRequest,
  CompositionSaveResult,
  EditResult,
  ExportFrame,
  ExportRecord,
  ExportStartRequest,
  ExportStartResult,
  JobSummary,
  KerfBridge,
  KerfEvent,
  ProjectSnapshot,
  ProjectSummary,
  SearchResponse,
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

export type ChatTurnStatus = 'streaming' | 'done' | 'aborted' | 'error';

export interface ChatTurn {
  readonly id: string;
  readonly message: string;
  readonly text: string;
  readonly tools: readonly ChatToolActivity[];
  readonly status: ChatTurnStatus;
  readonly providerLabel: string;
  readonly error: string | null;
  readonly hint: string | null;
  readonly durationMs: number | null;
}

export interface ChatError {
  readonly message: string;
  readonly hint: string | null;
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
  readonly exports: ExportRecord[];
  readonly compositionTrees: Readonly<Record<string, SceneTree>>;
  readonly chatTurns: readonly ChatTurn[];
  readonly chatActiveTurnId: string | null;
  readonly chatError: ChatError | null;
  readonly chatProvider: ChatProviderSetting | null;

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
  analyze: (assetId: string, kinds: readonly AnalysisKind[]) => Promise<void>;
  search: (query: string) => Promise<SearchResponse>;
  saveComposition: (
    request: CompositionSaveRequest,
  ) => Promise<CompositionSaveResult | null>;
  deleteComposition: (id: string) => Promise<void>;
  revealAssetFrame: (assetId: string, sourceFrame: number) => void;
  setCompositionTree: (compositionId: string, tree: SceneTree) => void;
  clearCompositionTrees: (keep?: readonly string[]) => void;

  refreshExports: () => Promise<void>;
  startExport: (
    request: ExportStartRequest,
  ) => Promise<ExportStartResult | null>;
  writeExportFrames: (
    id: string,
    frames: readonly ExportFrame[],
  ) => Promise<void>;
  finishExport: (id: string) => Promise<ExportRecord | null>;
  cancelExport: (id: string) => Promise<void>;
  pickExportPath: (presetId?: string) => Promise<string | null>;
  revealExport: (id: string) => void;
  exportOtio: () => Promise<string | null>;

  sendChat: (message: string) => Promise<boolean>;
  stopChat: () => Promise<void>;
  refreshChatProvider: () => Promise<void>;
  dismissChatError: () => void;

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
  return (
    job.kind === 'media.ingest' ||
    job.kind.startsWith('media.') ||
    job.kind.startsWith('analysis.')
  );
}

function exportMerge(
  exports: readonly ExportRecord[],
  record: ExportRecord,
): ExportRecord[] {
  const existing = exports.findIndex((candidate) => candidate.id === record.id);
  if (existing === -1) {
    return [record, ...exports];
  }
  return exports.map((candidate, index) =>
    index === existing ? record : candidate,
  );
}

function outputName(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? path;
}

function updateChatTurn(
  turns: readonly ChatTurn[],
  id: string,
  update: (turn: ChatTurn) => ChatTurn,
): ChatTurn[] {
  return turns.map((turn) => (turn.id === id ? update(turn) : turn));
}

function mergeChatTool(
  tools: readonly ChatToolActivity[],
  tool: ChatToolActivity,
): ChatToolActivity[] {
  const existing = tools.findIndex((candidate) => candidate.id === tool.id);
  if (existing === -1) {
    return [...tools, tool];
  }
  return tools.map((candidate, index) =>
    index === existing ? tool : candidate,
  );
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
      const projectChanged =
        current.snapshot?.project.id !== snapshot?.project.id;
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
        ...(projectChanged
          ? {
              chatTurns: [],
              chatActiveTurnId: null,
              chatError: null,
            }
          : {}),
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
      exports: [],
      compositionTrees: {},
      chatTurns: [],
      chatActiveTurnId: null,
      chatError: null,
      chatProvider: null,

      async hydrate() {
        set({ busy: true, error: null });
        try {
          const [projects, snapshot, chatProvider] = await Promise.all([
            bridge.projects.list(),
            bridge.projects.active(),
            bridge.chat.provider().catch(() => null),
          ]);
          const exports = snapshot
            ? await bridge.export.list(snapshot.project.id)
            : [];
          set({ projects, exports, chatProvider });
          setSnapshot(snapshot);
          set({ busy: false });
        } catch (cause) {
          set({ busy: false });
          fail(cause, 'Could not load projects');
        }
      },

      handleEvent(event) {
        if (event.type === 'chat.started') {
          set((state) => ({
            chatTurns: [
              ...state.chatTurns,
              {
                id: event.turnId,
                message: event.message,
                text: '',
                tools: [],
                status: 'streaming',
                providerLabel: event.providerLabel,
                error: null,
                hint: null,
                durationMs: null,
              },
            ],
            chatActiveTurnId: event.turnId,
            chatError: null,
          }));
          return;
        }

        if (event.type === 'chat.delta') {
          set((state) => ({
            chatTurns: updateChatTurn(
              state.chatTurns,
              event.turnId,
              (turn) => ({
                ...turn,
                text: turn.text + event.text,
              }),
            ),
          }));
          return;
        }

        if (event.type === 'chat.tool') {
          set((state) => ({
            chatTurns: updateChatTurn(
              state.chatTurns,
              event.turnId,
              (turn) => ({
                ...turn,
                tools: mergeChatTool(turn.tools, event.tool),
              }),
            ),
          }));
          return;
        }

        if (event.type === 'chat.done') {
          set((state) => ({
            chatTurns: updateChatTurn(
              state.chatTurns,
              event.turnId,
              (turn) => ({
                ...turn,
                text: event.text,
                status: 'done',
                durationMs: event.durationMs,
              }),
            ),
            chatActiveTurnId:
              state.chatActiveTurnId === event.turnId
                ? null
                : state.chatActiveTurnId,
          }));
          return;
        }

        if (event.type === 'chat.aborted') {
          set((state) => ({
            chatTurns: updateChatTurn(
              state.chatTurns,
              event.turnId,
              (turn) => ({
                ...turn,
                status: 'aborted',
              }),
            ),
            chatActiveTurnId:
              state.chatActiveTurnId === event.turnId
                ? null
                : state.chatActiveTurnId,
          }));
          return;
        }

        if (event.type === 'chat.error') {
          set((state) => ({
            chatTurns: updateChatTurn(
              state.chatTurns,
              event.turnId,
              (turn) => ({
                ...turn,
                status: 'error',
                error: event.error,
                hint: event.hint,
              }),
            ),
            chatActiveTurnId:
              state.chatActiveTurnId === event.turnId
                ? null
                : state.chatActiveTurnId,
            chatError: { message: event.error, hint: event.hint },
          }));
          return;
        }

        if (event.type === 'project.closed') {
          if (get().snapshot?.project.id === event.projectId) {
            setSnapshot(null, { clearSelection: true });
            set({ playing: false, exports: [] });
          }
          return;
        }

        if (event.type === 'export.changed') {
          const snapshot = get().snapshot;
          if (!snapshot || event.export.projectId !== snapshot.project.id) {
            return;
          }
          set((state) => ({
            exports: exportMerge(state.exports, event.export),
          }));
          if (event.export.status === 'succeeded') {
            pushToast({
              title: 'Export complete',
              description: outputName(event.export.outputPath),
              tone: 'success',
            });
          } else if (event.export.status === 'failed') {
            pushToast({
              title: 'Export failed',
              description: event.export.error ?? 'The encoder stopped early.',
              tone: 'error',
            });
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

        if (!('snapshot' in event)) {
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
          set({ playhead: 0, playing: false, exports: [] });
          await Promise.all([get().refreshProjects(), get().refreshExports()]);
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
          set({ playhead: 0, playing: false, exports: [] });
          await Promise.all([get().refreshProjects(), get().refreshExports()]);
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
          set({ exports: [] });
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
            set({ exports: [] });
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

      async analyze(assetId, kinds) {
        try {
          const result = await window.kerf.analysis.run({ assetId, kinds });
          for (const job of result.jobs) {
            pushToast({
              title: 'Analysis queued',
              description: `${job.kind.replace('analysis.', '')} · ${job.stage || 'waiting'}`,
              tone: 'info',
            });
          }
          for (const skip of result.skipped) {
            pushToast({
              title: `${skip.kind} skipped`,
              description: skip.reason,
              tone: 'warning',
            });
          }
        } catch (cause) {
          fail(cause, 'Could not start analysis');
        }
      },

      async search(query) {
        return window.kerf.analysis.search({ query });
      },

      async saveComposition(request) {
        try {
          const result = await window.kerf.motion.save(request);
          setSnapshot(result.snapshot);
          pushToast({
            title: 'Composition saved',
            description: result.composition.name,
            tone: 'success',
          });
          return result;
        } catch (cause) {
          fail(cause, 'Could not save the composition');
          return null;
        }
      },

      async deleteComposition(id) {
        try {
          const snapshot = await window.kerf.motion.delete(id);
          setSnapshot(snapshot);
        } catch (cause) {
          fail(cause, 'Could not delete the composition');
        }
      },

      setCompositionTree(compositionId, tree) {
        set((state) => ({
          compositionTrees: {
            ...state.compositionTrees,
            [compositionId]: tree,
          },
        }));
      },

      clearCompositionTrees(keep = []) {
        const allowed = new Set(keep);
        set((state) => ({
          compositionTrees: Object.fromEntries(
            Object.entries(state.compositionTrees).filter(([id]) =>
              allowed.has(id),
            ),
          ),
        }));
      },

      revealAssetFrame(assetId, sourceFrame) {
        const snapshot = get().snapshot;
        if (!snapshot) {
          return;
        }
        const match = findSequenceFrame(
          snapshot.project.sequence,
          assetId,
          sourceFrame,
        );
        if (match) {
          get().clearSelection();
          get().selectClip(match.clipId);
          get().setPlayhead(match.sequenceFrame);
          return;
        }
        pushToast({
          title: 'Clip is not on the timeline',
          description: 'Drag the asset to a track to reveal this moment.',
          tone: 'info',
        });
      },

      async refreshExports() {
        const snapshot = get().snapshot;
        if (!snapshot) {
          set({ exports: [] });
          return;
        }
        try {
          const exports = await bridge.export.list(snapshot.project.id);
          if (get().snapshot?.project.id === snapshot.project.id) {
            set({ exports });
          }
        } catch (cause) {
          fail(cause, 'Could not load export history');
        }
      },

      async startExport(request) {
        try {
          const result = await bridge.export.start(request);
          set((state) => ({
            exports: exportMerge(state.exports, result.export),
          }));
          return result;
        } catch (cause) {
          fail(cause, 'Could not start the export');
          return null;
        }
      },

      async writeExportFrames(id, frames) {
        await bridge.export.writeFrames(id, frames);
      },

      async finishExport(id) {
        try {
          const record = await bridge.export.finish(id);
          set((state) => ({
            exports: exportMerge(state.exports, record),
          }));
          return record;
        } catch (cause) {
          fail(cause, 'Could not finish the export');
          return null;
        }
      },

      async cancelExport(id) {
        try {
          await bridge.export.cancel(id);
        } catch (cause) {
          fail(cause, 'Could not cancel the export');
        }
      },

      async pickExportPath(presetId) {
        try {
          return await bridge.export.pickPath(presetId);
        } catch (cause) {
          fail(cause, 'Could not choose an export folder');
          return null;
        }
      },

      revealExport(id) {
        void bridge.export.reveal(id).catch((cause) => {
          fail(cause, 'Could not reveal the export');
        });
      },

      async exportOtio() {
        try {
          const result = await bridge.export.otio();
          if (!result) {
            return null;
          }
          pushToast({
            title: 'Timeline exported',
            description: outputName(result.path),
            tone: 'success',
          });
          return result.path;
        } catch (cause) {
          fail(cause, 'Could not export the OTIO timeline');
          return null;
        }
      },

      async sendChat(message) {
        const trimmed = message.trim();
        if (!trimmed) {
          return false;
        }
        set({ chatError: null });
        try {
          const result = await bridge.chat.send({ message: trimmed });
          set((state) =>
            state.chatTurns.find(
              (turn) =>
                turn.id === result.turnId && turn.status === 'streaming',
            )
              ? { chatActiveTurnId: result.turnId }
              : {},
          );
          return true;
        } catch (cause) {
          set({
            chatError: {
              message: errorMessage(cause),
              hint: null,
            },
          });
          return false;
        }
      },

      async stopChat() {
        try {
          await bridge.chat.abort();
        } catch (cause) {
          set({
            chatError: {
              message: errorMessage(cause),
              hint: null,
            },
          });
        }
      },

      async refreshChatProvider() {
        try {
          const chatProvider = await bridge.chat.provider();
          set({ chatProvider });
        } catch {
          set({ chatProvider: null });
        }
      },

      dismissChatError() {
        set({ chatError: null });
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
