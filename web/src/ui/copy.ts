// Presentation-only copy helpers — docs/DESIGN-DIRECTION.md §11, SPEC §3.2.
//
// IMPORTANT: this module never re-derives a verdict. Every `Verdict` it
// touches was already produced by `game/verdict.ts`, the ONE place engine
// scores become user-seat-relative sentences (SPEC §1). What lives here is
// strictly wording ON TOP of that — capitalisation, a trailing clause, or a
// context line that game/ has no reason to know about (whose turn it is,
// whether a side is engine-controlled) — never a win/loss/draw judgement.

import type { Colour, Seat } from '../game/seat.js';
import type { Verdict, VerdictKind } from '../game/verdict.js';
import type { SideControl } from './types.js';

export function capitalize(sentence: string): string {
  if (sentence.length === 0) return sentence;
  return sentence[0]!.toUpperCase() + sentence.slice(1);
}

/**
 * The context line above the headline sentence in Play/Analyse (design
 * §8.1/§8.2, copy §11): "Your turn." / "Thinking…" / "Her turn.". Purely a
 * function of whose turn it is and how that side is controlled — no verdict
 * involved.
 */
export function turnContextLine(
  seat: Seat,
  colourToMove: Colour,
  controlOfMover: SideControl | 'human',
): string {
  if (colourToMove === seat.userColour) return 'Your turn.';
  return controlOfMover === 'engine' ? 'Thinking…' : 'Her turn.';
}

/** Game-over headline (copy §11): "You win." / "She wins." / "Drawn." */
export function gameOverHeadline(
  seat: Seat,
  winner: Colour | null,
  winnerControl: SideControl | 'human',
): string {
  if (winner === null) return 'Drawn.';
  if (winner === seat.userColour) return 'You win.';
  return winnerControl === 'engine' ? 'The engine wins.' : 'She wins.';
}

/**
 * The Play/Analyse "position summary" sentence (design §8.1: "You win in 11
 * if you play well.", §8.2: same sentence pre-reveal, naming no column).
 * `verdict` is `null` while the position is still being solved — SPEC §6
 * forbids guessing, so that case gets its own honest sentence.
 */
export function positionSummary(verdict: Verdict | null): string {
  if (verdict === null) return 'Still solving this position.';
  if (verdict.kind === 'draw') return 'Drawn with best play.';
  return `${capitalize(verdict.sentence)} if you play well.`;
}

/**
 * Analyse mode, a column named explicitly — either because it was tapped
 * (design §8.2: "Tapping a column cell selects it and rewrites the headline
 * sentence") or because `Show me` revealed the best one ("Column 4." / "You
 * win in 11.").
 */
export function namedColumnSentence(column: number, verdict: Verdict): string {
  return `Column ${column + 1}. ${capitalize(verdict.sentence)}.`;
}

export function namedColumnFull(column: number): string {
  return `Column ${column + 1}. Column is full.`;
}

export function namedColumnUnknown(column: number): string {
  return `Column ${column + 1}. Still solving this column.`;
}

/**
 * The Play-mode blunder line (design §8.1, copy §11: "That threw away a
 * win. Column 4 held it."). `beforeKind` is the verdict just before the
 * move — the ONLY thing that changes the wording is whether a win or a draw
 * was given up; a draw thrown away reads oddly as "threw away a win", so
 * draw -> loss gets its own clause. `beforeKind` is never `'loss'` in
 * practice (SPEC §3.2 amended Firing rule: the flag only fires when the
 * verdict strictly degrades, and a loss cannot degrade further) — if it ever
 * were, this falls back to the win clause rather than fabricating a third
 * sentence for a case that cannot occur.
 */
export function blunderSentence(beforeKind: VerdictKind, bestColumn: number): string {
  const clause = beforeKind === 'draw' ? 'That threw away the draw.' : 'That threw away a win.';
  return `${clause} Column ${bestColumn + 1} held it.`;
}
