import { useEffect } from 'react';
import { useEditorCommands } from './editor-commands';

export interface GlobalShortcutsOptions {
  readonly onOpenPalette: () => void;
  readonly onOpenShortcuts: () => void;
  readonly enabled?: boolean;
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
  );
}

function isButtonTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest('button, a, [role="menuitem"], [role="option"]'))
  );
}

export function useGlobalShortcuts({
  onOpenPalette,
  onOpenShortcuts,
  enabled = true,
}: GlobalShortcutsOptions): void {
  const commands = useEditorCommands();

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey) {
        return;
      }

      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      const typing = isTypingTarget(event.target);
      const repeat = event.repeat;

      if (mod && key === 'k') {
        event.preventDefault();
        onOpenPalette();
        return;
      }

      if (typing) {
        return;
      }

      if (mod) {
        if (repeat) {
          return;
        }
        switch (key) {
          case 'z':
            event.preventDefault();
            if (event.shiftKey) {
              commands.redo();
            } else {
              commands.undo();
            }
            return;
          case 'y':
            event.preventDefault();
            commands.redo();
            return;
          case 'b':
            event.preventDefault();
            commands.split();
            return;
          case 'c':
            event.preventDefault();
            commands.copySelected();
            return;
          case 'v':
            event.preventDefault();
            void commands.pasteClipboard();
            return;
          case 'd':
            event.preventDefault();
            commands.duplicateSelected();
            return;
          case 'a':
            event.preventDefault();
            commands.selectAll();
            return;
          case 'i':
            event.preventDefault();
            void commands.importFootage();
            return;
          case '=':
          case '+':
            event.preventDefault();
            commands.zoomIn();
            return;
          case '-':
            event.preventDefault();
            commands.zoomOut();
            return;
          default:
            return;
        }
      }

      if (event.shiftKey && event.key === '?') {
        event.preventDefault();
        onOpenShortcuts();
        return;
      }

      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const direction = event.key === 'ArrowLeft' ? -1 : 1;
        commands.nudge(direction * (event.shiftKey ? 10 : 1));
        return;
      }

      if (repeat) {
        return;
      }

      switch (key) {
        case ' ':
          if (isButtonTarget(event.target)) {
            return;
          }
          event.preventDefault();
          commands.togglePlay();
          return;
        case 'v':
          commands.selectTool('select');
          return;
        case 'b':
          commands.selectTool('blade');
          return;
        case 't':
          commands.selectTool('text');
          return;
        case 'n':
          commands.toggleSnap();
          return;
        case 'r':
          commands.toggleRipple();
          return;
        case 'm':
          commands.addMarker();
          return;
        case 'home':
          event.preventDefault();
          commands.goToStart();
          return;
        case 'end':
          event.preventDefault();
          commands.goToEnd();
          return;
        case 'delete':
        case 'backspace':
          event.preventDefault();
          commands.deleteSelected(event.shiftKey);
          return;
        case '=':
        case '+':
          event.preventDefault();
          commands.zoomIn();
          return;
        case '-':
          event.preventDefault();
          commands.zoomOut();
          return;
        default:
          return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [commands, enabled, onOpenPalette, onOpenShortcuts]);
}
