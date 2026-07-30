// Wave 14b — the opponent-move classifier. Implements docs/OPPONENT-MODEL.md's
// "Pinned definitions and rulings" (D1-D7, R1-R7) against the Wave 14a oracle
// fixtures (`classifierOracle.ts`, committed first, byte-untouched here).
//
// Board mechanics are reused from the existing game layer
// (`game/setup.ts`'s `Grid`/`dropDisc`/`emptyGrid`/`legalSetupColumns`,
// `game/seat.ts`'s `colourAtPly`/`otherColour`) — nothing here forks or
// reimplements gravity, legality, or replay.
//
// D1: only the OPPONENT's moves are ever classified; "user"/"opponent" come
// from the game's seat record, never from colour, never assumed.

import type { LoggedGame } from '../game/loggedGame.js';
import { colourAtPly, otherColour, type Colour, type Seat } from '../game/seat.js';
import { BOARD_COLUMNS, BOARD_ROWS, dropDisc, emptyGrid, legalSetupColumns, type Grid } from '../game/setup.js';
import type { RuleName, RuleObservation, RuleObservations } from './classifierOracle.js';
import { RULE_NAMES } from './classifierOracle.js';

export type { RuleName, RuleObservation, RuleObservations };
export { RULE_NAMES };

// ---------------------------------------------------------------------------
// Geometry primitives (private). Four axes; a "diagonal" cell carries either
// of the two diagonal axes (D3/R3: "one cell may carry several directions").
// ---------------------------------------------------------------------------

type AxisName = 'horizontal' | 'vertical' | 'diagonalNE' | 'diagonalNW';

interface Axis {
  name: AxisName;
  vector: readonly [number, number];
}

const AXES: readonly Axis[] = [
  { name: 'horizontal', vector: [1, 0] },
  { name: 'vertical', vector: [0, 1] },
  { name: 'diagonalNE', vector: [1, 1] },
  { name: 'diagonalNW', vector: [1, -1] },
];

/** The set that decides whether a cell's completing line is a DIAGONAL one.
 * This is the "direction attribution" the owner's mutation mandate targets
 * for R3 — mutating this set (or the check that consults it) is exactly the
 * "break the direction attribution in R3" mutation. */
const DIAGONAL_AXIS_NAMES: ReadonlySet<AxisName> = new Set(['diagonalNE', 'diagonalNW']);

const CENTRE_COLUMNS: ReadonlySet<number> = new Set([2, 3, 4]); // D4: internal {2,3,4}

function withinBounds(column: number, row: number): boolean {
  return column >= 0 && column < BOARD_COLUMNS && row >= 0 && row < BOARD_ROWS;
}

/** Consecutive same-colour discs starting one step from (column,row) in
 * direction (dc,dr) — the cell itself is never counted. */
function axisRunLength(grid: Grid, colour: Colour, column: number, row: number, dc: number, dr: number): number {
  let count = 0;
  let c = column + dc;
  let r = row + dr;
  while (withinBounds(c, r) && grid[c]![r] === colour) {
    count++;
    c += dc;
    r += dr;
  }
  return count;
}

/** The current landing row for `column`, or `null` if the column is full. */
function landingRow(grid: Grid, column: number): number | null {
  const row = grid[column]!.findIndex((cell) => cell === null);
  return row === -1 ? null : row;
}

/** Which axes would complete four for `colour` if a disc of that colour were
 * placed at the (empty) cell (column,row). */
function winningAxesThroughCell(grid: Grid, colour: Colour, column: number, row: number): AxisName[] {
  const axes: AxisName[] = [];
  for (const axis of AXES) {
    const [dc, dr] = axis.vector;
    const total = 1 + axisRunLength(grid, colour, column, row, dc, dr) + axisRunLength(grid, colour, column, row, -dc, -dr);
    if (total >= 4) axes.push(axis.name);
  }
  return axes;
}

export interface ThreatCell {
  column: number;
  row: number;
  axes: readonly AxisName[];
}

/** D5: every currently-playable empty cell that would complete four for
 * `colour`. */
