import { describe, expect, it } from 'vitest';
import { compareForBlunder } from './blunder.js';

describe('compareForBlunder', () => {
  it.each([
    ['win', 'draw'],
    ['draw', 'loss'],
    ['win', 'loss'],
  ] as const)('flags a blunder when the verdict degrades from %s to %s', (before, after) => {
    const result = compareForBlunder({ evaluated: true, kind: before }, { evaluated: true, kind: after });
    expect(result.status).toBe('blunder');
  });

  it.each([
    ['win', 'win'],
    ['draw', 'draw'],
    ['loss', 'loss'],
    ['draw', 'win'],
    ['loss', 'draw'],
    ['loss', 'win'],
  ] as const)('does not flag %s -> %s', (before, after) => {
    const result = compareForBlunder({ evaluated: true, kind: before }, { evaluated: true, kind: after });
    expect(result.status).toBe('ok');
  });

  it('reports "not evaluated" rather than guessing when the "before" side is incomplete', () => {
    const result = compareForBlunder({ evaluated: false }, { evaluated: true, kind: 'loss' });
    expect(result.status).toBe('not-evaluated');
  });

  it('reports "not evaluated" rather than guessing when the "after" side is incomplete', () => {
    const result = compareForBlunder({ evaluated: true, kind: 'win' }, { evaluated: false });
    expect(result.status).toBe('not-evaluated');
  });

  it('reports "not evaluated" when both sides are incomplete', () => {
    const result = compareForBlunder({ evaluated: false }, { evaluated: false });
    expect(result.status).toBe('not-evaluated');
  });
});
