// The four-seat acceptance test — SPEC.md §1, AMENDED 2026-07-28.
//
// This is gate #2 of Phase 1 (ROADMAP.md). The ORIGINAL assertion ("the
// engine's internal evaluation must be identical across all four seat
// combinations") is structurally guaranteed and proves nothing: seat is not
// an engine input. The assertion that actually carries weight is the
// TRANSLATION — one fixed engine result, fed through the game layer under
// all four seats, must produce outputs that DIFFER where they must and are
// each independently correct.
//
// Every expected value below is hand-computed from the spec's own formulas
// (SPEC §1 colour/ply mapping, SPEC §2 parity, and the score -> distance
// arithmetic in ENGINE.md's score convention), written as literal constants.
// Nothing here calls the code under test to produce an expectation.
//
// Per the task order of work, this file is written before `verdict.ts` and
// `parity.ts` exist — it will not compile until they do. That failure is
// expected and correct.

import { describe, expect, it } from 'vitest';
import { colourForSide, userMovesFirst, type Seat } from './seat.js';
import { translateAnalysis, translateScore } from './verdict.js';
import { parityRows } from './parity.js';
import { createGame, enginePosition, playMove } from './gameState.js';
import type { AnalysisResult } from '../engine/types.js';

// ---------------------------------------------------------------------------
// One fixed engine result. The engine never runs for this test.
// ---------------------------------------------------------------------------
// Position: 4 plies already played. sideToMove is 'first' at ply 4, matching
// SPEC §1's ply/colour rule (mover parity == ply parity for the side that
// moved first overall).
const ENGINE_PLY = 4;
const ENGINE_SIDE_TO_MOVE = 'first' as const;
// score = 22 - stones_the_winner_will_have_played (ENGINE.md "Score
// convention"). +7 means the CURRENT MOVER ('first', since sideToMove is
// 'first') wins. By hand: winner is 'first'; 'first' has already played
// ceil(4/2) = 2 of their own stones among the 4 plies so far; total stones
// the winner will ever play = 22 - 7 = 15; so 15 - 2 = 13 of the winner's
// own moves remain, INCLUDING the move about to be played.
const ENGINE_SCORE = 7;
const EXPECTED_DISTANCE = 13;

interface SeatCase {
  name: string;
  seat: Seat;
  expectedUserMovesFirst: boolean;
  expectedVerdictKind: 'win' | 'loss' | 'draw';
  expectedSentence: string;
  expectedFirstMoverColour: 'red' | 'yellow';
  expectedSecondMoverColour: 'red' | 'yellow';
  expectedUserRows: number[];
  expectedOpponentRows: number[];
}

// Hand-derived per seat. See the comment above each block for the reasoning;
// none of these numbers/strings were produced by calling seat.ts/verdict.ts/
// parity.ts — they follow directly from SPEC §1 and §2 by hand.
const CASES: SeatCase[] = [
  {
    // A: user is red, red moves first -> user moves first, user IS the
    // winning 'first' side -> user wins.
    name: 'A: firstMover=red, userColour=red',
    seat: { firstMover: 'red', userColour: 'red' },
    expectedUserMovesFirst: true,
    expectedVerdictKind: 'win',
    expectedSentence: 'you win in 13 moves',
    expectedFirstMoverColour: 'red',
    expectedSecondMoverColour: 'yellow',
    expectedUserRows: [1, 3, 5],
    expectedOpponentRows: [2, 4, 6],
  },
  {
    // B: user is yellow, red still moves first -> user moves SECOND -> the
    // winning 'first' side is the opponent -> user loses. Colour mapping is
    // unchanged from A because firstMover (red) is unchanged.
    name: 'B: firstMover=red, userColour=yellow',
    seat: { firstMover: 'red', userColour: 'yellow' },
    expectedUserMovesFirst: false,
    expectedVerdictKind: 'loss',
    expectedSentence: 'the opponent wins in 13 moves',
    expectedFirstMoverColour: 'red',
    expectedSecondMoverColour: 'yellow',
    expectedUserRows: [2, 4, 6],
    expectedOpponentRows: [1, 3, 5],
  },
  {
    // C: user is red, but yellow moves first this game -> user moves
    // second -> user loses, SAME verdict as B, but for a different reason
    // (turn order flipped here, colour flipped there) -- proving verdict
    // tracks userMovesFirst, not colour. Colour mapping flips relative to
    // A/B because firstMover is now yellow.
    name: 'C: firstMover=yellow, userColour=red',
    seat: { firstMover: 'yellow', userColour: 'red' },
    expectedUserMovesFirst: false,
    expectedVerdictKind: 'loss',
    expectedSentence: 'the opponent wins in 13 moves',
    expectedFirstMoverColour: 'yellow',
    expectedSecondMoverColour: 'red',
    expectedUserRows: [2, 4, 6],
    expectedOpponentRows: [1, 3, 5],
  },
  {
    // D: user is yellow, yellow moves first -> user moves first -> user
    // wins, SAME verdict as A despite the opposite colour of A -- again
    // proving independence. Colour mapping matches C (same firstMover).
    name: 'D: firstMover=yellow, userColour=yellow',
    seat: { firstMover: 'yellow', userColour: 'yellow' },
    expectedUserMovesFirst: true,
    expectedVerdictKind: 'win',
    expectedSentence: 'you win in 13 moves',
    expectedFirstMoverColour: 'yellow',
    expectedSecondMoverColour: 'red',
    expectedUserRows: [1, 3, 5],
    expectedOpponentRows: [2, 4, 6],
  },
];

