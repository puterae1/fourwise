import { describe, expect, it } from 'vitest';
import { gameFloorStatus, GAME_FLOOR } from './gameFloor.js';
import type { LoggedGame } from '../game/loggedGame.js';

function stubGame(opponent: string, source: LoggedGame['source'] = 'live'): LoggedGame {
  return {
    id: `${opponent}-${Math.random()}`,
    date: '2026-01-01T00:00:00.000Z',
    opponent,
    seat: { firstMover: 'red', userColour: 'red' },
    moves: [3],
    result: 'loss',
    source,
  };
}

describe('gameFloorStatus', () => {
  it('GAME_FLOOR is 20 (docs/OPPONENT-MODEL.md "below 20 logged games")', () => {
    expect(GAME_FLOOR).toBe(20);
  });

  it('empty log: count 0, not met, remaining 20', () => {
    const status = gameFloorStatus([], 'her');
    expect(status).toEqual({ count: 0, floor: 20, met: false, remaining: 20 });
  });

  it('19 games for the label: not met, remaining 1', () => {
    const games = Array.from({ length: 19 }, () => stubGame('her'));
    const status = gameFloorStatus(games, 'her');
    expect(status).toEqual({ count: 19, floor: 20, met: false, remaining: 1 });
  });

  it('exactly 20 games for the label: met, remaining 0', () => {
    const games = Array.from({ length: 20 }, () => stubGame('her'));
    const status = gameFloorStatus(games, 'her');
    expect(status).toEqual({ count: 20, floor: 20, met: true, remaining: 0 });
  });

  it('above 20: still met, remaining 0 (never negative)', () => {
    const games = Array.from({ length: 25 }, () => stubGame('her'));
    const status = gameFloorStatus(games, 'her');
    expect(status).toEqual({ count: 25, floor: 20, met: true, remaining: 0 });
  });

  it('counts WHOLE games regardless of provenance — reconstructed games count fully toward the floor (§19 ruling #1)', () => {
    const games = [
      ...Array.from({ length: 10 }, () => stubGame('her', 'live')),
      ...Array.from({ length: 10 }, () => stubGame('her', 'reconstructed')),
    ];
    const status = gameFloorStatus(games, 'her');
    expect(status).toEqual({ count: 20, floor: 20, met: true, remaining: 0 });
  });

  it('label isolation (PIN 4): another opponent\'s games never count toward this label\'s floor', () => {
    const games = [
      ...Array.from({ length: 5 }, () => stubGame('her')),
      ...Array.from({ length: 30 }, () => stubGame('someone else')),
    ];
    const status = gameFloorStatus(games, 'her');
    expect(status).toEqual({ count: 5, floor: 20, met: false, remaining: 15 });
  });
});
