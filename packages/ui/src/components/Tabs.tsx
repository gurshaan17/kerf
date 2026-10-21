import { useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { cx } from '../cx';

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
      className={cx('k-tabs', className)}
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
            className={cx('k-tab', selected && 'is-selected')}
            onClick={() => onValueChange(item.id)}
          >
            {item.icon ? (
              <span className="k-tab__icon" aria-hidden="true">
                {item.icon}
              </span>
            ) : null}
            <span>{item.label}</span>
            {item.badge ? (
              <span className="k-tab__badge">{item.badge}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
