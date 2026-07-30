// Wave 14b — the classifier tested against the Wave 14a oracle fixtures,
// consumed VERBATIM (never restated, never edited — `classifierOracle.ts`
// and its own shape test are byte-untouched by this wave).

import { describe, expect, it } from 'vitest';
import { classifierOracleCases, RULE_NAMES } from './classifierOracle.js';
import { classifyMove, classifyMoves, classifyLoggedGame } from './classifier.js';
import { dropDisc, emptyGrid, type Grid } from '../game/setup.js';
import { colourAtPly } from '../game/seat.js';
import type { LoggedGame } from '../game/loggedGame.js';

// ---------------------------------------------------------------------------
// THE ORACLE IS THE ORACLE.
// ---------------------------------------------------------------------------

describe('classifyMoves reproduces every classifierOracleCases expectation, all seven rules', () => {
  for (const oracleCase of classifierOracleCases) {
    it(`"${oracleCase.id}": ${oracleCase.title}`, () => {
      const observed = classifyMoves(oracleCase.seat, oracleCase.moves);
      const last = observed[observed.length - 1];
      expect(last, `case "${oracleCase.id}" produced no observation for its final move`).toBeDefined();
      expect(last!.column).toBe(oracleCase.moves[oracleCase.moves.length - 1]);
      for (const rule of RULE_NAMES) {
        expect(last!.observations[rule], `case "${oracleCase.id}", rule "${rule}"`).toEqual(oracleCase.expected[rule]);
      }
    });
  }
});

it('classifyLoggedGame delegates to classifyMoves via seat + moves (no separate logic path)', () => {
  for (const oracleCase of classifierOracleCases) {
    const game: LoggedGame = {
      id: 'x',
      date: '2026-01-01T00:00:00.000Z',
      opponent: 'her',
      seat: oracleCase.seat,
      moves: oracleCase.moves,
      result: 'loss',
      source: 'live',
    };
    expect(classifyLoggedGame(game)).toEqual(classifyMoves(oracleCase.seat, oracleCase.moves));
  }
});

// ---------------------------------------------------------------------------
// Property / edge tests.
// ---------------------------------------------------------------------------

