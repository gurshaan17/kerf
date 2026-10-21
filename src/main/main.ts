import { app, BrowserWindow } from 'electron';
import started from 'electron-squirrel-startup';
import { registerProjectIpc } from './ipc';
import { broadcastEvent, createKerfServices } from './services';
import type { KerfServices } from './services';
import { createMainWindow } from './windows';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

let services: KerfServices | null = null;
let unregisterIpc: (() => void) | null = null;

void app.whenReady().then(() => {
  services = createKerfServices();
  unregisterIpc = registerProjectIpc({
    projects: services.projects,
    repository: services.repository,
    broadcast: broadcastEvent,
  });

  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('before-quit', () => {
  unregisterIpc?.();
  unregisterIpc = null;
  services?.dispose();
  services = null;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
