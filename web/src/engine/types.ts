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
