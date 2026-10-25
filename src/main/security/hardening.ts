import { app, session } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const CONTENT_SECURITY_POLICY =
  "default-src 'self'; " +
  "script-src 'self' blob: 'nonce-kerf-motion-bootstrap'; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob: kerfmedia:; " +
  "media-src 'self' blob: kerfmedia:; " +
  "font-src 'self'; " +
  "connect-src 'self'; " +
  "object-src 'none'; " +
  'frame-src blob:; ' +
  "worker-src 'self' blob:; " +
  "base-uri 'self'; " +
  "form-action 'none'";

const DEV_CONTENT_SECURITY_POLICY =
  "default-src 'self'; " +
  "script-src 'self' 'unsafe-inline' blob: 'nonce-kerf-motion-bootstrap'; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob: kerfmedia:; " +
  "media-src 'self' blob: kerfmedia:; " +
  "font-src 'self'; " +
  "connect-src 'self' ws://localhost:* http://localhost:*; " +
  "object-src 'none'; " +
  'frame-src blob:; ' +
  "worker-src 'self' blob:; " +
  "base-uri 'self'; " +
  "form-action 'none'";

function isDevelopment(): boolean {
  return (
    typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== 'undefined' &&
    Boolean(MAIN_WINDOW_VITE_DEV_SERVER_URL)
  );
}

/**
 * Reloads and Vite's dev-server full reloads arrive as top-level navigations.
 * Blocking all of them leaves the window blank whenever the dev server reloads
 * before React has mounted, so allow the app's own document and nothing else.
 */
function isInternalNavigation(url: string): boolean {
  if (
    typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== 'undefined' &&
    MAIN_WINDOW_VITE_DEV_SERVER_URL
  ) {
    try {
      return (
        new URL(url).origin === new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin
      );
    } catch {
      return false;
    }
  }
  const rendererRoot = pathToFileURL(
    path.join(__dirname, '..', 'renderer'),
  ).href;
  return url === rendererRoot || url.startsWith(`${rendererRoot}/`);
}

/** Deny every popup, webview and external top-level navigation. */
export function installNavigationGuards(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event, url) => {
      if (!isInternalNavigation(url)) {
        event.preventDefault();
      }
    });
    contents.on('will-attach-webview', (event) => {
      event.preventDefault();
    });
  });
}

export function installContentSecurityPolicy(): void {
  const policy = isDevelopment()
    ? DEV_CONTENT_SECURITY_POLICY
    : CONTENT_SECURITY_POLICY;

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    });
  });
}

export { CONTENT_SECURITY_POLICY, DEV_CONTENT_SECURITY_POLICY };
