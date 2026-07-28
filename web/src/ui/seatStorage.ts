// The first slice of Wave 5 persistence, sanctioned early (owner ruling)
// solely so the first-run seat prompt is genuinely first-run-only —
// SPEC.md §5 "Seat preference remembered". Nothing else is persisted here:
// game-state persistence and export/import stay Wave 5 proper.
//
// This is a UI-layer concern (`web/src/game/` never touches storage), so it
// lives here rather than in `game/seat.ts`.

import type { Colour, Seat } from '../game/seat.js';

export const SEAT_STORAGE_KEY = 'fourwise:seat';

function isColour(value: unknown): value is Colour {
  return value === 'red' || value === 'yellow';
}

/**
 * Reads the stored seat, if any. Returns `null` on a fresh browser, on
 * corrupt/foreign JSON, or if `localStorage` throws (private browsing,
 * quota, disabled storage) -- a missing or unreadable preference is exactly
 * "first run" as far as this app is concerned, never an error to surface.
 */
export function loadStoredSeat(storage: Storage = window.localStorage): Seat | null {
  try {
    const raw = storage.getItem(SEAT_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      isColour((parsed as Record<string, unknown>).firstMover) &&
      isColour((parsed as Record<string, unknown>).userColour)
    ) {
      const seat = parsed as Record<string, unknown>;
      return { firstMover: seat.firstMover as Colour, userColour: seat.userColour as Colour };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Stores the chosen seat -- called once when the first-run prompt's Start
 * is pressed, and again on every later in-app seat change, so the stored
 * preference always reflects the seat actually in use. Best-effort: a
 * `localStorage` write failure must never break the app that triggered it.
 */
export function saveSeat(seat: Seat, storage: Storage = window.localStorage): void {
  try {
    storage.setItem(SEAT_STORAGE_KEY, JSON.stringify(seat));
  } catch {
    // Persistence is a nicety, not a requirement of any single session.
  }
}