describe('four-seat acceptance test (SPEC §1, amended 2026-07-28)', () => {
  it.each(CASES)(
    '$name: verdict, colour, and parity are each independently correct',
    ({
      seat,
      expectedUserMovesFirst,
      expectedVerdictKind,
      expectedSentence,
      expectedFirstMoverColour,
      expectedSecondMoverColour,
      expectedUserRows,
      expectedOpponentRows,
    }) => {
      // (a)/(b) turn order is derived correctly and independently of colour.
      expect(userMovesFirst(seat)).toBe(expectedUserMovesFirst);

      // Verdict translation: same score, same ply, same sideToMove every
      // time -- only `seat` changes.
      const verdict = translateScore(ENGINE_SCORE, ENGINE_PLY, ENGINE_SIDE_TO_MOVE, seat);
      expect(verdict.kind).toBe(expectedVerdictKind);
      expect(verdict.distance).toBe(EXPECTED_DISTANCE);
      expect(verdict.sentence).toBe(expectedSentence);

      // Colour mapping depends ONLY on firstMover, never on userColour.
      expect(colourForSide(seat, 'first')).toBe(expectedFirstMoverColour);
      expect(colourForSide(seat, 'second')).toBe(expectedSecondMoverColour);

      // Parity rows, computed from userMovesFirst only (SPEC §2).
      const rows = parityRows(userMovesFirst(seat));
      expect(rows.user).toEqual(expectedUserRows);
      expect(rows.opponent).toEqual(expectedOpponentRows);
    },
  );

  it('produces byte-identical engine-facing positions across all four seats, via the real call site', () => {
    // Not a seatless stand-in: `gameState.ts`'s `enginePosition` is the
    // ACTUAL function whose output is handed to `engine/client.ts`'s
    // `analyse`/`analyseProgressive`. Its signature takes only a
    // `GameState` (which carries `seat` for OTHER purposes, e.g.
    // `colourToMove`) -- proving the byte-identical claim here means
    // proving that field is never read on this path, not proving a
    // decoy function can't see something it was never given.
    const columns = [3, 2, 4, 1]; // 0-indexed columns, arbitrary but fixed
    const EXPECTED_POSITION = '4352'; // digits: col3+1, col2+1, col4+1, col1+1

    const positions = CASES.map(({ seat }) => {
      let state = createGame(seat);
      for (const column of columns) {
        const result = playMove(state, column);
        if (!result.ok) throw new Error(result.error);
        state = result.state;
      }
      return enginePosition(state);
    });

    for (const position of positions) {
      expect(position).toBe(EXPECTED_POSITION);
    }

    // The string is exactly the digits of the columns played and nothing
    // else -- ruling out any seat-derived value smuggled in as extra
    // characters rather than merely asserting equality of two calls that
    // could never have differed by construction.
    expect(EXPECTED_POSITION).toMatch(/^[1-7]+$/);
    expect(EXPECTED_POSITION).toHaveLength(columns.length);
  });

  it('differs where it must: verdict wording, colour, and parity all vary across seats', () => {
    const verdicts = CASES.map((c) => translateScore(ENGINE_SCORE, ENGINE_PLY, ENGINE_SIDE_TO_MOVE, c.seat).sentence);
    // A and D say "you win"; B and C say "the opponent wins" -- not all four
    // identical, and not grouped by colour (A/B share a colour pairing, C/D
    // share the other, yet the verdict split is A+D vs B+C).
    expect(new Set(verdicts).size).toBe(2);
    expect(verdicts[0]).toBe(verdicts[3]);
    expect(verdicts[1]).toBe(verdicts[2]);
    expect(verdicts[0]).not.toBe(verdicts[1]);

    const firstMoverColours = CASES.map((c) => colourForSide(c.seat, 'first'));
    // Colour mapping splits A+B vs C+D -- grouped by firstMover, which is a
    // DIFFERENT grouping than the verdict split above. That difference is
    // the independence proof.
    expect(firstMoverColours[0]).toBe(firstMoverColours[1]);
    expect(firstMoverColours[2]).toBe(firstMoverColours[3]);
    expect(firstMoverColours[0]).not.toBe(firstMoverColours[2]);
  });
});

