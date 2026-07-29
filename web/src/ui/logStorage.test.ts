// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { CURRENT_LOG_STORAGE_VERSION, LOG_STORAGE_KEY, loadStoredLog, saveLog } from './logStorage.js';
import { buildLoggedGame, type LoggedGame } from '../game/loggedGame.js';
import type { Seat } from '../game/seat.js';

const SEAT: Seat = { firstMover: 'red', userColour: 'yellow' };

function makeStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => (data.has(key) ? (data.get(key) as string) : null),
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
  } as Storage;
}

function game(id: string): LoggedGame {
  return buildLoggedGame({
    seat: SEAT,
    moves: [3, 2, 4],
    winner: 'yellow',
    opponent: 'Anna',
    source: 'live',
    id,
    date: '2026-07-29T00:00:00.000Z',
  });
}

describe('loadStoredLog / saveLog (SPEC §5, "Phase 3 adds a game archive")', () => {
  it('a fresh storage has no log -- returns []', () => {
    expect(loadStoredLog(makeStorage())).toEqual([]);
  });

  it('round trips a saved log exactly', () => {
    const storage = makeStorage();
    const games = [game('a'), game('b')];
    saveLog(games, storage, '2026-07-29T00:00:00.000Z');
    expect(loadStoredLog(storage)).toEqual(games);
  });

  it('stores the envelope shape { version, exported, games }', () => {
    const storage = makeStorage();
    saveLog([game('a')], storage, '2026-07-29T00:00:00.000Z');
    const raw = JSON.parse(storage.getItem(LOG_STORAGE_KEY)!);
    expect(raw.version).toBe(CURRENT_LOG_STORAGE_VERSION);
    expect(raw.exported).toBe('2026-07-29T00:00:00.000Z');
    expect(raw.games).toHaveLength(1);
  });

  it('malformed JSON never crashes -- falls back to an empty log', () => {
    const storage = makeStorage();
    storage.setItem(LOG_STORAGE_KEY, '{ not valid json at all');
    expect(loadStoredLog(storage)).toEqual([]);
  });

  it('a validly-shaped but illegal entry (overfull column) never crashes -- falls back to an empty log', () => {
    const storage = makeStorage();
    const illegal = { ...game('a'), moves: Array.from({ length: 7 }, () => 3) };
    storage.setItem(LOG_STORAGE_KEY, JSON.stringify({ version: 1, exported: 'x', games: [illegal] }));
    expect(loadStoredLog(storage)).toEqual([]);
  });

  it('a newer-than-supported version never crashes -- falls back to an empty log', () => {
    const storage = makeStorage();
    storage.setItem(LOG_STORAGE_KEY, JSON.stringify({ version: CURRENT_LOG_STORAGE_VERSION + 1, exported: 'x', games: [game('a')] }));
    expect(loadStoredLog(storage)).toEqual([]);
  });

  it('a storage that throws on write never crashes the caller', () => {
    const throwing = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded');
      },
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    } as Storage;
    expect(() => saveLog([game('a')], throwing)).not.toThrow();
  });
});
