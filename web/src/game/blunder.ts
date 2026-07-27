// Blunder flag — SPEC.md §3.2 ("Blunder flag") and §3.1's amended "Engine
// move under an incomplete analysis" honesty rule.
//
// After a human move, compare the position verdict before and after. If it
// degrades (win -> draw, draw -> loss, win -> loss), that move threw away
// something and must be flagged immediately. If either side of the
// comparison came from an incomplete analysis, the comparison itself is
// meaningless -- the flag must say "not evaluated" rather than guess.

import type { VerdictKind } from './verdict.js';

/**
 * One side of a before/after comparison: either a fully-resolved verdict
 * kind, or `{ evaluated: false }` when the analysis it would come from was
 * incomplete (`AnalysisResult.complete === false` / a partial engine move).
 */
export type BlunderInput = { evaluated: true; kind: VerdictKind } | { evaluated: false };

export type BlunderStatus = 'not-evaluated' | 'blunder' | 'ok';

export interface BlunderResult {
  status: BlunderStatus;
}

// Higher rank is strictly better for the player being evaluated.
const RANK: Record<VerdictKind, number> = { win: 2, draw: 1, loss: 0 };

/**
 * Compares the verdict (from the SAME seat's point of view) before and
 * after one human move. Never fires from a partial comparison -- if either
 * side is `{ evaluated: false }`, the result is `'not-evaluated'`, never a
 * guess (SPEC §3.1 amendment).
 */
export function compareForBlunder(before: BlunderInput, after: BlunderInput): BlunderResult {
  if (!before.evaluated || !after.evaluated) {
    return { status: 'not-evaluated' };
  }
  return { status: RANK[after.kind] < RANK[before.kind] ? 'blunder' : 'ok' };
}
