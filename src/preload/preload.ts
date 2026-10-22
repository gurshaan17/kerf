import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type { Asset, EditCommand } from '@kerf/model';
import {
  KERF_IPC,
  type EditResult,
  type ExportOtioResult,
  type ExportRecord,
  type ExportStartRequest,
  type ExportStartResult,
  type JobSummary,
  type KerfBridge,
  type KerfEvent,
  type KerfEventEnvelope,
  type ProjectHistoryState,
  type ProjectSnapshot,
  type ProjectSummary,
} from '../shared/contracts';

const invoke = <Result>(channel: string, ...args: unknown[]): Promise<Result> =>
  ipcRenderer.invoke(channel, ...args) as Promise<Result>;

// Keep the renderer sandboxed: expose only the specific operations the UI
// needs instead of handing over Node.js or the whole `electron` module.
const bridge: KerfBridge = {
  getVersions: () => ({
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  }),
  projects: {
    list: () => invoke<ProjectSummary[]>(KERF_IPC.projects.list),
    active: () => invoke<ProjectSnapshot | null>(KERF_IPC.projects.active),
    create: (name) => invoke<ProjectSnapshot>(KERF_IPC.projects.create, name),
    open: (id) => invoke<ProjectSnapshot>(KERF_IPC.projects.open, id),
    close: () => invoke<void>(KERF_IPC.projects.close),
    rename: (id, name) =>
      invoke<ProjectSummary>(KERF_IPC.projects.rename, id, name),
    delete: (id, removeFolder) =>
      invoke<boolean>(KERF_IPC.projects.delete, id, removeFolder),
    reveal: (id) => invoke<void>(KERF_IPC.projects.reveal, id),
  },
  edits: {
    apply: (command: EditCommand) =>
      invoke<EditResult>(KERF_IPC.edits.apply, command),
    undo: () => invoke<EditResult | null>(KERF_IPC.edits.undo),
    redo: () => invoke<EditResult | null>(KERF_IPC.edits.redo),
    history: () => invoke<ProjectHistoryState>(KERF_IPC.edits.history),
  },
  assets: {
    list: () => invoke<Asset[]>(KERF_IPC.assets.list),
    import: (paths) => invoke<Asset[]>(KERF_IPC.assets.import, paths),
    pick: () => invoke<Asset[]>(KERF_IPC.assets.pick),
    refresh: () => invoke<Asset[]>(KERF_IPC.assets.refresh),
    relink: (id, path) =>
      invoke<Asset | null>(KERF_IPC.assets.relink, id, path),
  },
  jobs: {
    list: (projectId) => invoke<JobSummary[]>(KERF_IPC.jobs.list, projectId),
    cancel: (id) => invoke<boolean>(KERF_IPC.jobs.cancel, id),
  },
  export: {
    pickPath: (presetId) =>
      invoke<string | null>(KERF_IPC.export.pickPath, presetId),
    start: (request: ExportStartRequest) =>
      invoke<ExportStartResult>(KERF_IPC.export.start, request),
    writeFrame: (id, index, data) =>
      invoke<void>(KERF_IPC.export.writeFrame, id, index, data),
    finish: (id) => invoke<ExportRecord>(KERF_IPC.export.finish, id),
    cancel: (id) => invoke<boolean>(KERF_IPC.export.cancel, id),
    list: (projectId) =>
      invoke<ExportRecord[]>(KERF_IPC.export.list, projectId),
    reveal: (id) => invoke<void>(KERF_IPC.export.reveal, id),
    otio: () => invoke<ExportOtioResult | null>(KERF_IPC.export.otio),
  },
  events: {
    subscribe(listener: (event: KerfEvent) => void) {
      const handler = (
        _event: IpcRendererEvent,
        envelope: KerfEventEnvelope,
      ) => {
        listener(envelope.event);
      };
      ipcRenderer.on(KERF_IPC.event, handler);
      return () => {
        ipcRenderer.removeListener(KERF_IPC.event, handler);
      };
    },
  },
};

contextBridge.exposeInMainWorld('kerf', bridge);
