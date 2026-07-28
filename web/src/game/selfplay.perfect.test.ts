// Engine-vs-engine self-play at Perfect, all four seat combinations
// (SPEC.md §1 -- "all four combinations are legal and must work
// identically"). BOTH sides are engine-controlled at Perfect through the
// real production path: `game/levels.ts`'s `pickEngineMove` (the actual
// move-selection function `ui/useGameController.ts` calls) fed by
// `engine/wrapper.ts`'s `analyse()` (the real compiled wasm module, same
// loading pattern as `wrapper.test.ts`/`levels.realEngine.test.ts`), driven
// through `game/gameState.ts` (`createGame`/`playMove`/`enginePosition`/
// `absolutePly`) -- i.e. the seat model itself is exercised move by move,
// never bypassed.
//
// The opening book (`web/public/book.bin`) is loaded and REQUIRED to load
// successfully: without it, early-game solves would hit the node-budget
// ceiling and this test would have to choose between an honestly-partial
// "Perfect" (which SPEC forbids) or a multi-minute empty-board solve per
// ENGINE.md's documented ~115s figure. A failed book load fails this test
// loudly rather than silently degrading.
//
// "Perfect" here means genuinely perfect: every `analyse()` call is issued
// with an effectively-unlimited node budget, and any `complete: false`
// result, or any move chosen from a non-'complete' origin, fails the test
// immediately with the offending position -- a silently-imperfect "Perfect"
// would invalidate the whole experiment (Connect 4's known first-player-win
// result, and the seat-independence proof below, both depend on the engine
// actually being exact at every ply).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import { analyse, initEngine, loadBook } from '../engine/wrapper.js';
import { readWasmBytes } from '../engine/wasm-test-helper.js';
import { deriveBoard } from '../ui/deriveBoard.js';
import { absolutePly, createGame, enginePosition, playMove } from './gameState.js';
import { pickEngineMove } from './levels.js';
import type { Colour, Seat } from './seat.js';

// `docs/ENGINE.md` "Budgeted analysis": the budget is in NODES, never
// milliseconds. The smoke run that sized this constant (same book, same
// wasm module, run outside vitest to calibrate this file) never needed more
// than ~44M nodes for the hardest ply of a full 41-ply Perfect game; this is
// ~90x that headroom while staying safely clear of the u32 boundary
// (4294967295) `analyse`'s wasm signature accepts -- "effectively
// unlimited" for anything this project's board size can produce, without
// risking an unbounded wait if something regresses.
const PERFECT_NODE_BUDGET = 4_000_000_000;

// Safety cap only -- a real game can never exceed 42 plies (a full board).
// If self-play runs past this, something is broken (e.g. `playMove` is
// silently rejecting moves), and looping forever is the wrong failure mode.
const MAX_PLIES = 43;

const bookPath = fileURLToPath(new URL('../../public/book.bin', import.meta.url));

beforeAll(async () => {
  await initEngine({ module_or_path: readWasmBytes() });
  const bookLoad = loadBook(readFileSync(bookPath));
  // Mandatory, per this test's own governing instructions: a failed book
  // load must FAIL the test, not silently fall back to slower plain search.
  expect(bookLoad.ok, `book load failed: ${bookLoad.error ?? '(no error message)'}`).toBe(true);
  expect(bookLoad.entries).toBeGreaterThan(0);
});

interface SeatConfig {
  label: string;
  seat: Seat;
}

// user colour in {red, yellow} x user-moves-first in {true, false} -- the
// four legal combinations SPEC.md §1 requires all work identically.
// `firstMover` is derived per config so every combination of the two
// independent axes is actually represented, never hand-duplicated.
const SEAT_CONFIGS: SeatConfig[] = [
  { label: 'user=red, user moves first', seat: { firstMover: 'red', userColour: 'red' } },
  { label: 'user=red, user moves second', seat: { firstMover: 'yellow', userColour: 'red' } },
  { label: 'user=yellow, user moves first', seat: { firstMover: 'yellow', userColour: 'yellow' } },
  { label: 'user=yellow, user moves second', seat: { firstMover: 'red', userColour: 'yellow' } },
];

