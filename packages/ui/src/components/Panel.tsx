import type { ReactNode } from 'react';
import { cn } from '../cn';

export interface PanelProps {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  flush?: boolean;
}

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
  flush = false,
}: PanelProps) {
  return (
    <section
      className={cn('flex h-full min-h-0 flex-col bg-surface-1', className)}
    >
      {title ? (
        <header className="flex min-h-12 items-center justify-between gap-3 border-b border-line px-3 py-2.5 pl-3.5">
          <div className="min-w-0">
            <h2 className="font-sans text-[12px] font-semibold tracking-[0.02em]">
              {title}
            </h2>
            {subtitle ? (
              <p className="mt-px overflow-hidden text-[11px] text-ellipsis whitespace-nowrap text-ink-faint">
                {subtitle}
              </p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex items-center gap-0.5">{actions}</div>
          ) : null}
        </header>
      ) : null}
      <div
        className={cn(
          'min-h-0 flex-1 overflow-auto p-3.5',
          flush && 'p-0',
          bodyClassName,
        )}
      >
        {children}
      </div>
    </section>
  );
}
