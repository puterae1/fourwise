import { describe, expect, it } from 'vitest';
import {
  BOARD_COLUMNS,
  BOARD_ROWS,
  emptyGrid,
  dropDisc,
  legalSetupColumns,
  validateSetup,
  type Grid,
} from './setup.js';
import { otherColour, type Colour } from './seat.js';

/** Builds a grid from per-column bottom-up disc stacks (no gaps), padding
 * each column to BOARD_ROWS with nulls. Columns omitted are empty. */
function buildGrid(stacks: Partial<Record<number, Colour[]>>): Grid {
  return Array.from({ length: BOARD_COLUMNS }, (_, i) => {
    const stack = stacks[i] ?? [];
    const col: (Colour | null)[] = stack.slice();
    while (col.length < BOARD_ROWS) col.push(null);
    return col;
  });
}

describe('dropDisc / legalSetupColumns', () => {
  it('drops onto the lowest empty cell of a column', () => {
    let grid = emptyGrid();
    grid = dropDisc(grid, 3, 'red');
    grid = dropDisc(grid, 3, 'yellow');
    expect(grid[3]).toEqual(['red', 'yellow', null, null, null, null]);
  });

  it('excludes full columns from the legal set', () => {
    let grid = emptyGrid();
    for (let r = 0; r < BOARD_ROWS; r++) {
      grid = dropDisc(grid, 0, r % 2 === 0 ? 'red' : 'yellow');
    }
    expect(legalSetupColumns(grid)).not.toContain(0);
    expect(legalSetupColumns(grid)).toContain(1);
  });
});

