import type { ReactNode } from 'react';
import { cx } from '../cx';

export interface PanelProps {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  flush?: boolean;
}

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className,
  flush = false,
}: PanelProps) {
  return (
    <section className={cx('k-panel', className)}>
      {title ? (
        <header className="k-panel__header">
          <div className="k-panel__heading">
            <h2 className="k-panel__title">{title}</h2>
            {subtitle ? <p className="k-panel__subtitle">{subtitle}</p> : null}
          </div>
          {actions ? <div className="k-panel__actions">{actions}</div> : null}
        </header>
      ) : null}
      <div className={cx('k-panel__body', flush && 'k-panel__body--flush')}>
        {children}
      </div>
    </section>
  );
}
