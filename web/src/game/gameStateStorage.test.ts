import { describe, expect, it } from 'vitest';
import { createGame, playMove, type GameState } from './gameState.js';
import { deserialiseGameState, reconcileGameSeat, serialiseGameState } from './gameStateStorage.js';
import type { Seat } from './seat.js';

const SEAT: Seat = { firstMover: 'red', userColour: 'yellow' };

function play(state: GameState, column: number): GameState {
  const result = playMove(state, column);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

function playedGame(): GameState {
  let state = createGame(SEAT, 'play');
  state = play(state, 3);
  state = play(state, 2);
  return state;
}

describe('serialiseGameState / deserialiseGameState -- round trip', () => {
  it('restores an identical GameState for a fresh game', () => {
    const state = createGame(SEAT, 'play');
    const restored = deserialiseGameState(JSON.parse(JSON.stringify(serialiseGameState(state))));
    expect(restored).toEqual(state);
  });

  it('restores an identical GameState for a game with moves, undo applied, and a setup prefix', () => {
    const state: GameState = { seat: SEAT, mode: 'analyse', setupPrefix: '44', moves: [{ column: 2 }, { column: 3, partial: true }], currentPly: 1 };
    const restored = deserialiseGameState(JSON.parse(JSON.stringify(serialiseGameState(state))));
    expect(restored).toEqual(state);
  });

  it('round-trips a genuinely played game (not hand-built)', () => {
    const state = playedGame();
    const restored = deserialiseGameState(JSON.parse(JSON.stringify(serialiseGameState(state))));
    expect(restored).toEqual(state);
  });
});

describe('deserialiseGameState -- corrupt/invalid input never crashes, always null', () => {
  it('rejects a non-object', () => {
    expect(deserialiseGameState(null)).toBeNull();
    expect(deserialiseGameState('nonsense')).toBeNull();
    expect(deserialiseGameState(42)).toBeNull();
    expect(deserialiseGameState(undefined)).toBeNull();
  });

  it('rejects a missing seat', () => {
    const bad = { mode: 'play', setupPrefix: '', moves: [], currentPly: 0 };
    expect(deserialiseGameState(bad)).toBeNull();
  });

  it('rejects a seat with a non-colour value', () => {
    const bad = { seat: { firstMover: 'blue', userColour: 'red' }, mode: 'play', setupPrefix: '', moves: [], currentPly: 0 };
    expect(deserialiseGameState(bad)).toBeNull();
  });

  it('rejects an invalid mode', () => {
    const bad = { seat: SEAT, mode: 'freeplay', setupPrefix: '', moves: [], currentPly: 0 };
    expect(deserialiseGameState(bad)).toBeNull();
  });

  it('rejects a setupPrefix with a non-column character', () => {
    const bad = { seat: SEAT, mode: 'play', setupPrefix: '48', moves: [], currentPly: 0 };
    expect(deserialiseGameState(bad)).toBeNull();
  });

  it('rejects a moves array with a malformed entry', () => {
    const bad = { seat: SEAT, mode: 'play', setupPrefix: '', moves: [{ column: 'four' }], currentPly: 1 };
    expect(deserialiseGameState(bad)).toBeNull();
  });

  it('rejects a moves array with an out-of-range column', () => {
    const bad = { seat: SEAT, mode: 'play', setupPrefix: '', moves: [{ column: 7 }], currentPly: 1 };
    expect(deserialiseGameState(bad)).toBeNull();
  });

  it('rejects currentPly out of range (negative, or past the end of moves)', () => {
    expect(deserialiseGameState({ seat: SEAT, mode: 'play', setupPrefix: '', moves: [], currentPly: -1 })).toBeNull();
    expect(
      deserialiseGameState({ seat: SEAT, mode: 'play', setupPrefix: '', moves: [{ column: 0 }], currentPly: 5 }),
    ).toBeNull();
  });

  it('rejects an overfull column (seven discs in one column) -- would crash a live replay otherwise', () => {
    const moves = Array.from({ length: 7 }, () => ({ column: 3 }));
    const bad = { seat: SEAT, mode: 'play', setupPrefix: '', moves, currentPly: 7 };
    expect(deserialiseGameState(bad)).toBeNull();
  });

  it('rejects a setupPrefix that is itself already overfull, even with no live moves on top', () => {
    const bad = { seat: SEAT, mode: 'play', setupPrefix: '3333333', moves: [], currentPly: 0 };
    expect(deserialiseGameState(bad)).toBeNull();
  });
});

describe('reconcileGameSeat', () => {
  it('overrides the restored game\'s seat with the seat supplied, leaving everything else untouched', () => {
    const restored = playedGame();
    const newSeat: Seat = { firstMover: 'yellow', userColour: 'yellow' };
    const reconciled = reconcileGameSeat(restored, newSeat);
    expect(reconciled.seat).toEqual(newSeat);
    expect(reconciled.mode).toBe(restored.mode);
    expect(reconciled.setupPrefix).toBe(restored.setupPrefix);
    expect(reconciled.moves).toEqual(restored.moves);
    expect(reconciled.currentPly).toBe(restored.currentPly);
  });
});
