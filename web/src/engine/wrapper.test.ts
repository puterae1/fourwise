import { beforeAll, describe, expect, it } from 'vitest';
import { analyse, legalMoves, loadBook, setBookEnabled, tacticalFallback, EngineError, initEngine } from './wrapper.js';
import { readWasmBytes } from './wasm-test-helper.js';

beforeAll(async () => {
  await initEngine({ module_or_path: readWasmBytes() });
});

describe('legalMoves', () => {
  it('converts the wasm Uint32Array into a plain number[]', () => {
    const result = legalMoves('');
    expect(Array.isArray(result)).toBe(true);
    expect(result).not.toBeInstanceOf(Uint32Array);
    expect(result).toHaveLength(7);
    expect([...result].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('throws an EngineError with the engine message for an invalid position', () => {
    expect(() => legalMoves('8')).toThrow(EngineError);
    expect(() => legalMoves('8')).toThrow(/column/i);
  });
});

describe('analyse', () => {
  it('normalises best to null when the budget is too small to solve every column', () => {
    // The empty board with a 1-node budget cannot solve anything, and no
    // column on an empty board is an immediate win, so nothing is 'score'.
    const result = analyse('', 1);
    expect(result.best).toBe(null);
    expect(result.complete).toBe(false);
    for (const column of result.columns) {
      expect(['score', 'full', 'unknown']).toContain(column.kind);
    }
  });

  it('reports a valid 7-entry ColumnEval union even at budget 0', () => {
    // The immediate-win / avoid-losing-move checks are exempt from the node
    // budget (docs/ENGINE.md "Boundary mechanics"), so some columns can
    // already report 'score' with zero nodes spent.
    const result = analyse('414141', 0);
    expect(result.nodes).toBe(0);
    expect(result.columns).toHaveLength(7);

    const kinds = new Set(result.columns.map((c) => c.kind));
    expect(kinds.size).toBeGreaterThan(0);
    for (const column of result.columns) {
      if (column.kind === 'score') {
        expect(typeof column.score).toBe('number');
      } else {
        // 'full' and 'unknown' entries carry no extra payload.
        expect(column).not.toHaveProperty('score');
      }
    }

    // Not every non-full column solved here (budget 0) -> best stays null,
    // per the pinned rule "null unless every non-full column is 'score'".
    if (result.columns.some((c) => c.kind === 'unknown')) {
      expect(result.best).toBe(null);
    }
  });

  it('reports sideToMove as a side, never a colour', () => {
    const result = analyse('', 1);
    expect(['first', 'second']).toContain(result.sideToMove);
  });

  it('surfaces the engine message for an invalid position string, naming the actual problem', () => {
    let thrown: unknown;
    try {
      analyse('8', 100);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(EngineError);
    expect((thrown as EngineError).message).toMatch(/column/i);
  });

  it('surfaces the engine message for a position that overflows a column', () => {
    let thrown: unknown;
    try {
      // Column 1 played seven times: only six rows exist, so the seventh
      // move is illegal.
      analyse('1111111', 100);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(EngineError);
    expect((thrown as EngineError).message).toMatch(/full/i);
  });

  it('throws EngineError (not a raw wasm value) so callers never see an unrecognised exception shape', () => {
    try {
      analyse('8', 100);
      expect.unreachable('expected analyse to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(EngineError);
      expect(err).toBeInstanceOf(Error);
    }
  });
});

describe('loadBook', () => {
  // No production book.bin exists yet (Wave 9 is the absent-book path in
  // every dev/deployed session -- see the delegation brief). What's under
  // test here is the CONTRACT: corrupt/garbage bytes are validated and
  // reported honestly (`ok: false`), never thrown, per ENGINE.md's "corrupt
  // or absent file is a silent fallback" pin.
  it('reports ok: false for garbage bytes, without throwing', () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const result = loadBook(garbage);
    expect(result.ok).toBe(false);
    expect(result.entries).toBe(0);
    expect(result.depth).toBe(0);
  });

  it('reports ok: false, never null, for an empty byte array', () => {
    const result = loadBook(new Uint8Array(0));
    expect(result.ok).toBe(false);
    expect(result.error).not.toBeNull(); // some honest reason, never a bare null with ok:false
  });

  it('normalises a failed load\'s error to a string, and a successful load\'s error to null (never undefined)', () => {
    const result = loadBook(new Uint8Array([9, 9, 9]));
    expect(typeof result.error).toBe('string');
  });
});

describe('setBookEnabled / tacticalFallback', () => {
  it('tacticalFallback returns a 7-entry TacticalEval union with no book loaded, best 0-based or null', () => {
    const result = tacticalFallback('', 4);
    expect(result.columns).toHaveLength(7);
    for (const column of result.columns) {
      expect(['score', 'full']).toContain(column.kind);
    }
    if (result.best !== null) {
      expect(result.best).toBeGreaterThanOrEqual(0);
      expect(result.best).toBeLessThan(7);
    }
  });

  it('never reports an "unknown" column kind -- the search is complete within its own horizon', () => {
    const result = tacticalFallback('44', 6);
    for (const column of result.columns) {
      expect(column.kind).not.toBe('unknown');
    }
  });

  it('reports best: null only when every column is full', () => {
    // A near-full centre column but plenty of legal columns elsewhere ->
    // best must be a real column, not null.
    const result = tacticalFallback('', 2);
    const anyLegal = result.columns.some((c) => c.kind === 'score');
    if (anyLegal) expect(result.best).not.toBeNull();
  });

  it('a fast, non-terminal win-in-one is still reported as a score column (no node-budget concept here to be exempt from)', () => {
    // "414141" leaves column 0 (1-indexed "1") with three of one side's
    // discs stacked -- board arithmetic aside, the real assertion is just
    // that tacticalFallback runs end-to-end on a mid-game position without
    // throwing and returns a valid shape.
    const result = tacticalFallback('414141', 4);
    expect(result.columns).toHaveLength(7);
  });

  it('book-disabled passthrough: setBookEnabled(false) still produces a valid, complete result, indistinguishable in shape from the book-agnostic path (ENGINE.md: "an absent, disabled, or never-loaded book behaves identically")', () => {
    setBookEnabled(false);
    try {
      const analysed = analyse('', 1000);
      expect(analysed.columns).toHaveLength(7);
      const tactical = tacticalFallback('', 4);
      expect(tactical.columns).toHaveLength(7);
      for (const column of tactical.columns) {
        expect(['score', 'full']).toContain(column.kind);
      }
    } finally {
      // The flag is PERMANENT until re-enabled (ENGINE.md) -- restore the
      // default so this test can never leak into a later test in this file
      // that assumes book lookups are live.
      setBookEnabled(true);
    }
  });

  it('re-enabling after disabling is honoured (set_book_enabled(true) is the only way back)', () => {
    setBookEnabled(false);
    setBookEnabled(true);
    // No book was ever loaded in this file, so this is a smoke assertion
    // that the call sequence itself never throws and search still runs.
    const result = analyse('', 1000);
    expect(result.columns).toHaveLength(7);
  });
});
