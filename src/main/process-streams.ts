/**
 * A dev terminal can disappear while the Electron main process is still
 * running. When that happens Node emits EPIPE on stdout/stderr, and an
 * unhandled stream error becomes an "Uncaught Exception" dialog. Closing a
 * console is not an application error, so ignore only EPIPE here.
 */
export type ProcessOutputStream = Pick<NodeJS.WriteStream, 'on'> | undefined;

export function isBrokenPipe(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === 'EPIPE'
  );
}

export function installProcessStreamGuards(
  streams: readonly ProcessOutputStream[] = [process.stdout, process.stderr],
): void {
  for (const stream of streams) {
    stream?.on('error', (error: Error) => {
      if (isBrokenPipe(error)) {
        return;
      }
      // Keep unexpected stream failures visible instead of swallowing them.
      queueMicrotask(() => {
        throw error;
      });
    });
  }
}
