import { describe, expect, it } from 'vitest';
import {
  colourToMove,
  createGame,
  enginePosition,
  jumpToPly,
  legalColumns,
  playMove,
  redo,
  setMode,
  sideToMove,
  startFromSetup,
  undo,
  visibleMoveString,
} from './gameState.js';
import type { Seat } from './seat.js';
import { BOARD_COLUMNS, BOARD_ROWS, dropDisc, emptyGrid, type Grid } from './setup.js';

const SEAT: Seat = { firstMover: 'red', userColour: 'red' };

describe('createGame / playMove / enginePosition', () => {
  it('starts empty and accumulates the engine position string as moves are played', () => {
    let state = createGame(SEAT);
    expect(enginePosition(state)).toBe('');
    expect(sideToMove(state)).toBe('first');
    expect(colourToMove(state)).toBe('red');

    const first = playMove(state, 3); // 0-indexed column 3 -> digit '4'
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    state = first.state;
    expect(enginePosition(state)).toBe('4');
    expect(sideToMove(state)).toBe('second');
    expect(colourToMove(state)).toBe('yellow');

    const second = playMove(state, 2); // column 2 -> digit '3'
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    state = second.state;
    expect(enginePosition(state)).toBe('43');
  });

  it('rejects a move into a full column, naming the actual column', () => {
    let state = createGame(SEAT);
    for (let i = 0; i < BOARD_ROWS; i++) {
      const result = playMove(state, 0);
      expect(result.ok).toBe(true);
      if (result.ok) state = result.state;
    }
    expect(legalColumns(state)).not.toContain(0);

    const overflow = playMove(state, 0);
    expect(overflow.ok).toBe(false);
    if (!overflow.ok) {
      expect(overflow.error).toBe('Column 1 is full.');
    }
  });

  it('rejects an out-of-range column', () => {
    const state = createGame(SEAT);
    const result = playMove(state, 7);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Column 8');
  });
});

describe('undo / redo / jumpToPly', () => {
  function playColumns(state: ReturnType<typeof createGame>, columns: number[]) {
    let s = state;
    for (const c of columns) {
      const result = playMove(s, c);
      if (!result.ok) throw new Error(result.error);
      s = result.state;
    }
    return s;
  }

  it('undo steps back one ply without discarding the move', () => {
    let state = createGame(SEAT);
    state = playColumns(state, [3, 2]);
    expect(enginePosition(state)).toBe('43');

    state = undo(state);
    expect(enginePosition(state)).toBe('4');
    expect(state.moves).toHaveLength(2); // the undone move is still recorded
  });

  it('redo restores an undone move', () => {
    let state = createGame(SEAT);
    state = playColumns(state, [3, 2]);
    state = undo(state);
    state = redo(state);
    expect(enginePosition(state)).toBe('43');
  });

  it('undo at the very start is a no-op', () => {
    const state = createGame(SEAT);
    expect(undo(state)).toEqual(state);
  });

  it('redo past the end is a no-op', () => {
    let state = createGame(SEAT);
    state = playColumns(state, [3]);
    expect(redo(state)).toEqual(state);
  });

  it('playing a new move after undo truncates the abandoned redo tail', () => {
    let state = createGame(SEAT);
    state = playColumns(state, [3, 2, 1]);
    state = undo(state); // back to '43'
    const result = playMove(state, 5); // a genuinely different move
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    state = result.state;
    expect(enginePosition(state)).toBe('436'); // NOT '4326' or '4322'
    expect(redo(state)).toEqual(state); // nothing left to redo into
  });

  it('jumpToPly moves the displayed position without touching the move list', () => {
    let state = createGame(SEAT);
    state = playColumns(state, [3, 2, 1]);

    const jumped = jumpToPly(state, 1);
    expect(jumped.ok).toBe(true);
    if (!jumped.ok) return;
    expect(enginePosition(jumped.state)).toBe('4');
    expect(jumped.state.moves).toHaveLength(3); // full history preserved

    const forward = jumpToPly(jumped.state, 3);
    expect(forward.ok && enginePosition(forward.state)).toBe('432');
  });

  it('jumpToPly rejects an out-of-range ply', () => {
    const state = createGame(SEAT);
    const result = jumpToPly(state, 1);
    expect(result.ok).toBe(false);
  });
});

describe('setMode', () => {
  it('changes mode without perturbing the position', () => {
    let state = createGame(SEAT, 'play');
    const played = playMove(state, 3);
    if (!played.ok) throw new Error(played.error);
    state = played.state;

    const analysing = setMode(state, 'analyse');
    expect(analysing.mode).toBe('analyse');
    expect(enginePosition(analysing)).toBe(enginePosition(state));

    const backToPlay = setMode(analysing, 'play');
    expect(enginePosition(backToPlay)).toBe(enginePosition(state));
  });
});

describe('startFromSetup', () => {
  it('starts the visible move list at the setup point, keeping the reconstruction internal', () => {
    let grid: Grid = emptyGrid();
    grid = dropDisc(grid, 2, 'red');
    grid = dropDisc(grid, 3, 'red');
    grid = dropDisc(grid, 3, 'yellow');

    const outcome = startFromSetup(SEAT, grid);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    let state = outcome.state;
    expect(state.moves).toHaveLength(0); // nothing in the visible list yet
    expect(visibleMoveString(state)).toBe('');
    expect(enginePosition(state).length).toBe(3); // the reconstructed prefix

    const played = playMove(state, 4);
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    state = played.state;
    expect(state.moves).toHaveLength(1); // the setup point, not the prefix
    expect(visibleMoveString(state)).toBe('5');
    expect(enginePosition(state)).toHaveLength(4);
  });

  it('surfaces the Setup rejection instead of building a game from an illegal board', () => {
    let grid: Grid = emptyGrid();
    // Five red, no yellow -- rejection 2.
    for (let i = 0; i < BOARD_ROWS - 1; i++) grid = dropDisc(grid, 0, 'red');
    grid = dropDisc(grid, 1, 'red');
    const outcome = startFromSetup(SEAT, grid);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.rejection.code).toBe('count-mismatch');
  });
});

describe('legalColumns', () => {
  it('lists all seven columns as legal on an empty board', () => {
    const state = createGame(SEAT);
    expect(legalColumns(state)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(legalColumns(state)).toHaveLength(BOARD_COLUMNS);
  });
});
