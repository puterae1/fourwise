// Wave 14b — deliverable 5: the 20-game floor. docs/OPPONENT-MODEL.md,
// §19 ruling #1 (STATUS.md): the floor counts WHOLE logged games for the
// active opponent label, whatever their provenance (live and reconstructed
// both count as one whole game each here — the live/reconstructed WEIGHT
// distinction is a Beta-Bernoulli concept, `betaBernoulli.ts`, and plays no
// part in this predicate). Below the floor: no predictions at all — expose
// the count and how many more are needed.

import type { LoggedGame } from '../game/loggedGame.js';

export const GAME_FLOOR = 20;

export interface GameFloorStatus {
  /** Whole logged games for this opponent label, any provenance. */
  count: number;
  floor: number;
  met: boolean;
  /** 0 once `met` is true. */
  remaining: number;
}

/** Pure predicate — PIN 4: scoped to one opponent label, never pooled. */
export function gameFloorStatus(games: readonly LoggedGame[], opponentLabel: string): GameFloorStatus {
  const count = games.reduce((total, game) => (game.opponent === opponentLabel ? total + 1 : total), 0);
  const met = count >= GAME_FLOOR;
  return { count, floor: GAME_FLOOR, met, remaining: met ? 0 : GAME_FLOOR - count };
}
