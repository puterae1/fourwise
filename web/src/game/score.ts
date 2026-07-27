// Shared low-level score arithmetic (ENGINE.md "Score convention"):
// `score = 22 - stones_the_winner_will_have_played`, a TOTAL over the whole
// game from ply 0. `verdict.ts` (user-facing distance) and `levels.ts` (the
// score-horizon clamp) both need to turn that total into "how far away is
// this outcome from the CURRENT position" -- this module is the one place
// that arithmetic lives, so the two callers can never drift apart.

import { otherSide, type Side } from './seat.js';

const TOTAL_STONES_AT_ZERO_SPEED = 22;

export function sideParity(side: Side): 0 | 1 {
  return side === 'first' ? 0 : 1;
}

/**
 * How many stones the side with the given parity has already placed among
 * the `ply` moves played so far (0-indexed plies 0..ply-1).
 */
export function stonesAlreadyPlayed(ply: number, parity: 0 | 1): number {
  return parity === 0 ? Math.ceil(ply / 2) : Math.floor(ply / 2);
}

/**
 * The winning side, given a mover-relative `score` for the position where
 * `sideToMove` was to move. `score` must be non-zero (a draw has no winner).
 */
export function winningSide(score: number, sideToMove: Side): Side {
  return score > 0 ? sideToMove : otherSide(sideToMove);
}

/**
 * The winner's own remaining moves from the analysed position, INCLUDING
 * the move about to be played. `score` must be non-zero.
 */
export function ownMoveDistance(score: number, ply: number, sideToMove: Side): number {
  const winner = winningSide(score, sideToMove);
  const already = stonesAlreadyPlayed(ply, sideParity(winner));
  return TOTAL_STONES_AT_ZERO_SPEED - Math.abs(score) - already;
}

/**
 * Total plies (both sides' moves combined) from the analysed position until
 * the game resolves -- what a depth-limited search would need to reach to
 * prove this outcome, and therefore the quantity the SPEC §3.1 score-horizon
 * clamp compares against Fair/Weak's ply horizon. `score` must be non-zero.
 *
 * If the winner is the side about to move, the sequence from here is
 * W,O,W,O,...,W (R winner moves, R-1 opponent moves) = 2R-1 plies. If the
 * winner is NOT the side about to move, the sequence is O,W,O,W,...,W (R
 * pairs, ending on the winner) = 2R plies.
 */
export function totalPlyDistance(score: number, ply: number, sideToMove: Side): number {
  const remaining = ownMoveDistance(score, ply, sideToMove);
  const winnerMovesNext = score > 0; // score > 0 means sideToMove (about to move) is the winner
  return winnerMovesNext ? 2 * remaining - 1 : 2 * remaining;
}
