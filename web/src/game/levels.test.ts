import { describe, expect, it } from 'vitest';
import { pickEngineMove } from './levels.js';
import type { AnalysisResult } from '../engine/types.js';

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
  it('always plays the objectively best column', () => {
    const move = pickEngineMove(fixedComplete(), 0, 'perfect');
    expect(move).toEqual({ column: 2, partial: false });
  });
});

describe('pickEngineMove — Strong', () => {
  it('picks uniformly among columns within 2 points of the raw best, ignoring the horizon clamp', () => {
    // Raw best is col 2 (score 1). Within 2 points (>= -1): col 0 (0) and
    // col 2 (1). Col 3 (-5) and col 5 (-18) are excluded.
    const low = pickEngineMove(fixedComplete(), 0, 'strong', () => 0);
    expect(low).toEqual({ column: 0, partial: false });

    const high = pickEngineMove(fixedComplete(), 0, 'strong', () => 0.99);
    expect(high).toEqual({ column: 2, partial: false });
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
    expect(move).toEqual({ column: 0, partial: false });
  });

  it('Weak clamps the same slow win/loss AND the col-5 loss (distance 8 > weak horizon 4)', () => {
    const move = pickEngineMove(fixedComplete(), 0, 'weak');
    expect(move).toEqual({ column: 0, partial: false });
  });
});

describe('pickEngineMove — incomplete analysis (SPEC §3.1 amendment)', () => {
  function partialResult(): AnalysisResult {
    return {
      columns: [
        { kind: 'unknown' },
        { kind: 'full' },
        { kind: 'score', score: 1 },
        { kind: 'unknown' },
        { kind: 'full' },
        { kind: 'unknown' },
        { kind: 'unknown' },
      ],
      best: null,
      complete: false,
      sideToMove: 'first',
      threats: { current: [], opponent: [] },
      nodes: 100,
    };
  }

  it('restricts the level rule to solved columns and marks the move partial', () => {
    const move = pickEngineMove(partialResult(), 0, 'perfect');
    expect(move).toEqual({ column: 2, partial: true });
  });

  it('falls back to the centre-most legal column when nothing is solved yet', () => {
    const result: AnalysisResult = {
      columns: [
        { kind: 'unknown' },
        { kind: 'full' },
        { kind: 'unknown' },
        { kind: 'unknown' }, // centre column, index 3
        { kind: 'unknown' },
        { kind: 'unknown' },
        { kind: 'unknown' },
      ],
      best: null,
      complete: false,
      sideToMove: 'first',
      threats: { current: [], opponent: [] },
      nodes: 0,
    };
    const move = pickEngineMove(result, 0, 'perfect');
    expect(move).toEqual({ column: 3, partial: true });
  });

  it('falls back to the next centre-most legal column when the true centre is full', () => {
    const result: AnalysisResult = {
      columns: [
        { kind: 'unknown' },
        { kind: 'unknown' },
        { kind: 'unknown' },
        { kind: 'full' }, // centre is full -- next in centre-out order is col 2
        { kind: 'unknown' },
        { kind: 'unknown' },
        { kind: 'unknown' },
      ],
      best: null,
      complete: false,
      sideToMove: 'first',
      threats: { current: [], opponent: [] },
      nodes: 0,
    };
    const move = pickEngineMove(result, 0, 'perfect');
    expect(move).toEqual({ column: 2, partial: true });
  });

  it('is deterministic given the same solved set for every level except Strong', () => {
    const a = pickEngineMove(partialResult(), 0, 'fair');
    const b = pickEngineMove(partialResult(), 0, 'fair');
    expect(a).toEqual(b);
  });
});
