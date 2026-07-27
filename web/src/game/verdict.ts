// Verdict translation — SPEC.md §3.2 and §1. This is the ONE place engine
// mover-relative scores become user-seat-relative verdicts. The UI layer
// (Wave 4b) consumes only the translated form produced here; it must never
// re-derive a verdict from a raw score itself.
//
// Score convention (ENGINE.md "Score convention" / "Score point of view"):
// a `score` is from the perspective of the side to move in the position it
// was computed for (positive = that side wins). Its magnitude encodes speed:
// `score = 22 - stones_the_winner_will_have_played` (a TOTAL over the whole
// game, from ply 0). To turn that into "how many of the winner's OWN moves
// remain from here", subtract however many of the winner's stones are
// already on the board at the current ply.

import { colourForSide, type Seat, type Side } from './seat.js';
import { ownMoveDistance, winningSide } from './score.js';
import type { AnalysisResult, ColumnEval } from '../engine/types.js';

export type VerdictKind = 'win' | 'loss' | 'draw';

export interface Verdict {
  kind: VerdictKind;
  /** The winner's remaining own moves, including the one about to be played.
   *  `null` for a draw. */
  distance: number | null;
  /** Plain-language sentence, phrased from the user's seat (SPEC §3.2). */
  sentence: string;
}

function pluralMoves(n: number): string {
  return n === 1 ? '1 move' : `${n} moves`;
}

/**
 * Translates one engine score into a user-seat-relative verdict.
 *
 * @param score      Mover-relative score for the analysed position (positive
 *                    = `sideToMove` wins). Exactly as `analyse()`/a column
 *                    entry reports it — never negate before calling this.
 * @param ply         The analysed position's ply (its move-string length).
 *                    Needed, together with the score magnitude, to derive
 *                    the winner's remaining move count (score alone is not
 *                    enough: `22 - score` is a total from ply 0).
 * @param sideToMove  The side the score is relative to.
 * @param seat        The seat translating perspective into "you"/"the
 *                    opponent".
 */
export function translateScore(score: number, ply: number, sideToMove: Side, seat: Seat): Verdict {
  if (score === 0) {
    return { kind: 'draw', distance: null, sentence: 'draw' };
  }

  const winnerSide = winningSide(score, sideToMove);
  const winnerColour = colourForSide(seat, winnerSide);
  const userWins = winnerColour === seat.userColour;

  const distance = ownMoveDistance(score, ply, sideToMove);

  return {
    kind: userWins ? 'win' : 'loss',
    distance,
    sentence: userWins ? `you win in ${pluralMoves(distance)}` : `the opponent wins in ${pluralMoves(distance)}`,
  };
}

/**
 * A single column's engine evaluation, translated to the user's seat.
 * `full` and `unknown` pass through untouched (SPEC §6: never guess, never
 * render a placeholder as though it were a score).
 */
export type TranslatedColumn =
  | { kind: 'score'; verdict: Verdict }
  | { kind: 'full' }
  | { kind: 'unknown' };

/**
 * Translates one `ColumnEval` (SPEC §3.2's per-column display). `ply` and
 * `sideToMove` describe the ANALYSED position -- the same position the
 * column score is relative to (ENGINE.md "Score point of view": a column's
 * score is already the analysed position mover's own perspective, not the
 * child's).
 */
export function translateColumn(column: ColumnEval, ply: number, sideToMove: Side, seat: Seat): TranslatedColumn {
  if (column.kind !== 'score') return column;
  return { kind: 'score', verdict: translateScore(column.score, ply, sideToMove, seat) };
}

export interface TranslatedAnalysis {
  /** The position's own verdict, only when the engine has fully resolved it
   *  (mirrors `AnalysisResult.complete`/`best`) -- `null` while still
   *  thinking, never guessed. */
  position: Verdict | null;
  columns: TranslatedColumn[];
  /** Index of the best column, carried through unchanged -- ranking is
   *  seat-independent (every seat agrees on which column is objectively
   *  best; only the wording of its verdict differs). */
  best: number | null;
  complete: boolean;
}

/**
 * Translates a whole `AnalysisResult` for display (SPEC §3.2). `ply` is the
 * analysed position's ply -- not carried on `AnalysisResult` itself, since
 * the engine boundary is clock- and history-free; the game layer supplies it
 * from the position it just asked the engine about.
 */
export function translateAnalysis(result: AnalysisResult, ply: number, seat: Seat): TranslatedAnalysis {
  const columns = result.columns.map((c) => translateColumn(c, ply, result.sideToMove, seat));
  const position =
    result.best !== null && result.columns[result.best]?.kind === 'score'
      ? translateScore((result.columns[result.best] as { kind: 'score'; score: number }).score, ply, result.sideToMove, seat)
      : null;
  return { position, columns, best: result.best, complete: result.complete };
}
