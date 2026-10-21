import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '../cx';
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
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      label,
      icon,
      size = 'md',
      active = false,
      tooltip,
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
        className={cx('k-icon-button', `k-icon-button--${size}`, className)}
        {...rest}
      >
        {icon}
      </button>
    );

    return tooltip ? <Tooltip label={tooltip}>{button}</Tooltip> : button;
  },
);
