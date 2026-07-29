// Presentation-only copy helpers for the game log (design §16.2). Mirrors
// `copy.ts`'s own discipline: this module never re-derives a verdict or a
// result -- `game/loggedGame.ts`'s `result` field is already seat-derived
// (SPEC §1), and everything here is wording ON TOP of that.

import { userMovesFirst, type Seat } from '../game/seat.js';
import type { LoggedGameResult } from '../game/loggedGame.js';

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Design §16.2, row line 1: `29 Jul` within the current year, `29 Jul 2025`
 * otherwise. `now` is injectable for tests; production omits it. Falls back
 * to the raw ISO string for an unparseable date rather than throwing or
 * showing "Invalid Date" -- SPEC §6's "never guess" extends to "never crash
 * on a row" too.
 */
export function loggedGameDateLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const day = date.getDate();
  const month = MONTH_ABBR[date.getMonth()];
  return date.getFullYear() === now.getFullYear() ? `${day} ${month}` : `${day} ${month} ${date.getFullYear()}`;
}

/**
 * Design §16.2, row line 1's label clause: a game whose `opponent` field is
 * empty reads `Unlabelled` -- "never a substituted pronoun, never a guessed
 * name" (R9).
 */
export function loggedGameOpponentLabel(opponent: string): string {
  return opponent.trim().length > 0 ? opponent : 'Unlabelled';
}

/**
 * Design §16.2, row line 2: "Seat, as two facts" -- `You were yellow · she
 * moved first`. Two independent clauses, colour a property of the first
 * clause and never the sort key; the second clause states who actually
 * moved first IN WORDS, so there is no arrangement of this line that lets
 * colour imply order (R8).
 */
export function loggedGameSeatLine(seat: Seat): string {
  const firstClause = userMovesFirst(seat) ? 'you moved first' : 'she moved first';
  return `You were ${seat.userColour} · ${firstClause}`;
}

/**
 * Design §17.1's review header: "You were yellow. She moved first." — the
 * SAME two facts as `loggedGameSeatLine` above (R8: colour never implies
 * order), reformatted as two plain sentences for the review header's own
 * punctuation rather than the sheet row's `·`-joined clause. Always
 * translated from the REVIEWED game's own `seat`, which may differ from the
 * app's active session seat (Wave 13 DoD item 4).
 */
export function reviewSeatSentence(seat: Seat): string {
  const firstSentence = userMovesFirst(seat) ? 'You moved first.' : 'She moved first.';
  return `You were ${seat.userColour}. ${firstSentence}`;
}

/**
 * Design §16.2, row line 3: "Result, from the user's seat" -- `You won` /
 * `She won` / `Drawn`, exactly as pinned (never "Red won").
 */
export function loggedGameResultLine(result: LoggedGameResult): string {
  if (result === 'win') return 'You won';
  if (result === 'loss') return 'She won';
  return 'Drawn';
}

/**
 * Design §16.2, row line 3's move-count clause: "deliberately NOT phrased
 * `in N`" -- `· N moves`, a length, never a verdict.
 */
export function loggedGameMoveCountClause(moveCount: number): string {
  return `· ${moveCount} move${moveCount === 1 ? '' : 's'}`;
}

/**
 * Design §16.2, row line 4: `LIVE` or `RECONSTRUCTED · COUNTS HALF` --
 * "both provenance states are labelled" (PIN 3's 1.0 / 0.5 discount stated
 * numerically, never implied by edge treatment alone).
 */
export function loggedGameProvenanceLabel(source: 'live' | 'reconstructed'): string {
  return source === 'live' ? 'LIVE' : 'RECONSTRUCTED · COUNTS HALF';
}
