import { useEffect, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { cn } from '../cn';

export interface MenuItemEntry {
  type?: 'item';
  id: string;
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
}

export interface MenuSeparatorEntry {
  type: 'separator';
  id: string;
}

export type MenuEntry = MenuItemEntry | MenuSeparatorEntry;

export interface MenuProps {
  entries: MenuEntry[];
  onSelect: (id: string) => void;
  label: string;
  onClose?: () => void;
  autoFocus?: boolean;
  className?: string;
}

const isItem = (entry: MenuEntry): entry is MenuItemEntry =>
  entry.type !== 'separator';

export function Menu({
  entries,
  onSelect,
  label,
  onClose,
  autoFocus = true,
  className,
}: MenuProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!autoFocus) {
      return;
    }
    refs.current.find((node) => node && !node.disabled)?.focus();
  }, [autoFocus]);

  const focusAt = (index: number) => {
    const node = refs.current[index];
    if (node && !node.disabled) {
      node.focus();
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const enabled = entries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => isItem(entry) && !entry.disabled) as Array<{
      entry: MenuItemEntry;
      index: number;
    }>;
    const currentIndex = refs.current.findIndex(
      (node) => node === document.activeElement,
    );
    const position = enabled.findIndex(({ index }) => index === currentIndex);

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusAt(enabled[(position + 1) % enabled.length]?.index ?? 0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusAt(
        enabled[(position - 1 + enabled.length) % enabled.length]?.index ?? 0,
      );
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusAt(enabled[0]?.index ?? 0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusAt(enabled[enabled.length - 1]?.index ?? 0);
    } else if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') {
        event.preventDefault();
      }
      onClose?.();
    }
  };

  return (
    <div
      className={cn(
        'min-w-[200px] rounded-sm border border-line-strong bg-surface-3 p-1 shadow-2',
        className,
      )}
      role="menu"
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {entries.map((entry, index) => {
        if (!isItem(entry)) {
          return (
            <div key={entry.id} className="m-1 h-px bg-line" role="separator" />
          );
        }

        return (
          <button
            key={entry.id}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="menuitem"
            tabIndex={-1}
            disabled={entry.disabled}
            className={cn(
              'flex h-7 w-full items-center gap-2 rounded-[4px] border-0 bg-transparent px-2 text-left text-[12px] text-ink-muted enabled:hover:bg-surface-raised enabled:hover:text-ink focus-visible:bg-surface-raised focus-visible:text-ink focus-visible:outline-none disabled:opacity-40',
              entry.danger && 'text-danger',
            )}
            onClick={() => {
              if (entry.disabled) {
                return;
              }
              onSelect(entry.id);
              onClose?.();
            }}
          >
            {entry.icon ? (
              <span
                className="inline-flex w-4 justify-center [&_svg]:size-3.5"
                aria-hidden="true"
              >
                {entry.icon}
              </span>
            ) : null}
            <span className="flex-1">{entry.label}</span>
            {entry.shortcut ? (
              <span className="font-mono text-[10px] text-ink-faint">
                {entry.shortcut}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
