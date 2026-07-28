// Types for the WASM engine boundary. Verbatim from `docs/ENGINE.md` §WASM
// boundary, plus the "Boundary mechanics" amendment (2026-07-28).
//
// Do not add fields here that the engine does not produce, and do not add
// colour anywhere in this file — the engine boundary speaks only in sides
// ('first' | 'second'). Mapping to red/yellow happens in the game layer,
// which does not exist yet (Wave 4+).

/** Column-by-column evaluation. Exact scores only; nothing is ever guessed. */
export type ColumnEval =
  | { kind: 'score'; score: number } // exact; from the CURRENT MOVER's perspective
  | { kind: 'full' } // column is full, no move exists
  | { kind: 'unknown' }; // budget exhausted before this column solved

export interface AnalysisResult {
  columns: ColumnEval[]; // length 7, index = 0-based column
  best: number | null; // 0-based; null unless every non-full column is 'score'
  complete: boolean; // true iff no column is 'unknown'
  sideToMove: 'first' | 'second'; // NOT a colour
  threats: { current: number[]; opponent: number[] }; // 0-based square indices
  nodes: number; // nodes actually spent in this call
}

// Book and tactical-fallback exports (ENGINE.md "Book and tactical-fallback
// exports", Wave 8 addition, pinned 2026-07-28). Verbatim shapes from that
// section -- do not add fields the engine does not produce.

/**
 * `load_book`'s result. A corrupt or invalid book is never a thrown error --
 * it is reported here as `ok: false`, the "corrupt or absent file is a
 * silent fallback" pin (SPEC §6, "no placeholder data" read the other way:
 * a failed book load must not be dressed up as a loaded one either).
 */
export interface BookLoadResult {
  ok: boolean;
  entries: number; // 0 when ok is false
  depth: number; // 0 when ok is false
  /** `null` only via the TS wrapper's normalisation -- see `wrapper.ts`.
   *  Arrives as `undefined` at the raw wasm boundary when `ok` is `true`. */
  error: string | null;
}

/** Deliberately no `'unknown'` variant (ENGINE.md): `tactical_fallback` is a
 *  COMPLETE search within its own horizon, so every legal column resolves to
 *  either `full` or an exact (possibly horizon-clamped-to-zero) `score`. */
export type TacticalEval = { kind: 'score'; score: number } | { kind: 'full' };

export interface TacticalAnalysis {
  columns: TacticalEval[]; // length 7, index = 0-based column
  best: number | null; // 0-based; null only when every column is 'full'
}
