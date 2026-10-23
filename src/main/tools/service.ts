import type {
  Actor,
  BeatMap,
  Composition,
  EditCommand,
  ReferenceProfile,
} from '@kerf/model';
import type {
  ToolContext,
  ToolEditResult,
  ToolEditorContext,
  ToolExportRecord,
  ToolExportStartResult,
  ToolRendererBridge,
  ToolSearchHit,
  ToolSearchResponse,
  ToolSnapshot,
} from '@kerf/tools';
import { toolRegistry } from '@kerf/tools';
import {
  EXPORT_PRESETS,
  type CompositionSaveRequest,
  type EditResult,
  type ExportRecord,
  type ExportStartRequest,
  type ExportStartResult,
  type ProjectSnapshot,
  type SearchRequest,
  type SearchResponse,
} from '../../shared/contracts';

export interface ToolProjectSource {
  current(): ProjectSnapshot | null;
  apply(
    command: unknown,
    options?: { readonly actor?: Actor; readonly label?: string },
  ): EditResult;
  refresh(
    reason?: 'analysis' | 'compositions' | 'assets' | 'metadata',
  ): ProjectSnapshot;
}

export interface ToolRepositorySource {
  listReferenceProfiles(
    projectId: string,
  ): import('@kerf/model').ReferenceProfile[];
  saveReferenceProfile(
    projectId: string,
    profile: import('@kerf/model').ReferenceProfile,
  ): import('@kerf/model').ReferenceProfile;
}

export interface ToolAnalysisSource {
  query(request: SearchRequest): SearchResponse;
  detectBeats?(assetId: string): Promise<BeatMap>;
  profileReference?(assetId: string, name?: string): Promise<ReferenceProfile>;
}

export interface ToolExportSource {
  list(projectId?: string): ExportRecord[];
  get(id: string): ExportRecord | null;
  start(request: ExportStartRequest): ExportStartResult;
  cancel(id: string): boolean;
}

export interface ToolServiceOptions {
  readonly projects: ToolProjectSource;
  readonly repository: ToolRepositorySource;
  readonly analysis?: ToolAnalysisSource;
  readonly exports: ToolExportSource;
  readonly renderer?: () => ToolRendererBridge | null;
  readonly editorContext?: () => ToolEditorContext;
  readonly saveComposition?: (
    request: CompositionSaveRequest,
  ) => Promise<Composition>;
  readonly renderExport?: (result: ExportStartResult) => Promise<void>;
  readonly revealExport?: (path: string) => void;
  readonly now?: () => number;
}

const DEFAULT_EDITOR_CONTEXT: ToolEditorContext = {
  playheadFrame: 0,
  selectedClipIds: [],
  selectedAssetId: null,
};

function toToolRecord(record: ExportRecord): ToolExportRecord {
  return {
    id: record.id,
    preset: record.preset,
    outputPath: record.outputPath,
    status: record.status,
    progress: record.progress,
    error: record.error,
    createdAt: record.createdAt,
    completedAt: record.completedAt,
  };
}

function toToolStart(result: ExportStartResult): ToolExportStartResult {
  return {
    export: toToolRecord(result.export),
    width: result.width,
    height: result.height,
    frameRate: result.frameRate,
    startFrame: result.startFrame,
    endFrame: result.endFrame,
    frameCount: result.frameCount,
  };
}

/**
 * Adapts the open project and the render/export services to the tool contract.
 * Calls are serialised so a model cannot race two edits against the same
 * sequence snapshot.
 */
export class ToolService {
  private readonly options: ToolServiceOptions;
  private queue: Promise<unknown> = Promise.resolve();
  private editor: ToolEditorContext = DEFAULT_EDITOR_CONTEXT;

  constructor(options: ToolServiceOptions) {
    this.options = options;
  }

  names(): readonly string[] {
    return toolRegistry.names();
  }

  setEditorContext(context: ToolEditorContext): void {
    this.editor = {
      playheadFrame: Math.max(0, Math.round(context.playheadFrame)),
      selectedClipIds: [...context.selectedClipIds],
      selectedAssetId: context.selectedAssetId,
    };
  }

