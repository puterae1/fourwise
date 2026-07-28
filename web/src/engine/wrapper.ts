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
  load_book as wasmLoadBook,
  set_book_enabled as wasmSetBookEnabled,
  tactical_fallback as wasmTacticalFallback,
  type InitInput,
} from './pkg/connect4_engine.js';
import type { AnalysisResult, BookLoadResult, ColumnEval, TacticalAnalysis, TacticalEval } from './types.js';

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

function validateBookLoadResult(raw: unknown): BookLoadResult {
  if (!isPlainObject(raw)) {
    throw new EngineError(`Engine returned a non-object book-load result: ${JSON.stringify(raw)}`);
  }
  const { ok, entries, depth, error } = raw;
  if (typeof ok !== 'boolean') {
    throw new EngineError(`Engine returned a non-boolean 'ok' from load_book: ${JSON.stringify(ok)}`);
  }
  if (typeof entries !== 'number') {
    throw new EngineError(`Engine returned a non-numeric 'entries' from load_book: ${JSON.stringify(entries)}`);
  }
  if (typeof depth !== 'number') {
    throw new EngineError(`Engine returned a non-numeric 'depth' from load_book: ${JSON.stringify(depth)}`);
  }
  // Boundary mechanics (ENGINE.md, same rule as `AnalysisResult.best`):
  // `error` arrives as `undefined` when `ok` is `true` -- normalise to
  // `null` here so nothing downstream ever sees `undefined`.
  let normalisedError: string | null;
  if (error === undefined || error === null) {
    normalisedError = null;
  } else if (typeof error === 'string') {
    normalisedError = error;
  } else {
    throw new EngineError(`Engine returned a non-string 'error' from load_book: ${JSON.stringify(error)}`);
  }
  return { ok, entries, depth, error: normalisedError };
}

/**
 * Hands opening-book bytes to the engine's loader. Per `docs/ENGINE.md`, a
 * corrupt or invalid book is NEVER a thrown error -- it comes back as
 * `ok: false` here, and callers must fall back to plain search silently
 * (SPEC §6: no placeholder data -- a failed load is never dressed up as a
 * successful one, but it is also never a user-visible error). The `Result`
 * channel this wraps exists only for the (unreachable in practice)
 * result-serialisation failure, exactly like `analyse`'s.
 */
export function loadBook(bytes: Uint8Array): BookLoadResult {
  let raw: unknown;
  try {
    raw = wasmLoadBook(bytes);
  } catch (err) {
    throw new EngineError(describe(err));
  }
  return validateBookLoadResult(raw);
}

/**
 * The permanent book-disabled flag (ENGINE.md): once set `false`, every
 * subsequent book lookup misses regardless of any later `loadBook` call,
 * until this is called again with `true`. Exists so the tactical-fallback
 * and plain-search paths can be exercised deliberately.
 */
export function setBookEnabled(enabled: boolean): void {
  wasmSetBookEnabled(enabled);
}

function validateTacticalEval(raw: unknown, index: number): TacticalEval {
  if (!isPlainObject(raw) || typeof raw.kind !== 'string') {
    throw new EngineError(
      `Engine returned a malformed tactical column entry at index ${index}: ${JSON.stringify(raw)}`,
    );
  }
  switch (raw.kind) {
    case 'score':
      if (typeof raw.score !== 'number') {
        throw new EngineError(
          `Engine returned a 'score' tactical column at index ${index} with no numeric score: ${JSON.stringify(raw)}`,
        );
      }
      return { kind: 'score', score: raw.score };
    case 'full':
      return { kind: 'full' };
    default:
      throw new EngineError(
        `Engine returned an unrecognised tactical column kind '${raw.kind}' at index ${index}`,
      );
  }
}

function validateTacticalAnalysis(raw: unknown): TacticalAnalysis {
  if (!isPlainObject(raw)) {
    throw new EngineError(`Engine returned a non-object tactical-fallback result: ${JSON.stringify(raw)}`);
  }
  const { columns, best } = raw;
  if (!Array.isArray(columns) || columns.length !== 7) {
    throw new EngineError(
      `Engine returned ${Array.isArray(columns) ? columns.length : 'a non-array'} tactical columns instead of 7`,
    );
  }
  const validatedColumns = columns.map((c, i) => validateTacticalEval(c, i));

  let normalisedBest: number | null;
  if (best === undefined || best === null) {
    normalisedBest = null;
  } else if (typeof best === 'number') {
    normalisedBest = best;
  } else {
    throw new EngineError(`Engine returned a non-numeric tactical 'best': ${JSON.stringify(best)}`);
  }

  return { columns: validatedColumns, best: normalisedBest };
}

/**
 * `docs/SPEC.md` §3.1's post-gate amendment: a COMPLETE search bounded by
 * ply distance (never a node budget) for the game layer to call on cap
 * expiry, instead of choosing among a partial deep search's unevenly-solved
 * columns. `maxPly` plies are searched FROM EACH CHILD (ENGINE.md's "Horizon
 * convention" pin) -- callers get `maxPly + 1` total plies of information
 * from `position`. Never reports `'unknown'`: every legal column resolves to
 * `full` or an exact (possibly honest-horizon-draw) `score`.
 */
export function tacticalFallback(position: string, maxPly: number): TacticalAnalysis {
  let raw: unknown;
  try {
    raw = wasmTacticalFallback(position, maxPly);
  } catch (err) {
    throw new EngineError(describe(err));
  }
  return validateTacticalAnalysis(raw);
}
