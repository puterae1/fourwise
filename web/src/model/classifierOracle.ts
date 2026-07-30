// Wave 14a — the CLASSIFIER ORACLE. docs/OPPONENT-MODEL.md, "Pinned
// definitions and rulings" (D1-D7, R1-R7), owner rule 2026-07-30 (STATUS
// standing rule 11): fixtures committed BEFORE any classifier exists, so git
// history proves the oracle predates the implementation.
//
// DATA ONLY. No function here computes a rule's applicability or
// satisfaction, or anything that could grade a move — that is Wave 14b.
// Every `expected` value below was hand-derived from the pins first (see
// each case's `derivation` string), then cross-checked with a private,
// throwaway board-arithmetic script kept OUTSIDE this repository (never
// committed, not part of this delivery) that mechanically replays `moves`
// and reports raw geometric facts (threat cells, line lengths, legal
// columns) — never a rule verdict — so the hand derivations below could be
// checked against real board geometry before being written down.

import type { Seat } from '../game/seat.js';

/** The seven rules, doc §"The model" / pins, in the doc's own table order. */
export type RuleName =
  | 'takes_win'
  | 'blocks_loss'
  | 'blocks_diagonal'
  | 'extends_own'
  | 'centre_bias'
  | 'repeats_column'
  | 'builds_double';

export const RULE_NAMES: readonly RuleName[] = [
  'takes_win',
  'blocks_loss',
  'blocks_diagonal',
  'extends_own',
  'centre_bias',
  'repeats_column',
  'builds_double',
];

/**
 * D2: a rule is first tested for applicability; only an applicable rule
 * records an observation. `satisfied: null` means "not applicable, no
 * observation" — inapplicable rules never carry `true`/`false`.
 */
export interface RuleObservation {
  applicable: boolean;
  /** `null` iff `applicable` is `false`. Never omitted. */
  satisfied: boolean | null;
}

/** All seven rules present explicitly on every fixture case — no omissions. */
export type RuleObservations = Record<RuleName, RuleObservation>;

export interface ClassifierOracleCase {
  /** Unique, stable, kebab-case. */
  id: string;
  title: string;
  /**
   * The full 0-indexed column sequence from the empty board up to AND
   * INCLUDING the move being classified. The LAST entry is the classified
   * move; everything before it is context (D1: only opponent moves are ever
   * classified, but a fixture only needs to assert `expected` for the final
   * move of its own sequence).
   */
  moves: number[];
  /**
   * The LoggedGame seat shape (docs/OPPONENT-MODEL.md's `Seat`), so 14b can
   * consume a case directly. The OPPONENT is whichever colour actually plays
   * the last move in `moves` — CLAUDE.md invariant #1 holds here unchanged:
   * `firstMover` and `userColour` are set independently per case, never
   * derived from one another.
   */
  seat: Seat;
  /** All seven rules, explicitly, every case. */
  expected: RuleObservations;
  /**
   * Hand-derivation from the pins, written BEFORE the booleans above (per
   * the wave's verification discipline). Cites the specific D/R numbers and
   * the decisive board facts (threat cells, directions, line lengths). An
   * ASCII sketch appears only where the geometry genuinely needs it (the
   * adversarial diagonal cases).
   */
  derivation: string;
}

