import { beforeAll, describe, expect, it } from 'vitest';
import { analyse, legalMoves, EngineError, initEngine } from './wrapper.js';
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
