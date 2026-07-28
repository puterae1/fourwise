// Current-game persistence -- SPEC.md §5, "current game survives a
// refresh". Mirrors `seatStorage.ts`'s own shape exactly (this is a
// UI-layer concern; `game/` never touches storage): read/write
// `localStorage`, delegate all (de)serialisation and validation to
// `game/gameStateStorage.ts`, and treat anything unreadable or invalid as
// "no game to restore" rather than an error to surface -- SPEC §5's
// "corrupt/invalid stored game -> fresh game, never a crash" holds here by
// construction, since `deserialiseGameState` already returns `null` for
// every malformed shape and this function's own `try/catch` covers
// `JSON.parse` throwing on non-JSON garbage besides.

import type { GameState } from '../game/gameState.js';
import { deserialiseGameState, serialiseGameState } from '../game/gameStateStorage.js';

export const GAME_STORAGE_KEY = 'fourwise:game';

/**
 * Reads the stored game, if any. Returns `null` on a fresh browser, on
 * corrupt/foreign JSON, on a validly-shaped-but-illegal game (an overfull
 * column, say), or if `localStorage` throws -- every one of those is
 * "nothing to restore", never a crash and never a half-restored game.
 */
export function loadStoredGame(storage: Storage = window.localStorage): GameState | null {
  try {
    const raw = storage.getItem(GAME_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return deserialiseGameState(parsed);
  } catch {
    return null;
  }
}

/**
 * Stores the current game -- called on every change (see `App.tsx`'s
 * effect). Best-effort: a `localStorage` write failure must never break the
 * session that triggered it.
 */
export function saveGame(state: GameState, storage: Storage = window.localStorage): void {
  try {
    storage.setItem(GAME_STORAGE_KEY, JSON.stringify(serialiseGameState(state)));
  } catch {
    // Persistence is a nicety, not a requirement of any single session.
  }
}