export const classifierOracleCases: ClassifierOracleCase[] = [
  {
    id: 'd3-taken-win-exclusivity',
    title: 'D3: a taken win records takes_win and nothing else',
    moves: [6, 0, 5, 1, 6, 2, 5, 3],
    seat: { firstMover: 'yellow', userColour: 'yellow' },
    expected: {
      takes_win: { applicable: true, satisfied: true },
      blocks_loss: { applicable: false, satisfied: null },
      blocks_diagonal: { applicable: false, satisfied: null },
      extends_own: { applicable: false, satisfied: null },
      centre_bias: { applicable: false, satisfied: null },
      repeats_column: { applicable: false, satisfied: null },
      builds_double: { applicable: false, satisfied: null },
    },
    derivation:
      'R1: before the move red has row-0 cols 0-2 (0-indexed) and column 3 is open, so playing column 3 both wins and completes a length-3 line. ' +
      'R1 applicable+satisfied. D3: because takes_win SUCCEEDED, exclusivity forces every other rule to inapplicable/null regardless of real ' +
      'opportunity beneath it: R2/R3 are also independently gated off by their own definitions (both require takes_win NOT applicable). But R4 ' +
      '(this exact move extends the length-3 line to 4), R5 (column 3 is a centre column), and R6 (her previous move was column 2, still legal, ' +
      'so a naive check would call this a REPEAT-failure) would all be genuinely, non-vacuously applicable if evaluated on their own terms -- D3 ' +
      'is what suppresses them, not their own definitions. That contrast is the point of pairing this case with the missed-win case below.',
  },
  {
    id: 'd3-missed-win-observes-all',
    title: 'D3: a missed win observes every other genuinely applicable rule',
    moves: [0, 5, 1, 6, 2, 5, 4, 6, 4],
    seat: { firstMover: 'red', userColour: 'yellow' },
    expected: {
      takes_win: { applicable: true, satisfied: false },
      blocks_loss: { applicable: false, satisfied: null },
      blocks_diagonal: { applicable: false, satisfied: null },
      extends_own: { applicable: true, satisfied: false },
      centre_bias: { applicable: true, satisfied: true },
      repeats_column: { applicable: true, satisfied: true },
      builds_double: { applicable: false, satisfied: null },
    },
    derivation:
      'Red has row-0 columns 0-2 (0-indexed) with column 3 open -- the same winning cell as the taken-win case -- but this time she plays column ' +
      '4 instead: R1 applicable+FAILED (missed). D3: no exclusivity on a miss, so every genuinely applicable rule gets its own real observation. ' +
      'R2/R3 stay inapplicable regardless, by their OWN definition (gated on takes_win not applicable, true whether the win is taken or missed) ' +
      '-- not by D3. R4: her longest line is length 3 (row 0, cols 0-2); the only legal move extending it to four is column 3, so applicable=true, ' +
      'but she played column 4 (her only other prior disc, a lone single there -- below the floor, not itself a line) which does not touch the ' +
      'length-3 line at all, so satisfied=false. R5: column 4 is centre, satisfied. R6: her previous move was also column 4, repeated, satisfied.',
  },
  {
    id: 'diag-dual-direction-cell',
    title: 'blocks_diagonal adversarial: one cell is both horizontal and diagonal',
    moves: [2, 1, 4, 2, 4, 2, 1, 1, 3, 4, 3, 4, 0, 5, 3],
    seat: { firstMover: 'yellow', userColour: 'red' },
    expected: {
      takes_win: { applicable: false, satisfied: null },
      blocks_loss: { applicable: true, satisfied: true },
      blocks_diagonal: { applicable: true, satisfied: true },
      extends_own: { applicable: false, satisfied: null },
      centre_bias: { applicable: true, satisfied: true },
      repeats_column: { applicable: true, satisfied: false },
      builds_double: { applicable: false, satisfied: null },
    },
    derivation:
      'Board immediately before the block (0-indexed columns; "." = empty, the target cell; row 1 = bottom):\n' +
      '  row4: . . . . R . .\n' +
      '  row3: . R R . R . .\n' +
      '  row2: . Y R Y Y . .\n' +
      '  row1: Y R Y Y Y R .\n' +
      '        0 1 2 3 4 5 6\n' +
      'Column 3 row 3 completes BOTH the row-3 horizontal (cols 1,2,[3],4 = R,R,_,R) AND the /-diagonal through (1,1)-(2,2)-[3,3]-(4,4) (all red). ' +
      'D5: one cell, two directions is explicitly allowed. R2 applicable (takes_win false, this threat cell exists), satisfied (yellow blocks it). ' +
      'R3 applicable (the same cell IS diagonal-carrying), satisfied (same landing cell). Per the pin: "blocking a cell that is both diagonal and ' +
      'horizontal satisfies R2 AND R3" -- separate Bernoullis, both true here. R4: her own (yellow) longest line is the dead length-3 row-1 ' +
      'stretch (cols 2-4); both flanking row-1 cells (col 1, col 5) are already red, so no legal move can extend it -- inapplicable. R5: column 3 ' +
      'is centre, satisfied. R6: her previous move was column 0, not column 3 -- applicable, failed.',
  },
  {
    id: 'diag-block-horizontal-miss-diagonal',
    title: 'blocks_diagonal adversarial: blocks the horizontal, misses the diagonal',
    moves: [2, 5, 4, 5, 4, 6, 6, 6, 3, 0, 5, 1],
    seat: { firstMover: 'red', userColour: 'red' },
    expected: {
      takes_win: { applicable: false, satisfied: null },
      blocks_loss: { applicable: true, satisfied: true },
      blocks_diagonal: { applicable: true, satisfied: false },
      extends_own: { applicable: true, satisfied: false },
      centre_bias: { applicable: true, satisfied: false },
      repeats_column: { applicable: true, satisfied: false },
      builds_double: { applicable: false, satisfied: null },
    },
    derivation:
      'Before the move red has TWO separate user threat cells: column 1 row 0 (horizontal only -- row 0 reads R,_,R,R,R across cols 0-4 with ' +
      'column 1 the gap) and column 6 row 3 (diagonal only, the /-line through (3,0)-(4,1)-(5,2)-[6,3]). Yellow plays column 1, blocking the ' +
      'horizontal cell and leaving the diagonal one standing. R2 applicable (>=1 user threat cell, takes_win inapplicable), satisfied (column 1 ' +
      'IS a threat cell). R3 applicable (the column-6 cell is diagonal-carrying), satisfied=FALSE (the blocked cell carries only "horizontal" in ' +
      'its dirs, not diagonal) -- exactly the pinned "sees-horizontals-misses-diagonals" asymmetry: R2 success, R3 failure. R4: yellows longest ' +
      'line is length 2 (col 6 row 0 - col 5 row 1, a \\-diagonal); column 4 legally extends it to 3, but she played column 1 instead -- ' +
      'applicable, failed. R5: column 1 is not centre -- applicable, failed. R6: her previous move was column 0, not column 1 -- applicable, ' +
      'failed.',
  },
  {
    id: 'diag-only-play-elsewhere',
    title: 'blocks_diagonal adversarial: only a diagonal pends, she plays elsewhere',
    moves: [1, 3, 2, 3, 2, 4, 4, 4, 3, 6],
    seat: { firstMover: 'yellow', userColour: 'yellow' },
    expected: {
      takes_win: { applicable: false, satisfied: null },
      blocks_loss: { applicable: true, satisfied: false },
      blocks_diagonal: { applicable: true, satisfied: false },
      extends_own: { applicable: true, satisfied: false },
      centre_bias: { applicable: true, satisfied: false },
      repeats_column: { applicable: true, satisfied: false },
      builds_double: { applicable: false, satisfied: null },
    },
    derivation:
      'Before the move the ONLY user (yellow) threat cell is column 4 row 3, a /-diagonal through (1,0)-(2,1)-(3,2)-[4,3] (all yellow, column 4 ' +
      'the gap) -- no horizontal or other threat exists anywhere. Red plays column 6, unrelated to it entirely. Per the pin ("only diagonal ' +
      'threats pending and she plays elsewhere = R2 failure and R3 failure"): R2 applicable (the threat cell exists), satisfied=false (column 6 ' +
      'is not it). R3 applicable (that same cell is diagonal), satisfied=false. R4: reds longest line is length 2 (col 3 row 0 - col 4 row 0, ' +
      'horizontal); column 5 legally extends it to 3, but she played column 6 -- applicable, failed. R5: column 6 is not centre -- applicable, ' +
      'failed. R6: her previous move was column 4, not column 6 -- applicable, failed.',
  },
  {
    id: 'diag-NE-blocked',
    title: 'blocks_diagonal: a clean up-right (/) diagonal threat, blocked',
    moves: [1, 3, 2, 3, 2, 4, 4, 4, 3, 4],
    seat: { firstMover: 'yellow', userColour: 'yellow' },
    expected: {
      takes_win: { applicable: false, satisfied: null },
      blocks_loss: { applicable: true, satisfied: true },
      blocks_diagonal: { applicable: true, satisfied: true },
      extends_own: { applicable: true, satisfied: false },
      centre_bias: { applicable: true, satisfied: true },
      repeats_column: { applicable: true, satisfied: true },
      builds_double: { applicable: false, satisfied: null },
    },
    derivation:
      'Identical position to the "play elsewhere" case above (same first 9 moves; only the 10th move differs), so the same single user threat ' +
      'cell (column 4 row 3, the /-diagonal through (1,0)-(2,1)-(3,2)-[4,3]) is pending. This time red plays column 4 itself, landing exactly on ' +
      'it. R2 applicable+satisfied (lands on the threat cell). R3 applicable+satisfied (that cell is diagonal-carrying). R4: same length-2 ' +
      'horizontal line as before; column 4 does not extend it (it connects to nothing at that row) -- applicable, failed. R5: column 4 is centre, ' +
      'satisfied. R6: her previous move (2 plies back) was also column 4 -- applicable, satisfied.',
  },
  {
    id: 'diag-NW-blocked',
    title: 'blocks_diagonal: a clean up-left (\\) diagonal threat, blocked',
    moves: [4, 1, 3, 2, 3, 2, 1, 1, 2, 1],
    seat: { firstMover: 'red', userColour: 'red' },
    expected: {
      takes_win: { applicable: false, satisfied: null },
      blocks_loss: { applicable: true, satisfied: true },
      blocks_diagonal: { applicable: true, satisfied: true },
      extends_own: { applicable: true, satisfied: false },
      centre_bias: { applicable: true, satisfied: false },
      repeats_column: { applicable: true, satisfied: true },
      builds_double: { applicable: false, satisfied: null },
    },
    derivation:
      'This time the pending threat runs the OTHER diagonal direction: column 1 row 3 completes a \\-line through (4,0)-(3,1)-(2,2)-[1,3] (all ' +
      'red, column 1 the gap) -- no horizontal or other user threat exists. Yellow plays column 1, landing exactly on it. R2 applicable+satisfied. ' +
      'R3 applicable+satisfied (diagonal-carrying). R4: yellows longest line is length 2 (col 1 row 0 - col 2 row 0, horizontal, extendable via ' +
      'column 0 or the /-diagonal via column 3); column 1 touches neither -- applicable, failed. R5: column 1 is not centre -- applicable, ' +
      'failed. R6: her previous move (2 plies back) was also column 1 -- applicable, satisfied.',
  },
  {
    id: 'horizontal-only-no-diagonal',
    title: 'blocks_loss satisfied where blocks_diagonal is genuinely inapplicable',
    moves: [1, 5, 2, 6, 3, 4],
    seat: { firstMover: 'red', userColour: 'red' },
    expected: {
      takes_win: { applicable: false, satisfied: null },
      blocks_loss: { applicable: true, satisfied: true },
      blocks_diagonal: { applicable: false, satisfied: null },
      extends_own: { applicable: true, satisfied: true },
      centre_bias: { applicable: true, satisfied: true },
      repeats_column: { applicable: true, satisfied: false },
      builds_double: { applicable: false, satisfied: null },
    },
    derivation:
      'Red has row-0 columns 1-3 with BOTH column 0 and column 4 open (a two-ended open three) -- two threat cells, both horizontal, no red disc ' +
      'anywhere off row 0 so no diagonal exists at all. Yellow blocks column 4. R2 applicable (>=1 threat cell), satisfied (lands on one of ' +
      'them). R3: R3 requires >=1 of the threat cells to carry a diagonal completion -- neither does, so R3 is genuinely inapplicable (not merely ' +
      'gated by takes_win, which is separately also false) -- the dedicated "R3 inapplicable while R2 fires" case. R4: yellows longest line is ' +
      'length 2 (col 5 - col 6, row 0); column 4 legally extends it to 3 on the open left side, and that IS the move played -- ' +
      'applicable+satisfied (it blocks red AND extends her own line in one disc). R5: column 4 is centre, satisfied. R6: her previous move was ' +
      'column 6, not column 4 -- applicable, failed.',
  },
  {
    id: 'first-move-of-game',
    title: 'R6 inapplicable: her very first move in the game',
    moves: [3, 2],
    seat: { firstMover: 'red', userColour: 'red' },
    expected: {
      takes_win: { applicable: false, satisfied: null },
      blocks_loss: { applicable: false, satisfied: null },
      blocks_diagonal: { applicable: false, satisfied: null },
      extends_own: { applicable: false, satisfied: null },
      centre_bias: { applicable: true, satisfied: true },
      repeats_column: { applicable: false, satisfied: null },
      builds_double: { applicable: false, satisfied: null },
    },
    derivation:
      'Red opens with column 3 (the whole board otherwise empty); yellow, the opponent being classified, now plays column 2 -- her first move ' +
      'ever in this game. R6: "her first move: inapplicable" per the pin, verbatim -- there is no previous move to compare against. R1/R2/R3: no ' +
      'discs of either colour reach three-in-a-row from a single opening move, all inapplicable. R4: yellow has zero discs before this move, so ' +
      'no line (not even a below-floor single) exists yet to extend -- inapplicable. R5: column 2 is centre and legal -- applicable, satisfied. ' +
      'R7: with only one disc on the board after the move, no distinct-column double is possible -- inapplicable.',
  },
  {
    id: 'extends-own-single-disc-floor',
    title: 'R4 inapplicable: her only existing disc is a single, below the floor',
    moves: [3, 0, 4, 6],
    seat: { firstMover: 'red', userColour: 'red' },
    expected: {
      takes_win: { applicable: false, satisfied: null },
      blocks_loss: { applicable: false, satisfied: null },
      blocks_diagonal: { applicable: false, satisfied: null },
      extends_own: { applicable: false, satisfied: null },
      centre_bias: { applicable: true, satisfied: false },
      repeats_column: { applicable: true, satisfied: false },
      builds_double: { applicable: false, satisfied: null },
    },
    derivation:
      'Before the move yellow (the opponent) has exactly one disc on the whole board (column 0, from her first move) -- an isolated single, not ' +
      'adjacent to anything of her own colour in any direction. R4: "counting only lines of length >= 2" -- a single disc is not a line at all, ' +
      'so no length-L line exists for her to extend -- inapplicable per the floor, independent of any move being available. R1/R2/R3: red has ' +
      'only a length-2 line (cols 3-4, row 0) -- no three-in-a-row for either side -- all inapplicable. R5: column 6 is not centre -- applicable, ' +
      'failed. R6: her previous move was column 0, not column 6 -- applicable, failed.',
  },
  {
    id: 'centre-columns-full',
    title: 'R5 inapplicable: columns 3-5 (displayed) are completely full',
    moves: [
      2, 3, 4, 2, 3, 4, 2, 3, 4, 2, 3, 4, 2, 3, 4, 2, 3, 4, 0,
    ],
    seat: { firstMover: 'red', userColour: 'yellow' },
    expected: {
      takes_win: { applicable: false, satisfied: null },
      blocks_loss: { applicable: true, satisfied: false },
      blocks_diagonal: { applicable: true, satisfied: false },
      extends_own: { applicable: false, satisfied: null },
      centre_bias: { applicable: false, satisfied: null },
      repeats_column: { applicable: false, satisfied: null },
      builds_double: { applicable: false, satisfied: null },
    },
    derivation:
      'The first 18 moves fill internal columns 2, 3, and 4 to the top (6 rows each) with alternating colours; the 19th move (red) plays column ' +
      '0. R5: centre = internal {2,3,4} (D4) and all three are completely full -- no centre column is legal at all, so R5 is inapplicable no ' +
      'matter which column is actually played. Incidentally the dense fill creates two real yellow (user) diagonal threat cells at columns 1 ' +
      'and 5 (row 0), both playable -- R2 applicable, satisfied=false (red plays column 0, neither cell); R3 applicable (both threats ARE ' +
      'diagonal), satisfied=false. R4: reds longest line is length 3 (several dead diagonals inside the 2-3-4 block) but every extension cell ' +
      'sits above row 0 in a column whose landing spot IS row 0 -- unextendable -- inapplicable. R6: her previous move (column 3) is now a FULL ' +
      'column -- inapplicable per "that column is legal" failing, a second, distinct reason for R6 to be inapplicable beyond the first-move case ' +
      'above.',
  },
  {
    id: 'genuine-two-column-double',
    title: 'builds_double satisfied: an open three threatens two distinct columns',
    moves: [1, 5, 2, 6, 3],
    seat: { firstMover: 'red', userColour: 'yellow' },
    expected: {
      takes_win: { applicable: false, satisfied: null },
      blocks_loss: { applicable: false, satisfied: null },
      blocks_diagonal: { applicable: false, satisfied: null },
      extends_own: { applicable: true, satisfied: true },
      centre_bias: { applicable: true, satisfied: true },
      repeats_column: { applicable: true, satisfied: false },
      builds_double: { applicable: true, satisfied: true },
    },
    derivation:
      'Red has columns 1-2 at row 0 (length-2 line, both ends -- column 0 and column 3 -- open) and plays column 3: row 0 becomes _,R,R,R,_ ' +
      'across cols 0-4, an open three with two distinct winning columns (0 and 4, since column 3 is not next to the board edge) after the move. ' +
      'R7 applicable (this move creates it) and satisfied (it is the move played) -- a genuine two-column double, not a same-column stack. R4: ' +
      'this is also the move that extends her own length-2 line to 3 -- applicable+satisfied (the same disc serves ' +
      'both rules, separate Bernoullis). R5: column 3 is centre, satisfied. R6: her previous move was column 2, not column 3 -- applicable, ' +
      'failed. R1/R2/R3: no red or yellow three-in-a-row exists before this move -- all inapplicable.',
  },
  {
    id: 'double-available-not-taken',
    title: 'builds_double applicable+failed: the open-three move existed, she played the edge instead',
    moves: [1, 5, 2, 6, 0],
    seat: { firstMover: 'red', userColour: 'yellow' },
    expected: {
      takes_win: { applicable: false, satisfied: null },
      blocks_loss: { applicable: false, satisfied: null },
      blocks_diagonal: { applicable: false, satisfied: null },
      extends_own: { applicable: true, satisfied: true },
      centre_bias: { applicable: true, satisfied: false },
      repeats_column: { applicable: true, satisfied: false },
      builds_double: { applicable: true, satisfied: false },
    },
    derivation:
      'Identical position to the genuine-double case (same first 4 moves), so column 3 is STILL available as a double-creating move -- R7 ' +
      'applicable=true regardless of what she actually plays. She plays column 0 instead: row 0 becomes R,R,R,_,_ across cols 0-2 (column 0 new) ' +
      '-- only ONE open end (column 3; the other side, column -1, does not exist), a single threat, not a double. R7 satisfied=false. R4: column ' +
      '0 also extends her length-2 line to 3 (the other side of the same line) -- applicable+satisfied. R5: column 0 is not centre -- ' +
      'applicable, failed. R6: her previous move was column 2, not column 0 -- applicable, failed.',
  },
  {
    id: 'stacked-same-column-not-double',
    title: 'builds_double inapplicable: the only apparent second threat stacks in the SAME column',
    moves: [4, 2, 3, 2, 3, 4, 0, 5, 1, 3, 6, 2],
    seat: { firstMover: 'yellow', userColour: 'yellow' },
    expected: {
      takes_win: { applicable: false, satisfied: null },
      blocks_loss: { applicable: false, satisfied: null },
      blocks_diagonal: { applicable: false, satisfied: null },
      extends_own: { applicable: false, satisfied: null },
      centre_bias: { applicable: true, satisfied: true },
      repeats_column: { applicable: true, satisfied: false },
      builds_double: { applicable: false, satisfied: null },
    },
    derivation:
      'Red already has a length-3 \\-diagonal (col 5 row 0 - col 4 row 1 - col 3 row 2) whose completing cell, column 2 row 3, is not yet ' +
      'playable (column 2 only has 2 discs, landing at row 2). Red plays column 2 (row 2): this both builds a vertical three in column 2 (rows ' +
      '0-2) AND, as a side effect, makes column 2 row 3 the new landing spot -- which now ALSO completes the pre-existing diagonal. So after the ' +
      'move there is exactly ONE playable winning cell, column 2 row 3, carrying two directions (vertical AND diagonal) at once. Per the pin ' +
      '("stacked same-column threats are never simultaneous and do not count") this is ONE column, not two -- R7 inapplicable, not satisfied, ' +
      'even though a naive count-the-directions check might see "2". No other legal column creates a genuine second, distinct-column threat ' +
      'either. R4: reds own length-3 diagonal cannot be extended by any legal move (its only open end, column 2 row 3, is not playable) -- ' +
      'inapplicable. R5: column 2 is centre, satisfied. R6: her previous move was column 3, not column 2 -- applicable, failed.',
  },
  {
    id: 'r4-bridge-two-sub-L-runs',
    title: 'R4 addendum: a bridging move satisfies extends_own even with a direct extension also on offer',
    moves: [0, 0, 1, 1, 4, 4, 6, 6, 5],
    seat: { firstMover: 'red', userColour: 'yellow' },
    expected: {
      takes_win: { applicable: false, satisfied: null },
      blocks_loss: { applicable: false, satisfied: null },
      blocks_diagonal: { applicable: false, satisfied: null },
      extends_own: { applicable: true, satisfied: true },
      centre_bias: { applicable: true, satisfied: false },
      repeats_column: { applicable: true, satisfied: false },
      builds_double: { applicable: true, satisfied: false },
    },
    derivation:
      'Board immediately before the classified move (0-indexed columns; row 0 = bottom):\n' +
      '  row1: Y . . . Y . Y\n' +
      '  row0: R R . . R . R\n' +
      '        0 1 2 3 4 5 6\n' +
      'Red (the opponent) has row-0 columns 0-1 (a length-2 line, L=2 -- the pin R4 floor) plus two ISOLATED red singles at column 4 and column 6, ' +
      'each below the floor on its own, with column 5 the empty gap between them. R1: no legal drop completes four for red anywhere (the richest ' +
      'row-0 run reachable is 3, at column 2 or column 3) -- inapplicable, so R2/R3 are also inapplicable by their own gate; independently, no ' +
      'yellow cell anywhere reaches a completed four either (checked every landing cell by hand: max total run through any axis is 2), so there is ' +
      'no pending loss against her to complicate the picture -- the position is deliberately clean of R1/R2/R3, per the instruction to keep the ' +
      'fixture sharp. R4 -- the decisive geometry: L=2 (row-0 cols 0-1). Column 2 is a DIRECT extension of that exact line (its landing cell has ' +
      'the length-2 run 0-1 immediately on one side, extending it to a 3-run 0-1-2) -- this is the "direct extension also available" column the ' +
      'ruling requires be present so the poisoning scenario is real, not hypothetical. Column 5 -- the move actually played -- is the BRIDGE: its ' +
      'landing cell has the column-4 red single (run length 1, strictly < L) on its left and the column-6 red single (run length 1, strictly < L) ' +
      'on its right; 1+1 = 2 = L, so the combined connected run after playing it is columns 4-5-6, length 3 = L+1. Per the R4 addendum ' +
      '(owner-ruled 2026-07-30): "making it longer" means the resulting run is >= L+1, not that either side alone must already carry the ' +
      'length-L line -- so this bridge is BOTH applicable (a legal move joins two sub-L runs into an L+1 run) AND satisfying when played. A ' +
      'per-side-only reading of R4 (checking only whether one flank alone reaches length L, rather than the summed flanks) would still call R4 ' +
      'applicable here (column 2 still qualifies on its own), but would flip column 5 to satisfied=false purely because neither of ITS flanks ' +
      'individually reaches 2 -- exactly the false-negative "failure logged for a move that extended her longest line" the addendum names as the ' +
      'decisive reason bridge-exclusion is wrong; that is the mutation this fixture is built to catch. R5: column 5 is not a centre column ' +
      '(internal {2,3,4}, D4) -- applicable (columns 2-4 are legal), failed. R6: her previous move (2 plies back) was column 6, not column 5 -- ' +
      'applicable, failed. R7: playing column 5 leaves exactly one distinct winning column standing afterward (column 3, completing cols 3-4-5-6) ' +
      '-- not a double, so builds_double is not satisfied by the move played; it IS genuinely applicable, though, since a different legal move ' +
      '(column 3 itself) would have left TWO distinct winning columns open (column 2 and column 5, each completing a separate four) -- applicable, ' +
      'failed for the move actually played.',
  },
];

