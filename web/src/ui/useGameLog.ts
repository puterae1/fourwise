// Owns the live in-memory game log, persisted to `localStorage` on every
// change (mirrors `App.tsx`'s own `saveGame` effect for the current-game
// persistence). This is the ONE place `addGame`/`mergeImported` mutate the
// log; `App.tsx` wires it to the live-play save control, the "add from
// memory" flow, and the import pipeline.

import { useCallback, useEffect, useState } from 'react';
import type { LoggedGame } from '../game/loggedGame.js';
import { loadStoredLog, saveLog } from './logStorage.js';

export interface GameLog {
  games: LoggedGame[];
  addGame: (game: LoggedGame) => void;
  /** Merges an imported batch, de-duplicated by `id` -- re-importing the
   *  same file is idempotent rather than duplicating every row. Returns how
   *  many were actually NEW (for a caller that wants to say so), without
   *  requiring any awkward "read the count back out of state" dance. */
  mergeImported: (imported: readonly LoggedGame[]) => number;
}

export function useGameLog(storage: Storage = window.localStorage): GameLog {
  const [games, setGames] = useState<LoggedGame[]>(() => loadStoredLog(storage));

  useEffect(() => {
    saveLog(games, storage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [games]);

  const addGame = useCallback((game: LoggedGame) => setGames((g) => [...g, game]), []);

  const mergeImported = useCallback(
    (imported: readonly LoggedGame[]) => {
      const ids = new Set(games.map((g) => g.id));
      const toAdd = imported.filter((g) => !ids.has(g.id));
      if (toAdd.length > 0) setGames((g) => [...g, ...toAdd]);
      return toAdd.length;
    },
    [games],
  );

  return { games, addGame, mergeImported };
}
