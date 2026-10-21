import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import type { DatabaseHandle } from './db';
import { openDatabase } from './db';
import { ProjectRepository, ProjectService } from './projects';
import { KERF_IPC, type KerfEventEnvelope } from '../shared/contracts';

export interface KerfServices {
  readonly database: DatabaseHandle;
  readonly repository: ProjectRepository;
  readonly projects: ProjectService;
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
    const projects = new ProjectService({ repository });
    return {
      database,
      repository,
      projects,
      dispose() {
        projects.close();
        database.close();
      },
    };
  } catch (error) {
    database.close();
    throw error;
  }
}

export function broadcastEvent(envelope: KerfEventEnvelope): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send(KERF_IPC.event, envelope);
    }
  }
}
