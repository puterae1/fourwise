// Game state — SPEC.md §3 (modes), §3.3 ("the move list of a Setup-derived
// game starts at the setup point"), §4 (move list with jump-to-ply, every
// position in history re-analysable).
//
// This module owns move history, play/undo/redo, jump-to-ply, and the mode
// field. It does NOT talk to the engine directly (that is `analysisSession.ts`
// plus `engine/client.ts`) and does NOT know colours beyond what `Seat`
// already resolves (`seat.ts` owns that mapping).

import { colourAtPly, type Colour, type Seat, type Side } from './seat.js';
import { BOARD_COLUMNS, BOARD_ROWS, validateSetup, type Grid, type SetupRejection } from './setup.js';

export type Mode = 'play' | 'analyse' | 'setup';

export interface Move {
  /** 0-indexed column, as everywhere else in the game/engine layers. */
  column: number;
  /** True when the engine chose this move from an incomplete analysis
   *  (SPEC §3.1 amendment, "Honesty") -- surfaced in the move list; a
   *  blunder check must never fire across a move flagged this way (see
   *  `blunder.ts`). */
  partial?: boolean;
}

export interface GameState {
  seat: Seat;
  mode: Mode;
  /** The Setup-reconstructed move-sequence prefix (SPEC §3.3), or `''` for
   *  a game that started from an empty board. An "internal encoding, not
   *  history": it is part of `enginePosition` but never appears in `moves`. */
  setupPrefix: string;
  /** Every move played from the setup point onward, in order. Undo/jump do
   *  NOT delete entries here (they only move `currentPly`), so redo can
   *  restore them; playing a genuinely new move from a rewound position
   *  truncates everything after `currentPly` first. */
  moves: Move[];
  /** How many of `moves` are "live" right now (0..moves.length). */
  currentPly: number;
}

export function createGame(seat: Seat, mode: Mode = 'play'): GameState {
  return { seat, mode, setupPrefix: '', moves: [], currentPly: 0 };
}

/** Builds a game from a validated Setup board (SPEC §3.3). Runs all five
 * Setup rejections via `validateSetup`; on success the reconstructed
 * ordering becomes `setupPrefix` and the visible move list starts empty. */
export function startFromSetup(
  seat: Seat,
  grid: Grid,
  mode: Mode = 'play',
): { ok: true; state: GameState } | { ok: false; rejection: SetupRejection } {
  const outcome = validateSetup(grid, seat.firstMover);
  if (!outcome.ok) return { ok: false, rejection: outcome.rejection };
  return { ok: true, state: { seat, mode, setupPrefix: outcome.moves, moves: [], currentPly: 0 } };
}

/** The user-visible move-sequence string up to `currentPly` -- excludes the
 * Setup prefix, matching the move list's own scope. */
export function visibleMoveString(state: GameState): string {
  return state.moves
    .slice(0, state.currentPly)
    .map((m) => String(m.column + 1))
    .join('');
}

/** The full engine-facing position string: what `analyse()`/`legalMoves()`
 * must be called with. Includes the Setup prefix, which the engine has no
 * reason to distinguish from any other move. */
export function enginePosition(state: GameState): string {
  return state.setupPrefix + visibleMoveString(state);
}

/** Absolute ply (from the true start of the game, prefix included) at the
 * CURRENT position -- this, not `currentPly`, is what colour/side mapping
 * must use (SPEC §1: "on ply n, the mover is firstMover when n is even"). */
export function absolutePly(state: GameState): number {
  return state.setupPrefix.length + state.currentPly;
}

export function sideToMove(state: GameState): Side {
  return absolutePly(state) % 2 === 0 ? 'first' : 'second';
}

export function colourToMove(state: GameState): Colour {
  return colourAtPly(state.seat, absolutePly(state));
}

function columnDiscCount(position: string, column: number): number {
  const digit = String(column + 1);
  let count = 0;
  for (const ch of position) if (ch === digit) count++;
  return count;
}

/** Legal (non-full) columns at the current position, 0-indexed ascending. */
export function legalColumns(state: GameState): number[] {
  const position = enginePosition(state);
  const columns: number[] = [];
  for (let c = 0; c < BOARD_COLUMNS; c++) {
    if (columnDiscCount(position, c) < BOARD_ROWS) columns.push(c);
  }
  return columns;
}

export type PlayResult = { ok: true; state: GameState } | { ok: false; error: string };

/**
 * Plays `column` from the current position. If `currentPly` is behind the
 * end of `moves` (the user undid or jumped back), this truncates the
 * abandoned redo tail first -- standard undo/redo semantics: a genuinely
 * new move discards the future it diverges from.
 */
export function playMove(state: GameState, column: number, options: { partial?: boolean } = {}): PlayResult {
  if (column < 0 || column >= BOARD_COLUMNS) {
    return { ok: false, error: `Column ${column + 1} does not exist on a ${BOARD_COLUMNS}-column board.` };
  }
  const position = enginePosition(state);
  if (columnDiscCount(position, column) >= BOARD_ROWS) {
    return { ok: false, error: `Column ${column + 1} is full.` };
  }

  const kept = state.moves.slice(0, state.currentPly);
  const move: Move = options.partial ? { column, partial: true } : { column };
  const moves = [...kept, move];
  return { ok: true, state: { ...state, moves, currentPly: moves.length } };
}

/** Steps one ply back, if possible. A no-op (returns the same state) at the
 * start of the visible move list -- there is nothing before the setup
 * point to undo into. */
export function undo(state: GameState): GameState {
  if (state.currentPly === 0) return state;
  return { ...state, currentPly: state.currentPly - 1 };
}

/** Steps one ply forward into previously-undone history, if any. */
export function redo(state: GameState): GameState {
  if (state.currentPly >= state.moves.length) return state;
  return { ...state, currentPly: state.currentPly + 1 };
}

/** Jumps directly to `ply` (0..moves.length) -- SPEC §4: "every position in
 * history re-analysable". Unlike `playMove`, this never truncates `moves`. */
export function jumpToPly(state: GameState, ply: number): PlayResult {
  if (ply < 0 || ply > state.moves.length) {
    return {
      ok: false,
      error: `Ply ${ply} is out of range for a ${state.moves.length}-move game.`,
    };
  }
  return { ok: true, state: { ...state, currentPly: ply } };
}

/** Switches mode without losing the position (SPEC §3: "switchable at any
 * time without losing the position") -- trivial by construction, since this
 * only ever changes `mode`. */
export function setMode(state: GameState, mode: Mode): GameState {
  return { ...state, mode };
}
