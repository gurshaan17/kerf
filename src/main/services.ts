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
import type { KerfEvent } from '../shared/contracts';

export interface KerfServices {
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
    const imports = new MediaImportService({
      repository,
      jobs,
      onAssetsChanged: (projectId) => {
        if (projects.current()?.project.id === projectId) {
          projects.reloadAssets();
        }
      },
    });
    const exportService = new ExportService({ repository, projects });
    const analysis = new AnalysisService({
      database,
      repository,
      projects,
      jobs,
      userData: app.getPath('userData'),
      secrets: electronSecrets,
    });
    const renderer = new RendererBridge({
      framesDir: join(app.getPath('userData'), 'tool-frames'),
    });
    const tools = new ToolService({
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
      projects,
      providers: analysis.providers,
      tools,
      broadcast: options.broadcast ?? (() => undefined),
    });
    return {
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
      dispose() {
        agent.abort();
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
