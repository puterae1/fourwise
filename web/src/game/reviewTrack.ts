// The review ply track's evaluation marks — docs/DESIGN-DIRECTION.md §17.2.
// Pure logic only: no rendering, no engine calls, no React. This module
// makes no independent judgement about what counts as a blunder — it reuses
// `game/blunder.ts`'s `compareForBlunder` VERBATIM (STATUS.md Wave 5a/9:
// "blunder flags fire on VERDICT-ONLY semantics ... reuse both, do not fork
// the logic") and only decides, from what is KNOWN about two adjacent plies,
// which of the three track marks applies.

import { compareForBlunder } from './blunder.js';
import type { VerdictKind } from './verdict.js';

export type PlyMark =
  | { kind: 'unevaluated' }
  | { kind: 'clean' }
  | { kind: 'blunder'; bestColumnBefore: number; beforeKind: VerdictKind };

/**
 * What is known about one ply's own analysis, reduced to exactly what a mark
 * needs. `evaluated` mirrors `TranslatedAnalysis.complete` — SPEC §3.1's
 * partial-honesty rule, and `blunder.ts`'s own firing rule: an incomplete
 * analysis can never feed a blunder verdict, so a ply whose analysis hasn't
 * settled this session contributes nothing to either neighbouring mark.
 */
export interface PlyKnowledge {
  evaluated: boolean;
  kind: VerdictKind | null;
  best: number | null;
}

/**
 * The mark for the tick representing the move from `before` (the position
 * just before it was played) to `after` (just after). SPEC §3.1: "the wedge
 * never appears from a partial comparison" — an unevaluated ply on EITHER
 * side of the pair is an open ring, never an optimistic dot (a dot is
 * itself a claim — "evaluated, clean" — that an unanalysed ply has no
 * business making).
 */
export function plyMark(before: PlyKnowledge | undefined, after: PlyKnowledge | undefined): PlyMark {
  if (!before?.evaluated || !after?.evaluated || before.kind === null || after.kind === null) {
    return { kind: 'unevaluated' };
  }
  const check = compareForBlunder({ evaluated: true, kind: before.kind }, { evaluated: true, kind: after.kind });
  if (check.status === 'blunder' && before.best !== null) {
    return { kind: 'blunder', bestColumnBefore: before.best, beforeKind: before.kind };
  }
  return { kind: 'clean' };
}

export interface PlyTrack {
  /** One entry per move, in play order — `marks[i]` is the mark for the
   *  transition from ply `i` to ply `i + 1` (i.e. the move at `moves[i]`). */
  marks: PlyMark[];
  notEvaluatedCount: number;
}

/**
 * Builds the whole track for a game of `totalMoves` moves. `knowledgeAt(ply)`
 * supplies whatever is known about position `ply` (0..totalMoves) —
 * `undefined` for a ply that has never been analysed this session (design
 * §17: "evaluation on demand as the user steps", never a bulk pre-solve).
 */
export function buildPlyTrack(
  totalMoves: number,
  knowledgeAt: (ply: number) => PlyKnowledge | undefined,
): PlyTrack {
  const marks: PlyMark[] = [];
  for (let i = 0; i < totalMoves; i++) {
    marks.push(plyMark(knowledgeAt(i), knowledgeAt(i + 1)));
  }
  return { marks, notEvaluatedCount: marks.filter((m) => m.kind === 'unevaluated').length };
}

/**
 * Design §17.2: "the running count ... which disappears when it reaches
 * zero." `null` (never rendered) rather than a `0` string — CLAUDE.md "no
 * placeholder data": a count of zero unevaluated plies has nothing left to
 * report, so the honest move is to say nothing, not to print "0 plies".
 */
export function notEvaluatedLine(count: number): string | null {
  if (count === 0) return null;
  if (count === 1) return '1 ply not evaluated yet.';
  return `${count} plies not evaluated yet.`;
}
