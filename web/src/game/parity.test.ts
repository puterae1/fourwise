import { describe, expect, it } from 'vitest';
import { parityRows } from './parity.js';

describe('parityRows (SPEC §2)', () => {
  it('gives the user the odd rows when the user moves first', () => {
    const rows = parityRows(true);
    expect(rows.user).toEqual([1, 3, 5]);
    expect(rows.opponent).toEqual([2, 4, 6]);
  });

  it('gives the user the even rows when the user moves second', () => {
    const rows = parityRows(false);
    expect(rows.user).toEqual([2, 4, 6]);
    expect(rows.opponent).toEqual([1, 3, 5]);
  });

  it('user and opponent rows are always disjoint and cover every row exactly once', () => {
    for (const userMovesFirst of [true, false]) {
      const rows = parityRows(userMovesFirst);
      const all = [...rows.user, ...rows.opponent].sort((a, b) => a - b);
      expect(all).toEqual([1, 2, 3, 4, 5, 6]);
    }
  });
});
