// UI-only types for Wave 4b. SPEC.md §3.1 defines `SideControl`/`Controls`
// as part of Play mode's behaviour, but Wave 4a's game layer does not own
// them (grep confirms no `SideControl` anywhere under `src/game/`) — they
// are a UI/orchestration concern, so they live here rather than being added
// to `game/`, which this wave must only consume.

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