  call(
    name: string,
    input: unknown,
    actor: 'agent' | 'mcp' | 'system' | 'user' = 'agent',
  ): Promise<unknown> {
    const run = this.queue.then(() =>
      toolRegistry.call(name, input, this.context(actor)),
    );
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private context(actor: 'agent' | 'mcp' | 'system' | 'user'): ToolContext {
    return {
      snapshot: () => this.snapshot(),
      editor: () => this.editor,
      apply: (command, options) => this.apply(command, actor, options?.label),
      applyBatch: (commands, options) =>
        this.applyBatch(commands, actor, options?.label),
      search: (request) => this.search(request),
      renderer: () => this.options.renderer?.() ?? null,
      exports: () => this.exports(),
      saveComposition: this.options.saveComposition
        ? (request) => this.options.saveComposition!(request)
        : undefined,
      detectBeats: this.options.analysis?.detectBeats
        ? (assetId) => this.options.analysis!.detectBeats!(assetId)
        : undefined,
      profileReference: (request) => this.profileReference(request),
      now: () => this.options.now?.() ?? Date.now(),
    };
  }

  private snapshot(): ToolSnapshot | null {
    const snapshot = this.options.projects.current();
    if (!snapshot) {
      return null;
    }
    return this.toolSnapshot(snapshot);
  }

  private toolSnapshot(snapshot: ProjectSnapshot): ToolSnapshot {
    return {
      project: snapshot.project,
      assets: snapshot.assets,
      transcripts: snapshot.transcripts,
      scenes: snapshot.scenes,
      beatMaps: snapshot.beatMaps,
      compositions: snapshot.compositions,
      referenceProfiles: this.options.repository.listReferenceProfiles(
        snapshot.project.id,
      ),
    };
  }

  private apply(
    command: EditCommand,
    actor: 'agent' | 'mcp' | 'system' | 'user',
    label?: string,
  ): ToolEditResult {
    const result = this.options.projects.apply(command, { actor, label });
    if (!result.command) {
      throw new Error('The edit did not return a command envelope.');
    }
    return {
      snapshot: this.toolSnapshot(result.snapshot),
      command: result.command,
      inverse: result.inverse,
    };
  }

  private applyBatch(
    commands: readonly EditCommand[],
    actor: 'agent' | 'mcp' | 'system' | 'user',
    label?: string,
  ): ToolEditResult {
    if (commands.length === 0) {
      throw new Error('A batch must contain at least one command.');
    }
    if (commands.length === 1) {
      return this.apply(commands[0]!, actor, label);
    }
    const batch: EditCommand = {
      type: 'batch',
      label: label ?? 'Batch edit',
      commands: [...commands],
    };
    return this.apply(batch, actor, label ?? 'Batch edit');
  }

  private search(request: {
    readonly query: string;
    readonly limit?: number;
  }): ToolSearchResponse {
    if (!this.options.analysis) {
      throw new Error('Search is not available in this session.');
    }
    const response = this.options.analysis.query(request);
    const results: ToolSearchHit[] = response.results.map((result) => ({
      id: result.id,
      kind: result.kind,
      assetId: result.assetId,
      assetName: result.assetName,
      text: result.text,
      startFrame: result.startFrame,
      endFrame: result.endFrame,
      score: result.score,
    }));
    return { results, vectorSearch: response.vectorSearch };
  }

  private exports() {
    const service = this.options.exports;
    return {
      list: () => service.list().map(toToolRecord),
      get: (id: string) => {
        const record = service.get(id);
        return record ? toToolRecord(record) : null;
      },
      presets: () => EXPORT_PRESETS.map((preset) => ({ ...preset })),
      start: async (request: {
        readonly presetId: string;
        readonly startFrame: number;
        readonly endFrame: number;
        readonly outputPath?: string | null;
      }) => {
        if (!this.options.renderer?.() && !this.options.renderExport) {
          throw new Error(
            'The editor window must be open before an export can render frames.',
          );
        }
        const result = service.start(request);
        if (this.options.renderExport) {
          void this.options.renderExport(result).catch(() => {
            service.cancel(result.export.id);
          });
        }
        return toToolStart(result);
      },
      reveal: async (id: string) => {
        const record = service.get(id);
        if (!record) {
          throw new Error('That export is not in this project.');
        }
        this.options.revealExport?.(record.outputPath);
      },
    };
  }

  private async profileReference(request: {
    readonly assetId: string;
    readonly name?: string;
  }): Promise<ReferenceProfile> {
    if (!this.options.analysis?.profileReference) {
      throw new Error('Reference profiling is not available in this session.');
    }
    return this.options.analysis.profileReference(
      request.assetId,
      request.name,
    );
  }
}
