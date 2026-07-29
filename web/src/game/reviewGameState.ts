// Builds a synthetic `GameState` from a `LoggedGame` at a given ply — lets
// the post-game review stepper (docs/DESIGN-DIRECTION.md §17) reuse every
// existing pure position/board primitive (`game/gameState.ts`'s
// `enginePosition`/`absolutePly`/`colourToMove`, `ui/deriveBoard.ts`'s
// `deriveBoard`) instead of re-deriving any of them. A `LoggedGame` is
// always a standalone, flattened game (no separate setup prefix — see
// `game/loggedGame.ts`'s own doc comment), so `setupPrefix` is always `''`.
//
// `mode` is fixed to `'analyse'` — a review position is always re-analysable
// (SPEC §4) and is never a live Play/Setup position; nothing downstream
// actually branches on this GameState's own `mode` field (the review UI
// drives its own mode-independent components directly), but a valid `Mode`
// value is required by the type.

import type { GameState } from './gameState.js';
import type { LoggedGame } from './loggedGame.js';

/**
 * `ply` must be in `0..game.moves.length` — the caller (`ui/useReviewSession.ts`)
 * is the one place that owns clamping the visible ply to the game's length.
 */
export function loggedGameStateAt(game: LoggedGame, ply: number): GameState {
  return {
    seat: game.seat,
    mode: 'analyse',
    setupPrefix: '',
    moves: game.moves.map((column) => ({ column })),
    currentPly: ply,
  };
}
