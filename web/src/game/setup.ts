// Setup mode — SPEC.md §3.3, "Path to the engine" (amended 2026-07-28).
//
// Setup reconstructs an arbitrary position for replaying a game lost at the
// table. The engine only consumes move-sequence strings (ENGINE.md "Position
// encoding"), so a board built by clicking columns needs a bridge: this
// module reconstructs a legal move ordering in TypeScript, in the game
// layer. The engine's surface is untouched.
//
// Five rejections, each with its own specific reason (SPEC §3.3: "state the
// actual problem... never 'Invalid position'"):
//   1. A floating disc.
//   2. Disc counts differing by more than one.
//   3. Counts inconsistent with the declared `firstMover`.
//   4. A four-in-a-row already on the board for either side.
//   5. No legal move ordering exists under the declared `firstMover`, even
//      though checks 1-4 all pass (SPEC's own example: equal counts, but the
//      only playable bottom disc belongs to the second mover).

import { otherColour, type Colour } from './seat.js';

export const BOARD_ROWS = 6;
export const BOARD_COLUMNS = 7;

/**
 * `grid[col][row]` — row 0 is the bottom (row 1 in SPEC §4's 1-indexed UI
 * numbering), row `BOARD_ROWS - 1` is the top. Every column has exactly
 * `BOARD_ROWS` entries; empty cells are `null`.
 *
 * This full-grid shape (rather than a compact per-column stack) is
 * deliberately expressive enough to represent a floating disc, so the
 * "impossible with column-drop input, but validate anyway" check (SPEC
 * §3.3) has something to actually check.
 */
export type Grid = ReadonlyArray<ReadonlyArray<Colour | null>>;

export function emptyGrid(): Grid {
  return Array.from({ length: BOARD_COLUMNS }, () => Array<Colour | null>(BOARD_ROWS).fill(null));
}

/** Drops a disc of `colour` into `column` (0-indexed), returning a new grid.
 * Throws if the column is out of range or already full -- callers (Setup
 * mode's click handler) are expected to check `legalSetupColumns` first. */
export function dropDisc(grid: Grid, column: number, colour: Colour): Grid {
  if (column < 0 || column >= BOARD_COLUMNS) {
    throw new Error(`Column ${column} is out of range 0-${BOARD_COLUMNS - 1}.`);
  }
  const col = grid[column]!;
  const landingRow = col.findIndex((cell) => cell === null);
  if (landingRow === -1) {
    throw new Error(`Column ${column + 1} is full.`);
  }
  const newCol = col.slice();
  newCol[landingRow] = colour;
  return grid.map((c, i) => (i === column ? newCol : c));
}

/** Columns with room for another disc, 0-indexed ascending. */
export function legalSetupColumns(grid: Grid): number[] {
  return grid.map((col, i) => ({ col, i })).filter(({ col }) => col.some((cell) => cell === null)).map(({ i }) => i);
}

export type SetupRejectionCode =
  | 'floating-disc'
  | 'count-mismatch'
  | 'count-inconsistent-with-first-mover'
  | 'existing-four-in-a-row'
  | 'unreachable';

export interface SetupRejection {
  code: SetupRejectionCode;
  /** The specific, actual problem -- never "Invalid position" (SPEC §3.3). */
  message: string;
}

export type SetupOutcome =
  | { ok: true; moves: string }
  | { ok: false; rejection: SetupRejection };

function cap(colour: Colour): string {
  return colour[0]!.toUpperCase() + colour.slice(1);
}

interface DiscCounts {
  red: number;
  yellow: number;
}

function countDiscs(grid: Grid): DiscCounts {
  let red = 0;
  let yellow = 0;
  for (const col of grid) {
    for (const cell of col) {
      if (cell === 'red') red++;
      else if (cell === 'yellow') yellow++;
    }
  }
  return { red, yellow };
}