function threatCells(grid: Grid, colour: Colour): ThreatCell[] {
  const threats: ThreatCell[] = [];
  for (let column = 0; column < BOARD_COLUMNS; column++) {
    const row = landingRow(grid, column);
    if (row === null) continue;
    const axes = winningAxesThroughCell(grid, colour, column, row);
    if (axes.length > 0) threats.push({ column, row, axes });
  }
  return threats;
}

/** R4's `L`: the longest CONTIGUOUS run of `colour`, counting only runs of
 * length >= 2 (a lone disc is not a line — the floor). Returns 0 if no such
 * run exists. */
function longestLine(grid: Grid, colour: Colour): number {
  let longest = 0;
  for (let column = 0; column < BOARD_COLUMNS; column++) {
    for (let row = 0; row < BOARD_ROWS; row++) {
      if (grid[column]![row] !== colour) continue;
      for (const axis of AXES) {
        const [dc, dr] = axis.vector;
        const pc = column - dc;
        const pr = row - dr;
        // Only count a run from its start (the cell behind it, in this same
        // axis, is not the same colour) so each run is measured exactly once.
        if (withinBounds(pc, pr) && grid[pc]![pr] === colour) continue;
        let length = 1;
        let c = column + dc;
        let r = row + dr;
        while (withinBounds(c, r) && grid[c]![r] === colour) {
          length++;
          c += dc;
          r += dr;
        }
        if (length >= 2 && length > longest) longest = length;
      }
    }
  }
  return longest;
}

function ruleObs(applicable: boolean, satisfiedIfApplicable: boolean): RuleObservation {
  return applicable ? { applicable: true, satisfied: satisfiedIfApplicable } : { applicable: false, satisfied: null };
}

// ---------------------------------------------------------------------------
// Deliverable 1 — the classifier proper.
// ---------------------------------------------------------------------------

/**
 * Classifies one candidate move `move` (a 0-indexed column) against the
 * position `grid` immediately before it, per D1-D7/R1-R7.
 *
 * `moverColour` is whoever is about to play `move` (D1: only ever an
 * opponent move in the training walk below, but this function is also the
 * one Wave 14b's prediction scorer reuses for hypothetical candidate moves
 * — "same satisfaction tests" per the doc's Prediction section — so it does
 * not itself assume which side is moving).
 *
 * `previousMoverColumn` is `moverColour`'s own previous move in this game
 * (R6), or `null` if this is their first move.
 */
