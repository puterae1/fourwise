import { describe, expect, it } from 'vitest';
import { emptyGrid, dropDisc, type Grid } from './setup.js';
import type { Colour, Seat } from './seat.js';
import { reconstructFinishedGame } from './reconstructedLog.js';

function buildGrid(stacks: Partial<Record<number, Colour[]>>): Grid {
  let grid = emptyGrid();
  for (const [colStr, stack] of Object.entries(stacks)) {
    const col = Number(colStr);
    for (const colour of stack!) grid = dropDisc(grid, col, colour);
  }
  return grid;
}

const RED_FIRST: Seat = { firstMover: 'red', userColour: 'red' };

describe('reconstructFinishedGame (Wave 12, "add a game from memory")', () => {
  it('reconstructs a red win (vertical four) into 0-indexed moves plus the winning colour', () => {
    // Column 0: red x4. Column 1: yellow x3, balancing counts (4 vs 3).
    const grid = buildGrid({
      0: ['red', 'red', 'red', 'red'],
      1: ['yellow', 'yellow', 'yellow'],
    });
    const result = reconstructFinishedGame(RED_FIRST, grid);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.winner).toBe('red');
    expect(result.moves.every((c) => c >= 0 && c < 7)).toBe(true);
    expect(result.moves).toHaveLength(7);
    // Round-trips back to the same grid under the reconstructed order.
    let rebuilt = emptyGrid();
    for (let ply = 0; ply < result.moves.length; ply++) {
      const colour = ply % 2 === 0 ? RED_FIRST.firstMover : 'yellow';
      rebuilt = dropDisc(rebuilt, result.moves[ply]!, colour);
    }
    expect(rebuilt).toEqual(grid);
  });

  it('reconstructs a drawn (full, four-free) board with winner: null', () => {
    // A verified-by-scan full board (21 red / 21 yellow, no four-in-a-row in
    // any direction) -- hand-verified fixtures for a 7x6 four-free full
    // board are error-prone to eyeball, so this one was generated and
    // checked against the same directional scan `winningColour` itself uses
    // before being pinned here as a literal.
    const grid: Grid = [
      ['red', 'yellow', 'yellow', 'yellow', 'red', 'red'],
      ['yellow', 'yellow', 'red', 'yellow', 'red', 'yellow'],
      ['red', 'yellow', 'red', 'red', 'yellow', 'red'],
      ['yellow', 'red', 'yellow', 'red', 'yellow', 'red'],
      ['yellow', 'yellow', 'yellow', 'red', 'red', 'red'],
      ['red', 'red', 'red', 'yellow', 'red', 'yellow'],
      ['yellow', 'yellow', 'red', 'yellow', 'red', 'yellow'],
    ];
    const result = reconstructFinishedGame(RED_FIRST, grid);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.winner).toBeNull();
    expect(result.moves).toHaveLength(42);
  });

  it('rejects a position that is not actually finished (no four, board not full) with an honest, specific message', () => {
    const grid = buildGrid({ 3: ['red'] });
    const result = reconstructFinishedGame(RED_FIRST, grid);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe('not-finished');
    expect(result.rejection.message).toMatch(/not the end of a game/i);
    expect(result.rejection.message).not.toBe('Invalid position.');
  });

  it('still rejects a floating disc, reusing the exact Setup message', () => {
    const grid = emptyGrid();
    const mutable = grid.map((col) => col.slice());
    mutable[0]![1] = 'red';
    const result = reconstructFinishedGame(RED_FIRST, mutable);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe('floating-disc');
    expect(result.rejection.message).toContain('Column 1');
  });

  it('still rejects a disc-count mismatch, reusing the exact Setup message', () => {
    const grid = buildGrid({
      0: ['red', 'red', 'red', 'red', 'red'],
      1: ['yellow', 'yellow', 'yellow'],
    });
    const result = reconstructFinishedGame(RED_FIRST, grid);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe('count-mismatch');
    expect(result.rejection.message).toBe('Yellow has 3 discs, red has 5 — impossible.');
  });

  it('rejects counts inconsistent with the declared firstMover, reusing the exact Setup message', () => {
    const grid = buildGrid({
      0: ['red', 'red'],
      1: ['yellow', 'yellow', 'yellow'],
    });
    const result = reconstructFinishedGame(RED_FIRST, grid);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe('count-inconsistent-with-first-mover');
  });

  it('a four-in-a-row for YELLOW is accepted (unlike plain Setup, which would reject it) and reports yellow as winner', () => {
    // A diagonal yellow four -- (0,0) (1,1) (2,2) (3,3) -- with just enough
    // red filler beneath (1,1)/(2,2)/(3,3) to respect gravity, and ONE extra
    // yellow filler (col3, row2) so the final count is a balanced 5 red / 5
    // yellow (verified by an exhaustive four-scan against this exact literal
    // before being pinned here -- diagonal fixtures are easy to get subtly
    // wrong by hand).
    let grid = emptyGrid();
    grid = dropDisc(grid, 0, 'yellow'); // (0,0) -- diagonal
    grid = dropDisc(grid, 1, 'red'); // (1,0) filler
    grid = dropDisc(grid, 1, 'yellow'); // (1,1) -- diagonal
    grid = dropDisc(grid, 2, 'red'); // (2,0) filler
    grid = dropDisc(grid, 2, 'red'); // (2,1) filler
    grid = dropDisc(grid, 2, 'yellow'); // (2,2) -- diagonal
    grid = dropDisc(grid, 3, 'red'); // (3,0) filler
    grid = dropDisc(grid, 3, 'red'); // (3,1) filler
    grid = dropDisc(grid, 3, 'yellow'); // (3,2) filler -- the balancing yellow
    grid = dropDisc(grid, 3, 'yellow'); // (3,3) -- diagonal

    const result = reconstructFinishedGame(RED_FIRST, grid);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.winner).toBe('yellow');
  });
});
