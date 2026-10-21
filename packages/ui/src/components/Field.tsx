import { forwardRef } from 'react';
import type {
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from 'react';
import { cx } from '../cx';

export interface FieldProps {
  label: string;
  children: ReactNode;
  hint?: string;
  error?: string;
  optional?: boolean;
  className?: string;
}

export function Field({
  label,
  children,
  hint,
  error,
  optional = false,
  className,
}: FieldProps) {
  return (
    <div className={cx('k-field', className)}>
      <label className="k-field__label">
        <span className="k-field__label-text">
          {label}
          {optional ? (
            <span className="k-field__optional">Optional</span>
          ) : null}
        </span>
        {children}
      </label>
      {hint ? <p className="k-field__hint">{hint}</p> : null}
      {error ? (
        <p className="k-field__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx('k-input', className)} {...rest} />;
});

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...rest }, ref) {
  return (
    <textarea ref={ref} className={cx('k-textarea', className)} {...rest} />
  );
});