/** Check 1: a disc with an empty cell beneath it in the same column. */
export function findFloatingDisc(grid: Grid): SetupRejection | null {
  for (let c = 0; c < grid.length; c++) {
    const col = grid[c]!;
    let seenGap = false;
    for (let r = 0; r < col.length; r++) {
      if (col[r] === null) {
        seenGap = true;
      } else if (seenGap) {
        return {
          code: 'floating-disc',
          message: `Column ${c + 1} has a disc at row ${r + 1} with nothing beneath it — a floating disc is impossible.`,
        };
      }
    }
  }
  return null;
}

/** Check 2: disc counts differing by more than one. */
export function checkDiscCountBalance(grid: Grid): SetupRejection | null {
  const { red, yellow } = countDiscs(grid);
  if (Math.abs(red - yellow) <= 1) return null;

  const [fewerColour, fewerCount, moreColour, moreCount]: [Colour, number, Colour, number] =
    red < yellow ? ['red', red, 'yellow', yellow] : ['yellow', yellow, 'red', red];
  return {
    code: 'count-mismatch',
    message: `${cap(fewerColour)} has ${fewerCount} disc${fewerCount === 1 ? '' : 's'}, ${moreColour} has ${moreCount} — impossible.`,
  };
}

/** Check 3: counts inconsistent with the declared `firstMover`. The first
 * mover plays on plies 0, 2, 4, ... so across any total, their count must be
 * exactly equal to the other colour's, or exactly one more -- never fewer. */
export function checkFirstMoverConsistency(grid: Grid, firstMover: Colour): SetupRejection | null {
  const { red, yellow } = countDiscs(grid);
  const firstCount = firstMover === 'red' ? red : yellow;
  const otherCount = firstMover === 'red' ? yellow : red;
  const other = otherColour(firstMover);

  if (firstCount === otherCount || firstCount === otherCount + 1) return null;

  return {
    code: 'count-inconsistent-with-first-mover',
    message:
      `${cap(firstMover)} is declared to move first, so ${firstMover} should have as many discs as ${other} ` +
      `or exactly one more — it has ${firstCount} to ${other}'s ${otherCount}.`,
  };
}

const LINE_DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], // horizontal
  [0, 1], // vertical
  [1, 1], // diagonal /
  [1, -1], // diagonal \
];

/** Scans for a completed four-in-a-row and returns ITS COLOUR, or `null` if
 * none exists -- the same directional scan `findExistingFour` uses to reject
 * a Setup board, factored out so a FINISHED-game caller (`game/
 * reconstructedLog.ts`, Wave 12: logging a game reconstructed from memory)
 * can ask "who won, if anyone" without duplicating this scan a second time.
 * Unlike `findExistingFour`, this is not itself a rejection -- a finished
 * game is exactly the case Setup mode (continuing play) must refuse, but
 * the game-log path needs the opposite: a four-in-a-row here is the whole
 * point. */
export function winningColour(grid: Grid): Colour | null {
  for (let c = 0; c < BOARD_COLUMNS; c++) {
    for (let r = 0; r < BOARD_ROWS; r++) {
      const colour = grid[c]![r];
      if (!colour) continue;
      for (const [dc, dr] of LINE_DIRECTIONS) {
        let count = 1;
        for (let k = 1; k < 4; k++) {
          const cc = c + dc * k;
          const rr = r + dr * k;
          if (cc < 0 || cc >= BOARD_COLUMNS || rr < 0 || rr >= BOARD_ROWS) break;
          if (grid[cc]![rr] !== colour) break;
          count++;
        }
        if (count >= 4) return colour;
      }
    }
  }
  return null;
}

/** Check 4: a four-in-a-row already completed, for either colour. */
export function findExistingFour(grid: Grid): SetupRejection | null {
  const colour = winningColour(grid);
  if (!colour) return null;
  return {
    code: 'existing-four-in-a-row',
    message: `${cap(colour)} already has four in a row on this board — impossible to set up a position where the game isn't already over.`,
  };
}

/** Each column's discs, bottom-to-top, with the empty rows above dropped. */
function compactColumns(grid: Grid): Colour[][] {
  return grid.map((col) => col.filter((cell): cell is Colour => cell !== null));
}

