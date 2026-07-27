// Message shapes for the main-thread <-> worker boundary. Kept separate from
// `worker.ts` and `client.ts` so both sides (and tests, via a fake transport)
// share one definition.

import type { AnalysisResult } from './types.js';

export interface AnalyseRequest {
  id: number;
  position: string;
  nodeBudget: number;
}

export type WorkerResponse =
  | { id: number; result: AnalysisResult }
  | { id: number; error: string };
