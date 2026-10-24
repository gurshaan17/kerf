import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Button, KerfMark } from '@kerf/ui';

export interface ErrorBoundaryProps {
  readonly children: ReactNode;
}

interface ErrorBoundaryState {
  readonly error: Error | null;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[kerf] renderer error', error, info);
  }

  override render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <main className="grid h-full w-full place-items-center overflow-auto bg-surface-0 p-8 text-ink">
        <div className="w-full max-w-xl rounded-lg border border-line bg-surface-1 p-6 shadow-2">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-md border border-line bg-surface-0 text-accent">
              <KerfMark size={24} />
            </span>
            <div>
              <p className="font-mono text-[10px] tracking-[0.12em] text-ink-faint uppercase">
                Kerf
              </p>
              <h1 className="mt-1 font-display text-[26px] leading-tight font-medium">
                Something went wrong
              </h1>
            </div>
          </div>

          <p className="mt-4 text-[12px] leading-relaxed text-ink-muted">
            Your project is still on disk. Reload the window to get back to the
            editor. If the same screen returns, the error below is the place to
            start.
          </p>

          <pre className="mt-4 max-h-40 overflow-auto rounded-sm border border-line bg-surface-0 p-3 font-mono text-[10px] leading-relaxed whitespace-pre-wrap text-danger">
            {this.state.error.message}
          </pre>

          <div className="mt-5 flex justify-end gap-2">
            <Button variant="primary" onClick={() => window.location.reload()}>
              Reload Kerf
            </Button>
          </div>
        </div>
      </main>
    );
  }
}
