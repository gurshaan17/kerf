import { cloneElement, useId } from 'react';
import type { ReactElement } from 'react';
import { cx } from '../cx';

export interface TooltipProps {
  label: string;
  children: ReactElement<{ 'aria-describedby'?: string }>;
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}

export function Tooltip({
  label,
  children,
  side = 'top',
  className,
}: TooltipProps) {
  const id = useId();
  const describedBy = [children.props['aria-describedby'], id]
    .filter(Boolean)
    .join(' ');

  return (
    <span className={cx('k-tooltip', className)} data-side={side}>
      {cloneElement(children, { 'aria-describedby': describedBy })}
      <span id={id} role="tooltip" className="k-tooltip__bubble">
        {label}
      </span>
    </span>
  );
}
