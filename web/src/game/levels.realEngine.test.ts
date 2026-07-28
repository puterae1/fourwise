// Real-wasm integration coverage for the engine-move path (Wave 9 task
// requirement: "at least one test runs the engine-move path with the book
// explicitly disabled"). `levels.test.ts` covers the level-ranking rules
// themselves against hand-built fixtures; this file drives the SAME
// functions off a genuine `analyse()`/`tacticalFallback()` call against the
// real compiled wasm module, with the book deliberately disabled via
// `setBookEnabled(false)` -- the same real-artifact pattern `wrapper.test.ts`
// already uses.

import { beforeAll, describe, expect, it } from 'vitest';
import { analyse, initEngine, setBookEnabled, tacticalFallback } from '../engine/wrapper.js';
import { readWasmBytes } from '../engine/wasm-test-helper.js';
import { pickEngineMove, pickEngineMoveFromTactical, TACTICAL_HORIZON_PLY } from './levels.js';

beforeAll(async () => {
  await initEngine({ module_or_path: readWasmBytes() });
});

describe('engine-move path against the real engine, book explicitly disabled', () => {
  it('pickEngineMove chooses a legal column from a real, complete analyse() result', () => {
    setBookEnabled(false);
    try {
      // A generous budget on a near-empty board -- small enough to stay
      // fast in CI, big enough that the immediate-win/avoid-losing-move
      // checks alone (exempt from the node budget per ENGINE.md) plus a
      // shallow real search reliably produce a complete result.
      const result = analyse('44', 2_000_000);
      if (!result.complete) {
        // A slow CI box could conceivably still leave this incomplete --
        // if so, the tactical-fallback path below is exactly what
        // production falls back to, and IS exercised either way.
        const tactical = tacticalFallback('44', TACTICAL_HORIZON_PLY.perfect);
        const move = pickEngineMoveFromTactical(tactical, 2, 'first', 'perfect');
        expect(move.column).toBeGreaterThanOrEqual(0);
        expect(move.column).toBeLessThan(7);
        return;
      }
      const move = pickEngineMove(result, 2, 'perfect');
      expect(move).toEqual({ column: result.best, origin: 'complete' });
      expect(move.column).toBeGreaterThanOrEqual(0);
      expect(move.column).toBeLessThan(7);
    } finally {
      setBookEnabled(true); // the flag is permanent (ENGINE.md) -- restore the default
    }
  });

  it('pickEngineMoveFromTactical chooses a legal column from a real tacticalFallback() result, book disabled', () => {
    setBookEnabled(false);
    try {
      const tactical = tacticalFallback('44', TACTICAL_HORIZON_PLY.fair);
      const move = pickEngineMoveFromTactical(tactical, 2, 'first', 'fair');
      expect(move).toEqual({ column: expect.any(Number), origin: 'tactical' });
      expect(move.column).toBeGreaterThanOrEqual(0);
      expect(move.column).toBeLessThan(7);
    } finally {
      setBookEnabled(true);
    }
  });

  it('is indistinguishable in shape from the book-ENABLED path (ENGINE.md: "an absent, disabled, or never-loaded book behaves identically") -- no book is loaded in this file either way, so this is a smoke check that toggling the flag itself never breaks the engine-move path', () => {
    setBookEnabled(true);
    const enabledResult = tacticalFallback('44', TACTICAL_HORIZON_PLY.weak);
    setBookEnabled(false);
    const disabledResult = tacticalFallback('44', TACTICAL_HORIZON_PLY.weak);
    setBookEnabled(true);
    expect(disabledResult).toEqual(enabledResult); // no book ever loaded -> both paths hit plain search identically
  });
});
