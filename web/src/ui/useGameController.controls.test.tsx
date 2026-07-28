// @vitest-environment jsdom

// Wave 6a: role-based Play-mode controls default (carried defect fix).
//
// Before this fix, `useGameController` hardcoded `{ red: 'human', yellow:
// 'engine' }` regardless of which colour the user picked -- a first-run user
// seated as yellow would watch the ENGINE play their own colour. The fix
// (`ui/types.ts`'s `defaultControls`) makes the default a function of
// `userColour`: the user's own colour starts human-controlled, the
// opponent's starts engine-controlled. This file proves two properties
// (task requirement, both required):
//
//   1. The default at NEW game creation is role-based, not colour-based --
//      exercised for both a red-user and a yellow-user seat, and for both
//      the "seat already known at mount" path (a stored seat) and the
//      "seat arrives after mount" path (the first-run prompt's Start
//      button).
//   2. A later, in-app seat change (`setUserColour`/`setFirstMover`) never
//      reassigns who controls which COLOUR -- controls stay per-colour once
//      a game exists; only the creation-time default is role-derived.

import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useGameController } from './useGameController.js';
import type { GameState } from '../game/gameState.js';
import type { Seat } from '../game/seat.js';

describe('Play controls: role-based default at new-game creation', () => {
  it('a red-user seat defaults red to human and yellow to engine', () => {
    const seat: Seat = { firstMover: 'yellow', userColour: 'red' };
    const { result } = renderHook(() => useGameController(null, seat));
    expect(result.current!.controls).toEqual({ red: 'human', yellow: 'engine' });
  });

  it('a yellow-user seat defaults yellow to human and red to engine -- the exact case the carried defect got wrong', () => {
    const seat: Seat = { firstMover: 'red', userColour: 'yellow' };
    const { result } = renderHook(() => useGameController(null, seat));
    expect(result.current!.controls).toEqual({ yellow: 'human', red: 'engine' });
  });

  it('applies the same role-based default when the seat arrives AFTER mount (the first-run prompt path)', () => {
    const { result, rerender } = renderHook(({ seat }: { seat: Seat | null }) => useGameController(null, seat), {
      initialProps: { seat: null as Seat | null },
    });
    // No seat chosen yet -- no game, no controller (the prompt is still up).
    expect(result.current).toBeNull();

    rerender({ seat: { firstMover: 'red', userColour: 'yellow' } });
    expect(result.current!.controls).toEqual({ yellow: 'human', red: 'engine' });
  });
});

describe('Play controls: a mid-game seat change never reassigns who controls a colour', () => {
  it('changing "you are" (userColour) leaves both colours\' controls exactly as they were', () => {
    const seat: Seat = { firstMover: 'red', userColour: 'red' };
    const { result } = renderHook(() => useGameController(null, seat));
    expect(result.current!.controls).toEqual({ red: 'human', yellow: 'engine' });

    act(() => result.current!.setUserColour('yellow'));

    // The user is now yellow, but RED -- no longer the user's own colour --
    // stays human-controlled, and yellow stays engine-controlled. Only the
    // seat changed; the control assignment is untouched.
    expect(result.current!.seat.userColour).toBe('yellow');
    expect(result.current!.controls).toEqual({ red: 'human', yellow: 'engine' });
  });

  it('changing "moves first" (firstMover) also leaves both colours\' controls exactly as they were', () => {
    const seat: Seat = { firstMover: 'red', userColour: 'yellow' };
    const { result } = renderHook(() => useGameController(null, seat));
    expect(result.current!.controls).toEqual({ yellow: 'human', red: 'engine' });

    act(() => result.current!.setFirstMover('yellow'));

    expect(result.current!.seat.firstMover).toBe('yellow');
    expect(result.current!.controls).toEqual({ yellow: 'human', red: 'engine' });
  });
});

// Seat persistence architecture (owner ruling, 2026-07-28, mid-Wave-6a):
// `fourwise:seat` (this hook's `initialSeat` parameter) is a first-run
// DEFAULT ONLY -- it seeds a brand-new game, but a RESTORED game
// (`initialGame`) keeps its own embedded seat outright, even when it
// disagrees with `initialSeat`. This used to be `reconcileGameSeat`
// (`game/gameStateStorage.ts`), which did the opposite (the preference
// always won) -- removed; this is the inverted property that replaces it,
// at the layer that actually makes the decision now.
describe('a restored game keeps its own seat, never the separately-stored preference', () => {
  const restoredGame: GameState = {
    seat: { firstMover: 'yellow', userColour: 'yellow' },
    mode: 'play',
    setupPrefix: '',
    moves: [{ column: 3 }],
    currentPly: 1,
  };

  it("uses the restored game's own seat, ignoring a disagreeing `initialSeat`", () => {
    const differingPreference: Seat = { firstMover: 'red', userColour: 'red' };
    const { result } = renderHook(() => useGameController(null, differingPreference, restoredGame));

    expect(result.current!.seat).toEqual({ firstMover: 'yellow', userColour: 'yellow' });
    // The role-based default (this file's other describe block) is seeded
    // from the GAME's own seat too, not the disagreeing preference.
    expect(result.current!.controls).toEqual({ yellow: 'human', red: 'engine' });
    // And the restored game's own moves are untouched by any of this.
    expect(result.current!.game.moves).toEqual([{ column: 3 }]);
  });

  it('still uses `initialSeat` to seed a genuinely brand-new game when no game is restored', () => {
    const preference: Seat = { firstMover: 'red', userColour: 'red' };
    const { result } = renderHook(() => useGameController(null, preference, null));

    expect(result.current!.seat).toEqual(preference);
    expect(result.current!.game.moves).toEqual([]);
  });
});
