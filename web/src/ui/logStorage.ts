// Day-to-day `localStorage` persistence for the game log (Wave 12, SPEC §5:
// "Phase 3 adds a game archive"). Separate key, separate small envelope from
// `ui/gameStorage.ts`'s current-game persistence -- the log survives
// independently of whatever game is currently in progress. Mirrors the
// house pattern exactly (`ui/gameStorage.ts` / `ui/seatStorage.ts`): pure
// I/O here, all shape/legality validation delegated to
// `game/loggedGame.ts`'s `parseLoggedGameArray`, and anything unreadable or
// invalid is treated as "nothing to restore" -- never a crash, never a
// half-restored log.

import { parseLoggedGameArray, type LoggedGame } from '../game/loggedGame.js';

export const LOG_STORAGE_KEY = 'fourwise:log';
export const CURRENT_LOG_STORAGE_VERSION = 1;

export interface LogStorageEnvelope {
  version: number;
  exported: string;
  games: LoggedGame[];
}

/**
 * Reads the stored log, if any. Returns `[]` on a fresh browser, on
 * corrupt/foreign JSON, on a newer-than-supported version, or on a
 * validly-shaped-but-illegal entry (an unreplayable move list, say) --
 * every one of those is "nothing to restore", never a crash and never a
 * half-restored log (same contract as `ui/gameStorage.ts`'s
 * `loadStoredGame`).
 */
export function loadStoredLog(storage: Storage = window.localStorage): LoggedGame[] {
  try {
    const raw = storage.getItem(LOG_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return [];
    const v = parsed as Record<string, unknown>;
    if (typeof v.version !== 'number' || !Number.isInteger(v.version) || v.version < 1) return [];
    if (v.version > CURRENT_LOG_STORAGE_VERSION) return [];
    const games = parseLoggedGameArray(v.games);
    return typeof games === 'string' ? [] : games;
  } catch {
    return [];
  }
}

/**
 * Stores the whole log -- called on every change (see `useGameLog.ts`'s own
 * effect). Best-effort: a `localStorage` write failure must never break the
 * session that triggered it.
 */
export function saveLog(
  games: readonly LoggedGame[],
  storage: Storage = window.localStorage,
  exportedAt: string = new Date().toISOString(),
): void {
  try {
    const envelope: LogStorageEnvelope = { version: CURRENT_LOG_STORAGE_VERSION, exported: exportedAt, games: [...games] };
    storage.setItem(LOG_STORAGE_KEY, JSON.stringify(envelope));
  } catch {
    // Persistence is a nicety, not a requirement of any single session.
  }
}
