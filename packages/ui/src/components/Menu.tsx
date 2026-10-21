import { useEffect, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { cx } from '../cx';

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
      className={cx('k-menu', className)}
      role="menu"
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {entries.map((entry, index) => {
        if (!isItem(entry)) {
          return (
            <div
              key={entry.id}
              className="k-menu__separator"
              role="separator"
            />
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
            className={cx(
              'k-menu__item',
              entry.danger && 'k-menu__item--danger',
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
              <span className="k-menu__icon" aria-hidden="true">
                {entry.icon}
              </span>
            ) : null}
            <span className="k-menu__label">{entry.label}</span>
            {entry.shortcut ? (
              <span className="k-menu__shortcut">{entry.shortcut}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
