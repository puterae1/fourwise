import { describe, expect, it } from 'vitest';
import {
  centreMostMove,
  pickEngineMove,
  pickEngineMoveFromTactical,
  isPartialOrigin,
  TACTICAL_HORIZON_PLY,
  type Level,
} from './levels.js';
import type { AnalysisResult, TacticalAnalysis } from '../engine/types.js';

// A single fixed position's analysis, ply 0, sideToMove 'first':
//   col 0: score  0  (a draw)
//   col 1: full
//   col 2: score +1  (a WIN, but a very slow one -- ply-distance 41, hand
//                      computed: remaining = 22 - 1 - 0 = 21 winner moves;
//                      winner ('first') moves next, so total plies =
//                      2*21 - 1 = 41 -- far beyond both Fair's (8) and
//                      Weak's (4) horizon)
//   col 3: score -5  (a loss; winner is 'second'; remaining = 22-5-0 = 17;
//                      winner does NOT move next, total plies = 2*17 = 34 --
//                      also beyond both horizons)
//   col 4: full
//   col 5: score -18 (a fast loss; winner 'second'; remaining = 22-18-0 = 4;
//                      total plies = 2*4 = 8 -- exactly AT Fair's horizon
//                      (not clamped, "further than 8" is strict), but
//                      BEYOND Weak's horizon of 4 (clamped))
//   col 6: full
function fixedComplete(): AnalysisResult {
  return {
    columns: [
      { kind: 'score', score: 0 },
      { kind: 'full' },
      { kind: 'score', score: 1 },
      { kind: 'score', score: -5 },
      { kind: 'full' },
      { kind: 'score', score: -18 },
      { kind: 'full' },
    ],
    best: 2,
    complete: true,
    sideToMove: 'first',
    threats: { current: [], opponent: [] },
    nodes: 999,
  };
}

describe('pickEngineMove — Perfect', () => {
  it('always plays the objectively best column, origin "complete"', () => {
    const move = pickEngineMove(fixedComplete(), 0, 'perfect');
    expect(move).toEqual({ column: 2, origin: 'complete' });
  });
});

describe('pickEngineMove — Strong', () => {
  it('picks uniformly among columns within 2 points of the raw best, ignoring the horizon clamp', () => {
    // Raw best is col 2 (score 1). Within 2 points (>= -1): col 0 (0) and
    // col 2 (1). Col 3 (-5) and col 5 (-18) are excluded.
    const low = pickEngineMove(fixedComplete(), 0, 'strong', () => 0);
    expect(low).toEqual({ column: 0, origin: 'complete' });

    const high = pickEngineMove(fixedComplete(), 0, 'strong', () => 0.99);
    expect(high).toEqual({ column: 2, origin: 'complete' });
  });
});

describe('pickEngineMove — Fair and Weak (score-horizon clamp)', () => {
  it('Fair treats the slow win and the distant loss as draws, and prefers the tied draw at the lower index', () => {
    // Clamped ranking: col 0 = 0 (already a draw), col 2 = 0 (41 > 8),
    // col 3 = 0 (34 > 8), col 5 = -18 UNCLAMPED (distance is exactly 8, not
    // "further than" 8). Best clamped score is 0, tied among 0/2/3; lowest
    // index wins -> col 0. This differs from Perfect's col 2 -- proof the
    // clamp actually changes the decision, not just the display.
    const move = pickEngineMove(fixedComplete(), 0, 'fair');
    expect(move).toEqual({ column: 0, origin: 'complete' });
  });

  it('Weak clamps the same slow win/loss AND the col-5 loss (distance 8 > weak horizon 4)', () => {
    const move = pickEngineMove(fixedComplete(), 0, 'weak');
    expect(move).toEqual({ column: 0, origin: 'complete' });
  });
});

describe('pickEngineMove — requires a complete analysis (SPEC §3.1a supersedes the old solved-subset rule)', () => {
  it('throws for an incomplete analysis -- cap expiry is pickEngineMoveFromTactical\'s job now', () => {
    const partial: AnalysisResult = {
      columns: Array.from({ length: 7 }, () => ({ kind: 'unknown' as const })),
      best: null,
      complete: false,
      sideToMove: 'first',
      threats: { current: [], opponent: [] },
      nodes: 100,
    };
    expect(() => pickEngineMove(partial, 0, 'perfect')).toThrow(/complete/i);
  });
});

// -----------------------------------------------------------------------
// pickEngineMoveFromTactical — SPEC §3.1a's post-gate amendment: cap expiry
// calls tacticalFallback (a COMPLETE, ply-bounded search) instead of
// restricting the level rule to a partial deep search's solved subset.
// -----------------------------------------------------------------------

