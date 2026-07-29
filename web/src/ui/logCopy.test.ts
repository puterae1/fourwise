import { describe, expect, it } from 'vitest';
import {
  loggedGameDateLabel,
  loggedGameMoveCountClause,
  loggedGameOpponentLabel,
  loggedGameProvenanceLabel,
  loggedGameResultLine,
  loggedGameSeatLine,
  reviewSeatSentence,
} from './logCopy.js';
import type { Seat } from '../game/seat.js';

describe('loggedGameDateLabel (design §16.2)', () => {
  it('omits the year when the date falls within the reference year', () => {
    expect(loggedGameDateLabel('2026-07-29T00:00:00.000Z', new Date('2026-01-01T00:00:00.000Z'))).toBe('29 Jul');
  });

  it('includes the year when the date is from an earlier year', () => {
    expect(loggedGameDateLabel('2025-07-27T00:00:00.000Z', new Date('2026-01-01T00:00:00.000Z'))).toBe('27 Jul 2025');
  });

  it('falls back to the raw string for an unparseable date -- never throws, never "Invalid Date"', () => {
    expect(loggedGameDateLabel('not-a-date')).toBe('not-a-date');
  });
});

describe('loggedGameOpponentLabel (R9: never a guessed name)', () => {
  it('returns the label verbatim when present', () => {
    expect(loggedGameOpponentLabel('Anna')).toBe('Anna');
  });

  it('returns "Unlabelled" for an empty or whitespace-only label', () => {
    expect(loggedGameOpponentLabel('')).toBe('Unlabelled');
    expect(loggedGameOpponentLabel('   ')).toBe('Unlabelled');
  });
});

describe('loggedGameSeatLine (R8: colour never implies order)', () => {
  it('states both facts, in words, for all four seat combinations', () => {
    const cases: Array<{ seat: Seat; expected: string }> = [
      { seat: { firstMover: 'yellow', userColour: 'red' }, expected: 'You were red · she moved first' },
      { seat: { firstMover: 'red', userColour: 'red' }, expected: 'You were red · you moved first' },
      { seat: { firstMover: 'red', userColour: 'yellow' }, expected: 'You were yellow · she moved first' },
      { seat: { firstMover: 'yellow', userColour: 'yellow' }, expected: 'You were yellow · you moved first' },
    ];
    for (const { seat, expected } of cases) {
      expect(loggedGameSeatLine(seat)).toBe(expected);
    }
  });
});

describe('loggedGameResultLine (seat-derived, never "Red won")', () => {
  it('phrases every result from the user\'s seat', () => {
    expect(loggedGameResultLine('win')).toBe('You won');
    expect(loggedGameResultLine('loss')).toBe('She won');
    expect(loggedGameResultLine('draw')).toBe('Drawn');
  });
});

describe('loggedGameMoveCountClause (a length, never "in N")', () => {
  it('pluralises correctly', () => {
    expect(loggedGameMoveCountClause(1)).toBe('· 1 move');
    expect(loggedGameMoveCountClause(27)).toBe('· 27 moves');
    expect(loggedGameMoveCountClause(0)).toBe('· 0 moves');
  });
});

describe('loggedGameProvenanceLabel (both states always labelled)', () => {
  it('labels live and reconstructed distinctly, with the numeric discount stated', () => {
    expect(loggedGameProvenanceLabel('live')).toBe('LIVE');
    expect(loggedGameProvenanceLabel('reconstructed')).toBe('RECONSTRUCTED · COUNTS HALF');
  });
});

describe('reviewSeatSentence (design §17.1, R8: colour never implies order)', () => {
  it('states both facts, in two plain sentences, for all four seat combinations', () => {
    const cases: Array<{ seat: Seat; expected: string }> = [
      { seat: { firstMover: 'yellow', userColour: 'red' }, expected: 'You were red. She moved first.' },
      { seat: { firstMover: 'red', userColour: 'yellow' }, expected: 'You were yellow. She moved first.' },
      { seat: { firstMover: 'red', userColour: 'red' }, expected: 'You were red. You moved first.' },
      { seat: { firstMover: 'yellow', userColour: 'yellow' }, expected: 'You were yellow. You moved first.' },
    ];
    for (const { seat, expected } of cases) {
      expect(reviewSeatSentence(seat)).toBe(expected);
    }
  });
});