interface PerfectGameResult {
  /** 0-indexed columns played, in order -- both sides combined. */
  columns: number[];
  isDraw: boolean;
  winnerColour: Colour | null;
}

/**
 * Plays one full engine-vs-engine game at Perfect under `seat`, through the
 * real game layer. Both sides use the exact same production function
 * (`pickEngineMove`) -- there is no separate "which side is the user" logic
 * here, matching `useGameController.ts`'s own engine-vs-engine path (both
 * `controls.red` and `controls.yellow` set to `'engine'`).
 */
function playPerfectGame(seat: Seat): PerfectGameResult {
  let state = createGame(seat, 'play');
  const columns: number[] = [];

  for (let i = 0; i < MAX_PLIES; i++) {
    const board = deriveBoard(state);
    if (board.isGameOver) {
      return { columns, isDraw: board.winLine === null, winnerColour: board.winLine?.colour ?? null };
    }

    const position = enginePosition(state);
    const result = analyse(position, PERFECT_NODE_BUDGET);
    if (!result.complete) {
      throw new Error(
        `Perfect self-play got a PARTIAL analysis at position "${position}" (seat ${JSON.stringify(seat)}). ` +
          'Perfect must never move from an incomplete analysis -- raise the node budget or investigate why ' +
          'this position did not solve.',
      );
    }

    const ply = absolutePly(state);
    const chosen = pickEngineMove(result, ply, 'perfect');
    if (chosen.origin !== 'complete') {
      throw new Error(
        `Perfect self-play chose a move with origin "${chosen.origin}" at position "${position}" -- a ` +
          "genuinely-complete analysis must never fall through to the tactical-fallback path.",
      );
    }

    const played = playMove(state, chosen.column);
    if (!played.ok) {
      throw new Error(`Perfect self-play tried an illegal move at position "${position}": ${played.error}`);
    }
    columns.push(chosen.column);
    state = played.state;
  }

  throw new Error(
    `Perfect self-play did not terminate within ${MAX_PLIES} plies -- a real game can never exceed 42.`,
  );
}

describe('engine-vs-engine self-play at Perfect, all four seats (real wasm + real opening book)', () => {
  it(
    'every seat: centre opening, first mover wins, exactly 41 plies -- and all four games are move-for-move identical',
    { timeout: 300_000 },
    () => {
      const results = SEAT_CONFIGS.map(({ seat }) => ({ seat, result: playPerfectGame(seat) }));

      results.forEach(({ seat, result }, i) => {
        const label = SEAT_CONFIGS[i]!.label;

        // 1. The unique winning first move is the centre column (column 4,
        // 1-indexed -- column index 3, 0-indexed, per ENGINE.md's 0-indexed
        // API).
        expect(result.columns[0], `${label}: first move`).toBe(3);

        // 2. The player who moved first wins -- never the second player,
        // never a draw. Asserted on the COLOUR that ply-0 mapped to under
        // this seat (`seat.firstMover`), which is exactly "the player who
        // moved first" restated in this seat's own vocabulary -- never
        // derived from `userColour`, keeping this assertion colour/turn-order
        // independent per CLAUDE.md invariant #1.
        expect(result.isDraw, `${label}: game must not end in a draw`).toBe(false);
        expect(result.winnerColour, `${label}: the first mover (${seat.firstMover}) must win`).toBe(seat.firstMover);

        // 3. Total game length is exactly 41 plies (score +1 at the root =>
        // the winner's 21st stone, i.e. ply 41 under mutual perfection).
        expect(result.columns.length, `${label}: total plies`).toBe(41);
      });

      // 4. Seat independence: Perfect is deterministic (lowest-column
      // tie-break) and the engine never sees a colour -- the seat
      // configuration must not change a single move. This is the
      // seat-independence proof this test exists to run.
      const [first, ...rest] = results;
      rest.forEach(({ result }, i) => {
        expect(result.columns, `${SEAT_CONFIGS[i + 1]!.label} vs ${SEAT_CONFIGS[0]!.label}: move sequence`).toEqual(
          first!.result.columns,
        );
      });
    },
  );
});
