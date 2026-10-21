import { forwardRef } from 'react';
import type {
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from 'react';
import { cn } from '../cn';

export interface FieldProps {
  label: string;
  children: ReactNode;
  hint?: string;
  error?: string;
  optional?: boolean;
  className?: string;
}

const controlClasses =
  'w-full rounded-sm border border-line bg-surface-0 text-[12px] text-ink transition-[border-color,box-shadow] duration-150 ease-k placeholder:text-ink-faint hover:border-line-strong focus:border-accent-dim focus:ring-[3px] focus:ring-accent/15 focus:outline-none aria-invalid:border-danger';

export function Field({
  label,
  children,
  hint,
  error,
  optional = false,
  className,
}: FieldProps) {
  return (
    <div className={cn('grid min-w-0 gap-1.5', className)}>
      <label className="grid gap-1.5 text-[11px] text-ink-muted">
        <span className="flex items-baseline justify-between gap-2 font-semibold tracking-[0.02em]">
          {label}
          {optional ? (
            <span className="font-normal text-ink-faint">Optional</span>
          ) : null}
        </span>
        {children}
      </label>
      {hint ? (
        <p className="text-[11px] leading-snug text-ink-faint">{hint}</p>
      ) : null}
      {error ? (
        <p className="text-[11px] leading-snug text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function FieldRow({
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('grid grid-cols-2 gap-2', className)} {...rest} />;
}

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...rest }, ref) {
  return (
    <input
      ref={ref}
      className={cn(controlClasses, 'h-[30px] px-[9px]', className)}
      {...rest}
    />
  );
});

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        controlClasses,
        'min-h-[88px] resize-y px-[9px] py-2',
        className,
      )}
      {...rest}
    />
  );
});
