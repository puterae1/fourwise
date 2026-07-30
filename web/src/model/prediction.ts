// Wave 14b — deliverable 3: prediction. docs/OPPONENT-MODEL.md, "Prediction
// and gating (restated with the pins)": for a position, each legal move
// scores the sum of posterior means of every rule that move WOULD satisfy
// (same satisfaction tests as the classifier, D3's taken-win exclusivity
// included); normalise over legal moves; top-3 with confidence.

import type { Colour } from '../game/seat.js';
import { legalSetupColumns, type Grid } from '../game/setup.js';
import { classifyMove } from './classifier.js';
import { RULE_NAMES } from './classifierOracle.js';
import { posteriorMean, type OpponentRuleStates } from './betaBernoulli.js';

export interface MoveScore {
  column: number;
  /** Normalised across all legal moves at this position — sums to 1 across
   *  the FULL legal set, not just the returned top-3 (see `scoreLegalMoves`
   *  if the whole distribution is needed). */
  confidence: number;
}

/**
 * Scores every legal move at `grid` by the sum of posterior means of every
 * rule that move would satisfy — using the SAME satisfaction tests the
 * classifier applies to a real move (D3's taken-win exclusivity included,
 * since a hypothetical winning candidate short-circuits `classifyMove` to
 * `takes_win` alone exactly as a real one would). Returns the full,
 * normalised distribution over legal columns, in column order (ascending) —
 * `topPredictions` below sorts and truncates it.
 *
 * `previousMoverColumn` is the opponent's own most recent move in the CURRENT
 * game being played/reviewed (not the training log) — `null` if she has not
 * moved yet this game, matching R6's "her first move: inapplicable".
 */
export function scoreLegalMoves(
  grid: Grid,
  opponentColour: Colour,
  userColour: Colour,
  previousMoverColumn: number | null,
  ruleStates: OpponentRuleStates,
): MoveScore[] {
  const legalColumns = legalSetupColumns(grid);

  const rawScores = legalColumns.map((column) => {
    const observations = classifyMove(grid, opponentColour, userColour, previousMoverColumn, column);
    let score = 0;
    for (const rule of RULE_NAMES) {
      if (observations[rule].satisfied === true) score += posteriorMean(ruleStates[rule]);
    }
    return { column, score };
  });

  const total = rawScores.reduce((sum, r) => sum + r.score, 0);
  if (total > 0) {
    return rawScores.map((r) => ({ column: r.column, confidence: r.score / total }));
  }
  // No candidate move satisfies any rule at all (every rule inapplicable, or
  // every posterior mean is exactly 0 — practically unreachable but not
  // impossible with a pathological state). No basis to prefer one legal move
  // over another: spread the confidence uniformly rather than divide by zero.
  const uniform = rawScores.length > 0 ? 1 / rawScores.length : 0;
  return rawScores.map((r) => ({ column: r.column, confidence: uniform }));
}

/** The top three (or fewer, if fewer legal moves exist) by confidence,
 * highest first. Ties keep the lower-column entry first (stable sort over
 * the ascending-column input from `scoreLegalMoves`), matching this
 * project's house lowest-column tie-break convention elsewhere. */
export function topPredictions(scores: readonly MoveScore[], limit = 3): MoveScore[] {
  return scores
    .slice()
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);
}
