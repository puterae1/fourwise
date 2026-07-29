import { describe, expect, it } from 'vitest';
import {
  buildLoggedGame,
  generateGameId,
  mostRecentOpponentLabel,
  parseLoggedGameArray,
  parseLoggedGameMoves,
  resultFromSeat,
  validateLoggedGame,
  type LoggedGame,
} from './loggedGame.js';
import type { Seat } from './seat.js';

const RED_USER_YELLOW_FIRST: Seat = { firstMover: 'yellow', userColour: 'red' };

function legalMoves(): number[] {
  // A short legal Connect-4 opening, 0-indexed columns.
  return [3, 3, 2, 4];
}

describe('resultFromSeat (SPEC §1: result is derived from userColour, never from turn order)', () => {
  it('a draw (winner: null) is always "draw", regardless of seat', () => {
    expect(resultFromSeat(RED_USER_YELLOW_FIRST, null)).toBe('draw');
    expect(resultFromSeat({ firstMover: 'red', userColour: 'yellow' }, null)).toBe('draw');
  });

  it('the user\'s own colour winning is "win"', () => {
    expect(resultFromSeat(RED_USER_YELLOW_FIRST, 'red')).toBe('win');
  });

  it('the other colour winning is "loss"', () => {
    expect(resultFromSeat(RED_USER_YELLOW_FIRST, 'yellow')).toBe('loss');
  });

  it('all four seat combinations agree with userColour alone -- firstMover never enters the comparison', () => {
    const combos: Seat[] = [
      { firstMover: 'red', userColour: 'red' },
      { firstMover: 'red', userColour: 'yellow' },
      { firstMover: 'yellow', userColour: 'red' },
      { firstMover: 'yellow', userColour: 'yellow' },
    ];
    for (const seat of combos) {
      expect(resultFromSeat(seat, seat.userColour)).toBe('win');
      const other = seat.userColour === 'red' ? 'yellow' : 'red';
      expect(resultFromSeat(seat, other)).toBe('loss');
    }
  });
});

describe('generateGameId', () => {
  it('produces a non-empty string, and two calls never collide', () => {
    const a = generateGameId();
    const b = generateGameId();
    expect(a.length).toBeGreaterThan(0);
    expect(a).not.toBe(b);
  });
});

describe('buildLoggedGame', () => {
  it('builds a full LoggedGame record with a derived result and an injected id/date', () => {
    const game = buildLoggedGame({
      seat: RED_USER_YELLOW_FIRST,
      moves: legalMoves(),
      winner: 'red',
      opponent: 'Anna',
      source: 'live',
      id: 'fixed-id',
      date: '2026-07-29T00:00:00.000Z',
    });
    expect(game).toEqual({
      id: 'fixed-id',
      date: '2026-07-29T00:00:00.000Z',
      opponent: 'Anna',
      seat: RED_USER_YELLOW_FIRST,
      moves: legalMoves(),
      result: 'win',
      source: 'live',
    });
  });

  it('generates an id and a date when neither is supplied', () => {
    const game = buildLoggedGame({
      seat: RED_USER_YELLOW_FIRST,
      moves: legalMoves(),
      winner: null,
      opponent: '',
      source: 'reconstructed',
    });
    expect(game.id.length).toBeGreaterThan(0);
    expect(() => new Date(game.date).toISOString()).not.toThrow();
    expect(game.result).toBe('draw');
  });
});

describe('parseLoggedGameMoves', () => {
  it('accepts a plain array of in-range 0-indexed columns', () => {
    expect(parseLoggedGameMoves([0, 6, 3])).toEqual([0, 6, 3]);
  });

  it('rejects a non-array', () => {
    expect(parseLoggedGameMoves('nope')).toBeNull();
  });

  it('rejects an out-of-range column', () => {
    expect(parseLoggedGameMoves([0, 7])).toBeNull();
    expect(parseLoggedGameMoves([-1])).toBeNull();
  });

  it('rejects a non-integer entry', () => {
    expect(parseLoggedGameMoves([1.5])).toBeNull();
  });
});

