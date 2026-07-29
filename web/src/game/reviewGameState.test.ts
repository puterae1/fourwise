import { describe, expect, it } from 'vitest';
import { loggedGameStateAt } from './reviewGameState.js';
import { enginePosition, absolutePly, colourToMove } from './gameState.js';
import { buildLoggedGame } from './loggedGame.js';
import type { Seat } from './seat.js';

const RED_FIRST_USER_YELLOW: Seat = { firstMover: 'red', userColour: 'yellow' };

describe('loggedGameStateAt', () => {
  it('produces a GameState whose engine position/ply/mover match the LoggedGame at the given ply', () => {
    const game = buildLoggedGame({
      seat: RED_FIRST_USER_YELLOW,
      moves: [3, 0, 3, 1, 3, 2],
      winner: 'red',
      opponent: 'Anna',
      source: 'live',
      id: 'g1',
      date: '2026-07-29T00:00:00.000Z',
    });

    const atStart = loggedGameStateAt(game, 0);
    expect(enginePosition(atStart)).toBe('');
    expect(absolutePly(atStart)).toBe(0);
    expect(colourToMove(atStart)).toBe('red'); // firstMover

    const atThree = loggedGameStateAt(game, 3);
    expect(enginePosition(atThree)).toBe('414'); // moves [3,0,3] -> 1-indexed digits 4,1,4
    expect(absolutePly(atThree)).toBe(3);
    expect(colourToMove(atThree)).toBe('yellow'); // ply 3 is odd -> otherColour(firstMover)

    const atEnd = loggedGameStateAt(game, 6);
    expect(enginePosition(atEnd)).toBe('414243'); // full move list, 1-indexed digits
  });

  it('carries the LoggedGame\'s own seat unchanged, independent of any other seat', () => {
    const game = buildLoggedGame({
      seat: RED_FIRST_USER_YELLOW,
      moves: [0],
      winner: null,
      opponent: '',
      source: 'reconstructed',
      id: 'g2',
      date: '2026-07-29T00:00:00.000Z',
    });
    const state = loggedGameStateAt(game, 1);
    expect(state.seat).toEqual(RED_FIRST_USER_YELLOW);
    expect(state.setupPrefix).toBe('');
  });
});
