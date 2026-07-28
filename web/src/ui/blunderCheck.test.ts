import { describe, expect, it } from 'vitest';
import { checkForBlunder } from './blunderCheck.js';

describe('checkForBlunder (UI wiring over game/blunder.ts, SPEC §3.2 amended Firing rule)', () => {
  it.each([
    ['win', 'draw'],
    ['draw', 'loss'],
    ['win', 'loss'],
  ] as const)('fires on a verdict drop from %s to %s and carries the before kind for copy', (before, after) => {
    const result = checkForBlunder({ evaluated: true, kind: before }, { evaluated: true, kind: after });
    expect(result.status).toBe('blunder');
    expect(result.beforeKind).toBe(before);
  });

  it('does not fire on a speed-only difference: the same verdict kind before and after (win-in-9 -> win-in-15) is indistinguishable from no change at this layer, by construction — BlunderInput carries no distance', () => {
    const result = checkForBlunder({ evaluated: true, kind: 'win' }, { evaluated: true, kind: 'win' });
    expect(result.status).toBe('ok');
  });

  it('does not fire when the verdict improves', () => {
    const result = checkForBlunder({ evaluated: true, kind: 'loss' }, { evaluated: true, kind: 'win' });
    expect(result.status).toBe('ok');
  });

  it('never fires from a partial ("not evaluated") comparison, whichever side is incomplete', () => {
    expect(checkForBlunder({ evaluated: false }, { evaluated: true, kind: 'loss' }).status).toBe('not-evaluated');
    expect(checkForBlunder({ evaluated: true, kind: 'win' }, { evaluated: false }).status).toBe('not-evaluated');
    expect(checkForBlunder({ evaluated: false }, { evaluated: false }).status).toBe('not-evaluated');
  });

  it('reports beforeKind as null when the before side was not evaluated -- never guessed', () => {
    const result = checkForBlunder({ evaluated: false }, { evaluated: true, kind: 'loss' });
    expect(result.beforeKind).toBeNull();
  });

  it('carries beforeKind even when the after side is the one missing (still "not evaluated" overall, but the before kind is known and not fabricated)', () => {
    const result = checkForBlunder({ evaluated: true, kind: 'win' }, { evaluated: false });
    expect(result.status).toBe('not-evaluated');
    expect(result.beforeKind).toBe('win');
  });
});
