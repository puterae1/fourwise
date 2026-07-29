import { describe, expect, it } from 'vitest';
import { blunderSentence, reviewPlyContextLine, terminalOutcome } from './copy.js';
import type { Seat } from '../game/seat.js';

describe('blunderSentence', () => {
  it('phrases a win thrown away generically ("a win"), covering both win -> draw and win -> loss', () => {
    expect(blunderSentence('win', 3)).toBe('That threw away a win. Column 4 held it.');
  });

  it('phrases a draw thrown away distinctly (draw -> loss), never claiming a win existed', () => {
    expect(blunderSentence('draw', 6)).toBe('That threw away the draw. Column 7 held it.');
  });

  it('names the 1-indexed column', () => {
    expect(blunderSentence('win', 0)).toContain('Column 1 held it.');
  });
});

// SPEC.md §1's acceptance test shape, applied to `terminalOutcome`: one
// fixed game outcome (red won, human-controlled), fed through all four seat
// combinations, with hand-written (never derived from `terminalOutcome`
// itself) expected sentences/kinds per combo -- and the engine-facing input
// here (there is none; this function never touches the engine) stays
// trivially identical across all four, so the only thing under test is the
// TRANSLATION.
describe('terminalOutcome (SPEC §3.2 terminal-display amendment, SPEC §1 seat translation)', () => {
  it('red won, red is the user, red moved first -> "you won", kind win', () => {
    const seat: Seat = { firstMover: 'red', userColour: 'red' };
    expect(terminalOutcome(seat, 'red', 'human')).toEqual({ kind: 'win', sentence: 'Game over — you won.' });
  });

  it('red won, YELLOW is the user, red moved first -> "she won", kind loss (colour and turn order independent of the sentence)', () => {
    const seat: Seat = { firstMover: 'red', userColour: 'yellow' };
    expect(terminalOutcome(seat, 'red', 'human')).toEqual({ kind: 'loss', sentence: 'Game over — she won.' });
  });

  it('red won, red is the user, YELLOW moved first -> "you won" still, kind win (turn order never leaks into the sentence)', () => {
    const seat: Seat = { firstMover: 'yellow', userColour: 'red' };
    expect(terminalOutcome(seat, 'red', 'human')).toEqual({ kind: 'win', sentence: 'Game over — you won.' });
  });

  it('red won, YELLOW is the user, YELLOW moved first -> "she won", kind loss', () => {
    const seat: Seat = { firstMover: 'yellow', userColour: 'yellow' };
    expect(terminalOutcome(seat, 'red', 'human')).toEqual({ kind: 'loss', sentence: 'Game over — she won.' });
  });

  it('a draw is seat-independent: every combination reports the identical drawn sentence', () => {
    const combos: Seat[] = [
      { firstMover: 'red', userColour: 'red' },
      { firstMover: 'red', userColour: 'yellow' },
      { firstMover: 'yellow', userColour: 'red' },
      { firstMover: 'yellow', userColour: 'yellow' },
    ];
    for (const seat of combos) {
      expect(terminalOutcome(seat, null, 'human')).toEqual({ kind: 'draw', sentence: 'Game over — drawn.' });
    }
  });

  it('an engine-controlled winner is named "the engine", not "she", when the winner is not the user', () => {
    const seat: Seat = { firstMover: 'red', userColour: 'yellow' };
    expect(terminalOutcome(seat, 'red', 'engine')).toEqual({ kind: 'loss', sentence: 'Game over — the engine won.' });
  });

  it('winnerControl is irrelevant when the user themself is the winner -- always "you won", never "the engine"', () => {
    const seat: Seat = { firstMover: 'red', userColour: 'red' };
    expect(terminalOutcome(seat, 'red', 'engine')).toEqual({ kind: 'win', sentence: 'Game over — you won.' });
  });
});

describe('reviewPlyContextLine (design §17.1, seat-translated from the REVIEWED game\'s own seat)', () => {
  it('names the mover as "your move" when the mover is the user\'s own colour', () => {
    const seat: Seat = { firstMover: 'red', userColour: 'red' };
    expect(reviewPlyContextLine(14, 31, seat, 'red')).toBe('Ply 14 of 31 — your move.');
  });

  it('names the mover as "her move" when the mover is not the user\'s colour', () => {
    const seat: Seat = { firstMover: 'red', userColour: 'red' };
    expect(reviewPlyContextLine(14, 31, seat, 'yellow')).toBe('Ply 14 of 31 — her move.');
  });

  it('turn order never leaks in: the SAME mover colour reads "your move" regardless of who moves first', () => {
    const userFirst: Seat = { firstMover: 'yellow', userColour: 'yellow' };
    const userSecond: Seat = { firstMover: 'red', userColour: 'yellow' };
    expect(reviewPlyContextLine(5, 20, userFirst, 'yellow')).toBe('Ply 5 of 20 — your move.');
    expect(reviewPlyContextLine(5, 20, userSecond, 'yellow')).toBe('Ply 5 of 20 — your move.');
  });

  it('drops the mover clause entirely at a terminal position (mover null)', () => {
    const seat: Seat = { firstMover: 'red', userColour: 'red' };
    expect(reviewPlyContextLine(31, 31, seat, null)).toBe('Ply 31 of 31.');
  });
});
