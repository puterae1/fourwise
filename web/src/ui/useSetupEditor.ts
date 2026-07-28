// Setup mode's local editing state — SPEC.md §3.3. Deliberately separate
// from `useGameController`'s `GameState`: switching into Setup and back out
// again WITHOUT pressing `Done` must leave the live game untouched ("three
// modes, switchable at any time without losing the position", SPEC §3), so
// the board being built here only becomes the game once it is committed.

import { useCallback, useMemo, useState } from 'react';
import { dropDisc, emptyGrid, validateSetup, type Grid, type SetupRejection } from '../game/setup.js';
import type { Colour, Seat } from '../game/seat.js';

interface Placement {
  column: number;
  colour: Colour;
}

export interface SetupEditor {
  grid: Grid;
  placing: Colour;
  setPlacing: (colour: Colour) => void;
  place: (column: number) => void;
  undo: () => void;
  clear: () => void;
  canUndo: boolean;
  rejection: SetupRejection | null;
  reset: () => void;
}

/**
 * `seat` is `null` exactly while `App.tsx`'s first-run prompt is still up
 * (`controller` itself is `null` then) and a real `Seat` from the moment
 * `controller` exists — this hook is called unconditionally regardless
 * (React's rules of hooks), but Setup mode is unreachable while `seat` is
 * `null`, so nothing derived from it is ever user-visible until then.
 *
 * Bug fixed here (third occurrence of this project's signature bug class —
 * verifier audit, Wave 6a): `placing`'s `useState` used to read its
 * argument exactly once, at THIS hook's very first call -- which happens
 * while `App` is still rendering the prompt and `seat` is `null`, long
 * before the user's real `userColour` exists. A first-run user who chose
 * yellow would open Setup and find RED checked as the placing colour,
 * because the `useState` initializer had already run and frozen on the
 * inert fallback before the real seat ever arrived. The fix mirrors
 * `useGameController.ts`'s own `seenInitialSeat` pattern exactly: `seat`
 * transitions from `null` to a real `Seat` exactly once, in this component's
 * lifetime, and only THAT transition re-syncs `placing` to the real
 * `userColour` -- adjusting state during render, not in an effect, for the
 * same reason `useGameController` does (no extra frame with stale state).
 * `synced` then latches permanently, so a LATER, unrelated seat change
 * (changing "You are" while already playing, then entering Setup) never
 * silently overwrites a placing colour the user chose by hand in the
 * meantime.
 */
export function useSetupEditor(seat: Seat | null): SetupEditor {
  const [history, setHistory] = useState<Placement[]>([]);
  const [placing, setPlacing] = useState<Colour>(seat?.userColour ?? 'red');

  const [seenSeat, setSeenSeat] = useState(seat);
  const [synced, setSynced] = useState(seat !== null);
  if (seat !== seenSeat) {
    setSeenSeat(seat);
    if (!synced && seat) {
      setPlacing(seat.userColour);
      setSynced(true);
    }
  }

  const firstMover = seat?.firstMover ?? 'red';

  const grid = useMemo(() => {
    let g: Grid = emptyGrid();
    for (const p of history) g = dropDisc(g, p.column, p.colour);
    return g;
  }, [history]);

  const rejection = useMemo(() => {
    const outcome = validateSetup(grid, firstMover);
    return outcome.ok ? null : outcome.rejection;
  }, [grid, firstMover]);

  const place = useCallback((column: number) => {
    setHistory((h) => {
      // Recompute fullness from the CURRENT history at update time, not a
      // stale `grid` closure -- guards against rapid double-clicks.
      let g: Grid = emptyGrid();
      for (const p of h) g = dropDisc(g, p.column, p.colour);
      if (g[column]!.every((cell) => cell !== null)) return h; // full, no-op
      return [...h, { column, colour: placing }];
    });
  }, [placing]);

  const undo = useCallback(() => setHistory((h) => h.slice(0, -1)), []);
  const clear = useCallback(() => setHistory([]), []);
  const reset = useCallback(() => setHistory([]), []);

  return { grid, placing, setPlacing, place, undo, clear, canUndo: history.length > 0, rejection, reset };
}
