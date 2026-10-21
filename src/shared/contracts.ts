import type {
  Asset,
  BeatMap,
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

/** The complete surface exposed on `window.kerf`. Keep this allowlist small. */
export interface KerfBridge {
  readonly getVersions: () => AppVersions;
}
