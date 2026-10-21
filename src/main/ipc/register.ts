import { ipcMain, shell } from 'electron';
import { z } from 'zod';
import type { JobQueue } from '../jobs';
import type { ProjectRepository } from '../projects';
import type { ProjectService } from '../projects';
import { KERF_IPC, type KerfEvent } from '../../shared/contracts';

const projectIdSchema = z.string().min(1);
const projectNameSchema = z.string().trim().min(1).max(120);

export interface ProjectIpcOptions {
  readonly projects: ProjectService;
  readonly repository: ProjectRepository;
  readonly jobs: JobQueue;
  readonly broadcast: (event: KerfEvent) => void;
}

export function registerProjectIpc(options: ProjectIpcOptions): () => void {
  const { projects, repository, jobs, broadcast } = options;

  ipcMain.handle(KERF_IPC.projects.list, () => projects.list());
  ipcMain.handle(KERF_IPC.projects.active, () => projects.current());
  ipcMain.handle(KERF_IPC.projects.create, (_event, name: unknown) =>
    projects.create({ name: projectNameSchema.parse(name) }),
  );
  ipcMain.handle(KERF_IPC.projects.open, (_event, id: unknown) =>
    projects.open(projectIdSchema.parse(id)),
  );
  ipcMain.handle(KERF_IPC.projects.close, () => {
    projects.close();
  });
  ipcMain.handle(
    KERF_IPC.projects.rename,
    (_event, id: unknown, name: unknown) =>
      projects.rename(projectIdSchema.parse(id), projectNameSchema.parse(name)),
  );
  ipcMain.handle(
    KERF_IPC.projects.delete,
    (_event, id: unknown, removeFolder: unknown) =>
      projects.delete(
        projectIdSchema.parse(id),
        removeFolder === undefined ? true : z.boolean().parse(removeFolder),
      ),
  );
  ipcMain.handle(KERF_IPC.projects.reveal, (_event, id: unknown) => {
    const folder = repository.folderFor(projectIdSchema.parse(id));
    if (!folder) {
      throw new Error('Project folder was not found.');
    }
    shell.showItemInFolder(folder);
  });

  ipcMain.handle(KERF_IPC.edits.apply, (_event, command: unknown) =>
    projects.apply(command),
  );
  ipcMain.handle(KERF_IPC.edits.undo, () => projects.undo());
  ipcMain.handle(KERF_IPC.edits.redo, () => projects.redo());
  ipcMain.handle(KERF_IPC.edits.history, () => projects.history());

  ipcMain.handle(KERF_IPC.jobs.list, (_event, projectId: unknown) =>
    jobs.list(
      projectId === undefined ? undefined : projectIdSchema.parse(projectId),
    ),
  );
  ipcMain.handle(KERF_IPC.jobs.cancel, (_event, id: unknown) =>
    jobs.cancel(projectIdSchema.parse(id)),
  );

  const unsubscribe = projects.subscribe((event) => {
    broadcast(event);
  });

  return () => {
    unsubscribe();
    for (const channel of [
      ...Object.values(KERF_IPC.projects),
      ...Object.values(KERF_IPC.edits),
      ...Object.values(KERF_IPC.jobs),
    ]) {
      ipcMain.removeHandler(channel);
    }
  };
}
