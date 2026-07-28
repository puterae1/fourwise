// Play-strength levels — SPEC.md §3.1, "Level mechanics", "Engine move under
// an incomplete analysis" (both amended 2026-07-28), and the 2026-07-28
// post-gate amendment that supersedes the old "restricted to the solved
// subset" cap-expiry rule. All level logic lives here, in TypeScript,
// working only from the candidate sets `analyse`/`tacticalFallback` already
// return (ENGINE.md "Levels (pin)": `best_move` is deliberately absent from
// the engine surface).
//
// Three distinct ways an engine move gets chosen, in order of preference:
//   1. `pickEngineMove`            -- a COMPLETE `analyse()` result. This is
//      the level's own defining computation.
//   2. `pickEngineMoveFromTactical` -- cap expired (`complete: false`); the
//      caller (`ui/useGameController.ts`) ran `tacticalFallback` instead of
//      choosing among a partial deep search's unevenly-solved columns (the
//      superseded rule -- see SPEC §3.1's post-gate amendment: a partial
//      DEEP search lost to a trivial tactic that unsolved columns would have
//      refuted; a COMPLETE search at reduced depth never misses a forced
//      win/loss within its own horizon).
//   3. `centreMostMove`            -- even `tacticalFallback` itself could
//      not run (the engine call failed). Last resort only.
//
// Every one of these three carries an `origin` (SPEC §3.1's amended
// "Honesty" rule): a move from anything less than the level's own defining
// computation must say so, both in the move list (`Move.origin`,
// `gameState.ts`) and at the level label's OWN surface
// (`useGameController.ts`'s `levelQualifiers`, consumed by `PlayPanel.tsx`).

import type { AnalysisResult, ColumnEval, TacticalAnalysis, TacticalEval } from '../engine/types.js';
import { totalPlyDistance } from './score.js';
import type { Side } from './seat.js';

export type Level = 'perfect' | 'strong' | 'fair' | 'weak';

const HORIZON_PLY: Record<'fair' | 'weak', number> = { fair: 8, weak: 4 };

// Centre-out column order, 0-indexed (ENGINE.md "Move ordering, centre-out"):
// used ONLY by `centreMostMove` below, never for ranking solved moves.
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

/**
 * Tactical-fallback horizon per level, in `maxPly` (ENGINE.md's "Horizon
 * convention" pin: `maxPly` plies are searched FROM EACH CHILD, so a caller
 * gets `maxPly + 1` TOTAL plies of information from the analysed root).
 * These are TUNING values, not spec values -- SPEC §3.1a only requires "a
 * complete search bounded by ply distance"; the depth is this
 * implementation's own choice, made once here so both the game layer and
 * this file's own doc comment stay in sync.
 *
 * Fair/Weak reuse their OWN already-defined horizon exactly
 * (`HORIZON_PLY` above), via `maxPly = HORIZON_PLY - 1`: a Fair player
 * never claims to see further than Fair already claims to see, cap expiry
 * or not, so the tactical read stays capped at exactly that many total
 * plies (7+1=8 for Fair, 3+1=4 for Weak) -- no separate tuning decision
 * needed for those two levels.
 *
 * Perfect/Strong have no horizon of their own (they rank on the raw,
 * unclamped score) -- but `tacticalFallback` is a COMPLETE, TT-free search
 * with NO node budget, so depth still has to be bounded independently of
 * level to keep it fast at the exact moment (cap expiry) the engine is
 * already struggling to finish a full search. 10/8 plies (11/9 total) were
 * chosen as deep enough to catch the class of near-term tactics SPEC's
 * post-gate amendment names -- a missed double threat is provable within a
 * handful of plies -- while staying shallow enough that a TT-free complete
 * search stays fast on a phone. Perfect gets one notch deeper than Strong
 * since it is the level advertised as never missing anything.
 */
export const TACTICAL_HORIZON_PLY: Record<Level, number> = {
  perfect: 10,
  strong: 8,
  fair: HORIZON_PLY.fair - 1,
  weak: HORIZON_PLY.weak - 1,
};

/** How an engine move was actually chosen (SPEC §3.1's amended "Honesty"
 *  rule). `'complete'` is the level's own defining computation; anything
 *  else must be surfaced, both in the move list and at the level label's
 *  own surface -- see this file's module comment. */
export type EngineMoveOrigin = 'complete' | 'tactical' | 'centre-fallback';

export function isPartialOrigin(origin: EngineMoveOrigin): boolean {
  return origin !== 'complete';
}

export interface LevelMove {
  column: number;
  origin: EngineMoveOrigin;
}

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

/** Every `{ index, score }` pair among "score" columns -- shared shape for
 * both `AnalysisResult.columns` (`ColumnEval[]`) and `TacticalAnalysis.
 * columns` (`TacticalEval[]`); a `TacticalEval` is a structural subset of
 * `ColumnEval` (no `'unknown'` variant), so one function covers both. */
