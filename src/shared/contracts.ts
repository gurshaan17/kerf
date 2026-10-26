import type {
  Actor,
  Asset,
  BeatMap,
  Composition,
  EditCommand,
  EditCommandEnvelope,
  FrameRate,
  Project,
  ReferenceProfile,
  Scene,
  Transcript,
} from '@kerf/model';

/** Serializable values the renderer may request from the main process. */
export interface AppVersions {
  readonly electron: string;
  readonly chrome: string;
  readonly node: string;
}

export interface ProjectSummary {
  readonly id: string;
  readonly name: string;
  readonly folderPath: string;
  readonly width: number;
  readonly height: number;
  readonly frameRate: FrameRate;
  readonly durationFrames: number;
  readonly assetCount: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface ProjectBundle {
  readonly project: Project;
  readonly assets: Asset[];
  readonly transcripts: Transcript[];
  readonly scenes: Scene[];
  readonly beatMaps: BeatMap[];
  readonly referenceProfiles: ReferenceProfile[];
  readonly compositions: Composition[];
}

export type JobStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface JobSummary {
  readonly id: string;
  readonly projectId: string | null;
  readonly kind: string;
  readonly targetId: string | null;
  readonly status: JobStatus;
  readonly stage: string;
  readonly progress: number;
  readonly error: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly startedAt: number | null;
  readonly finishedAt: number | null;
}

export interface HistorySummary {
  readonly label: string;
  readonly actor: Actor;
  readonly createdAt: number;
}

export interface ProjectHistoryState {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoDepth: number;
  readonly redoDepth: number;
  readonly undo: HistorySummary | null;
  readonly redo: HistorySummary | null;
  readonly groupOpen: boolean;
}

export interface ProjectSnapshot {
  readonly summary: ProjectSummary;
  readonly project: Project;
  readonly assets: Asset[];
  readonly transcripts: Transcript[];
  readonly scenes: Scene[];
  readonly beatMaps: BeatMap[];
  readonly compositions: Composition[];
  readonly jobs: JobSummary[];
  readonly history: ProjectHistoryState;
}

export interface EditResult {
  readonly snapshot: ProjectSnapshot;
  readonly command: EditCommandEnvelope | null;
  readonly inverse: EditCommand | null;
}

export type ProjectEvent =
  | {
      readonly type: 'project.opened';
      readonly snapshot: ProjectSnapshot;
    }
  | {
      readonly type: 'project.changed';
      readonly snapshot: ProjectSnapshot;
      readonly reason:
        | 'edit'
        | 'undo'
        | 'redo'
        | 'assets'
        | 'metadata'
        | 'analysis'
        | 'compositions';
    }
  | {
      readonly type: 'project.closed';
      readonly projectId: string;
    };

export interface JobEvent {
  readonly type: 'jobs.changed';
  readonly job: JobSummary;
}

export type AnalysisKind =
  | 'transcript'
  | 'scenes'
  | 'beats'
  | 'vision'
  | 'embeddings';

export interface AnalysisRunRequest {
  readonly assetId: string;
  readonly kinds: readonly AnalysisKind[];
}

export interface AnalysisSkip {
  readonly kind: AnalysisKind;
  readonly reason: string;
}

export interface AnalysisRunResult {
  readonly jobs: JobSummary[];
  readonly skipped: AnalysisSkip[];
}

export interface AnalysisAssetStatus {
  readonly assetId: string;
  readonly transcript: boolean;
  readonly sceneCount: number;
  readonly descriptions: number;
  readonly beatMap: boolean;
  readonly bpm: number | null;
  readonly embeddings: boolean;
}

export interface SearchRequest {
  readonly query: string;
  readonly limit?: number;
}

export type SearchMatchKind = 'transcript' | 'scene';

export interface SearchResult {
  readonly id: string;
  readonly kind: SearchMatchKind;
  readonly assetId: string;
  readonly assetName: string;
  readonly text: string;
  readonly startFrame: number;
  readonly endFrame: number;
  readonly score: number;
  readonly thumbnailPath: string | null;
}

export interface SearchResponse {
  readonly results: SearchResult[];
  readonly vectorSearch: boolean;
}

export type ProviderKind =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'xai'
  | 'ollama'
  | 'openai-compatible';

export interface ProviderAccount {
  readonly id: string;
  readonly kind: ProviderKind;
  readonly label: string;
  readonly baseUrl: string | null;
  readonly model: string | null;
  readonly chatModel: string | null;
  readonly hasKey: boolean;
  readonly enabled: boolean;
  readonly visionConsent: boolean;
  readonly chatConsent: boolean;
}

export interface ProviderSaveRequest {
  readonly id?: string;
  readonly kind: ProviderKind;
  readonly label: string;
  readonly baseUrl?: string | null;
  readonly model?: string | null;
  readonly chatModel?: string | null;
  readonly apiKey?: string | null;
  readonly clearKey?: boolean;
  readonly enabled?: boolean;
  readonly visionConsent?: boolean;
  readonly chatConsent?: boolean;
}

export interface ProviderTestResult {
  readonly ok: boolean;
  readonly message: string;
}

export interface WhisperModelInfo {
  readonly id: string;
  readonly name: string;
  readonly fileName: string;
  readonly sizeBytes: number;
  readonly url: string;
  readonly installed: boolean;
  readonly downloadedBytes: number;
}

export interface WhisperModelInstall {
  readonly job: JobSummary;
}

export interface CompositionSaveRequest {
  readonly id?: string;
  readonly name: string;
  readonly source: string;
  readonly width?: number;
  readonly height?: number;
  readonly durationFrames?: number;
}

export interface CompositionSaveResult {
  readonly composition: Composition;
  readonly snapshot: ProjectSnapshot;
}

export interface ExportPreset {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Null dimensions mean the preset uses the sequence size. */
  readonly width: number | null;
  readonly height: number | null;
}

export const EXPORT_PRESETS: readonly ExportPreset[] = [
  {
    id: 'sequence',
    name: 'Match sequence',
    description: 'Use the sequence frame size.',
    width: null,
    height: null,
  },
  {
    id: '1080p',
    name: 'Full HD · 1080p',
    description: '1920 × 1080 landscape.',
    width: 1920,
    height: 1080,
  },
  {
    id: '720p',
    name: 'HD · 720p',
    description: '1280 × 720 landscape.',
    width: 1280,
    height: 720,
  },
  {
    id: 'vertical',
    name: 'Vertical · 1080p',
    description: '1080 × 1920 for social.',
    width: 1080,
    height: 1920,
  },
];

export const DEFAULT_EXPORT_PRESET_ID = 'sequence';

export type ExportStatus =
  | 'rendering'
  | 'encoding'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface ExportRecord {
  readonly id: string;
  readonly projectId: string;
  readonly preset: string;
  readonly outputPath: string;
  readonly status: ExportStatus;
  readonly progress: number;
  readonly error: string | null;
  readonly createdAt: number;
  readonly completedAt: number | null;
}

export interface ExportStartRequest {
  readonly presetId: string;
  readonly startFrame: number;
  readonly endFrame: number;
  readonly outputPath?: string | null;
}

export interface ExportStartResult {
  readonly export: ExportRecord;
  readonly width: number;
  readonly height: number;
  readonly frameRate: FrameRate;
  readonly startFrame: number;
  readonly endFrame: number;
  readonly frameCount: number;
}

export interface ExportFrame {
  readonly index: number;
  readonly data: Uint8Array;
}

export interface ExportEvent {
  readonly type: 'export.changed';
  readonly export: ExportRecord;
}

export interface ExportOtioResult {
  readonly path: string;
}

export type ChatToolStatus = 'running' | 'succeeded' | 'failed';

export interface ChatToolActivity {
  readonly id: string;
  readonly name: string;
  readonly status: ChatToolStatus;
  readonly input: unknown;
  readonly output?: unknown;
  readonly error?: string;
  readonly durationMs?: number;
}

export interface ChatSendRequest {
  readonly message: string;
}

export interface ChatStartResult {
  readonly turnId: string;
  readonly sessionId: string;
  readonly provider: {
    readonly id: string;
    readonly label: string;
    readonly kind: ProviderKind;
    readonly model: string | null;
  };
}

export interface ChatProviderSetting {
  readonly providerId: string | null;
  readonly provider: ProviderAccount | null;
}

export interface McpSettings {
  readonly enabled: boolean;
  readonly autoStart: boolean;
  readonly port: number;
}

export interface McpSettingsUpdate {
  readonly enabled?: boolean;
  readonly autoStart?: boolean;
  readonly port?: number;
}

export type McpActivityKind = 'server' | 'session' | 'tool' | 'auth';

export interface McpActivity {
  readonly id: string;
  readonly at: number;
  readonly kind: McpActivityKind;
  readonly ok: boolean;
  readonly message: string;
  readonly tool?: string;
}

export interface McpStatus extends McpSettings {
  readonly running: boolean;
  readonly endpoint: string | null;
  readonly token: string;
  readonly sessions: number;
  readonly activity: readonly McpActivity[];
  readonly error: string | null;
}

export interface ReferenceUseRequest {
  readonly assetId: string;
  readonly name?: string;
}

export interface ReferenceLookRequest {
  readonly profileId?: string;
  readonly clipIds?: string[];
  readonly strength?: number;
}

export interface ReferencePacing {
  readonly averageShotLengthFrames: number;
  readonly cutsPerMinute: number;
  readonly sceneCount: number;
  readonly targetShotLengthFrames: number | null;
  readonly suggestedCutFrames: number[];
}

export interface ReferenceLookResult {
  readonly commandId?: string;
  readonly appliedClipCount: number;
  readonly effectsAdded: number;
  readonly pacing: ReferencePacing;
  readonly durationFrames?: number;
}

export interface ReferencePacingResult {
  readonly added: number;
  readonly pacing: ReferencePacing;
}

export type ChatEvent =
  | {
      readonly type: 'chat.started';
      readonly turnId: string;
      readonly sessionId: string;
      readonly message: string;
      readonly providerLabel: string;
    }
  | {
      readonly type: 'chat.delta';
      readonly turnId: string;
      readonly text: string;
    }
  | {
      readonly type: 'chat.tool';
      readonly turnId: string;
      readonly tool: ChatToolActivity;
    }
  | {
      readonly type: 'chat.done';
      readonly turnId: string;
      readonly text: string;
      readonly durationMs: number;
    }
  | {
      readonly type: 'chat.aborted';
      readonly turnId: string;
    }
  | {
      readonly type: 'chat.error';
      readonly turnId: string;
      readonly error: string;
      readonly hint: string | null;
    };

export interface RendererRequest {
  readonly id: string;
  readonly kind: 'render-frame' | 'preview-composition' | 'render-export';
  readonly payload: unknown;
}

export type RendererResponse =
  | {
      readonly id: string;
      readonly ok: true;
      readonly result: unknown;
    }
  | {
      readonly id: string;
      readonly ok: false;
      readonly error: string;
    };

export interface RendererFrameResult {
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
}

export interface RendererPreviewResult {
  readonly sceneTree: unknown | null;
  readonly error: string | null;
}

export interface RendererEditorContext {
  readonly playheadFrame: number;
  readonly selectedClipIds: readonly string[];
  readonly selectedAssetId: string | null;
}

export type KerfEvent = ProjectEvent | JobEvent | ExportEvent | ChatEvent;

export const KERF_IPC = {
  app: {
    versions: 'kerf:app:versions',
  },
  projects: {
    list: 'kerf:projects:list',
    active: 'kerf:projects:active',
    create: 'kerf:projects:create',
    open: 'kerf:projects:open',
    close: 'kerf:projects:close',
    rename: 'kerf:projects:rename',
    delete: 'kerf:projects:delete',
    reveal: 'kerf:projects:reveal',
  },
  edits: {
    apply: 'kerf:edits:apply',
    undo: 'kerf:edits:undo',
    redo: 'kerf:edits:redo',
    history: 'kerf:edits:history',
  },
  assets: {
    list: 'kerf:assets:list',
    import: 'kerf:assets:import',
    pick: 'kerf:assets:pick',
    relink: 'kerf:assets:relink',
    refresh: 'kerf:assets:refresh',
  },
  jobs: {
    list: 'kerf:jobs:list',
    cancel: 'kerf:jobs:cancel',
  },
  export: {
    pickPath: 'kerf:export:pick-path',
    start: 'kerf:export:start',
    writeFrame: 'kerf:export:write-frame',
    writeFrames: 'kerf:export:write-frames',
    finish: 'kerf:export:finish',
    cancel: 'kerf:export:cancel',
    list: 'kerf:export:list',
    reveal: 'kerf:export:reveal',
    otio: 'kerf:export:otio',
  },
  analysis: {
    run: 'kerf:analysis:run',
    status: 'kerf:analysis:status',
    search: 'kerf:analysis:search',
    providers: 'kerf:analysis:providers',
    saveProvider: 'kerf:analysis:save-provider',
    deleteProvider: 'kerf:analysis:delete-provider',
    testProvider: 'kerf:analysis:test-provider',
    models: 'kerf:analysis:models',
    downloadModel: 'kerf:analysis:download-model',
    deleteModel: 'kerf:analysis:delete-model',
  },
  motion: {
    save: 'kerf:motion:save',
    delete: 'kerf:motion:delete',
  },
  mcp: {
    status: 'kerf:mcp:status',
    update: 'kerf:mcp:update',
    rotateToken: 'kerf:mcp:rotate-token',
  },
  references: {
    use: 'kerf:references:use',
    clear: 'kerf:references:clear',
    applyLook: 'kerf:references:apply-look',
    applyPacing: 'kerf:references:apply-pacing',
  },
  chat: {
    send: 'kerf:chat:send',
    abort: 'kerf:chat:abort',
    provider: 'kerf:chat:provider',
    setProvider: 'kerf:chat:set-provider',
  },
  renderer: {
    request: 'kerf:renderer:request',
    response: 'kerf:renderer:response',
    editor: 'kerf:renderer:editor',
  },
  event: 'kerf:event',
} as const;

export interface KerfEventEnvelope {
  readonly id: string;
  readonly at: number;
  readonly event: KerfEvent;
}

/** The complete surface exposed on `window.kerf`. Keep this allowlist small. */
export interface KerfBridge {
  readonly getVersions: () => AppVersions;
  readonly projects: {
    readonly list: () => Promise<ProjectSummary[]>;
    readonly active: () => Promise<ProjectSnapshot | null>;
    readonly create: (name: string) => Promise<ProjectSnapshot>;
    readonly open: (id: string) => Promise<ProjectSnapshot>;
    readonly close: () => Promise<void>;
    readonly rename: (id: string, name: string) => Promise<ProjectSummary>;
    readonly delete: (id: string, removeFolder?: boolean) => Promise<boolean>;
    readonly reveal: (id: string) => Promise<void>;
  };
  readonly edits: {
    readonly apply: (command: EditCommand) => Promise<EditResult>;
    readonly undo: () => Promise<EditResult | null>;
    readonly redo: () => Promise<EditResult | null>;
    readonly history: () => Promise<ProjectHistoryState>;
  };
  readonly assets: {
    readonly list: () => Promise<Asset[]>;
    readonly import: (paths: readonly string[]) => Promise<Asset[]>;
    readonly pick: () => Promise<Asset[]>;
    readonly refresh: () => Promise<Asset[]>;
    readonly relink: (id: string, path?: string) => Promise<Asset | null>;
  };
  readonly jobs: {
    readonly list: (projectId?: string) => Promise<JobSummary[]>;
    readonly cancel: (id: string) => Promise<boolean>;
  };
  readonly export: {
    readonly pickPath: (presetId?: string) => Promise<string | null>;
    readonly start: (request: ExportStartRequest) => Promise<ExportStartResult>;
    readonly writeFrame: (
      id: string,
      index: number,
      data: Uint8Array,
    ) => Promise<void>;
    readonly writeFrames: (
      id: string,
      frames: readonly ExportFrame[],
    ) => Promise<void>;
    readonly finish: (id: string) => Promise<ExportRecord>;
    readonly cancel: (id: string) => Promise<boolean>;
    readonly list: (projectId?: string) => Promise<ExportRecord[]>;
    readonly reveal: (id: string) => Promise<void>;
    readonly otio: () => Promise<ExportOtioResult | null>;
  };
  readonly analysis: {
    readonly run: (request: AnalysisRunRequest) => Promise<AnalysisRunResult>;
    readonly status: () => Promise<AnalysisAssetStatus[]>;
    readonly search: (request: SearchRequest) => Promise<SearchResponse>;
    readonly providers: () => Promise<ProviderAccount[]>;
    readonly saveProvider: (
      request: ProviderSaveRequest,
    ) => Promise<ProviderAccount>;
    readonly deleteProvider: (id: string) => Promise<boolean>;
    readonly testProvider: (id: string) => Promise<ProviderTestResult>;
    readonly models: () => Promise<WhisperModelInfo[]>;
    readonly downloadModel: (id: string) => Promise<WhisperModelInstall>;
    readonly deleteModel: (id: string) => Promise<boolean>;
  };
  readonly motion: {
    readonly save: (
      request: CompositionSaveRequest,
    ) => Promise<CompositionSaveResult>;
    readonly delete: (id: string) => Promise<ProjectSnapshot>;
  };
  readonly mcp: {
    readonly status: () => Promise<McpStatus>;
    readonly update: (settings: McpSettingsUpdate) => Promise<McpStatus>;
    readonly rotateToken: () => Promise<McpStatus>;
  };
  readonly references: {
    readonly use: (request: ReferenceUseRequest) => Promise<ProjectSnapshot>;
    readonly clear: () => Promise<ProjectSnapshot>;
    readonly applyLook: (
      request: ReferenceLookRequest,
    ) => Promise<ReferenceLookResult>;
    readonly applyPacing: () => Promise<ReferencePacingResult>;
  };
  readonly chat: {
    readonly send: (request: ChatSendRequest) => Promise<ChatStartResult>;
    readonly abort: () => Promise<boolean>;
    readonly provider: () => Promise<ChatProviderSetting>;
    readonly setProvider: (
      providerId: string | null,
    ) => Promise<ChatProviderSetting>;
  };
  readonly renderer: {
    readonly subscribe: (
      listener: (request: RendererRequest) => void,
    ) => () => void;
    readonly respond: (response: RendererResponse) => Promise<void>;
    readonly setEditorContext: (
      context: RendererEditorContext,
    ) => Promise<void>;
  };
  readonly events: {
    readonly subscribe: (listener: (event: KerfEvent) => void) => () => void;
  };
}
