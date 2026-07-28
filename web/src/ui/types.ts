// UI-only types for Wave 4b. SPEC.md §3.1 defines `SideControl`/`Controls`
// as part of Play mode's behaviour, but Wave 4a's game layer does not own
// them (grep confirms no `SideControl` anywhere under `src/game/`) — they
// are a UI/orchestration concern, so they live here rather than being added
// to `game/`, which this wave must only consume.

import type { Colour } from '../game/seat.js';
import { otherColour } from '../game/seat.js';
import type { Level } from '../game/levels.js';

/** SPEC §3.1: "Per-side control". */
export type SideControl = 'human' | 'engine';

export interface Controls {
  red: SideControl;
  yellow: SideControl;
}

export interface Levels {
  red: Level;
  yellow: Level;
}

/** SPEC §3.1's amended "Level-label honesty": `null` when the last move
 *  made by this colour came from the level's own complete computation;
 *  otherwise the specific reason it didn't, for the level label's own
 *  surface (`PlayPanel.tsx`) to qualify visibly -- the move list's
 *  `partial` badge is "necessary but not sufficient" per the amendment.
 *  Computed by `useGameController.ts`'s `levelQualifiers`. */
export type LevelQualifier = 'tactical' | 'centre-fallback' | null;

/**
 * The role-based default for a brand-new game (Wave 6a fix): the user's own
 * colour starts under human control, the opponent's colour starts under
 * engine control. Deliberately a function of `userColour`, never a fixed
 * per-colour default (the carried defect this replaces hardcoded `{ red:
 * 'human', yellow: 'engine' }` regardless of which colour the user picked —
 * a first-run user seated as yellow would have watched the ENGINE play
 * their own colour). Only ever consulted at the moment a game is created;
 * callers must not re-derive `controls` from `userColour` on every render,
 * or a later seat change would silently reassign who controls which colour
 * mid-game, which CLAUDE.md invariant #1 and this wave's own task forbid.
 */
export function defaultControls(userColour: Colour): Controls {
  const opponentColour = otherColour(userColour);
  const controls: Record<Colour, SideControl> = { red: 'engine', yellow: 'engine' };
  controls[userColour] = 'human';
  controls[opponentColour] = 'engine';
  return controls;
}
