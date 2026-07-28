// Pure (de)serialisation for `GameState` -- SPEC §5, "current game survives
// a refresh". This module never touches `localStorage` itself (`game/`
// never touches storage, mirroring `seatStorage.ts`'s own note) -- the
// actual read/write lives in `web/src/ui/gameStorage.ts`, which calls
// straight into `serialiseGameState`/`deserialiseGameState` below.
//
// `deserialiseGameState` is the untrusted-input boundary: it accepts
// anything (`JSON.parse` of a hand-edited or corrupted blob) and returns
// `null` on the first sign of trouble, never throwing and never returning a
// partially-built `GameState`. The one legality gate (`replayIsLegal`,
// `gameRecordValidation.ts`) guarantees a `null` result whenever replaying
// the stored moves would ever hit an illegal drop, so a downstream
// `deriveBoard.ts` replay of whatever this returns can never throw.

import type { GameState, Mode, Move } from './gameState.js';
import type { Seat } from './seat.js';
import { isMode, isSeat, isSetupPrefixShape, parseMoveArray, replayIsLegal } from './gameRecordValidation.js';

/** The on-disk shape -- identical to `GameState`'s own fields today, but
 * kept as its own named type (rather than re-exporting `GameState`
 * directly) so a future storage-format change doesn't have to be the same
 * shape as the live in-memory type. */
export interface PersistedGameState {
  seat: Seat;
  mode: Mode;
  setupPrefix: string;
  moves: Move[];
  currentPly: number;
}

export function serialiseGameState(state: GameState): PersistedGameState {
  return {
    seat: state.seat,
    mode: state.mode,
    setupPrefix: state.setupPrefix,
    moves: state.moves.map((m) => (m.partial ? { column: m.column, partial: true } : { column: m.column })),
    currentPly: state.currentPly,
  };
}

/**
 * Validates and rebuilds a `GameState` from an arbitrary value (already
 * `JSON.parse`d). Every check below is structural or a real legality
 * replay -- there is no "best effort" partial acceptance: any single
 * problem anywhere in the record returns `null`, and the caller's contract
 * (SPEC §5) is "corrupt/invalid stored game -> fresh game, never a crash".
 */
export function deserialiseGameState(value: unknown): GameState | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;

  if (!isSeat(v.seat)) return null;
  if (!isMode(v.mode)) return null;
  if (!isSetupPrefixShape(v.setupPrefix)) return null;

  const moves = parseMoveArray(v.moves);
  if (moves === null) return null;

  if (
    typeof v.currentPly !== 'number' ||
    !Number.isInteger(v.currentPly) ||
    v.currentPly < 0 ||
    v.currentPly > moves.length
  ) {
    return null;
  }

  const seat = v.seat as Seat;
  const setupPrefix = v.setupPrefix as string;
  if (!replayIsLegal(seat, setupPrefix, moves)) return null;

  return { seat, mode: v.mode as Mode, setupPrefix, moves, currentPly: v.currentPly };
}

/**
 * Seat persistence already exists independently (`fourwise:seat`,
 * `ui/seatStorage.ts`) -- this module does not duplicate it. A game
 * restored from storage carries its OWN `seat` field (needed so
 * `deserialiseGameState` can validate/replay it), but the seat actually in
 * force at runtime must come from the single `fourwise:seat` preference, not
 * from whatever happened to be embedded in the game blob. This is the one
 * place those two independently-stored things are reconciled.
 */
export function reconcileGameSeat(state: GameState, seat: Seat): GameState {
  return { ...state, seat };
}
