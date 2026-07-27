// Play-strength levels — SPEC.md §3.1, "Level mechanics" and "Engine move
// under an incomplete analysis" (both amended 2026-07-28). All level logic
// lives here, in TypeScript, working only from the candidate set `analyse`
// already returns (ENGINE.md "Levels (pin)": `best_move` is deliberately
// absent from the engine surface).

import type { AnalysisResult } from '../engine/types.js';
import { totalPlyDistance } from './score.js';
import type { Side } from './seat.js';

export type Level = 'perfect' | 'strong' | 'fair' | 'weak';

const HORIZON_PLY: Record<'fair' | 'weak', number> = { fair: 8, weak: 4 };

// Centre-out column order, 0-indexed (ENGINE.md "Move ordering, centre-out"):
// used ONLY for the "no column solved yet" fallback below, never for ranking
// solved moves.
const CENTRE_OUT: number[] = [3, 2, 4, 1, 5, 0, 6];

/** A time preference per level, mapped to a node budget via the client's
 * calibration (SPEC §3.1 amendment: "Perfect 2s, Strong 1s, Fair/Weak 0.5s;
 * tune in Wave 5/6 if needed"). */
export const LEVEL_THINK_MS: Record<Level, number> = {
  perfect: 2000,
  strong: 1000,
  fair: 500,
  weak: 500,
};

interface Candidate {
  index: number;
  /** The score used for RANKING -- for Fair/Weak this is the horizon-clamped
   *  score, never the raw one. */
  rankingScore: number;
}

/**
 * The score-horizon clamp (SPEC §3.1 amendment): for Fair/Weak, any outcome
 * whose total ply-distance from the analysed position exceeds the level's
 * horizon is treated as a draw (0) for ranking purposes ONLY -- it is not
 * mutating the engine's actual, exact evaluation, just what this level
 * "sees" when picking a move. Perfect and Strong see the raw score.
 */
function rankingScore(score: number, ply: number, sideToMove: Side, level: Level): number {
  if (level !== 'fair' && level !== 'weak') return score;
  if (score === 0) return 0;
  const distance = totalPlyDistance(score, ply, sideToMove);
  return distance > HORIZON_PLY[level] ? 0 : score;
}

/** Legal (non-full) column indices, in engine order. */
function legalColumns(result: AnalysisResult): number[] {
  return result.columns.map((c, i) => ({ c, i })).filter(({ c }) => c.kind !== 'full').map(({ i }) => i);
}

/** Solved column indices (`kind: 'score'`), in engine order. */
function solvedColumns(result: AnalysisResult): number[] {
  return result.columns.map((c, i) => ({ c, i })).filter(({ c }) => c.kind === 'score').map(({ i }) => i);
}

/** Best-scoring candidate; ties broken by lowest column index (ENGINE.md
 * "best tie-break: lowest column index wins among equal scores"). */
function pickBest(candidates: Candidate[]): number {
  let bestIndex = candidates[0]!.index;
  let bestScore = candidates[0]!.rankingScore;
  for (const c of candidates.slice(1)) {
    if (c.rankingScore > bestScore || (c.rankingScore === bestScore && c.index < bestIndex)) {
      bestScore = c.rankingScore;
      bestIndex = c.index;
    }
  }
  return bestIndex;
}

/** Uniform-random pick among every candidate within 2 points of the best
 * (SPEC §3.1: "Strong — Optimal unless a move within 2 points of optimal
 * exists; then random among them"). `rng` is injected so this is
 * deterministic in tests; it must return a value in `[0, 1)`. */
function pickStrong(candidates: Candidate[], rng: () => number): number {
  const bestScore = Math.max(...candidates.map((c) => c.rankingScore));
  const within = candidates
    .filter((c) => c.rankingScore >= bestScore - 2)
    .sort((a, b) => a.index - b.index);
  const roll = Math.floor(rng() * within.length);
  const clamped = Math.min(Math.max(roll, 0), within.length - 1);
  return within[clamped]!.index;
}

export interface LevelMove {
  column: number;
  /** True when this move was chosen from an incomplete analysis, restricted
   *  to the solved columns (or the centre-most legal fallback). SPEC §3.1
   *  amendment, "Honesty": moves made this way must be marked as such in the
   *  move list. */
  partial: boolean;
}

/**
 * Chooses the engine's move for `level` from one `analyse()` result.
 *
 * @param result  The engine's analysis of the position the engine is about
 *                to move in. May be `complete: false` (SPEC §3.1's "Engine
 *                move under an incomplete analysis"): in that case the level
 *                rule is applied restricted to the SOLVED columns only, or
 *                the centre-most legal column if nothing is solved yet.
 * @param ply     The analysed position's ply (needed for the Fair/Weak
 *                horizon clamp, which reasons about ply-distance).
 * @param level   The play-strength level.
 * @param rng     Source of randomness for Strong, `[0, 1)`. Defaults to
 *                `Math.random`; tests inject a fixed sequence for
 *                determinism.
 */
export function pickEngineMove(
  result: AnalysisResult,
  ply: number,
  level: Level,
  rng: () => number = Math.random,
): LevelMove {
  const solved = solvedColumns(result);

  if (!result.complete) {
    if (solved.length === 0) {
      const legal = legalColumns(result);
      const centre = CENTRE_OUT.find((i) => legal.includes(i));
      if (centre === undefined) {
        throw new Error('pickEngineMove: no legal column exists in this position');
      }
      return { column: centre, partial: true };
    }
    return { column: pickFromSolved(result, solved, ply, level, rng), partial: true };
  }

  return { column: pickFromSolved(result, solved, ply, level, rng), partial: false };
}

function pickFromSolved(
  result: AnalysisResult,
  solved: number[],
  ply: number,
  level: Level,
  rng: () => number,
): number {
  const candidates: Candidate[] = solved.map((index) => {
    const column = result.columns[index]!;
    const score = column.kind === 'score' ? column.score : 0; // unreachable for non-score, kept for type-safety
    return { index, rankingScore: rankingScore(score, ply, result.sideToMove, level) };
  });

  if (level === 'strong') {
    // Strong ranks on the RAW score (full engine strength), never the
    // horizon-clamped one -- only Fair/Weak clamp.
    const raw: Candidate[] = solved.map((index) => {
      const column = result.columns[index]!;
      const score = column.kind === 'score' ? column.score : 0;
      return { index, rankingScore: score };
    });
    return pickStrong(raw, rng);
  }

  return pickBest(candidates);
}
