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

export interface JobSummary {
  readonly id: string;
  readonly projectId: string | null;
  readonly kind: string;
  readonly status: string;
  readonly stage: string;
  readonly progress: number;
  readonly error: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
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
      readonly reason: 'edit' | 'undo' | 'redo' | 'assets';
    }
  | {
      readonly type: 'project.closed';
      readonly projectId: string;
    };

export type KerfEvent = ProjectEvent;

/** The complete surface exposed on `window.kerf`. Keep this allowlist small. */
export interface KerfBridge {
  readonly getVersions: () => AppVersions;
}