function scoredColumns(columns: ReadonlyArray<ColumnEval | TacticalEval>): Array<{ index: number; score: number }> {
  const result: Array<{ index: number; score: number }> = [];
  columns.forEach((c, index) => {
    if (c.kind === 'score') result.push({ index, score: c.score });
  });
  return result;
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

/**
 * Ranks `scored` columns per `level`'s own rule (SPEC §3.1's level table)
 * and returns the chosen column index. Shared by `pickEngineMove` (a
 * complete `analyse()` result) and `pickEngineMoveFromTactical` (a complete
 * `tacticalFallback()` result) -- both hand this function the same shape
 * (`{ index, score }[]` plus the position's `ply`/`sideToMove`), so the
 * level rule itself cannot drift between the two call sites.
 */
function pickByLevel(
  scored: Array<{ index: number; score: number }>,
  ply: number,
  sideToMove: Side,
  level: Level,
  rng: () => number,
): number {
  if (level === 'strong') {
    // Strong ranks on the RAW score (full engine strength), never the
    // horizon-clamped one -- only Fair/Weak clamp.
    const raw: Candidate[] = scored.map(({ index, score }) => ({ index, rankingScore: score }));
    return pickStrong(raw, rng);
  }
  const candidates: Candidate[] = scored.map(({ index, score }) => ({
    index,
    rankingScore: rankingScore(score, ply, sideToMove, level),
  }));
  return pickBest(candidates);
}

/**
 * Chooses the engine's move for `level` from a COMPLETE `analyse()` result
 * (`result.complete === true` -- this IS the level's own defining
 * computation, so the returned move's `origin` is always `'complete'`).
 *
 * Cap expiry (`result.complete === false`) is NOT handled here -- that is
 * `pickEngineMoveFromTactical`'s job, on a SEPARATE `tacticalFallback` call
 * the caller makes instead (SPEC §3.1a's post-gate amendment; see this
 * file's module comment). Calling this with an incomplete result is a
 * caller bug, not a case this function degrades gracefully from.
 *
 * @param result  A complete `analyse()` result for the position the engine
 *                is about to move in.
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
  if (!result.complete) {
    throw new Error(
      'pickEngineMove requires a complete analysis -- cap expiry is pickEngineMoveFromTactical\'s job (SPEC §3.1a).',
    );
  }
  const scored = scoredColumns(result.columns);
  if (scored.length === 0) {
    throw new Error('pickEngineMove: a complete analysis solved no column -- nothing to choose from.');
  }
  return { column: pickByLevel(scored, ply, result.sideToMove, level, rng), origin: 'complete' };
}

/**
 * Chooses the engine's move for `level` from a `tacticalFallback()` result
 * (SPEC §3.1a: called on cap expiry INSTEAD OF restricting the level rule to
 * a partial deep search's solved subset). `tacticalFallback` is always
 * complete within its own horizon (ENGINE.md: no `'unknown'` variant), so
 * every legal column contributes a candidate here -- there is no further
 * "nothing solved yet" case to handle; that only ever applies if the
 * `tacticalFallback` CALL ITSELF fails, which is `centreMostMove`'s job.
 *
 * @param tactical    The tactical-fallback result for the SAME position
 *                     `sideToMove`/`ply` describe.
 * @param ply         The analysed position's ply (Fair/Weak horizon clamp).
 * @param sideToMove  The analysed position's side to move (from the SAME
 *                     `analyse()` call whose `complete: false` triggered
 *                     this fallback -- `tacticalFallback` doesn't return its
 *                     own, since it shares the position).
 * @param level       The play-strength level.
 * @param rng         Source of randomness for Strong; see `pickEngineMove`.
 */
export function pickEngineMoveFromTactical(
  tactical: TacticalAnalysis,
  ply: number,
  sideToMove: Side,
  level: Level,
  rng: () => number = Math.random,
): LevelMove {
  const scored = scoredColumns(tactical.columns);
  if (scored.length === 0) {
    throw new Error('pickEngineMoveFromTactical: every column is full -- no legal move exists.');
  }
  return { column: pickByLevel(scored, ply, sideToMove, level, rng), origin: 'tactical' };
}

/**
 * Last resort (SPEC §3.1a: "falling back to centre-most only if even
 * [tacticalFallback] cannot run") -- the centre-most LEGAL column, with no
 * evaluation behind the choice at all. `legalCols` is 0-indexed, any order.
 */
export function centreMostMove(legalCols: readonly number[]): LevelMove {
  const centre = CENTRE_OUT.find((i) => legalCols.includes(i));
  if (centre === undefined) {
    throw new Error('centreMostMove: no legal column exists in this position');
  }
  return { column: centre, origin: 'centre-fallback' };
}
