import type { Actor, EditCommand, Sequence } from '@kerf/model';
import { commandLabel } from '@kerf/model';
import { applyCommand } from './apply';
import type { ApplyContext } from './apply';
import { EngineError } from './errors';

export interface HistoryEntry {
  readonly label: string;
  readonly actor: Actor;
  readonly command: EditCommand;
  readonly inverse: EditCommand | null;
  readonly createdAt: number;
}

export interface HistorySummary {
  readonly label: string;
  readonly actor: Actor;
  readonly createdAt: number;
}

export interface HistoryState {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoDepth: number;
  readonly redoDepth: number;
  readonly undo: HistorySummary | null;
  readonly redo: HistorySummary | null;
  readonly groupOpen: boolean;
}

export interface HistoryMove {
  readonly sequence: Sequence;
  readonly entry: HistoryEntry;
}

export interface RecordOptions {
  label?: string;
  actor?: Actor;
}

export interface HistoryOptions {
  /** Maximum number of committed groups retained on each stack. */
  limit?: number;
  now?: () => number;
}

interface OpenGroup {
  label: string;
  actor: Actor;
  commands: EditCommand[];
  /** Inverses in unwind order, newest first. */
  inverses: EditCommand[];
  createdAt: number;
}

const DEFAULT_LIMIT = 200;

function labelFor(command: EditCommand): string {
  const label = commandLabel(command);
  return label.trim().length > 0 ? label : command.type;
}

/**
 * A bounded undo/redo log. Application stays in `applyCommand`; the history
 * only stores the forward command and its inverse, so callers can use the same
 * log for mouse edits, agent tools and MCP requests.
 */
export class EditHistory {
  private readonly limit: number;
  private readonly now: () => number;
  private readonly undoStack: HistoryEntry[] = [];
  private readonly redoStack: HistoryEntry[] = [];
  private open: OpenGroup | null = null;

  constructor(options: HistoryOptions = {}) {
    const limit = options.limit ?? DEFAULT_LIMIT;
    if (!Number.isInteger(limit) || limit < 1) {
      throw new EngineError(
        'invalid-range',
        'The history limit must be a positive integer.',
        'Choose a limit of at least one edit.',
      );
    }
    this.limit = limit;
    this.now = options.now ?? Date.now;
  }

  get state(): HistoryState {
    return {
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      undoDepth: this.undoStack.length,
      redoDepth: this.redoStack.length,
      undo: this.summary(this.undoStack.at(-1)),
      redo: this.summary(this.redoStack.at(-1)),
      groupOpen: this.open !== null,
    };
  }

  beginGroup(label: string, actor: Actor = 'user'): void {
    if (this.open) {
      throw new EngineError(
        'invalid-command',
        'A history group is already open.',
        'Commit or cancel the current group first.',
      );
    }
    if (label.trim().length === 0) {
      throw new EngineError(
        'invalid-command',
        'A history group needs a label.',
        'Enter a short description of the edit.',
      );
    }
    this.open = {
      label,
      actor,
      commands: [],
      inverses: [],
      createdAt: this.now(),
    };
  }

  commitGroup(): void {
    const group = this.open;
    this.open = null;
    if (!group || group.commands.length === 0) {
      return;
    }

    const command: EditCommand =
      group.commands.length === 1
        ? (group.commands[0] as EditCommand)
        : { type: 'batch', label: group.label, commands: group.commands };
    const inverse: EditCommand | null =
      group.inverses.length === 0
        ? null
        : group.inverses.length === 1
          ? (group.inverses[0] as EditCommand)
          : {
              type: 'batch',
              label: `Undo ${group.label}`,
              commands: group.inverses,
            };

    this.pushUndo({
      label: group.label,
      actor: group.actor,
      command,
      inverse,
      createdAt: group.createdAt,
    });
    this.redoStack.length = 0;
  }

  cancelGroup(): void {
    this.open = null;
  }

  record(
    command: EditCommand,
    inverse: EditCommand | null,
    options: RecordOptions = {},
  ): void {
    if (this.open) {
      this.open.commands.push(command);
      if (inverse) {
        this.open.inverses.unshift(inverse);
      }
      return;
    }

    this.pushUndo({
      label: options.label ?? labelFor(command),
      actor: options.actor ?? 'user',
      command,
      inverse,
      createdAt: this.now(),
    });
    this.redoStack.length = 0;
  }

  undo(sequence: Sequence, context?: ApplyContext): HistoryMove | null {
    this.assertClosed();
    const entry = this.undoStack.at(-1);
    if (!entry) {
      return null;
    }

    const next = entry.inverse
      ? applyCommand(sequence, entry.inverse, context).sequence
      : sequence;
    this.undoStack.pop();
    this.redoStack.push(entry);
    return { sequence: next, entry };
  }

  redo(sequence: Sequence, context?: ApplyContext): HistoryMove | null {
    this.assertClosed();
    const entry = this.redoStack.at(-1);
    if (!entry) {
      return null;
    }

    const next = applyCommand(sequence, entry.command, context).sequence;
    this.redoStack.pop();
    this.pushUndo(entry);
    return { sequence: next, entry };
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.open = null;
  }

  private pushUndo(entry: HistoryEntry): void {
    this.undoStack.push(entry);
    if (this.undoStack.length > this.limit) {
      this.undoStack.shift();
    }
  }

  private summary(entry: HistoryEntry | undefined): HistorySummary | null {
    if (!entry) {
      return null;
    }
    return {
      label: entry.label,
      actor: entry.actor,
      createdAt: entry.createdAt,
    };
  }

  private assertClosed(): void {
    if (this.open) {
      throw new EngineError(
        'invalid-command',
        'Undo and redo are unavailable while a history group is open.',
        'Commit or cancel the current group first.',
      );
    }
  }
}
