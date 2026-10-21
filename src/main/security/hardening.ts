import { app, session } from 'electron';

const CONTENT_SECURITY_POLICY =
  "default-src 'self'; " +
  "script-src 'self'; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob: kerfmedia:; " +
  "media-src 'self' blob: kerfmedia:; " +
  "font-src 'self'; " +
  "connect-src 'self'; " +
  "object-src 'none'; " +
  "frame-src 'none'; " +
  "worker-src 'self' blob:; " +
  "base-uri 'self'; " +
  "form-action 'none'";

const DEV_CONTENT_SECURITY_POLICY =
  "default-src 'self'; " +
  "script-src 'self' 'unsafe-inline'; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob: kerfmedia:; " +
  "media-src 'self' blob: kerfmedia:; " +
  "font-src 'self'; " +
  "connect-src 'self' ws://localhost:* http://localhost:*; " +
  "object-src 'none'; " +
  "frame-src 'none'; " +
  "worker-src 'self' blob:; " +
  "base-uri 'self'; " +
  "form-action 'none'";

function isDevelopment(): boolean {
  return (
    typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== 'undefined' &&
    Boolean(MAIN_WINDOW_VITE_DEV_SERVER_URL)
  );
}

/** Deny every popup, webview and top-level navigation the app did not load. */
export function installNavigationGuards(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event) => {
      event.preventDefault();
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
