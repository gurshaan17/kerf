import { useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { cn } from '../cn';

export interface TabItem {
  id: string;
  label: string;
  icon?: ReactNode;
  badge?: ReactNode;
}

export interface TabsProps {
  items: TabItem[];
  value: string;
  onValueChange: (id: string) => void;
  label: string;
  className?: string;
}

export function Tabs({
  items,
  value,
  onValueChange,
  label,
  className,
}: TabsProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const focusAt = (index: number) => {
    const item = items[index];
    if (!item) {
      return;
    }
    refs.current[index]?.focus();
    onValueChange(item.id);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = items.findIndex((item) => item.id === value);
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      focusAt((current + 1) % items.length);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      focusAt((current - 1 + items.length) % items.length);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusAt(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusAt(items.length - 1);
    }
  };

  return (
    <div
      className={cn('flex gap-0.5 border-b border-line', className)}
      role="tablist"
      aria-label={label}
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
    >
      {items.map((item, index) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className={cn(
              'inline-flex items-center gap-1.5 border-b-2 border-transparent bg-transparent px-[9px] pt-2 pb-[7px] text-[11px] font-semibold tracking-[0.03em] text-ink-faint transition-colors duration-150 ease-k hover:text-ink-muted focus-visible:outline-none',
              selected && 'border-accent text-ink',
            )}
            onClick={() => onValueChange(item.id)}
          >
            {item.icon ? (
              <span className="inline-flex" aria-hidden="true">
                {item.icon}
              </span>
            ) : null}
            <span>{item.label}</span>
            {item.badge ? (
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-pill bg-surface-3 px-1 font-mono text-[9px] text-ink-muted">
                {item.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