/**
 * Deterministic backtracking reconstruction (SPEC §3.3). Gravity fixes each
 * column's own colour sequence for good: the k-th disc ever dropped into a
 * column is always that column's k-th disc from the bottom. But WHICH of
 * several columns to advance at a given ply is not a free choice picked in
 * isolation -- consuming the "wrong" one of two tied candidates can strand a
 * later ply with no column able to supply the colour it needs (e.g. two
 * columns both offer the required colour now, but only one of them also
 * unblocks a colour that is needed later and nowhere else). So this
 * performs a real DFS, trying columns lowest-index-first at every ply (the
 * tie-break) and backtracking only when a whole branch dead-ends, memoising
 * failed states (identified by the per-column pointers, which fully
 * determine the remaining search) so a dead end already explored via one
 * path is never re-explored via another.
 */
function tryReconstructOrder(columns: Colour[][], firstMover: Colour): string | null {
  const other = otherColour(firstMover);
  const totalDiscs = columns.reduce((sum, col) => sum + col.length, 0);
  const deadEnds = new Set<string>();

  function search(pointers: number[], ply: number, moves: string): string | null {
    if (ply === totalDiscs) return moves;
    const key = pointers.join(',');
    if (deadEnds.has(key)) return null;

    const required = ply % 2 === 0 ? firstMover : other;
    for (let c = 0; c < columns.length; c++) {
      if (pointers[c]! < columns[c]!.length && columns[c]![pointers[c]!] === required) {
        const next = pointers.slice();
        next[c]!++;
        const result = search(next, ply + 1, moves + String(c + 1)); // 1-indexed digit
        if (result !== null) return result;
      }
    }
    deadEnds.add(key);
    return null;
  }

  return search(
    columns.map(() => 0),
    0,
    '',
  );
}

/** Check 5: does any legal move ordering reach this board under the
 * declared `firstMover`? If not, and flipping `firstMover` would make it
 * reachable, the rejection says so (SPEC §3.3). Assumes checks 1-4 already
 * passed -- called only from `validateSetup` below.
 *
 * Exported (Wave 12) so `game/reconstructedLog.ts` can reuse this SAME
 * backtracking search for a FINISHED game (one Setup's own `validateSetup`
 * would reject at check 4) without reimplementing it -- this function
 * itself never checks for an existing four-in-a-row, so it is already
 * correct for that case unmodified. */
export function reconstructMoveOrder(grid: Grid, firstMover: Colour): SetupOutcome {
  const columns = compactColumns(grid);
  const moves = tryReconstructOrder(columns, firstMover);
  if (moves !== null) return { ok: true, moves };

  const other = otherColour(firstMover);
  const flipped = tryReconstructOrder(columns, other);
  const base = `No legal game reaches this position with ${firstMover} moving first.`;
  const message = flipped !== null ? `${base} But it is reachable if ${other} moved first.` : base;
  return { ok: false, rejection: { code: 'unreachable', message } };
}

/**
 * Runs all five checks in order (SPEC §3.3) and, if every check passes,
 * returns the reconstructed move-sequence string the engine can consume.
 * The reconstructed ordering is an internal encoding, not history: a
 * Setup-derived game's move LIST starts at the setup point, even though
 * `moves` here is the full string from an empty board (the game layer's
 * job, not this function's, to keep those two views separate).
 */
export function validateSetup(grid: Grid, firstMover: Colour): SetupOutcome {
  const floating = findFloatingDisc(grid);
  if (floating) return { ok: false, rejection: floating };

  const balance = checkDiscCountBalance(grid);
  if (balance) return { ok: false, rejection: balance };

  const consistency = checkFirstMoverConsistency(grid, firstMover);
  if (consistency) return { ok: false, rejection: consistency };

  const existingFour = findExistingFour(grid);
  if (existingFour) return { ok: false, rejection: existingFour };

  return reconstructMoveOrder(grid, firstMover);
}