describe('edge cases beyond the oracle set', () => {
  it('an empty game classifies nothing', () => {
    expect(classifyMoves({ firstMover: 'red', userColour: 'red' }, [])).toEqual([]);
  });

  it('classifyMoves never emits an observation for a USER ply (D1)', () => {
    // firstMover red, userColour red -> user plays every even ply; only odd
    // plies (yellow, the opponent) may ever appear in the output.
    const seat = { firstMover: 'red' as const, userColour: 'red' as const };
    const moves = [3, 2, 4, 1, 2];
    const observed = classifyMoves(seat, moves);
    for (const entry of observed) {
      expect(entry.ply % 2, 'every observed ply must be odd (yellow, the opponent) under this seat').toBe(1);
      expect(colourAtPly(seat, entry.ply)).toBe('yellow');
    }
  });

  it('all four seat combinations independently move the opponent colour and observation set (CLAUDE.md invariant #1)', () => {
    const moves = [3, 3, 2, 2, 4];
    const combos: Array<{ firstMover: 'red' | 'yellow'; userColour: 'red' | 'yellow' }> = [
      { firstMover: 'red', userColour: 'red' },
      { firstMover: 'red', userColour: 'yellow' },
      { firstMover: 'yellow', userColour: 'red' },
      { firstMover: 'yellow', userColour: 'yellow' },
    ];
    const results = combos.map((seat) => classifyMoves(seat, moves));
    // firstMover=red, userColour=red vs firstMover=red, userColour=yellow:
    // same physical board, but the OPPONENT is a different colour in each,
    // so the two classifications observe the OTHER set of plies (0,2,4 vs
    // 1,3) -- proving colour and turn order are read independently, not
    // derived from one another.
    expect(results[0]!.map((o) => o.ply)).toEqual([1, 3]);
    expect(results[1]!.map((o) => o.ply)).toEqual([0, 2, 4]);
    expect(results[2]!.map((o) => o.ply)).toEqual([0, 2, 4]);
    expect(results[3]!.map((o) => o.ply)).toEqual([1, 3]);
  });

  it('a completely full board (no legal columns at all) leaves every "legal move exists" rule inapplicable', () => {
    // Build a full, non-winning board by hand and classify a move played
    // as if it were the very last disc dropped -- exercised via
    // classifyMove directly so the "before" grid can be constructed without
    // needing a real winnable replay.
    let grid: Grid = emptyGrid();
    // Column-by-column alternating fill that never completes four: fill each
    // column with strict R,Y,R,Y,R,Y from the bottom.
    for (let col = 0; col < 7; col++) {
      for (let row = 0; row < 6; row++) {
        grid = dropDisc(grid, col, row % 2 === 0 ? 'red' : 'yellow');
      }
    }
    // Board is full; there is no legal column left, so classifying a
    // (hypothetical, already-played) move must find every "is there a legal
    // move that..." rule inapplicable regardless of the move argument.
    const observations = classifyMove(grid, 'red', 'yellow', null, 0);
    expect(observations.takes_win.applicable).toBe(false);
    expect(observations.blocks_loss.applicable).toBe(false);
    expect(observations.blocks_diagonal.applicable).toBe(false);
    expect(observations.extends_own.applicable).toBe(false);
    expect(observations.centre_bias.applicable).toBe(false);
    expect(observations.builds_double.applicable).toBe(false);
  });

  it('a draw-result LoggedGame classifies identically to a win/loss one (result never consulted)', () => {
    const base = classifierOracleCases[0]!;
    const asLoss: LoggedGame = {
      id: 'a',
      date: '2026-01-01T00:00:00.000Z',
      opponent: 'her',
      seat: base.seat,
      moves: base.moves,
      result: 'loss',
      source: 'live',
    };
    const asDraw: LoggedGame = { ...asLoss, id: 'b', result: 'draw' };
    expect(classifyLoggedGame(asDraw)).toEqual(classifyLoggedGame(asLoss));
  });

  it('a reconstructed-source LoggedGame classifies identically to a live one (source never consulted here — weighting is betaBernoulli.ts\'s job)', () => {
    const base = classifierOracleCases[0]!;
    const asLive: LoggedGame = {
      id: 'a',
      date: '2026-01-01T00:00:00.000Z',
      opponent: 'her',
      seat: base.seat,
      moves: base.moves,
      result: 'loss',
      source: 'live',
    };
    const asReconstructed: LoggedGame = { ...asLive, id: 'b', source: 'reconstructed' };
    expect(classifyLoggedGame(asReconstructed)).toEqual(classifyLoggedGame(asLive));
  });
});

// ---------------------------------------------------------------------------
// OWNER'S MUTATION MANDATE — narrated here so the mutations and their
// catching tests are on record next to the code they guard (the mutations
// themselves are applied transiently against a working copy and reverted;
// see the wave report for the exact diffs and observed failures).
// ---------------------------------------------------------------------------
//
// Mutation 1 (R3 direction attribution): change
// `DIAGONAL_AXIS_NAMES.has(axis)` in `classifier.ts`'s `blocks_diagonal`
// filter to always `true` (i.e. treat every threat cell as diagonal-
// carrying). Caught by: this file's "classifyMoves reproduces every
// classifierOracleCases expectation" suite, specifically the
// "diag-block-horizontal-miss-diagonal" case (expects blocks_diagonal
// satisfied=false; the mutant reports true because it no longer
// distinguishes the horizontal-only blocked cell from the diagonal one) and
// the "horizontal-only-no-diagonal" case (expects blocks_diagonal
// INAPPLICABLE; the mutant makes it applicable because it stops requiring
// any real diagonal-carrying threat cell to exist at all).
//
// Mutation 2 (D3 exclusivity): delete the
// `if (takesWinApplicable && takesWinSatisfied) { return ...; }` early
// return in `classifyMove`. Caught by: the "d3-taken-win-exclusivity" case
// (expects every rule but takes_win to be inapplicable; the mutant lets
// centre_bias and repeats_column become genuinely applicable+satisfied,
// since the case's own derivation notes those ARE real opportunities on
// their own terms).
