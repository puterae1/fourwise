// Message shapes for the main-thread <-> worker boundary. Kept separate from
// `worker.ts` and `client.ts` so both sides (and tests, via a fake transport)
// share one definition.
//
// Wave 9: extended beyond `analyse` to also carry the book/tactical-fallback
// calls (`docs/ENGINE.md` "Book and tactical-fallback exports") over the
// same one-Worker, one-wasm-instance boundary -- every request/response is a
// discriminated union tagged by `kind`, correlated by `id` exactly as
// `analyse` already was.

import type { AnalysisResult, BookLoadResult, TacticalAnalysis } from './types.js';

export type WorkerRequest =
  | { id: number; kind: 'analyse'; position: string; nodeBudget: number }
  | { id: number; kind: 'tacticalFallback'; position: string; maxPly: number }
  | { id: number; kind: 'loadBook'; bytes: Uint8Array }
  | { id: number; kind: 'setBookEnabled'; enabled: boolean };

export type WorkerResponse =
  | { id: number; kind: 'analyse'; result: AnalysisResult }
  | { id: number; kind: 'tacticalFallback'; result: TacticalAnalysis }
  | { id: number; kind: 'loadBook'; result: BookLoadResult }
  | { id: number; kind: 'setBookEnabled' }
  | { id: number; kind: 'error'; error: string };