function tacticalFixed(): TacticalAnalysis {
  // Mirrors `fixedComplete()`'s shape one-for-one (same scores/fulls at the
  // same indices) so the level-ranking assertions below can reuse the exact
  // same expected outcomes -- proof `pickByLevel` is genuinely shared code,
  // not two independently-drifting implementations.
  return {
    columns: [
      { kind: 'score', score: 0 },
      { kind: 'full' },
      { kind: 'score', score: 1 },
      { kind: 'score', score: -5 },
      { kind: 'full' },
      { kind: 'score', score: -18 },
      { kind: 'full' },
    ],
    best: 2,
  };
}

describe('pickEngineMoveFromTactical', () => {
  it('Perfect plays the best tactical column, origin "tactical"', () => {
    const move = pickEngineMoveFromTactical(tacticalFixed(), 0, 'first', 'perfect');
    expect(move).toEqual({ column: 2, origin: 'tactical' });
  });

  it('Strong picks uniformly within 2 points of the tactical best', () => {
    const low = pickEngineMoveFromTactical(tacticalFixed(), 0, 'first', 'strong', () => 0);
    expect(low).toEqual({ column: 0, origin: 'tactical' });
    const high = pickEngineMoveFromTactical(tacticalFixed(), 0, 'first', 'strong', () => 0.99);
    expect(high).toEqual({ column: 2, origin: 'tactical' });
  });

  it('Fair/Weak apply the exact same horizon clamp as the complete-analysis path', () => {
    expect(pickEngineMoveFromTactical(tacticalFixed(), 0, 'first', 'fair')).toEqual({
      column: 0,
      origin: 'tactical',
    });
    expect(pickEngineMoveFromTactical(tacticalFixed(), 0, 'first', 'weak')).toEqual({
      column: 0,
      origin: 'tactical',
    });
  });

  it('never reports an unresolved column -- there is nothing "unknown" to fall back on within tacticalFallback', () => {
    // Every column here is either 'score' or 'full' by construction
    // (TacticalEval has no 'unknown' variant at the type level) -- this
    // test documents that pickEngineMoveFromTactical never needs a
    // "nothing solved yet" branch the way the old rule did.
    const allFull: TacticalAnalysis = { columns: Array.from({ length: 7 }, () => ({ kind: 'full' as const })), best: null };
    expect(() => pickEngineMoveFromTactical(allFull, 0, 'first', 'perfect')).toThrow(/no legal move/i);
  });

  it('is deterministic given the same tactical result for every level except Strong', () => {
    const a = pickEngineMoveFromTactical(tacticalFixed(), 0, 'first', 'fair');
    const b = pickEngineMoveFromTactical(tacticalFixed(), 0, 'first', 'fair');
    expect(a).toEqual(b);
  });
});

describe('centreMostMove — the last-resort fallback when tacticalFallback itself cannot run', () => {
  it('picks the true centre column (index 3) when it is legal', () => {
    expect(centreMostMove([0, 1, 2, 3, 4, 5, 6])).toEqual({ column: 3, origin: 'centre-fallback' });
  });

  it('falls back to the next centre-most legal column when the true centre is full', () => {
    expect(centreMostMove([0, 1, 2, 4, 5, 6])).toEqual({ column: 2, origin: 'centre-fallback' });
  });

  it('throws when no legal column exists', () => {
    expect(() => centreMostMove([])).toThrow(/no legal column/i);
  });
});

describe('isPartialOrigin', () => {
  it('is false only for "complete"', () => {
    expect(isPartialOrigin('complete')).toBe(false);
    expect(isPartialOrigin('tactical')).toBe(true);
    expect(isPartialOrigin('centre-fallback')).toBe(true);
  });
});

describe('TACTICAL_HORIZON_PLY — the chosen per-level horizon mapping', () => {
  it('Fair/Weak reuse their own already-defined score-horizon exactly (maxPly = horizon - 1)', () => {
    expect(TACTICAL_HORIZON_PLY.fair).toBe(7); // 8-ply horizon, minus the "played into the column" ply
    expect(TACTICAL_HORIZON_PLY.weak).toBe(3); // 4-ply horizon, minus the "played into the column" ply
  });

  it('every level has a positive, defined horizon', () => {
    const levels: Level[] = ['perfect', 'strong', 'fair', 'weak'];
    for (const level of levels) {
      expect(TACTICAL_HORIZON_PLY[level]).toBeGreaterThan(0);
    }
  });

  it('Perfect searches at least as deep as Strong (never a WEAKER tactical read at a nominally stronger level)', () => {
    expect(TACTICAL_HORIZON_PLY.perfect).toBeGreaterThanOrEqual(TACTICAL_HORIZON_PLY.strong);
  });
});