// ---------------------------------------------------------------------------
// Whole-analysis translation (SPEC §1's amended assertion, applied to
// verdict.ts's `translateAnalysis` -- the function Analyse mode's per-column
// display actually consumes, not just the lower-level `translateScore`
// exercised above). ONE fixed, realistic `AnalysisResult` literal, fed
// through `translateAnalysis` four times, once per seat.
// ---------------------------------------------------------------------------
//
// Same analysed position as above (ply 4, sideToMove 'first' -- see
// ENGINE_PLY/ENGINE_SIDE_TO_MOVE), now with a full 7-column result:
//   col 0: score  +7  (a win for the mover, 'first' -- same figure as
//                       ENGINE_SCORE/EXPECTED_DISTANCE above: distance 13)
//   col 1: score  -5  (a LOSS for the mover, 'first' -- so the winner is
//                       'second'. By hand: 'second' has already played
//                       floor(4/2) = 2 stones among the 4 plies so far;
//                       total stones the winner will ever play = 22 - 5 =
//                       17; so 17 - 2 = 15 of the winner's own moves remain)
//   col 2: full
//   col 3..6: unknown
// `best` MUST be `null` here: ENGINE.md's own contract is "best: number |
// null; null unless every non-full column is 'score'", and columns 3-6
// are not -- so `complete: false` and `best: null` is the only honest pair,
// not an arbitrary test choice.
const FIXED_ANALYSIS: AnalysisResult = {
  columns: [
    { kind: 'score', score: 7 },
    { kind: 'score', score: -5 },
    { kind: 'full' },
    { kind: 'unknown' },
    { kind: 'unknown' },
    { kind: 'unknown' },
    { kind: 'unknown' },
  ],
  best: null,
  complete: false,
  sideToMove: ENGINE_SIDE_TO_MOVE,
  threats: { current: [10, 17], opponent: [24] },
  nodes: 250_000,
};

const COL0_DISTANCE = 13; // same figure as EXPECTED_DISTANCE above
const COL1_DISTANCE = 15;

interface AnalysisSeatCase {
  name: string;
  seat: Seat;
  // col 0 is a win for 'first' -- whether that is a user win depends on
  // whether the user IS 'first' under this seat (same A+D / B+C split as
  // the single-score test above, since it is the identical score/ply/side).
  col0Kind: 'win' | 'loss';
  col0Sentence: string;
  // col 1 is a win for 'second' -- the OPPOSITE split (B+C / A+D flipped).
  col1Kind: 'win' | 'loss';
  col1Sentence: string;
  expectedFirstMoverColour: 'red' | 'yellow';
  expectedSecondMoverColour: 'red' | 'yellow';
}

const ANALYSIS_CASES: AnalysisSeatCase[] = [
  {
    name: 'A: firstMover=red, userColour=red',
    seat: { firstMover: 'red', userColour: 'red' },
    col0Kind: 'win',
    col0Sentence: 'you win in 13 moves',
    col1Kind: 'loss',
    col1Sentence: 'the opponent wins in 15 moves',
    expectedFirstMoverColour: 'red',
    expectedSecondMoverColour: 'yellow',
  },
  {
    name: 'B: firstMover=red, userColour=yellow',
    seat: { firstMover: 'red', userColour: 'yellow' },
    col0Kind: 'loss',
    col0Sentence: 'the opponent wins in 13 moves',
    col1Kind: 'win',
    col1Sentence: 'you win in 15 moves',
    expectedFirstMoverColour: 'red',
    expectedSecondMoverColour: 'yellow',
  },
  {
    name: 'C: firstMover=yellow, userColour=red',
    seat: { firstMover: 'yellow', userColour: 'red' },
    col0Kind: 'loss',
    col0Sentence: 'the opponent wins in 13 moves',
    col1Kind: 'win',
    col1Sentence: 'you win in 15 moves',
    expectedFirstMoverColour: 'yellow',
    expectedSecondMoverColour: 'red',
  },
  {
    name: 'D: firstMover=yellow, userColour=yellow',
    seat: { firstMover: 'yellow', userColour: 'yellow' },
    col0Kind: 'win',
    col0Sentence: 'you win in 13 moves',
    col1Kind: 'loss',
    col1Sentence: 'the opponent wins in 15 moves',
    expectedFirstMoverColour: 'yellow',
    expectedSecondMoverColour: 'red',
  },
];

