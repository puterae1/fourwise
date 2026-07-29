// The game log — docs/OPPONENT-MODEL.md's `LoggedGame` interface, verbatim,
// plus the pure (no-storage, no-DOM) logic that builds and validates one.
// Mirrors this project's existing pattern exactly: `game/` owns the type,
// the seat-derived result translation, and untrusted-input validation;
// `ui/` owns the actual `localStorage` I/O (`ui/logStorage.ts`) and the
// export-envelope wiring (`game/exportFormat.ts`).
//
// CLAUDE.md invariant #1/#2 hold here unchanged: `result` is derived from
// `seat.userColour` alone (never from turn order), and `moves` are plain
// 0-indexed column numbers — the engine-facing/side-to-move vocabulary never
// appears in this file.

import type { Colour, Seat } from './seat.js';
import { BOARD_COLUMNS } from './setup.js';
import { isSeat, replayIsLegal } from './gameRecordValidation.js';

export type LoggedGameResult = 'win' | 'loss' | 'draw';
export type LoggedGameSource = 'live' | 'reconstructed';

/** docs/OPPONENT-MODEL.md's `LoggedGame` interface, field-for-field. */
export interface LoggedGame {
  id: string;
  /** ISO timestamp. */
  date: string;
  /** Free-text label, e.g. "Anna". Empty string means unlabelled (design
   *  §16.2: "never a substituted pronoun, never a guessed name"). */
  opponent: string;
  seat: Seat;
  /** 0-indexed column indices, in play order, for the WHOLE game (any Setup
   *  prefix already flattened in — a `LoggedGame` is a standalone finished
   *  game, not a live session, so it carries no separate `setupPrefix`). */
  moves: number[];
  result: LoggedGameResult;
  source: LoggedGameSource;
}

/**
 * SPEC §1: result is phrased from the user's seat, derived from
 * `seat.userColour` alone — never from `firstMover`/turn order. `winner ===
 * null` means a draw (an empty board scan found no four-in-a-row and the
 * board is full).
 */
export function resultFromSeat(seat: Seat, winner: Colour | null): LoggedGameResult {
  if (winner === null) return 'draw';
  return winner === seat.userColour ? 'win' : 'loss';
}

/** `crypto.randomUUID` where available (every real browser this project
 * targets); a plain fallback otherwise (older test/runtime environments) —
 * uniqueness only needs to hold within one browser's log, never globally. */
export function generateGameId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `game-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface BuildLoggedGameInput {
  seat: Seat;
  moves: number[];
  /** The winning colour, or `null` for a draw — the caller (UI layer, which
   *  already owns board/win-line derivation, `ui/deriveBoard.ts`) supplies
   *  this; this module never re-derives a winner from a move list itself,
   *  mirroring `game/verdict.ts`'s "translate once" discipline. */
  winner: Colour | null;
  opponent: string;
  source: LoggedGameSource;
  /** Injectable for tests; production omits both and gets a fresh id/date. */
  date?: string;
  id?: string;
}

export function buildLoggedGame(input: BuildLoggedGameInput): LoggedGame {
  return {
    id: input.id ?? generateGameId(),
    date: input.date ?? new Date().toISOString(),
    opponent: input.opponent,
    seat: input.seat,
    moves: input.moves,
    result: resultFromSeat(input.seat, input.winner),
    source: input.source,
  };
}

export function isLoggedGameResult(value: unknown): value is LoggedGameResult {
  return value === 'win' || value === 'loss' || value === 'draw';
}

export function isLoggedGameSource(value: unknown): value is LoggedGameSource {
  return value === 'live' || value === 'reconstructed';
}

/** Structural + range check only (every entry a valid 0-indexed column) --
 * `null` on the first invalid element, mirroring `gameRecordValidation.ts`'s
 * `parseMoveArray`. */
export function parseLoggedGameMoves(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const moves: number[] = [];
  for (const item of value) {
    if (typeof item !== 'number' || !Number.isInteger(item) || item < 0 || item >= BOARD_COLUMNS) return null;
    moves.push(item);
  }
  return moves;
}

/**
 * Validates one candidate `LoggedGame` from untrusted input (an imported
 * file or a corrupted `localStorage` blob) -- returns the parsed record, or
 * a specific message naming what's wrong (SPEC §6's "name the actual
 * problem" standard, same house pattern as `gameRecordValidation.ts`'s
 * `validateExportedGame`). `moves` is replayed with an EMPTY setup prefix
 * (a `LoggedGame` is always a standalone, flattened game) through the same
 * `replayIsLegal` gate the current-game export path uses, so a hostile move
 * list (an overfull column, an impossible ordering) is rejected here too,
 * never merely accepted and left to crash a later replay.
 */
export function validateLoggedGame(value: unknown, label: string): LoggedGame | string {
  if (typeof value !== 'object' || value === null) return `${label} is not a valid record.`;
  const v = value as Record<string, unknown>;

  if (typeof v.id !== 'string' || v.id.length === 0) return `${label} is missing a valid id.`;
  if (typeof v.date !== 'string') return `${label} is missing its date.`;
  if (typeof v.opponent !== 'string') return `${label} is missing an opponent label.`;
  if (!isSeat(v.seat)) return `${label} is missing a valid seat (firstMover/userColour).`;

  const moves = parseLoggedGameMoves(v.moves);
  if (moves === null) return `${label} has an invalid move list.`;

  if (!isLoggedGameResult(v.result)) return `${label} has an invalid result.`;
  if (!isLoggedGameSource(v.source)) return `${label} has an invalid source.`;

  const seat = v.seat as Seat;
  if (!replayIsLegal(seat, '', moves.map((column) => ({ column })))) {
    return `${label}'s moves do not form a legal game -- it cannot be replayed without an illegal drop.`;
  }

  return { id: v.id, date: v.date, opponent: v.opponent, seat, moves, result: v.result, source: v.source };
}

/** Validates a whole `games` array -- `null`/any-element failure returns a
 * specific message, never a crash and never a half-accepted array (the same
 * "no half-import" contract as `exportFormat.ts`'s own array validator). */
export function parseLoggedGameArray(value: unknown): LoggedGame[] | string {
  if (!Array.isArray(value)) return 'The logged games are not a list.';
  const games: LoggedGame[] = [];
  for (let i = 0; i < value.length; i++) {
    const result = validateLoggedGame(value[i], `Logged game ${i + 1}`);
    if (typeof result === 'string') return result;
    games.push(result);
  }
  return games;
}

/** The most recently DATED logged game's opponent label, or `''` for an
 * empty log -- design §16.4 / the delegation brief's "default = the most
 * recent logged game's label, so no new storage key". Ties (identical
 * dates) resolve to array order, which is the only tie-break available from
 * `date` strings alone. */
export function mostRecentOpponentLabel(games: readonly LoggedGame[]): string {
  if (games.length === 0) return '';
  let latest = games[0]!;
  for (const game of games) {
    if (game.date > latest.date) latest = game;
  }
  return latest.opponent;
}
