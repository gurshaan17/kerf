import type { ReactNode } from 'react';
import { cx } from '../cx';

export interface KbdProps {
  children: ReactNode;
  className?: string;
}

export function Kbd({ children, className }: KbdProps) {
  return <kbd className={cx('k-kbd', className)}>{children}</kbd>;
}

export function KbdGroup({ children }: { children: ReactNode }) {
  return <span className="k-kbd-group">{children}</span>;
}