export function classifyMove(
  grid: Grid,
  moverColour: Colour,
  userColour: Colour,
  previousMoverColumn: number | null,
  move: number,
): RuleObservations {
  const legalColumns = legalSetupColumns(grid);

  // R1 takes_win.
  const moverThreats = threatCells(grid, moverColour);
  const takesWinApplicable = moverThreats.length > 0;
  const takesWinSatisfied = moverThreats.some((t) => t.column === move);

  // D3: exclusivity applies ONLY when takes_win SUCCEEDS — a taken win
  // records takes_win success and nothing else, regardless of what any other
  // rule's own definition would otherwise say.
  if (takesWinApplicable && takesWinSatisfied) {
    return {
      takes_win: { applicable: true, satisfied: true },
      blocks_loss: { applicable: false, satisfied: null },
      blocks_diagonal: { applicable: false, satisfied: null },
      extends_own: { applicable: false, satisfied: null },
      centre_bias: { applicable: false, satisfied: null },
      repeats_column: { applicable: false, satisfied: null },
      builds_double: { applicable: false, satisfied: null },
    };
  }

  // R2 blocks_loss — gated on takes_win being INAPPLICABLE (true whether a
  // present-but-applicable win was taken or missed; a missed win still
  // suppresses R2/R3 by their OWN definition, not by D3).
  const userThreats = threatCells(grid, userColour);
  const blocksLossApplicable = !takesWinApplicable && userThreats.length > 0;
  const blocksLossSatisfied = userThreats.some((t) => t.column === move);

  // R3 blocks_diagonal — a subset of R2's own threat cells that carry a
  // diagonal completion.
  const diagonalUserThreats = userThreats.filter((t) => t.axes.some((axis) => DIAGONAL_AXIS_NAMES.has(axis)));
  const blocksDiagonalApplicable = blocksLossApplicable && diagonalUserThreats.length > 0;
  const blocksDiagonalSatisfied = diagonalUserThreats.some((t) => t.column === move);

  // R4 extends_own — L = longest existing contiguous line (>= 2); applicable
  // iff some legal move's landing cell directly joins existing same-colour
  // neighbours (on one or both sides) totalling >= L, so the resulting
  // connected run is longer than L (>= L+1) -- "making it longer", not
  // necessarily to exactly L+1: a cell that bridges the longest run AND a
  // separate shorter one on its other side still extends it, and genuinely
  // is the most informative case (it is very often also a winning move,
  // handled separately and first by D3/R1 above).
  const longest = longestLine(grid, moverColour);
  let extendsApplicable = false;
  let extendsSatisfied = false;
  if (longest >= 2) {
    for (const column of legalColumns) {
      const row = landingRow(grid, column);
      if (row === null) continue;
      const joinsLongest = AXES.some(({ vector: [dc, dr] }) => {
        const adjacent =
          axisRunLength(grid, moverColour, column, row, dc, dr) +
          axisRunLength(grid, moverColour, column, row, -dc, -dr);
        return adjacent >= longest;
      });
      if (joinsLongest) {
        extendsApplicable = true;
        if (column === move) extendsSatisfied = true;
      }
    }
  }

  // R5 centre_bias — D4: internal {2,3,4}.
  const centreLegal = legalColumns.some((column) => CENTRE_COLUMNS.has(column));

  // R6 repeats_column.
  const repeatApplicable = previousMoverColumn !== null && legalColumns.includes(previousMoverColumn);

  // R7 builds_double — does ANY legal move leave the mover with >= 2
  // playable winning cells in DISTINCT columns afterward? Stacked same-
  // column threats (one cell, multiple directions) count as one column.
  let doubleApplicable = false;
  let doubleSatisfied = false;
  for (const column of legalColumns) {
    const afterGrid = dropDisc(grid, column, moverColour);
    const distinctColumns = new Set(threatCells(afterGrid, moverColour).map((t) => t.column));
    if (distinctColumns.size >= 2) {
      doubleApplicable = true;
      if (column === move) doubleSatisfied = true;
    }
  }

  return {
    takes_win: ruleObs(takesWinApplicable, takesWinSatisfied),
    blocks_loss: ruleObs(blocksLossApplicable, blocksLossSatisfied),
    blocks_diagonal: ruleObs(blocksDiagonalApplicable, blocksDiagonalSatisfied),
    extends_own: ruleObs(extendsApplicable, extendsSatisfied),
    centre_bias: ruleObs(centreLegal, CENTRE_COLUMNS.has(move)),
    repeats_column: ruleObs(repeatApplicable, move === previousMoverColumn),
    builds_double: ruleObs(doubleApplicable, doubleSatisfied),
  };
}

export interface MoveObservation {
  /** Absolute 0-indexed ply within the game. */
  ply: number;
  column: number;
  observations: RuleObservations;
}

/**
 * The core, seat-free walk: replays `moves` from an empty board under
 * `seat`, classifying every OPPONENT ply (D1) and skipping every user ply
 * entirely (no observation is ever recorded for it).
 */
export function classifyMoves(seat: Seat, moves: readonly number[]): MoveObservation[] {
  const opponentColour = otherColour(seat.userColour);
  const observed: MoveObservation[] = [];
  let grid: Grid = emptyGrid();
  for (let ply = 0; ply < moves.length; ply++) {
    const column = moves[ply]!;
    const mover = colourAtPly(seat, ply);
    if (mover === opponentColour) {
      const previousMoverColumn = ply >= 2 ? moves[ply - 2]! : null;
      observed.push({
        ply,
        column,
        observations: classifyMove(grid, opponentColour, seat.userColour, previousMoverColumn, column),
      });
    }
    grid = dropDisc(grid, column, mover);
  }
  return observed;
}

/** Public entry point for a `LoggedGame` (deliverable 1's stated shape):
 * walks the OPPONENT's moves only, per D1, deriving "opponent" from
 * `game.seat.userColour` alone — never from colour, never assumed. */
export function classifyLoggedGame(game: LoggedGame): MoveObservation[] {
  return classifyMoves(game.seat, game.moves);
}
