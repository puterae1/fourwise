// Shared shape/legality guards for anything that turns untrusted data (a
// `localStorage` blob, an imported JSON file) into a `GameState`. Used by
// both `gameStateStorage.ts` (SPEC §5, "current game survives a refresh")
// and `exportFormat.ts` (SPEC §5, JSON export/import) so the two persistence
// paths validate identically rather than drifting apart. Nothing here talks
// to storage or the DOM -- pure functions only, consistent with the rest of
// `game/`.
//
// The single legality gate is `replayIsLegal`, below: it replays a candidate
// `setupPrefix + moves` through `setup.ts`'s own `dropDisc` (unmodified),
// exactly as `web/src/ui/deriveBoard.ts` will once this data becomes a live
// `GameState`. That guarantees a corrupt or hand-edited file (an overfull
// column, a floating disc from a broken replay order) can never reach
// `deriveBoard`'s own replay and throw there -- "corrupt/invalid stored game
// -> fresh game, never a crash" holds by construction, not by convention.

import { colourAtPly, type Colour, type Seat } from './seat.js';
import { BOARD_COLUMNS, dropDisc, emptyGrid, type Grid } from './setup.js';
import type { Mode, Move } from './gameState.js';

export function isColour(value: unknown): value is Colour {
  return value === 'red' || value === 'yellow';
}

export function isSeat(value: unknown): value is Seat {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return isColour(v.firstMover) && isColour(v.userColour);
}

export function isMode(value: unknown): value is Mode {
  return value === 'play' || value === 'analyse' || value === 'setup';
}

const SETUP_PREFIX_PATTERN = /^[1-7]*$/;

/** Structural check only (every character is a legal column digit) -- the
 * REAL legality check is `replayIsLegal` below, which needs the seat too. */
export function isSetupPrefixShape(value: unknown): value is string {
  return typeof value === 'string' && SETUP_PREFIX_PATTERN.test(value);
}

function isMoveShape(value: unknown): value is Move {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.column !== 'number' || !Number.isInteger(v.column) || v.column < 0 || v.column >= BOARD_COLUMNS) {
    return false;
  }
  if ('partial' in v && v.partial !== undefined && typeof v.partial !== 'boolean') return false;
  if ('origin' in v && v.origin !== undefined && v.origin !== 'tactical' && v.origin !== 'centre-fallback') {
    return false;
  }
  return true;
}

/** Structural validation of a `moves` array -- every element shaped like a
 * `Move`. Returns `null` on ANY malformed element (never throws, never
 * drops the bad entry and keeps going -- a half-valid move list is exactly
 * the "half-import" SPEC §5 forbids). */
export function parseMoveArray(value: unknown): Move[] | null {
  if (!Array.isArray(value)) return null;
  const moves: Move[] = [];
  for (const item of value) {
    if (!isMoveShape(item)) return null;
    moves.push(
      item.partial
        ? { column: item.column, partial: true, ...(item.origin ? { origin: item.origin } : {}) }
        : { column: item.column },
    );
  }
  return moves;
}

/**
 * The one legality gate shared by both persistence paths. Replays
 * `setupPrefix + moves` (in that order -- `setupPrefix` is itself a
 * move-sequence prefix, SPEC §3.3) through `setup.ts`'s real `dropDisc`,
 * colouring each ply via `colourAtPly` exactly as `deriveBoard.ts` does.
 * Returns `false` on the first illegal drop (an already-full column) or any
 * out-of-range column digit -- never throws.
 */
export function replayIsLegal(seat: Seat, setupPrefix: string, moves: Move[]): boolean {
  try {
    let grid: Grid = emptyGrid();
    const fullString = setupPrefix + moves.map((m) => String(m.column + 1)).join('');
    for (let ply = 0; ply < fullString.length; ply++) {
      const digit = fullString[ply]!;
      const column = Number(digit) - 1;
      if (!Number.isInteger(column) || column < 0 || column >= BOARD_COLUMNS) return false;
      grid = dropDisc(grid, column, colourAtPly(seat, ply));
    }
    return true;
  } catch {
    return false;
  }
}
