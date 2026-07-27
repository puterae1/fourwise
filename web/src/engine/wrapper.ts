// Typed wrapper over the generated `pkg/` bindings.
//
// This is the ONLY place that is allowed to know the wasm boundary produces
// `undefined` instead of `null`, or `Uint32Array` instead of `number[]`. See
// `docs/ENGINE.md` "Boundary mechanics" (2026-07-28). Nothing downstream of
// this file may ever see `undefined`, a `Uint32Array`, or the raw wasm
// exception shape.

import initWasm, {
  analyse as wasmAnalyse,
  legal_moves as wasmLegalMoves,
  type InitInput,
} from './pkg/connect4_engine.js';
import type { AnalysisResult, ColumnEval } from './types.js';

/**
 * Thrown for every error that crosses the wasm boundary — invalid position
 * strings, malformed shapes coming back from the engine, or an `analyse`/
 * `legalMoves` call made before `initEngine` resolved. The message is always
 * human-readable; per `docs/SPEC.md` §6 nothing here is ever a generic
 * "Invalid position".
 */
export class EngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineError';
  }
}

let initPromise: Promise<void> | null = null;

/**
 * Initialises the single wasm instance. Idempotent: calling it more than
 * once returns the same in-flight/settled promise rather than re-instantiating.
 *
 * `input` is passed straight to the generated `default` export. In the
 * browser, omit it and the module fetches its own `.wasm` file relative to
 * itself. In Node (tests), pass wasm bytes directly:
 * `initEngine({ module_or_path: readFileSync(wasmPath) })`.
 */
export function initEngine(
  input?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>,
): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      try {
        await initWasm(input);
      } catch (err) {
        initPromise = null;
        throw new EngineError(`Engine failed to initialise: ${describe(err)}`);
      }
    })();
  }
  return initPromise;
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function validateColumnEval(raw: unknown, index: number): ColumnEval {
  if (!isPlainObject(raw) || typeof raw.kind !== 'string') {
    throw new EngineError(
      `Engine returned a malformed column entry at index ${index}: ${JSON.stringify(raw)}`,
    );
  }
  switch (raw.kind) {
    case 'score':
      if (typeof raw.score !== 'number') {
        throw new EngineError(
          `Engine returned a 'score' column at index ${index} with no numeric score: ${JSON.stringify(raw)}`,
        );
      }
      return { kind: 'score', score: raw.score };
    case 'full':
      return { kind: 'full' };
    case 'unknown':
      return { kind: 'unknown' };
    default:
      throw new EngineError(
        `Engine returned an unrecognised column kind '${raw.kind}' at index ${index}`,
      );
  }
}

function validateAnalysisResult(raw: unknown): AnalysisResult {
  if (!isPlainObject(raw)) {
    throw new EngineError(`Engine returned a non-object analysis result: ${JSON.stringify(raw)}`);
  }

  const { columns, best, complete, sideToMove, threats, nodes } = raw;

  if (!Array.isArray(columns) || columns.length !== 7) {
    throw new EngineError(
      `Engine returned ${Array.isArray(columns) ? columns.length : 'a non-array'} columns instead of 7`,
    );
  }
  const validatedColumns = columns.map((c, i) => validateColumnEval(c, i));

  // Boundary mechanics (2026-07-28): `best` arrives as `undefined` when
  // absent (serde `None` -> `undefined`). Normalise to `null` here — nothing
  // downstream may ever see `undefined`.
  let normalisedBest: number | null;
  if (best === undefined || best === null) {
    normalisedBest = null;
  } else if (typeof best === 'number') {
    normalisedBest = best;
  } else {
    throw new EngineError(`Engine returned a non-numeric 'best': ${JSON.stringify(best)}`);
  }

  if (typeof complete !== 'boolean') {
    throw new EngineError(`Engine returned a non-boolean 'complete': ${JSON.stringify(complete)}`);
  }

  if (sideToMove !== 'first' && sideToMove !== 'second') {
    throw new EngineError(`Engine returned an unrecognised 'sideToMove': ${JSON.stringify(sideToMove)}`);
  }

  if (!isPlainObject(threats) || !Array.isArray(threats.current) || !Array.isArray(threats.opponent)) {
    throw new EngineError(`Engine returned a malformed 'threats' field: ${JSON.stringify(threats)}`);
  }

  if (typeof nodes !== 'number') {
    throw new EngineError(`Engine returned a non-numeric 'nodes': ${JSON.stringify(nodes)}`);
  }

  return {
    columns: validatedColumns,
    best: normalisedBest,
    complete,
    sideToMove,
    threats: {
      current: threats.current as number[],
      opponent: threats.opponent as number[],
    },
    nodes,
  };
}

/**
 * Analyses a position up to `nodeBudget` nodes. Node budgets, never
 * milliseconds — see `docs/ENGINE.md` "Budgeted analysis". Columns still
 * unsolved when the budget runs out report `kind: 'unknown'`; render that
 * honestly, never as a score or a blank (`docs/SPEC.md` §6).
 *
 * Throws `EngineError` for an invalid position string (the engine's own
 * message is preserved) or if the engine returns a shape this wrapper does
 * not recognise.
 */
export function analyse(position: string, nodeBudget: number): AnalysisResult {
  let raw: unknown;
  try {
    raw = wasmAnalyse(position, nodeBudget);
  } catch (err) {
    throw new EngineError(describe(err));
  }
  return validateAnalysisResult(raw);
}

/** Legal (non-full) columns for `position`, 0-indexed, ascending. */
export function legalMoves(position: string): number[] {
  let raw: Uint32Array;
  try {
    raw = wasmLegalMoves(position);
  } catch (err) {
    throw new EngineError(describe(err));
  }
  return Array.from(raw);
}
