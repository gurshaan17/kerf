import type {
  Actor,
  Asset,
  BeatMap,
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
      readonly reason: 'edit' | 'undo' | 'redo' | 'assets' | 'metadata';
    }
  | {
      readonly type: 'project.closed';
      readonly projectId: string;
    };

export interface JobEvent {
  readonly type: 'jobs.changed';
  readonly job: JobSummary;
}

export type KerfEvent = ProjectEvent | JobEvent;

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
    presets: 'kerf:export:presets',
    start: 'kerf:export:start',
    list: 'kerf:export:list',
  },
  analysis: {
    run: 'kerf:analysis:run',
    status: 'kerf:analysis:status',
  },
  mcp: {
    status: 'kerf:mcp:status',
  },
  chat: {
    send: 'kerf:chat:send',
    abort: 'kerf:chat:abort',
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
  readonly jobs: {
    readonly list: (projectId?: string) => Promise<JobSummary[]>;
    readonly cancel: (id: string) => Promise<boolean>;
  };
  readonly events: {
    readonly subscribe: (listener: (event: KerfEvent) => void) => () => void;
  };
}
