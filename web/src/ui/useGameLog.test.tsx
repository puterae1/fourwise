// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useGameLog } from './useGameLog.js';
import { buildLoggedGame, type LoggedGame } from '../game/loggedGame.js';
import type { Seat } from '../game/seat.js';
import { installMemoryLocalStorage } from './testMemoryStorage.js';

installMemoryLocalStorage();

afterEach(() => {
  window.localStorage.clear();
});

const SEAT: Seat = { firstMover: 'red', userColour: 'yellow' };

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

describe('useGameLog', () => {
  it('starts empty on a fresh browser', () => {
    const { result } = renderHook(() => useGameLog());
    expect(result.current.games).toEqual([]);
  });

  it('addGame appends and persists', () => {
    const { result, unmount } = renderHook(() => useGameLog());
    act(() => result.current.addGame(game('a')));
    expect(result.current.games).toHaveLength(1);
    unmount();

    const { result: reloaded } = renderHook(() => useGameLog());
    expect(reloaded.current.games).toHaveLength(1);
    expect(reloaded.current.games[0]!.id).toBe('a');
  });

  it('mergeImported adds only NEW ids and returns the added count', () => {
    const { result } = renderHook(() => useGameLog());
    act(() => result.current.addGame(game('a')));

    let added = -1;
    act(() => {
      added = result.current.mergeImported([game('a'), game('b')]);
    });
    expect(added).toBe(1);
    expect(result.current.games.map((g) => g.id).sort()).toEqual(['a', 'b']);
  });

  it('mergeImported is idempotent -- importing the same batch twice never duplicates', () => {
    const { result } = renderHook(() => useGameLog());
    act(() => {
      result.current.mergeImported([game('a'), game('b')]);
    });
    act(() => {
      result.current.mergeImported([game('a'), game('b')]);
    });
    expect(result.current.games).toHaveLength(2);
  });
});
