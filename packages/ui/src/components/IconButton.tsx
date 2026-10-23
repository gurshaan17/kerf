import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn';
import { Tooltip } from './Tooltip';

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-label'
> {
  label: string;
  icon: ReactNode;
  size?: 'sm' | 'md';
  active?: boolean;
  tooltip?: string;
  tooltipSide?: 'top' | 'bottom' | 'left' | 'right';
}

const baseClasses =
  'inline-grid size-[30px] shrink-0 place-items-center rounded-sm border border-transparent bg-transparent text-ink-muted transition-colors duration-150 ease-k hover:bg-surface-2 hover:text-ink focus-visible:outline-none data-[active]:border-accent/30 data-[active]:bg-accent/12 data-[active]:text-accent-bright disabled:pointer-events-none disabled:opacity-35 [&_svg]:size-4';

const sizeClasses = {
  sm: 'size-6 [&_svg]:size-3.5',
  md: '',
} as const;

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      label,
      icon,
      size = 'md',
      active = false,
      tooltip,
      tooltipSide,
      className,
      type = 'button',
      ...rest
    },
    ref,
  ) {
    const button = (
      <button
        ref={ref}
        type={type}
        aria-label={label}
        data-active={active || undefined}
        className={cn(baseClasses, sizeClasses[size], className)}
        {...rest}
      >
        {icon}
      </button>
    );

    return tooltip ? (
      <Tooltip label={tooltip} side={tooltipSide}>
        {button}
      </Tooltip>
    ) : (
      button
    );
  },
);
