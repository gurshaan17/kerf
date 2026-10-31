import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type { Asset, EditCommand } from '@kerf/model';
import {
  KERF_IPC,
  type AnalysisAssetStatus,
  type AnalysisRunRequest,
  type AnalysisRunResult,
  type ChatProviderSetting,
  type ChatSendRequest,
  type ChatStartResult,
  type CompositionSaveRequest,
  type CompositionSaveResult,
  type EditResult,
  type ExportOtioResult,
  type ExportRecord,
  type ExportStartRequest,
  type ExportStartResult,
  type JobSummary,
  type KerfBridge,
  type KerfEvent,
  type KerfEventEnvelope,
  type McpSettingsUpdate,
  type McpStatus,
  type ProjectHistoryState,
  type ReferenceLookRequest,
  type ReferenceLookResult,
  type ReferencePacingResult,
  type ReferenceUseRequest,
  type ProjectSnapshot,
  type ProjectSummary,
  type ProviderAccount,
  type ProviderSaveRequest,
  type ProviderTestResult,
  type RendererEditorContext,
  type RendererRequest,
  type RendererResponse,
  type SearchRequest,
  type SearchResponse,
  type WhisperModelInfo,
  type WhisperModelInstall,
} from '../shared/contracts';

const invoke = <Result>(channel: string, ...args: unknown[]): Promise<Result> =>
  ipcRenderer.invoke(channel, ...args) as Promise<Result>;

// Keep the renderer sandboxed: expose only the specific operations the UI
// needs instead of handing over Node.js or the whole `electron` module.
const bridge: KerfBridge = {
  tts: {
    providers: () => invoke(KERF_IPC.tts.providers),
    saveProvider: (request) => invoke(KERF_IPC.tts.saveProvider, request),
    deleteProvider: (id) => invoke(KERF_IPC.tts.deleteProvider, id),
    generate: (request) => invoke(KERF_IPC.tts.generate, request),
    takes: (id) => invoke(KERF_IPC.tts.takes, id),
    place: (request) => invoke(KERF_IPC.tts.place, request),
  },
  getVersions: () => ({
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  }),
  projects: {
    list: () => invoke<ProjectSummary[]>(KERF_IPC.projects.list),
    active: () => invoke<ProjectSnapshot | null>(KERF_IPC.projects.active),
    create: (request) =>
      invoke<ProjectSnapshot>(KERF_IPC.projects.create, request),
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
    writeFrames: (id, frames) =>
      invoke<void>(KERF_IPC.export.writeFrames, id, frames),
    finish: (id) => invoke<ExportRecord>(KERF_IPC.export.finish, id),
    cancel: (id) => invoke<boolean>(KERF_IPC.export.cancel, id),
    list: (projectId) =>
      invoke<ExportRecord[]>(KERF_IPC.export.list, projectId),
    reveal: (id) => invoke<void>(KERF_IPC.export.reveal, id),
    otio: () => invoke<ExportOtioResult | null>(KERF_IPC.export.otio),
  },
  analysis: {
    run: (request: AnalysisRunRequest) =>
      invoke<AnalysisRunResult>(KERF_IPC.analysis.run, request),
    status: () => invoke<AnalysisAssetStatus[]>(KERF_IPC.analysis.status),
    search: (request: SearchRequest) =>
      invoke<SearchResponse>(KERF_IPC.analysis.search, request),
    providers: () => invoke<ProviderAccount[]>(KERF_IPC.analysis.providers),
    saveProvider: (request: ProviderSaveRequest) =>
      invoke<ProviderAccount>(KERF_IPC.analysis.saveProvider, request),
    deleteProvider: (id) =>
      invoke<boolean>(KERF_IPC.analysis.deleteProvider, id),
    testProvider: (id) =>
      invoke<ProviderTestResult>(KERF_IPC.analysis.testProvider, id),
    models: () => invoke<WhisperModelInfo[]>(KERF_IPC.analysis.models),
    downloadModel: (id) =>
      invoke<WhisperModelInstall>(KERF_IPC.analysis.downloadModel, id),
    deleteModel: (id) => invoke<boolean>(KERF_IPC.analysis.deleteModel, id),
  },
  narration: {
    generate: (request) => invoke(KERF_IPC.narration.generate, request),
    captions: (request) => invoke(KERF_IPC.narration.captions, request),
    updateText: (request) => invoke(KERF_IPC.narration.updateText, request),
    setTiming: (request) => invoke(KERF_IPC.narration.setTiming, request),
    split: (request) => invoke(KERF_IPC.narration.split, request),
    merge: (request) => invoke(KERF_IPC.narration.merge, request),
    add: (request) => invoke(KERF_IPC.narration.add, request),
    delete: (request) => invoke(KERF_IPC.narration.delete, request),
    undo: (request) => invoke(KERF_IPC.narration.undo, request),
    redo: (request) => invoke(KERF_IPC.narration.redo, request),
    review: (request) => invoke(KERF_IPC.narration.review, request),
  },
  motion: {
    save: (request: CompositionSaveRequest) =>
      invoke<CompositionSaveResult>(KERF_IPC.motion.save, request),
    delete: (id) => invoke<ProjectSnapshot>(KERF_IPC.motion.delete, id),
  },
  mcp: {
    status: () => invoke<McpStatus>(KERF_IPC.mcp.status),
    update: (settings: McpSettingsUpdate) =>
      invoke<McpStatus>(KERF_IPC.mcp.update, settings),
    rotateToken: () => invoke<McpStatus>(KERF_IPC.mcp.rotateToken),
  },
  references: {
    use: (request: ReferenceUseRequest) =>
      invoke<ProjectSnapshot>(KERF_IPC.references.use, request),
    clear: () => invoke<ProjectSnapshot>(KERF_IPC.references.clear),
    applyLook: (request: ReferenceLookRequest) =>
      invoke<ReferenceLookResult>(KERF_IPC.references.applyLook, request),
    applyPacing: () =>
      invoke<ReferencePacingResult>(KERF_IPC.references.applyPacing),
  },
  chat: {
    send: (request: ChatSendRequest) =>
      invoke<ChatStartResult>(KERF_IPC.chat.send, request),
    abort: () => invoke<boolean>(KERF_IPC.chat.abort),
    provider: () => invoke<ChatProviderSetting>(KERF_IPC.chat.provider),
    setProvider: (providerId: string | null) =>
      invoke<ChatProviderSetting>(KERF_IPC.chat.setProvider, providerId),
  },
  renderer: {
    subscribe(listener: (request: RendererRequest) => void) {
      const handler = (_event: IpcRendererEvent, request: RendererRequest) => {
        listener(request);
      };
      ipcRenderer.on(KERF_IPC.renderer.request, handler);
      return () => {
        ipcRenderer.removeListener(KERF_IPC.renderer.request, handler);
      };
    },
    respond: (response: RendererResponse) =>
      invoke<void>(KERF_IPC.renderer.response, response),
    setEditorContext: (context: RendererEditorContext) =>
      invoke<void>(KERF_IPC.renderer.editor, context),
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
