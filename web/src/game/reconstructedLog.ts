// Reconstructing a FINISHED game from a hand-built board, for the game log
// (Wave 12, "Add a game from memory" -- design §16.4, DoD item 4). This
// reuses Setup's own machinery wholesale -- `checkFirstMoverConsistency`,
// `checkDiscCountBalance`, `findFloatingDisc`, `winningColour` and the
// exported backtracking `reconstructMoveOrder` search all come straight
// from `game/setup.ts`, none of it duplicated.
//
// The one thing this file does NOT reuse from `validateSetup` is its check
// 4 ("existing-four-in-a-row"): `validateSetup` exists to build a position
// to CONTINUE playing from, so a completed four is exactly what it must
// refuse. Logging a finished game needs the opposite -- a four-in-a-row (or
// a full, four-free board) is the whole point, so this module runs checks
// 1-3 itself, then requires the board to actually BE finished, then hands
// off to the identical ordering search.

import type { Colour, Seat } from './seat.js';
import {
  BOARD_COLUMNS,
  BOARD_ROWS,
  checkDiscCountBalance,
  checkFirstMoverConsistency,
  findFloatingDisc,
  reconstructMoveOrder,
  winningColour,
  type Grid,
} from './setup.js';

export interface ReconstructRejection {
  /** Deliberately a plain `string`, not a narrow literal union: this type
   *  carries both `game/setup.ts`'s own `SetupRejectionCode` values (reused
   *  as-is for checks 1-3 and the ordering search) and this module's own
   *  `'not-finished'` code, and nothing here needs to switch on it
   *  exhaustively -- only `message` is ever displayed. */
  code: string;
  /** The specific, actual problem -- never "Invalid position" (SPEC §3.3's
   *  standard, applied to this path too). */
  message: string;
}

export type ReconstructOutcome =
  | { ok: true; moves: number[]; winner: Colour | null }
  | { ok: false; rejection: ReconstructRejection };

function totalDiscCount(grid: Grid): number {
  let count = 0;
  for (const column of grid) {
    for (const cell of column) if (cell !== null) count++;
  }
  return count;
}

/**
 * Validates a hand-built `Grid` as a FINISHED game and, if valid, returns
 * the reconstructed 0-indexed move order plus the winning colour (`null`
 * for a draw). Runs the same floating-disc / count-balance / first-mover
 * checks Setup itself runs (SPEC §3.3, checks 1-3, reused verbatim), then a
 * "this must actually be over" check in their place of check 4, then the
 * identical backtracking ordering search (`setup.ts`'s own
 * `reconstructMoveOrder`, unmodified) using whichever colour actually won
 * (or the declared `firstMover`, for a draw) to resolve turn order.
 */
export function reconstructFinishedGame(seat: Seat, grid: Grid): ReconstructOutcome {
  const floating = findFloatingDisc(grid);
  if (floating) return { ok: false, rejection: floating };

  const balance = checkDiscCountBalance(grid);
  if (balance) return { ok: false, rejection: balance };

  const consistency = checkFirstMoverConsistency(grid, seat.firstMover);
  if (consistency) return { ok: false, rejection: consistency };

  const winner = winningColour(grid);
  const isFull = totalDiscCount(grid) === BOARD_COLUMNS * BOARD_ROWS;
  if (winner === null && !isFull) {
    return {
      ok: false,
      rejection: {
        code: 'not-finished',
        message: 'This is not the end of a game yet — there is no four-in-a-row and the board is not full.',
      },
    };
  }

  const outcome = reconstructMoveOrder(grid, seat.firstMover);
  if (!outcome.ok) {
    return { ok: false, rejection: outcome.rejection };
  }

  const moves = outcome.moves.split('').map((digit) => Number(digit) - 1);
  return { ok: true, moves, winner };
}
