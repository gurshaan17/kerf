import type { ReactNode } from 'react';
import { cn } from '../cn';

export interface KbdProps {
  children: ReactNode;
  className?: string;
}

export function Kbd({ children, className }: KbdProps) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] border border-line-strong border-b-2 bg-surface-2 px-[5px] font-mono text-[10px] leading-none text-ink-muted',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

export function KbdGroup({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center gap-[3px]">{children}</span>;
}
