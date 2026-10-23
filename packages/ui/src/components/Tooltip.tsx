import { cloneElement, useId } from 'react';
import type { ReactElement } from 'react';
import { cn } from '../cn';

export interface TooltipProps {
  label: string;
  children: ReactElement<{ 'aria-describedby'?: string }>;
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}

const bubbleBaseClasses =
  'pointer-events-none invisible absolute z-[var(--k-z-toast)] whitespace-nowrap rounded-xs border border-line-strong bg-surface-raised px-[7px] py-1 text-[11px] leading-[1.3] text-ink opacity-0 shadow-1 transition-all duration-150 ease-k group-hover:visible group-hover:opacity-100 group-has-[:focus-visible]:visible group-has-[:focus-visible]:opacity-100';

const sideClasses = {
  top: 'bottom-[calc(100%+6px)] left-1/2 -translate-x-1/2 translate-y-1 group-hover:translate-y-0 group-has-[:focus-visible]:translate-y-0',
  bottom:
    'top-[calc(100%+6px)] left-1/2 -translate-x-1/2 -translate-y-1 group-hover:translate-y-0 group-has-[:focus-visible]:translate-y-0',
  left: 'top-1/2 right-[calc(100%+6px)] -translate-y-1/2 translate-x-1 group-hover:translate-x-0 group-has-[:focus-visible]:translate-x-0',
  right:
    'top-1/2 left-[calc(100%+6px)] -translate-y-1/2 -translate-x-1 group-hover:translate-x-0 group-has-[:focus-visible]:translate-x-0',
} as const;

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
    <span
      className={cn('group relative inline-flex', className)}
      data-side={side}
    >
      {cloneElement(children, { 'aria-describedby': describedBy })}
      <span
        id={id}
        role="tooltip"
        className={cn(bubbleBaseClasses, sideClasses[side])}
      >
        {label}
      </span>
    </span>
  );
}
