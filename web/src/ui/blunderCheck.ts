// Thin UI-level wrapper over `game/blunder.ts`'s `compareForBlunder` (SPEC.md
// §3.2 "Blunder flag", Firing rule amended 2026-07-28). This module makes NO
// judgement of its own about win/draw/loss and does not touch `game/` — it
// only carries the "before" verdict's kind through the comparison, because
// the Play headline needs it to phrase the blunder line correctly ("threw
// away A WIN" vs "threw away THE DRAW"), which `compareForBlunder` itself has
// no reason to expose since it only returns a status.
//
// Firing rule, reiterated because it is load-bearing here: `BlunderInput`
// carries only a `VerdictKind` ('win' | 'draw' | 'loss'), never a distance.
// A speed-only change (win-in-9 played as win-in-15) is `{kind:'win'}` on
// both sides of the comparison, which can never rank as a degradation — the
// firing rule holds by construction, not by an extra check here.

import { compareForBlunder, type BlunderInput, type BlunderStatus } from '../game/blunder.js';
import type { VerdictKind } from '../game/verdict.js';

export type { BlunderInput, BlunderStatus };

export interface BlunderCheck {
  status: BlunderStatus;
  /** The verdict kind BEFORE the move — only present when the comparison
   *  actually fired (`status === 'blunder'`) is it meaningful for copy, but
   *  it is carried through whenever the "before" side was evaluated at all,
   *  never guessed when it was not. */
  beforeKind: VerdictKind | null;
}

export function checkForBlunder(before: BlunderInput, after: BlunderInput): BlunderCheck {
  const result = compareForBlunder(before, after);
  return {
    status: result.status,
    beforeKind: before.evaluated ? before.kind : null,
  };
}
