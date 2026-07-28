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

/**
 * The finished-game outcome, from the user's seat (SPEC §1) — SPEC §3.2's
 * terminal-display amendment: "when the position is terminal, the
 * per-column analysis reports the game's outcome ('game over — you won' /
 * '—drawn'), never 'still solving'". `Rail.tsx`/`AnalysePanel.tsx` consume
 * this instead of their normal per-column `TranslatedColumn` rendering once
 * the board is terminal — one seat-translated fact, not seven stale
 * "still solving" rows under a headline that already says the game is over.
 *
 * `kind` reuses `VerdictKind` ('win'/'draw'/'loss') so the two consuming
 * components can keep their EXISTING win/draw/loss bar styling (solid /
 * hatched / outline) with zero new CSS — a resolved outcome and an
 * in-progress win/draw/loss verdict are visually the same FAMILY of fact,
 * just phrased in the past tense here.
 */
export interface TerminalOutcome {
  kind: VerdictKind;
  sentence: string;
}

/**
 * @param seat           The viewer's seat (SPEC §1: translation happens
 *                        exactly once, here, from the raw winner colour).
 * @param winner          The winning colour, or `null` for a draw.
 * @param winnerControl   How the winning side was controlled — distinguishes
 *                        "the engine won" from "she won", mirroring
 *                        `gameOverHeadline`'s own branching exactly.
 */
export function terminalOutcome(seat: Seat, winner: Colour | null, winnerControl: SideControl | 'human'): TerminalOutcome {
  if (winner === null) {
    return { kind: 'draw', sentence: 'Game over — drawn.' };
  }
  const userWon = winner === seat.userColour;
  if (userWon) {
    return { kind: 'win', sentence: 'Game over — you won.' };
  }
  return {
    kind: 'loss',
    sentence: winnerControl === 'engine' ? 'Game over — the engine won.' : 'Game over — she won.',
  };
}
