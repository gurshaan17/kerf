import { forwardRef } from 'react';
import type { SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../cn';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  'children'
> {
  options: SelectOption[];
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select({ options, className, ...rest }, ref) {
    return (
      <span className="relative block">
        <select
          ref={ref}
          className={cn(
            'h-[30px] w-full appearance-none rounded-sm border border-line bg-surface-0 pr-7 pl-[9px] text-[12px] text-ink transition-[border-color,box-shadow] duration-150 ease-k hover:border-line-strong focus:border-accent-dim focus:ring-[3px] focus:ring-accent/15 focus:outline-none',
            className,
          )}
          {...rest}
        >
          {options.map((option) => (
            <option
              key={option.value}
              value={option.value}
              disabled={option.disabled}
            >
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-ink-faint"
          size={14}
          aria-hidden="true"
        />
      </span>
    );
  },
);