function validLoggedGameLiteral(overrides: Partial<LoggedGame> = {}): unknown {
  return {
    id: 'abc',
    date: '2026-07-29T00:00:00.000Z',
    opponent: 'Anna',
    seat: RED_USER_YELLOW_FIRST,
    moves: legalMoves(),
    result: 'win',
    source: 'live',
    ...overrides,
  };
}

describe('validateLoggedGame -- honest, specific rejections (house pattern)', () => {
  it('accepts a well-formed record', () => {
    const result = validateLoggedGame(validLoggedGameLiteral(), 'Game 1');
    expect(typeof result).not.toBe('string');
  });

  it('rejects a non-object', () => {
    expect(validateLoggedGame(42, 'Game 1')).toBe('Game 1 is not a valid record.');
    expect(validateLoggedGame(null, 'Game 1')).toBe('Game 1 is not a valid record.');
  });

  it('rejects a missing/invalid id', () => {
    const result = validateLoggedGame(validLoggedGameLiteral({ id: '' }), 'Game 1');
    expect(result).toMatch(/valid id/i);
  });

  it('rejects a missing seat', () => {
    const literal = validLoggedGameLiteral();
    delete (literal as Record<string, unknown>).seat;
    expect(validateLoggedGame(literal, 'Game 1')).toMatch(/valid seat/i);
  });

  it('rejects an invalid move list', () => {
    const result = validateLoggedGame(validLoggedGameLiteral({ moves: [99] as unknown as number[] }), 'Game 1');
    expect(result).toMatch(/invalid move list/i);
  });

  it('rejects an invalid result', () => {
    const result = validateLoggedGame(
      validLoggedGameLiteral({ result: 'tie' as unknown as LoggedGame['result'] }),
      'Game 1',
    );
    expect(result).toMatch(/invalid result/i);
  });

  it('rejects an invalid source', () => {
    const result = validateLoggedGame(
      validLoggedGameLiteral({ source: 'imagined' as unknown as LoggedGame['source'] }),
      'Game 1',
    );
    expect(result).toMatch(/invalid source/i);
  });

  it('rejects a move list that cannot be legally replayed (an overfull column)', () => {
    const illegal = Array.from({ length: 7 }, () => 3);
    const result = validateLoggedGame(validLoggedGameLiteral({ moves: illegal }), 'Game 1');
    expect(result).toMatch(/legal game/i);
  });
});

describe('parseLoggedGameArray', () => {
  it('accepts an empty array', () => {
    expect(parseLoggedGameArray([])).toEqual([]);
  });

  it('rejects a non-array', () => {
    expect(parseLoggedGameArray('not an array')).toMatch(/list/i);
  });

  it('accepts multiple well-formed games', () => {
    const result = parseLoggedGameArray([validLoggedGameLiteral({ id: 'a' }), validLoggedGameLiteral({ id: 'b' })]);
    expect(Array.isArray(result)).toBe(true);
    if (typeof result === 'string') return;
    expect(result).toHaveLength(2);
  });

  it('fails the whole array on one bad entry -- never a half-accepted list', () => {
    const result = parseLoggedGameArray([validLoggedGameLiteral(), { garbage: true }]);
    expect(typeof result).toBe('string');
    expect(result).toMatch(/Logged game 2/);
  });
});

describe('mostRecentOpponentLabel', () => {
  it('returns "" for an empty log', () => {
    expect(mostRecentOpponentLabel([])).toBe('');
  });

  it('returns the label of the game with the latest date', () => {
    const earlier: LoggedGame = validLoggedGameLiteral({ id: '1', date: '2026-07-20T00:00:00.000Z', opponent: 'Old' }) as LoggedGame;
    const later: LoggedGame = validLoggedGameLiteral({ id: '2', date: '2026-07-29T00:00:00.000Z', opponent: 'New' }) as LoggedGame;
    expect(mostRecentOpponentLabel([earlier, later])).toBe('New');
    expect(mostRecentOpponentLabel([later, earlier])).toBe('New');
  });
});
