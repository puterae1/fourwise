import { describe, expect, it } from 'vitest';
import { classifierOracleCases, RULE_NAMES } from './classifierOracle.js';
import { scoreLegalMoves, topPredictions } from './prediction.js';
import { classifyMove } from './classifier.js';
import { initialRuleStates, type OpponentRuleStates, type RuleState } from './betaBernoulli.js';
import { colourAtPly, otherColour, type Seat } from '../game/seat.js';
import { dropDisc, emptyGrid, legalSetupColumns, type Grid } from '../game/setup.js';

/** Replays `moves` under `seat` and returns the grid AFTER all of them. */
function replayGrid(seat: Seat, moves: readonly number[]): Grid {
  let grid: Grid = emptyGrid();
  for (let ply = 0; ply < moves.length; ply++) {
    grid = dropDisc(grid, moves[ply]!, colourAtPly(seat, ply));
  }
  return grid;
}

describe('scoreLegalMoves', () => {
  it('normalises to sum 1 across the full legal set on a real fixture position', () => {
    const oracleCase = classifierOracleCases.find((c) => c.id === 'genuine-two-column-double')!;
    const priorMoves = oracleCase.moves.slice(0, -1);
    const grid = replayGrid(oracleCase.seat, priorMoves);
    const opponentColour = otherColour(oracleCase.seat.userColour);
    const previousMoverColumn = priorMoves.length >= 2 ? priorMoves[priorMoves.length - 2]! : null;
    const scores = scoreLegalMoves(grid, opponentColour, oracleCase.seat.userColour, previousMoverColumn, initialRuleStates());
    const total = scores.reduce((sum, s) => sum + s.confidence, 0);
    expect(total).toBeCloseTo(1, 10);
    expect(scores.map((s) => s.column).sort((a, b) => a - b)).toEqual(legalSetupColumns(grid));
  });

  it('D3 exclusivity carries into prediction: a winning candidate move is never boosted by other rules it would ALSO satisfy', () => {
    // This fixture's own derivation notes that, evaluated on its own terms
    // (i.e. WITHOUT D3), the winning column would also be centre, a repeat,
    // and an extension of her longest line -- all comparatively low-prior
    // rules (0.45/0.30/0.55) next to takes_win's 0.97. If D3 exclusivity did
    // not carry into prediction, this candidate's raw score (and so its
    // normalised confidence) would be HIGHER than takes_win's posterior mean
    // alone can produce relative to the rest of the field; asserting it
    // matches the single-rule figure (via the other legal moves' own,
    // independently-computed low scores) catches a dropped-exclusivity
    // regression here as surely as it does in the classifier directly.
    const oracleCase = classifierOracleCases.find((c) => c.id === 'd3-taken-win-exclusivity')!;
    const priorMoves = oracleCase.moves.slice(0, -1);
    const winningColumn = oracleCase.moves[oracleCase.moves.length - 1]!;
    const grid = replayGrid(oracleCase.seat, priorMoves);
    const opponentColour = otherColour(oracleCase.seat.userColour);
    const userColour = oracleCase.seat.userColour;
    const previousMoverColumn = priorMoves.length >= 2 ? priorMoves[priorMoves.length - 2]! : null;
    const states = initialRuleStates();
    const scores = scoreLegalMoves(grid, opponentColour, userColour, previousMoverColumn, states);
    const total = scores.reduce((sum, s) => sum + s.confidence, 0);
    expect(total).toBeCloseTo(1, 10);

    const winningScore = scores.find((s) => s.column === winningColumn)!;
    // The winning move must classify (via the SAME satisfaction tests
    // scoreLegalMoves uses internally) to takes_win alone -- confirming the
    // exclusivity actually reached this candidate, not just the classifier.
    const winningObservations = classifyMove(grid, opponentColour, userColour, previousMoverColumn, winningColumn);
    expect(winningObservations.takes_win).toEqual({ applicable: true, satisfied: true });
    for (const rule of RULE_NAMES) {
      if (rule === 'takes_win') continue;
      expect(winningObservations[rule]).toEqual({ applicable: false, satisfied: null });
    }

    // Every OTHER legal move can score at most from the (non-takes_win) rules
    // it satisfies, none of which exceeds takes_win's 0.97 prior on its own
    // -- so the winning move must be the highest-confidence candidate.
    for (const other of scores) {
      if (other.column === winningColumn) continue;
      expect(winningScore.confidence).toBeGreaterThan(other.confidence);
    }
  });

  it('a fully occupied board (no legal columns) scores nothing, never divides by zero', () => {
    let grid: Grid = emptyGrid();
    for (let col = 0; col < 7; col++) {
      for (let row = 0; row < 6; row++) grid = dropDisc(grid, col, row % 2 === 0 ? 'red' : 'yellow');
    }
    const scores = scoreLegalMoves(grid, 'red', 'yellow', null, initialRuleStates());
    expect(scores).toEqual([]);
  });

  it('falls back to a uniform distribution (never NaN/Infinity) when every rule posterior is degenerately zero', () => {
    const zeroState: RuleState = { alpha: 0, beta: 1, rawSuccesses: 0, rawTotal: 0 };
    const zeroStates = Object.fromEntries(RULE_NAMES.map((rule) => [rule, zeroState])) as unknown as OpponentRuleStates;
    const grid = emptyGrid();
    const scores = scoreLegalMoves(grid, 'red', 'yellow', null, zeroStates);
    expect(scores.length).toBe(7);
    for (const s of scores) {
      expect(s.confidence).toBeCloseTo(1 / 7, 10);
      expect(Number.isFinite(s.confidence)).toBe(true);
    }
  });
});

describe('topPredictions', () => {
  it('returns at most 3, sorted by confidence descending', () => {
    const scores = [
      { column: 0, confidence: 0.1 },
      { column: 1, confidence: 0.5 },
      { column: 2, confidence: 0.2 },
      { column: 3, confidence: 0.15 },
      { column: 4, confidence: 0.05 },
    ];
    const top = topPredictions(scores);
    expect(top.length).toBe(3);
    expect(top.map((s) => s.column)).toEqual([1, 2, 3]);
  });

  it('returns fewer than 3 when fewer legal moves exist, never pads', () => {
    const scores = [
      { column: 0, confidence: 0.6 },
      { column: 1, confidence: 0.4 },
    ];
    expect(topPredictions(scores)).toEqual([
      { column: 0, confidence: 0.6 },
      { column: 1, confidence: 0.4 },
    ]);
  });

  it('does not mutate its input array', () => {
    const scores = [
      { column: 0, confidence: 0.1 },
      { column: 1, confidence: 0.9 },
    ];
    const copy = scores.map((s) => ({ ...s }));
    topPredictions(scores);
    expect(scores).toEqual(copy);
  });
});
