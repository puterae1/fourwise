// Setup mode's local editing state — SPEC.md §3.3. Deliberately separate
// from `useGameController`'s `GameState`: switching into Setup and back out
// again WITHOUT pressing `Done` must leave the live game untouched ("three
// modes, switchable at any time without losing the position", SPEC §3), so
// the board being built here only becomes the game once it is committed.

import { useCallback, useMemo, useState } from 'react';
import { dropDisc, emptyGrid, validateSetup, type Grid, type SetupRejection } from '../game/setup.js';
import type { Colour } from '../game/seat.js';

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

export function useSetupEditor(firstMover: Colour, initialPlacing: Colour): SetupEditor {
  const [history, setHistory] = useState<Placement[]>([]);
  const [placing, setPlacing] = useState<Colour>(initialPlacing);

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
