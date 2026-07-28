// UI-layer persistence tests for the CURRENT game (SPEC §5, "current game
// survives a refresh"). Runs in the default `node` environment -- no DOM
// needed, since every call here passes an explicit fake `Storage`, so
// `window.localStorage` (the default parameter) is never evaluated.

import { describe, expect, it } from 'vitest';
import { createGame, playMove, type GameState } from '../game/gameState.js';
import { GAME_STORAGE_KEY, loadStoredGame, saveGame } from './gameStorage.js';
import type { Seat } from '../game/seat.js';

const SEAT: Seat = { firstMover: 'red', userColour: 'yellow' };

function makeMemoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
    setItem: (key: string, value: string) => {
      data.set(key, String(value));
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => data.clear(),
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    get length() {
      return data.size;
    },
  };
}

function play(state: GameState, column: number): GameState {
  const result = playMove(state, column);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

describe('saveGame / loadStoredGame -- round trip', () => {
  it('restores a saved fresh game unchanged', () => {
    const storage = makeMemoryStorage();
    const state = createGame(SEAT, 'play');
    saveGame(state, storage);
    expect(loadStoredGame(storage)).toEqual(state);
  });

  it('restores a saved in-progress game (moves, undo applied) unchanged', () => {
    const storage = makeMemoryStorage();
    let state = createGame(SEAT, 'play');
    state = play(state, 3);
    state = play(state, 4);
    saveGame(state, storage);
    expect(loadStoredGame(storage)).toEqual(state);
  });

  it('the second save overwrites the first', () => {
    const storage = makeMemoryStorage();
    saveGame(createGame(SEAT, 'play'), storage);
    const later = play(createGame(SEAT, 'play'), 6);
    saveGame(later, storage);
    expect(loadStoredGame(storage)).toEqual(later);
  });
});

describe('loadStoredGame -- absent/corrupt storage never crashes', () => {
  it('returns null on a fresh storage with nothing stored', () => {
    expect(loadStoredGame(makeMemoryStorage())).toBeNull();
  });

  it('returns null on malformed JSON', () => {
    const storage = makeMemoryStorage();
    storage.setItem(GAME_STORAGE_KEY, '{ not json');
    expect(loadStoredGame(storage)).toBeNull();
  });

  it('returns null on valid JSON with the wrong shape', () => {
    const storage = makeMemoryStorage();
    storage.setItem(GAME_STORAGE_KEY, JSON.stringify({ some: 'other object' }));
    expect(loadStoredGame(storage)).toBeNull();
  });

  it('returns null (never throws) if the underlying storage throws on getItem', () => {
    const storage: Storage = {
      getItem: () => {
        throw new Error('quota exceeded, or private browsing');
      },
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    };
    expect(loadStoredGame(storage)).toBeNull();
  });
});

describe('saveGame -- best-effort, never throws', () => {
  it('does not throw when the underlying storage throws on setItem', () => {
    const storage: Storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded');
      },
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    };
    expect(() => saveGame(createGame(SEAT, 'play'), storage)).not.toThrow();
  });
});
