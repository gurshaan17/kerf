import { app, BrowserWindow, nativeImage } from 'electron';
import path from 'node:path';

const WINDOW_BACKGROUND = '#0b0c0d';

/** The packaged app reads the icon from `extraResource`; dev reads it from the repo. */
function loadAppIcon() {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(app.getAppPath(), 'assets', 'icon.png');
  return nativeImage.createFromPath(iconPath);
}

/**
 * The renderer normally mounts within a few hundred milliseconds of the page
 * loading. If a development reload races with startup and leaves an empty
 * document behind, the window stays blank forever. Treat an unmounted root
 * after loading as a failed boot and reload, with a capped number of retries.
 * This only runs in development, where the dev server can interrupt a load.
 */
const BOOT_CHECK_DELAY_MS = 5_000;
const BOOT_CHECK_TIMEOUT_MS = 500;
const BOOT_CHECK_POLLS = 12;
const BOOT_CHECK_INTERVAL_MS = 250;
const MAX_BOOT_RETRIES = 2;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function installBootGuard(mainWindow: BrowserWindow): void {
  const { webContents } = mainWindow;
  let retries = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const schedule = () => {
    if (disposed) return;
    clearTimeout(timer);
    timer = setTimeout(() => void check(), BOOT_CHECK_DELAY_MS);
  };

  const check = async () => {
    for (let poll = 0; poll < BOOT_CHECK_POLLS; poll += 1) {
      if (disposed || mainWindow.isDestroyed()) return;
      const mounted = await Promise.race([
        webContents
          .executeJavaScript(
            `Boolean(document.getElementById('root')?.childElementCount)`,
          )
          .catch(() => false),
        delay(BOOT_CHECK_TIMEOUT_MS).then(() => false),
      ]);
      if (mounted) return;
      await delay(BOOT_CHECK_INTERVAL_MS);
    }
    if (disposed || mainWindow.isDestroyed()) return;
    if (retries >= MAX_BOOT_RETRIES) {
      console.warn('[boot] renderer never mounted; giving up');
      return;
    }
    retries += 1;
    console.warn(
      `[boot] renderer did not mount; reloading (${retries}/${MAX_BOOT_RETRIES})`,
    );
    webContents.reload();
    schedule();
  };

  webContents.on('did-stop-loading', schedule);
  mainWindow.once('closed', () => {
    disposed = true;
    clearTimeout(timer);
  });
  schedule();
}

export function createMainWindow(): BrowserWindow {
  const icon = loadAppIcon();
  if (process.platform === 'darwin' && !app.isPackaged && !icon.isEmpty()) {
    app.dock?.setIcon(icon);
  }

  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: WINDOW_BACKGROUND,
    ...(process.platform === 'darwin' ? {} : { icon }),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  const perf = process.env.KERF_PERF === '1';
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(
      `${MAIN_WINDOW_VITE_DEV_SERVER_URL}${perf ? '?perf=1' : ''}`,
    );
    installBootGuard(mainWindow);
  } else {
    void mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
      perf ? { query: { perf: '1' } } : undefined,
    );
  }

  return mainWindow;
}
