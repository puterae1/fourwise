import { describe, expect, it } from 'vitest';
import { translateColumn, translateScore } from './verdict.js';
import type { Seat } from './seat.js';
import type { ColumnEval } from '../engine/types.js';

const RED_FIRST_USER_RED: Seat = { firstMover: 'red', userColour: 'red' };
const RED_FIRST_USER_YELLOW: Seat = { firstMover: 'red', userColour: 'yellow' };

describe('translateScore', () => {
  it('reports a draw with no distance when the score is zero', () => {
    const verdict = translateScore(0, 6, 'first', RED_FIRST_USER_RED);
    expect(verdict).toEqual({ kind: 'draw', distance: null, sentence: 'draw' });
  });

  it('an empty-board first-player-win scores the user a win when the user moves first', () => {
    // ply 0, sideToMove 'first', score +1 (the known empty-board result,
    // ENGINE.md "Correctness"): winner is 'first', has played 0 stones so
    // far, so distance = 22 - 1 - 0 = 21.
    const verdict = translateScore(1, 0, 'first', RED_FIRST_USER_RED);
    expect(verdict.kind).toBe('win');
    expect(verdict.distance).toBe(21);
    expect(verdict.sentence).toBe('you win in 21 moves');
  });

  it('the same score is a loss for a user who is not moving first', () => {
    const verdict = translateScore(1, 0, 'first', RED_FIRST_USER_YELLOW);
    expect(verdict.kind).toBe('loss');
    expect(verdict.distance).toBe(21);
    expect(verdict.sentence).toBe('the opponent wins in 21 moves');
  });

  it('singularises a one-move distance', () => {
    // score 21 at ply 0: winner ('first') has played 0 stones, total stones
    // winner will play = 22 - 21 = 1, so distance = 1.
    const verdict = translateScore(21, 0, 'first', RED_FIRST_USER_RED);
    expect(verdict.distance).toBe(1);
    expect(verdict.sentence).toBe('you win in 1 move');
  });

  it('a negative score for the mover means the OTHER side wins', () => {
    // ply 3, sideToMove 'second' (odd ply), score -5: the mover ('second')
    // loses, so the winner is 'first'. 'first' has already played
    // ceil(3/2) = 2 stones among the first 3 plies. Total stones winner will
    // play = 22 - 5 = 17, so distance = 17 - 2 = 15.
    const verdict = translateScore(-5, 3, 'second', RED_FIRST_USER_RED);
    expect(verdict.distance).toBe(15);
    // firstMover is red, user is red -> user IS 'first' -> user wins.
    expect(verdict.kind).toBe('win');
  });
});

describe('translateColumn', () => {
  const seat = RED_FIRST_USER_RED;

  it('passes a full column through untranslated', () => {
    const column: ColumnEval = { kind: 'full' };
    expect(translateColumn(column, 4, 'first', seat)).toEqual({ kind: 'full' });
  });

  it('passes an unsolved column through untranslated -- never guesses', () => {
    const column: ColumnEval = { kind: 'unknown' };
    expect(translateColumn(column, 4, 'first', seat)).toEqual({ kind: 'unknown' });
  });

  it('translates a scored column into a verdict', () => {
    const column: ColumnEval = { kind: 'score', score: 7 };
    const translated = translateColumn(column, 4, 'first', seat);
    expect(translated.kind).toBe('score');
    if (translated.kind === 'score') {
      expect(translated.verdict.kind).toBe('win');
      expect(translated.verdict.distance).toBe(13);
    }
  });
});