describe('validateSetup — the five rejections (SPEC §3.3)', () => {
  it('rejection 1: a floating disc', () => {
    // Column 0: empty at row 0, but a disc at row 1 -- impossible with real
    // column-drop input, but the grid shape can express it, so it must be
    // caught.
    const grid: Grid = buildGrid({});
    const mutable = grid.map((col) => col.slice());
    mutable[0]![1] = 'red';
    const result = validateSetup(mutable, 'red');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejection.code).toBe('floating-disc');
      expect(result.rejection.message).toContain('Column 1');
      expect(result.rejection.message).not.toBe('Invalid position.');
    }
  });

  it('rejection 2: disc counts differing by more than one', () => {
    // The exact example from SPEC §3.3 itself.
    const grid = buildGrid({
      0: ['red', 'red', 'red', 'red', 'red'],
      1: ['yellow', 'yellow', 'yellow'],
    });
    const result = validateSetup(grid, 'red');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejection.code).toBe('count-mismatch');
      expect(result.rejection.message).toBe('Yellow has 3 discs, red has 5 — impossible.');
    }
  });

  it('rejection 3: counts inconsistent with the declared firstMover', () => {
    // Red has ONE FEWER disc than yellow -- balance check alone allows a
    // difference of one, but the first mover can never have fewer discs
    // than the second.
    const grid = buildGrid({
      0: ['red', 'red'],
      1: ['yellow', 'yellow', 'yellow'],
    });
    const result = validateSetup(grid, 'red');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejection.code).toBe('count-inconsistent-with-first-mover');
      expect(result.rejection.message).toContain('red');
      expect(result.rejection.message).toContain('2');
      expect(result.rejection.message).toContain('3');
    }
  });

  it('rejection 4: a four-in-a-row already on the board', () => {
    // Four red stacked vertically in column 0, balanced by three yellow in
    // column 1 so checks 1-3 all pass first.
    const grid = buildGrid({
      0: ['red', 'red', 'red', 'red'],
      1: ['yellow', 'yellow', 'yellow'],
    });
    const result = validateSetup(grid, 'red');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejection.code).toBe('existing-four-in-a-row');
      expect(result.rejection.message).toContain('Red');
    }
  });

  it('rejection 5 (amended insight): equal counts, but the only playable bottom disc belongs to the second mover', () => {
    // A single column: yellow at the bottom, red on top. One of each colour
    // -> passes balance (diff 0) and first-mover consistency (equal counts
    // are compatible with any firstMover when the total is even). But the
    // very first move of the game must be `firstMover`'s colour, and the
    // only column with any discs has yellow at its bottom -- so no legal
    // ordering starts with red.
    const grid = buildGrid({ 0: ['yellow', 'red'] });
    const result = validateSetup(grid, 'red');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejection.code).toBe('unreachable');
      expect(result.rejection.message).toBe(
        'No legal game reaches this position with red moving first. But it is reachable if yellow moved first.',
      );
    }
  });

  it('rejection 5 without the hint when flipping firstMover would not help either', () => {
    // A single column, bottom-up: yellow, red, red. Counts: red 2, yellow 1
    // -- diff 1 passes balance, and 2 === 1 + 1 passes first-mover
    // consistency for firstMover='red'. No four either. So this genuinely
    // reaches `reconstructMoveOrder` (setup.ts), not an earlier check.
    //
    // Primary attempt (firstMover='red'): ply 0 needs red, but the only
    // column's bottom (its only playable disc) is yellow -- fails
    // immediately, no candidate column at all.
    //
    // Flipped attempt (tried as if 'yellow' moved first): ply0=yellow
    // matches the bottom, ply1=red matches the middle disc, but ply2 needs
    // 'yellow' again and the top disc is 'red' -- also fails. Both
    // directions dead-end, so the rejection must NOT offer a hint.
    const grid = buildGrid({ 0: ['yellow', 'red', 'red'] });
    const result = validateSetup(grid, 'red');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejection.code).toBe('unreachable');
      expect(result.rejection.message).toBe('No legal game reaches this position with red moving first.');
      expect(result.rejection.message).not.toContain('But it is reachable');
    }
  });

  it('accepts a legal board and reconstructs a move ordering the engine can consume', () => {
    const grid = buildGrid({
      2: ['red'],
      3: ['red', 'yellow'],
    });
    const result = validateSetup(grid, 'red');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(/^[1-7]+$/.test(result.moves)).toBe(true);
      expect(result.moves).toHaveLength(3);
    }
  });

  it('backtracks past a tie that would otherwise dead-end (SPEC "deterministic backtracking search")', () => {
    // Column 2 (0-indexed) holds a single red disc; column 3 holds red then
    // yellow. Two candidates offer 'red' at ply 0 (columns 2 and 3), but
    // consuming column 2 first strands ply 1 (which needs yellow) with no
    // column able to supply it, since column 3's red is still unconsumed.
    // A correct search must backtrack and use column 3 first instead.
    const grid = buildGrid({
      2: ['red'],
      3: ['red', 'yellow'],
    });
    const result = validateSetup(grid, 'red');
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Hand-verified ordering: ply0 col3(->'4'), ply1 col3(->'4'),
      // ply2 col2(->'3').
      expect(result.moves).toBe('443');
    }
  });

  it('round-trips: replaying the reconstructed moves string, disc by disc, rebuilds the original grid exactly', () => {
    const cases: Array<{ grid: Grid; firstMover: Colour }> = [
      // The backtracking case above -- its ordering is NOT simply
      // left-to-right, so this also proves the round-trip survives a
      // reconstruction that had to backtrack.
      { grid: buildGrid({ 2: ['red'], 3: ['red', 'yellow'] }), firstMover: 'red' },
      // A second, independent shape with a tie resolved without needing to
      // backtrack, so the property is checked against more than one board.
      { grid: buildGrid({ 3: ['red', 'yellow', 'red'], 4: ['yellow'] }), firstMover: 'red' },
    ];

    for (const { grid, firstMover } of cases) {
      const outcome = validateSetup(grid, firstMover);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) continue;

      let rebuilt = emptyGrid();
      for (let ply = 0; ply < outcome.moves.length; ply++) {
        const column = Number(outcome.moves[ply]) - 1; // moves are 1-indexed digits
        const colour = ply % 2 === 0 ? firstMover : otherColour(firstMover);
        rebuilt = dropDisc(rebuilt, column, colour);
      }

      expect(rebuilt).toEqual(grid);
    }
  });
});
