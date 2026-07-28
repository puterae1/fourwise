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
//
// Wave 9: routes on `request.kind` -- `analyse` is unchanged; `loadBook`/
// `setBookEnabled`/`tacticalFallback` are thin passthroughs to the same
// `wrapper.ts` functions the book/tactical-fallback deliverable added.
// Every request kind awaits the same `ready` promise before touching the
// wasm module, `analyse` included.

import { initEngine, analyse, loadBook, setBookEnabled, tacticalFallback } from './wrapper.js';
import type { WorkerRequest, WorkerResponse } from './protocol.js';

const scope = self as unknown as DedicatedWorkerGlobalScope;

// Fetches and instantiates the wasm module relative to this worker file.
// Starts immediately; every incoming message awaits this same promise, so
// concurrent early messages don't trigger concurrent re-init attempts.
const ready = initEngine();

scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  const { id } = request;
  try {
    await ready;
    let response: WorkerResponse;
    switch (request.kind) {
      case 'analyse':
        response = { id, kind: 'analyse', result: analyse(request.position, request.nodeBudget) };
        break;
      case 'tacticalFallback':
        response = {
          id,
          kind: 'tacticalFallback',
          result: tacticalFallback(request.position, request.maxPly),
        };
        break;
      case 'loadBook':
        response = { id, kind: 'loadBook', result: loadBook(request.bytes) };
        break;
      case 'setBookEnabled':
        setBookEnabled(request.enabled);
        response = { id, kind: 'setBookEnabled' };
        break;
    }
    scope.postMessage(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const response: WorkerResponse = { id, kind: 'error', error: message };
    scope.postMessage(response);
  }
};
