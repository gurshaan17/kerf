import type { EditCommand } from '@kerf/model';
import { describe, expect, it } from 'vitest';
import { applyCommand } from './apply';
import { EngineError, isEngineError } from './errors';
import { EditHistory } from './history';
import {
  makeSequence,
  makeTrack,
  makeVideoClip,
  withClips,
} from './test-fixtures';

function expectEngineError(fn: () => unknown, code: EngineError['code']): void {
  try {
    fn();
    throw new Error(`expected an EngineError with code ${code}`);
  } catch (error) {
    expect(isEngineError(error)).toBe(true);
    if (error instanceof EngineError) {
      expect(error.code).toBe(code);
      expect(error.hint).toBeTruthy();
    }
  }
}

function fixture(): {
  sequence: ReturnType<typeof makeSequence>;
  clipId: ReturnType<typeof makeVideoClip>['id'];
} {
  const track = makeTrack('video', 0);
  const clip = makeVideoClip({
    trackId: track.id,
    startFrame: 0,
    durationFrames: 10,
  });
  return {
    sequence: makeSequence([withClips(track, [clip])]),
    clipId: clip.id,
  };
}

describe('EditHistory', () => {
  it('undoes and redoes one command with its label and actor', () => {
    const { sequence, clipId } = fixture();
    const history = new EditHistory({ now: () => 42 });
    const command: EditCommand = {
      type: 'clip.move',
      clipId,
      startFrame: 20,
    };
    const applied = applyCommand(sequence, command);
    history.record(command, applied.inverse, {
      label: 'Nudge clip',
      actor: 'agent',
    });

    expect(history.state).toMatchObject({
      canUndo: true,
      canRedo: false,
      undoDepth: 1,
      redoDepth: 0,
      undo: { label: 'Nudge clip', actor: 'agent', createdAt: 42 },
      redo: null,
      groupOpen: false,
    });

    const undone = history.undo(applied.sequence);
    expect(undone?.sequence).toEqual(sequence);
    expect(undone?.entry.label).toBe('Nudge clip');
    expect(history.state).toMatchObject({
      canUndo: false,
      canRedo: true,
      redo: { label: 'Nudge clip', actor: 'agent' },
    });

    const redone = history.redo(undone?.sequence ?? sequence);
    expect(redone?.sequence).toEqual(applied.sequence);
    expect(history.state).toMatchObject({
      canUndo: true,
      canRedo: false,
      undoDepth: 1,
    });
  });

  it('commits several commands as one labelled batch', () => {
    const { sequence } = fixture();
    const history = new EditHistory();
    const first: EditCommand = { type: 'sequence.rename', name: 'Rough' };
    const firstResult = applyCommand(sequence, first);
    history.beginGroup('Rough cut', 'agent');
    history.record(first, firstResult.inverse);

    const second: EditCommand = {
      type: 'sequence.setCanvas',
      width: 1080,
      height: 1920,
    };
    const secondResult = applyCommand(firstResult.sequence, second);
    history.record(second, secondResult.inverse);
    expect(history.state.groupOpen).toBe(true);
    history.commitGroup();

    expect(history.state.undo).toMatchObject({
      label: 'Rough cut',
      actor: 'agent',
    });
    const undone = history.undo(secondResult.sequence);
    expect(undone?.sequence).toEqual(sequence);
    expect(undone?.entry.command).toMatchObject({
      type: 'batch',
      label: 'Rough cut',
    });

    const redone = history.redo(undone?.sequence ?? sequence);
    expect(redone?.sequence).toEqual(secondResult.sequence);
  });

  it('discards the redo tail when a new edit commits', () => {
    const { sequence } = fixture();
    const history = new EditHistory();

    const first: EditCommand = { type: 'sequence.rename', name: 'Take one' };
    const firstResult = applyCommand(sequence, first);
    history.record(first, firstResult.inverse);
    const undone = history.undo(firstResult.sequence);
    expect(history.state.canRedo).toBe(true);

    history.beginGroup('Paused group');
    history.record(
      { type: 'sequence.rename', name: 'Discarded' },
      { type: 'sequence.rename', name: 'Take one' },
    );
    expect(history.state.canRedo).toBe(true);
    history.cancelGroup();
    expect(history.state.canRedo).toBe(true);

    const nextSequence = undone?.sequence ?? sequence;
    const second: EditCommand = { type: 'sequence.rename', name: 'Take two' };
    const secondResult = applyCommand(nextSequence, second);
    history.record(second, secondResult.inverse);
    expect(history.state.canRedo).toBe(false);
    expect(history.state.undoDepth).toBe(1);

    const undoneSecond = history.undo(secondResult.sequence);
    expect(undoneSecond?.sequence).toEqual(nextSequence);
    expect(history.undo(undoneSecond?.sequence ?? sequence)).toBeNull();
  });

  it('keeps the stack bounded and still redoes every retained step', () => {
    const { sequence } = fixture();
    const history = new EditHistory({ limit: 2 });

    const names = ['One', 'Two', 'Three'];
    let current = sequence;
    for (const name of names) {
      const command: EditCommand = { type: 'sequence.rename', name };
      const result = applyCommand(current, command);
      history.record(command, result.inverse);
      current = result.sequence;
    }

    expect(history.state.undoDepth).toBe(2);
    const undoneOne = history.undo(current);
    expect(undoneOne?.sequence.name).toBe('Two');
    const undoneTwo = history.undo(undoneOne?.sequence ?? sequence);
    expect(undoneTwo?.sequence.name).toBe('One');
    expect(history.undo(undoneTwo?.sequence ?? sequence)).toBeNull();

    const redoneOne = history.redo(undoneTwo?.sequence ?? sequence);
    expect(redoneOne?.sequence.name).toBe('Two');
    const redoneTwo = history.redo(redoneOne?.sequence ?? sequence);
    expect(redoneTwo?.sequence.name).toBe('Three');
    expect(history.state.redoDepth).toBe(0);
  });

  it('supports interleaved undo and redo across groups', () => {
    const { sequence, clipId } = fixture();
    const history = new EditHistory();

    const move: EditCommand = {
      type: 'clip.move',
      clipId,
      startFrame: 20,
    };
    const moveResult = applyCommand(sequence, move);
    history.record(move, moveResult.inverse);

    const rename: EditCommand = { type: 'sequence.rename', name: 'Cut' };
    const renameResult = applyCommand(moveResult.sequence, rename);
    history.record(rename, renameResult.inverse);

    const firstUndo = history.undo(renameResult.sequence);
    expect(firstUndo?.sequence).toEqual(moveResult.sequence);
    const secondUndo = history.undo(firstUndo?.sequence ?? sequence);
    expect(secondUndo?.sequence).toEqual(sequence);

    const firstRedo = history.redo(secondUndo?.sequence ?? sequence);
    expect(firstRedo?.sequence).toEqual(moveResult.sequence);
    const secondRedo = history.redo(firstRedo?.sequence ?? sequence);
    expect(secondRedo?.sequence).toEqual(renameResult.sequence);
    expect(history.state.canRedo).toBe(false);
  });

  it('uses command labels and the user actor by default', () => {
    const { sequence } = fixture();
    const history = new EditHistory({ now: () => 7 });
    const command: EditCommand = { type: 'sequence.rename', name: 'Default' };
    const result = applyCommand(sequence, command);
    history.record(command, result.inverse);

    expect(history.state.undo).toEqual({
      label: 'Rename sequence',
      actor: 'user',
      createdAt: 7,
    });
  });

  it('guards open groups, empty groups and invalid limits', () => {
    const history = new EditHistory();
    history.beginGroup('Paused');
    expectEngineError(() => history.beginGroup('Second'), 'invalid-command');
    expectEngineError(() => history.undo(makeSequence([])), 'invalid-command');
    history.cancelGroup();
    expect(history.state.canUndo).toBe(false);

    history.beginGroup('Empty');
    history.commitGroup();
    expect(history.state.canUndo).toBe(false);

    expectEngineError(() => history.beginGroup('   '), 'invalid-command');
    expectEngineError(() => new EditHistory({ limit: 0 }), 'invalid-range');
  });

  it('clears both stacks', () => {
    const { sequence } = fixture();
    const history = new EditHistory();
    const command: EditCommand = { type: 'sequence.rename', name: 'Clear' };
    const result = applyCommand(sequence, command);
    history.record(command, result.inverse);
    history.undo(result.sequence);
    expect(history.state.canRedo).toBe(true);

    history.clear();
    expect(history.state).toMatchObject({
      canUndo: false,
      canRedo: false,
      undoDepth: 0,
      redoDepth: 0,
      undo: null,
      redo: null,
    });
  });
});
