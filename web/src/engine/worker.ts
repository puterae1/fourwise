/// <reference lib="webworker" />

// The Web Worker. Per `docs/ENGINE.md` "Transposition-table lifetime": ONE
// wasm instance, initialised ONCE at worker startup — never re-initialised
// per message, because the TT persists across calls and that persistence is
// what makes the "still thinking" progressive-budget loop (see client.ts)
// cheap on repeated calls for the same position.
//
// Kept deliberately thin: no escalation logic, no calibration, no shape
// validation beyond what `wrapper.ts` already does. That logic lives in
// `client.ts` where it can be tested without a real worker.

import { initEngine, analyse } from './wrapper.js';
import type { AnalyseRequest, WorkerResponse } from './protocol.js';

const scope = self as unknown as DedicatedWorkerGlobalScope;

// Fetches and instantiates the wasm module relative to this worker file.
// Starts immediately; every incoming message awaits this same promise, so
// concurrent early messages don't trigger concurrent re-init attempts.
const ready = initEngine();

scope.onmessage = async (event: MessageEvent<AnalyseRequest>) => {
  const { id, position, nodeBudget } = event.data;
  try {
    await ready;
    const result = analyse(position, nodeBudget);
    const response: WorkerResponse = { id, result };
    scope.postMessage(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const response: WorkerResponse = { id, error: message };
    scope.postMessage(response);
  }
};
