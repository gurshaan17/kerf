import type {
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
import type { SceneTree } from '@kerf/motion';

/** The slice of project state a tool may inspect. */
export interface ToolSnapshot {
  readonly project: Project;
  readonly assets: readonly Asset[];
  readonly transcripts: readonly Transcript[];
  readonly scenes: readonly Scene[];
  readonly beatMaps: readonly BeatMap[];
  readonly referenceProfiles: readonly ReferenceProfile[];
  readonly compositions: readonly Composition[];
}

export interface ToolEditorContext {
  readonly playheadFrame: number;
  readonly selectedClipIds: readonly string[];
  readonly selectedAssetId: string | null;
}

export interface ToolApplyOptions {
  readonly label?: string;
  readonly actor?: 'agent' | 'mcp' | 'system' | 'user';
}

export interface ToolEditResult {
  readonly snapshot: ToolSnapshot;
  readonly command: EditCommandEnvelope;
  readonly inverse: EditCommand | null;
}

export interface ToolSearchRequest {
  readonly query: string;
  readonly limit?: number;
  readonly assetIds?: readonly string[];
}

export interface ToolSearchHit {
  readonly id: string;
  readonly kind: 'transcript' | 'scene';
  readonly assetId: string;
  readonly assetName: string;
  readonly text: string;
  readonly startFrame: number;
  readonly endFrame: number;
  readonly score: number;
  readonly evidence?: readonly import('./rough-cut').SourceEvidence[];
  readonly sourceFrameRate?: FrameRate;
}

export interface ToolSearchResponse {
  readonly results: readonly ToolSearchHit[];
  readonly vectorSearch: boolean;
}

export interface ToolRenderFrameRequest {
  readonly signal?: AbortSignal;
  readonly frame: number;
  readonly maxWidth?: number;
}

export interface ToolRenderedFrame {
  readonly frame: number;
  readonly width: number;
  readonly height: number;
  readonly mimeType: 'image/png';
  /** A local cache path. Absolute paths never leave the renderer boundary. */
  readonly path: string;
}

export interface ToolCompositionPreviewRequest {
  readonly source: string;
  readonly frame?: number;
}

export interface ToolCompositionPreviewResult {
  readonly valid: boolean;
  readonly sceneTree: SceneTree | null;
  readonly error: string | null;
}

export interface ToolExportRecord {
  readonly id: string;
  readonly preset: string;
  readonly outputPath: string;
  readonly status:
    | 'rendering'
    | 'encoding'
    | 'succeeded'
    | 'failed'
    | 'cancelled';
  readonly progress: number;
  readonly error: string | null;
  readonly createdAt: number;
  readonly completedAt: number | null;
}

export interface ToolExportPreset {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly width: number | null;
  readonly height: number | null;
}

export interface ToolExportStartRequest {
  readonly presetId: string;
  readonly startFrame: number;
  readonly endFrame: number;
  readonly outputPath?: string | null;
}

export interface ToolExportStartResult {
  readonly export: ToolExportRecord;
  readonly width: number;
  readonly height: number;
  readonly frameRate: FrameRate;
  readonly startFrame: number;
  readonly endFrame: number;
  readonly frameCount: number;
}

export interface ToolExportAccess {
  list(): readonly ToolExportRecord[];
  get(id: string): ToolExportRecord | null;
  presets(): readonly ToolExportPreset[];
  start(request: ToolExportStartRequest): Promise<ToolExportStartResult>;
  reveal(id: string): Promise<void>;
}

export interface ToolRendererBridge {
  renderFrame(request: ToolRenderFrameRequest): Promise<ToolRenderedFrame>;
  previewComposition(
    request: ToolCompositionPreviewRequest,
  ): Promise<ToolCompositionPreviewResult>;
}

export interface ToolCompositionSaveRequest {
  readonly id?: string;
  readonly name: string;
  readonly source: string;
  readonly width?: number;
  readonly height?: number;
  readonly durationFrames?: number;
}

export interface ToolReferenceProfileRequest {
  readonly assetId: string;
  readonly name?: string;
}

export interface ToolContext {
  readonly actor?: ToolApplyOptions['actor'];
  readonly signal?: AbortSignal;
  checkAccess?(): void;
  visualReview?(): import('./visual-review').ToolVisualReviewAccess;
  editing?(): ToolEditingAccess;
  snapshot(): ToolSnapshot | null;
  editor(): ToolEditorContext;
  apply(command: EditCommand, options?: ToolApplyOptions): ToolEditResult;
  applyBatch(
    commands: readonly EditCommand[],
    options?: ToolApplyOptions,
  ): ToolEditResult;
  search(request: ToolSearchRequest): ToolSearchResponse;
  renderer(): ToolRendererBridge | null;
  exports(): ToolExportAccess;
  saveComposition?(request: ToolCompositionSaveRequest): Promise<Composition>;
  detectBeats?(assetId: string): Promise<BeatMap>;
  profileReference?(
    request: ToolReferenceProfileRequest,
  ): Promise<ReferenceProfile>;
  now(): number;
}

/** Facts captured immediately around a committed engine command. */
export interface EditReceipt {
  readonly commandId: string;
  readonly frameRate: FrameRate;
  readonly undoable: boolean;
  readonly projectId: string;
  readonly label: string;
  readonly beforeDurationFrames: number;
  readonly afterDurationFrames: number;
  readonly changes: readonly {
    clipId: string;
    label: string;
    kind: 'added' | 'changed' | 'removed';
    /** Post-commit clip/source identity; absent on older receipts. */
    fingerprint?: string | null;
    startFrame: number;
    endFrame: number;
    visual: boolean;
  }[];
}

export interface EditingJob {
  readonly id: string;
  readonly projectId: string | null;
  readonly kind: string;
  readonly status: string;
  readonly stage: string;
  readonly progress: number;
  readonly error: string | null;
  readonly reviewStatus: 'none' | 'awaiting-review' | 'applied' | 'cancelled';
}
export interface EditingProposal {
  readonly jobId: string;
  readonly projectId: string;
  readonly clipId: string;
  readonly assetId: string;
  readonly fingerprint: string;
  readonly kind: 'autoCut' | 'screenPolish' | 'roughCut';
  readonly roughCut?: {
    intent: string;
    assetIds: readonly string[];
    targetDurationSeconds?: number;
    estimatedDurationFrames: number;
    estimatedDurationSeconds: number;
    appendAtFrame: number;
    unmetConstraints: readonly string[];
  };
  readonly changes: readonly {
    assetId?: string;
    evidenceId?: string;
    evidenceKind?: 'transcript' | 'scene';
    sourceFrameRate?: FrameRate;
    sourceInFrame?: number;
    durationFrames?: number;
    id: string;
    startFrame: number;
    endFrame: number;
    reason: string;
    evidenceFrames: readonly number[];
    description: string;
  }[];
  readonly frameSpace: 'source' | 'sequence';
}
export interface EditingReview {
  readonly job: EditingJob;
  readonly proposal: EditingProposal | null;
  readonly selectedIds: readonly string[];
  readonly receipt?: EditReceipt;
}
export interface ToolEditingAccess {
  planRoughCut?(
    input: import('./rough-cut').RoughCutPlanRequest,
  ): EditingJob & { proposal: EditingProposal };
  providers(): readonly {
    id: string;
    label: string;
    enabled: boolean;
    visionConsent: boolean;
    chatConsent: boolean;
  }[];
  start(
    kind: 'autoCut' | 'screenPolish',
    input: { clipId: string; providerId: string; purpose?: string },
  ): EditingJob;
  read(jobId: string): EditingJob;
  cancel(jobId: string): EditingJob;
  proposal(jobId: string): EditingProposal | null;
  requestApply(
    jobId: string,
    changeIds: readonly string[],
  ): { status: 'awaiting-review'; jobId: string };
}
