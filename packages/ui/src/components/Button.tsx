import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  loading?: boolean;
}

const baseClasses =
  'inline-flex h-[30px] select-none items-center justify-center gap-2 whitespace-nowrap rounded-sm border border-transparent px-3 text-[12px] leading-none font-semibold tracking-[0.01em] transition-all duration-150 ease-k focus-visible:outline-none active:translate-y-px disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-3.5';

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'border-accent bg-accent text-[#17130d] hover:border-accent-bright hover:bg-accent-bright',
  secondary:
    'border-line bg-surface-3 hover:border-line-strong hover:bg-surface-raised',
  ghost: 'text-ink-muted hover:bg-surface-2 hover:text-ink',
  danger: 'border-danger/40 bg-danger/12 text-danger hover:bg-danger/20',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-[26px] px-[9px] text-[11px]',
  md: '',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = 'secondary',
      size = 'md',
      leadingIcon,
      trailingIcon,
      loading = false,
      className,
      children,
      disabled,
      type = 'button',
      ...rest
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          baseClasses,
          variantClasses[variant],
          sizeClasses[size],
          className,
        )}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...rest}
      >
        {leadingIcon ? (
          <span className="inline-flex items-center justify-center" aria-hidden>
            {leadingIcon}
          </span>
        ) : null}
        <span className="inline-flex items-center">{children}</span>
        {trailingIcon ? (
          <span className="inline-flex items-center justify-center" aria-hidden>
            {trailingIcon}
          </span>
        ) : null}
      </button>
    );
  },
);
