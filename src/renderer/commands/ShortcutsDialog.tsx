import { useMemo } from 'react';
import { Dialog, Kbd, KbdGroup } from '@kerf/ui';

interface Shortcut {
  readonly label: string;
  readonly keys: readonly string[];
}

interface ShortcutGroup {
  readonly title: string;
  readonly shortcuts: readonly Shortcut[];
}

export interface ShortcutsDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function ShortcutsDialog({ open, onOpenChange }: ShortcutsDialogProps) {
  const groups = useMemo<ShortcutGroup[]>(() => {
    const isMac =
      typeof navigator !== 'undefined' && /mac/i.test(navigator.userAgent);
    const mod = isMac ? '⌘' : 'Ctrl';
    const deleteKey = isMac ? '⌫' : 'Del';

    return [
      {
        title: 'Workspace',
        shortcuts: [
          { label: 'Command palette', keys: [mod, 'K'] },
          { label: 'Keyboard shortcuts', keys: ['?'] },
          { label: 'Undo', keys: [mod, 'Z'] },
          { label: 'Redo', keys: ['⇧', mod, 'Z'] },
          { label: 'Import footage', keys: [mod, 'I'] },
          { label: 'Export video', keys: [mod, 'E'] },
        ],
      },
      {
        title: 'Playback',
        shortcuts: [
          { label: 'Play or pause', keys: ['Space'] },
          { label: 'Previous frame', keys: ['←'] },
          { label: 'Next frame', keys: ['→'] },
          { label: 'Jump back ten frames', keys: ['⇧', '←'] },
          { label: 'Jump forward ten frames', keys: ['⇧', '→'] },
          { label: 'Go to start', keys: ['Home'] },
          { label: 'Go to end', keys: ['End'] },
        ],
      },
      {
        title: 'Editing',
        shortcuts: [
          { label: 'Split at playhead', keys: [mod, 'B'] },
          { label: 'Copy clips', keys: [mod, 'C'] },
          { label: 'Paste at playhead', keys: [mod, 'V'] },
          { label: 'Duplicate clips', keys: [mod, 'D'] },
          { label: 'Select all clips', keys: [mod, 'A'] },
          { label: 'Delete clips', keys: [deleteKey] },
          { label: 'Ripple delete', keys: ['⇧', deleteKey] },
          { label: 'Add marker', keys: ['M'] },
        ],
      },
      {
        title: 'Tools and view',
        shortcuts: [
          { label: 'Select tool', keys: ['V'] },
          { label: 'Blade tool', keys: ['B'] },
          { label: 'Text tool', keys: ['T'] },
          { label: 'Toggle snapping', keys: ['N'] },
          { label: 'Toggle ripple editing', keys: ['R'] },
          { label: 'Zoom in', keys: [mod, '+'] },
          { label: 'Zoom out', keys: [mod, '−'] },
        ],
      },
    ];
  }, []);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Keyboard shortcuts"
      description="Shortcuts pause whenever you are typing in a field."
    >
      <div className="k-shortcuts">
        {groups.map((group) => (
          <section key={group.title} className="k-shortcuts__group">
            <h3>{group.title}</h3>
            <dl className="k-shortcuts__list">
              {group.shortcuts.map((shortcut) => (
                <div
                  key={`${group.title}-${shortcut.label}`}
                  className="k-shortcuts__row"
                >
                  <dt>{shortcut.label}</dt>
                  <dd>
                    <KbdGroup>
                      {shortcut.keys.map((key) => (
                        <Kbd key={key}>{key}</Kbd>
                      ))}
                    </KbdGroup>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
