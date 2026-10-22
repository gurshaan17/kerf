import { app } from 'electron';
import { join } from 'node:path';
import type { DatabaseHandle } from './db';
import { openDatabase } from './db';
import { JobQueue } from './jobs';
import { ExportService } from './export';
import { MediaImportService } from './media';
import { ProjectRepository, ProjectService } from './projects';

export interface KerfServices {
  readonly database: DatabaseHandle;
  readonly repository: ProjectRepository;
  readonly projects: ProjectService;
  readonly jobs: JobQueue;
  readonly imports: MediaImportService;
  readonly exports: ExportService;
  dispose(): void;
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

export function createKerfServices(): KerfServices {
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
    return {
      database,
      repository,
      projects,
      jobs,
      imports,
      exports: exportService,
      dispose() {
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