describe('whole-analysis translation across all four seats (SPEC §1, amended)', () => {
  it.each(ANALYSIS_CASES)(
    '$name: per-column verdicts are independently correct, unknown/full pass through honestly',
    ({ seat, col0Kind, col0Sentence, col1Kind, col1Sentence, expectedFirstMoverColour, expectedSecondMoverColour }) => {
      const translated = translateAnalysis(FIXED_ANALYSIS, ENGINE_PLY, seat);

      // (a) the two scored columns, hand-derived per seat above.
      const col0 = translated.columns[0];
      expect(col0.kind).toBe('score');
      if (col0.kind === 'score') {
        expect(col0.verdict.kind).toBe(col0Kind);
        expect(col0.verdict.distance).toBe(COL0_DISTANCE);
        expect(col0.verdict.sentence).toBe(col0Sentence);
      }

      const col1 = translated.columns[1];
      expect(col1.kind).toBe('score');
      if (col1.kind === 'score') {
        expect(col1.verdict.kind).toBe(col1Kind);
        expect(col1.verdict.distance).toBe(COL1_DISTANCE);
        expect(col1.verdict.sentence).toBe(col1Sentence);
      }

      // (b) 'unknown' never becomes a guessed verdict, in ANY seat -- SPEC
      // §6's no-placeholder-data rule, checked at all four remaining
      // unsolved columns.
      for (const index of [3, 4, 5, 6]) {
        expect(translated.columns[index]).toEqual({ kind: 'unknown' });
      }

      // (c) 'full' passes through untouched, in every seat.
      expect(translated.columns[2]).toEqual({ kind: 'full' });

      // Bonus honesty check: with `best: null`/`complete: false`, the
      // position's OWN verdict must not be guessed either.
      expect(translated.position).toBeNull();
      expect(translated.complete).toBe(false);

      // (d) `translateAnalysis`'s own return shape (`TranslatedAnalysis`)
      // deliberately carries NO colour-bearing field -- `Verdict` is
      // `{ kind, distance, sentence }` and `TranslatedColumn` adds nothing
      // colour-shaped either. Colour mapping is seat.ts's sole
      // responsibility (SPEC §1: "nothing below this file may ever see a
      // colour" reversed -- nothing ABOVE the seat/verdict boundary should
      // reintroduce colour into the verdict shape). So "colour differs
      // across firstMover" is asserted the only place it can be: directly
      // against `colourForSide`, for the SAME seat this analysis was just
      // translated under.
      expect(colourForSide(seat, 'first')).toBe(expectedFirstMoverColour);
      expect(colourForSide(seat, 'second')).toBe(expectedSecondMoverColour);
    },
  );

  it('(e) never mutates the input AnalysisResult, across all four seats', () => {
    const snapshot = JSON.parse(JSON.stringify(FIXED_ANALYSIS)) as AnalysisResult;

    for (const { seat } of ANALYSIS_CASES) {
      translateAnalysis(FIXED_ANALYSIS, ENGINE_PLY, seat);
    }

    expect(FIXED_ANALYSIS).toEqual(snapshot);
  });

  it('differs where it must: col 0 and col 1 verdicts split OPPOSITELY across seats', () => {
    const col0Kinds = ANALYSIS_CASES.map(
      (c) => (translateAnalysis(FIXED_ANALYSIS, ENGINE_PLY, c.seat).columns[0] as { kind: 'score'; verdict: { kind: string } }).verdict.kind,
    );
    const col1Kinds = ANALYSIS_CASES.map(
      (c) => (translateAnalysis(FIXED_ANALYSIS, ENGINE_PLY, c.seat).columns[1] as { kind: 'score'; verdict: { kind: string } }).verdict.kind,
    );
    // col 0: A,D win; B,C lose. col 1: A,D lose; B,C win -- the two columns
    // of the SAME fixed analysis, under the SAME four seats, split in
    // opposite groupings. That is only possible if translation genuinely
    // depends on both the column's own score AND the seat, not a fixed
    // per-seat "user always wins" shortcut.
    expect(col0Kinds).toEqual(['win', 'loss', 'loss', 'win']);
    expect(col1Kinds).toEqual(['loss', 'win', 'win', 'loss']);
  });
});
