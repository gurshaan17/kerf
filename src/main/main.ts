import { app, BrowserWindow } from 'electron';
import started from 'electron-squirrel-startup';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
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
import { installProcessStreamGuards } from './process-streams';

const bootStartedAt = performance.now();
const perfState: { bootStartedAt: number; windowReadyAt: number | null } = {
  bootStartedAt,
  windowReadyAt: null,
};
(
  globalThis as {
    __kerfPerf?: { bootStartedAt: number; windowReadyAt: number | null };
  }
).__kerfPerf = perfState;
const configuredUserData = process.env.KERF_USER_DATA?.trim();
if (configuredUserData) {
  const userData = resolve(configuredUserData);
  mkdirSync(userData, { recursive: true });
  app.setPath('userData', userData);
}

installProcessStreamGuards();

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
    services = createKerfServices({ broadcast: broadcastEvent });
    const startedServices = services;
    if (process.env.KERF_E2E === '1') {
      (globalThis as { __kerfServices?: KerfServices }).__kerfServices =
        startedServices;
    }
    installMediaProtocol(startedServices.repository);
    unregisterIpc = registerProjectIpc({
      projects: services.projects,
      repository: services.repository,
      jobs: services.jobs,
      imports: services.imports,
      exports: services.exports,
      analysis: services.analysis,
      agent: services.agent,
      renderer: services.renderer,
      tools: services.tools,
      mcp: services.mcp,
      broadcast: broadcastEvent,
    });
    unsubscribeJobs = services.jobs.subscribe((job) => {
      broadcastEvent({ type: 'jobs.changed', job });
    });
    unsubscribeExports = services.exports.subscribe((event) => {
      broadcastEvent(event);
    });
    const mainWindow = createMainWindow();
    mainWindow.once('ready-to-show', () => {
      perfState.windowReadyAt = performance.now();
      if (process.env.KERF_PERF === '1') {
        console.info(
          `[perf] main window ready in ${Math.round(
            performance.now() - bootStartedAt,
          )}ms`,
        );
      }
    });

    // The window can paint before background queues and the MCP listener are
    // live. Jobs enqueued in the meantime are picked up when the queue starts.
    setImmediate(() => {
      startedServices.jobs.start();
      void startedServices.mcp.startIfEnabled();
    });

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
    if (process.env.KERF_E2E === '1') {
      delete (globalThis as { __kerfServices?: KerfServices }).__kerfServices;
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
