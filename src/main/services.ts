import { HighlightService } from './analysis/highlight-service';
import { AudioFinishingService } from './audio/finishing';
import { NoiseReductionService } from './audio/noise-reduction';
import { RoughCutService } from './analysis/rough-cut-service';
import { ReframeService } from './analysis/reframe-service';
import { EditingService } from './tools/editing';
import { app, shell } from 'electron';
import { join } from 'node:path';
import type { DatabaseHandle } from './db';
import { openDatabase } from './db';
import { JobQueue } from './jobs';
import { ExportService } from './export';
import { electronSecrets } from './security/secrets';
import { MediaImportService } from './media';
import { ProjectRepository, ProjectService } from './projects';
import { AnalysisService } from './analysis/service';
import { AgentService } from './agent/service';
import { RendererBridge } from './renderer-bridge';
import { ToolService } from './tools/service';
import { McpService } from './mcp/service';
import type { KerfEvent } from '../shared/contracts';
import { ScreenPolishService } from './analysis/screen-polish-service';
import { AutoCutService } from './analysis/auto-cut-service';
import { TtsService } from './tts/service';

export interface KerfServices {
  readonly reframe: ReframeService;
  readonly screenPolish: ScreenPolishService;
  readonly noiseReduction: NoiseReductionService;
  readonly autoCut: AutoCutService;
  readonly tts: TtsService;
  readonly database: DatabaseHandle;
  readonly repository: ProjectRepository;
  readonly projects: ProjectService;
  readonly jobs: JobQueue;
  readonly imports: MediaImportService;
  readonly exports: ExportService;
  readonly analysis: AnalysisService;
  readonly renderer: RendererBridge;
  readonly tools: ToolService;
  readonly agent: AgentService;
  readonly mcp: McpService;
  dispose(): void;
}

export interface CreateKerfServicesOptions {
  readonly broadcast?: (event: KerfEvent) => void;
}

function projectsRoot(): string {
  const configured = process.env.KERF_PROJECTS_ROOT?.trim();
  if (configured) {
    return configured;
  }
  return join(app.getPath('videos'), 'Kerf Projects');
}

function databasePath(): string {
  return (
    process.env.KERF_DATABASE_PATH?.trim() ||
    join(app.getPath('userData'), 'kerf.db')
  );
}

export function createKerfServices(
  options: CreateKerfServicesOptions = {},
): KerfServices {
  const database = openDatabase({
    filename: databasePath(),
  });
  try {
    const repository = new ProjectRepository({
      database: database.connection,
      projectsRoot: projectsRoot(),
    });
    const jobs = new JobQueue({ database: database.connection });
    const projects = new ProjectService({
      repository,
      jobs: (projectId) => jobs.list(projectId),
    });
    const reframe = new ReframeService({
      projects,
      repository,
      database: database.connection,
    });
    const imports = new MediaImportService({
      repository,
      jobs,
      onAssetsChanged: (projectId) => {
        if (projects.current()?.project.id === projectId) {
          projects.reloadAssets();
        }
      },
    });
    const noiseReduction = new NoiseReductionService((id) =>
      repository.folderFor(id),
    );
    const exportService = new ExportService({
      repository,
      projects,
      noiseReduction,
    });
    const tts = new TtsService({
      database: database.connection,
      secrets: electronSecrets,
      projects,
      repository,
      jobs,
      imports,
    });
    const analysis = new AnalysisService({
      database,
      repository,
      projects,
      jobs,
      userData: app.getPath('userData'),
      secrets: electronSecrets,
    });
    const screenPolish = new ScreenPolishService({
      projects,
      repository,
      jobs,
      providers: analysis.providers,
    });
    const autoCut = new AutoCutService({
      projects,
      repository,
      jobs,
      providers: analysis.providers,
      userData: app.getPath('userData'),
    });
    const renderer = new RendererBridge({
      framesDir: join(app.getPath('userData'), 'tool-frames'),
    });
    const roughCut = new RoughCutService({
      referenceProfiles: (projectId) =>
        repository.listReferenceProfiles(projectId),
      projects,
      jobs,
      search: (request) => analysis.query(request),
    });
    const editing = new EditingService({
      roughCut,
      projects,
      jobs,
      autoCut,
      screenPolish,
      providers: analysis.providers,
      database: database.connection,
    });
    const highlights = new HighlightService({
      projects,
      repository,
      jobs,
      providers: analysis.providers,
      database: database.connection,
    });
    const audio = new AudioFinishingService({ projects, noiseReduction });
    const tools = new ToolService({
      highlights,
      audio,
      editing,
      projects,
      repository,
      analysis,
      exports: exportService,
      renderer: () => (renderer.available() ? renderer : null),
      editorContext: () => renderer.editorContext(),
      saveComposition: async (request) => {
        const result = await analysis.saveComposition(request);
        return result.composition;
      },
      renderExport: (result) => renderer.renderExport(result),
      revealExport: (path) => shell.showItemInFolder(path),
    });
    const agent = new AgentService({
      database: database.connection,
      projects,
      providers: analysis.providers,
      tools,
      broadcast: options.broadcast ?? (() => undefined),
    });
    const mcp = new McpService({
      database: database.connection,
      secrets: electronSecrets,
      tools,
    });
    return {
      reframe,
      screenPolish,
      noiseReduction,
      autoCut,
      tts,
      database,
      repository,
      projects,
      jobs,
      imports,
      exports: exportService,
      analysis,
      renderer,
      tools,
      agent,
      mcp,
      dispose() {
        reframe.dispose();
        roughCut.dispose();
        screenPolish.dispose();
        autoCut.dispose();
        tts.dispose();
        agent.dispose();
        audio.dispose();
        noiseReduction.dispose();
        highlights.dispose();
        mcp.dispose();
        renderer.dispose();
        exportService.dispose();
        projects.close();
        jobs.stop();
        database.close();
      },
    };
  } catch (error) {
    database.close();
    throw error;
  }
}
