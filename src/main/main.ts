import { app, BrowserWindow } from 'electron';
import started from 'electron-squirrel-startup';
import { broadcastEvent, registerProjectIpc } from './ipc';
import {
  installContentSecurityPolicy,
  installMediaProtocol,
  installNavigationGuards,
  registerMediaScheme,
} from './security';
import { createKerfServices } from './services';
import type { KerfServices } from './services';
import { createMainWindow } from './windows';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  registerMediaScheme();
  installNavigationGuards();

  let services: KerfServices | null = null;
  let unregisterIpc: (() => void) | null = null;
  let unsubscribeJobs: (() => void) | null = null;
  let unsubscribeExports: (() => void) | null = null;

  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows();
    if (!window) {
      createMainWindow();
      return;
    }
    if (window.isMinimized()) {
      window.restore();
    }
    window.show();
    window.focus();
  });

  void app.whenReady().then(() => {
    installContentSecurityPolicy();
    services = createKerfServices();
    installMediaProtocol(services.repository);
    unregisterIpc = registerProjectIpc({
      projects: services.projects,
      repository: services.repository,
      jobs: services.jobs,
      imports: services.imports,
      exports: services.exports,
      analysis: services.analysis,
      broadcast: broadcastEvent,
    });
    unsubscribeJobs = services.jobs.subscribe((job) => {
      broadcastEvent({ type: 'jobs.changed', job });
    });
    unsubscribeExports = services.exports.subscribe((event) => {
      broadcastEvent(event);
    });
    services.jobs.start();

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
    unsubscribeJobs?.();
    unsubscribeJobs = null;
    unsubscribeExports?.();
    unsubscribeExports = null;
    services?.dispose();
    services = null;
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
