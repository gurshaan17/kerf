import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import type { OpenDialogOptions } from 'electron';
import { z } from 'zod';
import {
  AUDIO_EXTENSIONS,
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
} from '@kerf/model';
import type { JobQueue } from '../jobs';
import type { MediaImportService } from '../media';
import type { ProjectRepository } from '../projects';
import type { ProjectService } from '../projects';
import { KERF_IPC, type KerfEvent } from '../../shared/contracts';

const projectIdSchema = z.string().min(1);
const projectNameSchema = z.string().trim().min(1).max(120);
const importPathsSchema = z.array(z.string().min(1)).max(100);
const MEDIA_EXTENSIONS = [
  ...VIDEO_EXTENSIONS,
  ...AUDIO_EXTENSIONS,
  ...IMAGE_EXTENSIONS,
];

export interface ProjectIpcOptions {
  readonly projects: ProjectService;
  readonly repository: ProjectRepository;
  readonly jobs: JobQueue;
  readonly imports: MediaImportService;
  readonly broadcast: (event: KerfEvent) => void;
}

function requireActiveProject(projects: ProjectService) {
  const active = projects.current();
  if (!active) {
    throw new Error('Open a project before working with footage.');
  }
  return active;
}

export function registerProjectIpc(options: ProjectIpcOptions): () => void {
  const { projects, repository, jobs, imports, broadcast } = options;

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

  ipcMain.handle(KERF_IPC.assets.list, () => {
    return projects.current()?.assets ?? [];
  });
  ipcMain.handle(KERF_IPC.assets.import, (_event, paths: unknown) => {
    const active = requireActiveProject(projects);
    return imports.importFiles(
      active.project.id,
      importPathsSchema.parse(paths),
    );
  });
  ipcMain.handle(KERF_IPC.assets.pick, async () => {
    const active = requireActiveProject(projects);
    const options: OpenDialogOptions = {
      title: 'Import footage',
      buttonLabel: 'Import',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Footage', extensions: [...MEDIA_EXTENSIONS] },
        { name: 'All files', extensions: ['*'] },
      ],
    };
    const window = BrowserWindow.getFocusedWindow();
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) {
      return [];
    }
    return imports.importFiles(active.project.id, result.filePaths);
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
      ...Object.values(KERF_IPC.assets),
      ...Object.values(KERF_IPC.jobs),
    ]) {
      ipcMain.removeHandler(channel);
    }
  };
}