// ---------------------------------------------------------------------------
// PIN 2 / D6 — weighted-threshold boundary arithmetic (data, not logic).
// D6: live observations weight 1.0, reconstructed weight 0.5; the
// exploitation line fires at weighted count >= 6 (raw counts are what's
// DISPLAYED, never the weighted number or the posterior mean).
// ---------------------------------------------------------------------------
export interface WeightingBoundaryCase {
  label: string;
  liveObs: number;
  reconObs: number;
  weightedCount: number;
  firesAtThreshold: boolean;
}

export const weightingBoundaryCases: WeightingBoundaryCase[] = [
  { label: '6 live fires', liveObs: 6, reconObs: 0, weightedCount: 6.0, firesAtThreshold: true },
  { label: '9 reconstructed does not fire', liveObs: 0, reconObs: 9, weightedCount: 4.5, firesAtThreshold: false },
  { label: '12 reconstructed fires', liveObs: 0, reconObs: 12, weightedCount: 6.0, firesAtThreshold: true },
  { label: '5 live + 2 reconstructed fires', liveObs: 5, reconObs: 2, weightedCount: 6.0, firesAtThreshold: true },
  {
    label: '5 live + 1 reconstructed does not fire',
    liveObs: 5,
    reconObs: 1,
    weightedCount: 5.5,
    firesAtThreshold: false,
  },
];

// ---------------------------------------------------------------------------
// D7 — priors as pseudo-counts: alpha0 = 2p, beta0 = 2(1-p), prior strength 2.
// Two rows reproduced from the doc's own prior table.
// ---------------------------------------------------------------------------
export interface PriorPseudocountCase {
  rule: RuleName;
  priorP: number;
  alpha0: number;
  beta0: number;
}

export const priorPseudocountCases: PriorPseudocountCase[] = [
  { rule: 'takes_win', priorP: 0.97, alpha0: 1.94, beta0: 0.06 },
  { rule: 'blocks_diagonal', priorP: 0.65, alpha0: 1.3, beta0: 0.7 },
];
