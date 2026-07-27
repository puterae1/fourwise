// Main-thread promise API over the worker. `docs/SPEC.md` §6: analysis must
// never block input, so every call here is async and backed by a Web
// Worker; nothing in this file runs the wasm engine directly.

import { EngineError } from './wrapper.js';
import type { AnalysisResult } from './types.js';
import type { AnalyseRequest, WorkerResponse } from './protocol.js';

/**
 * The narrow surface `analyseProgressive`/`calibrate` need. A real client
 * backs this with a Worker (`createWorkerTransport`); tests inject a fake
 * one, so the escalation and calibration logic below is testable without a
 * browser Worker or the real wasm engine.
 */
export interface AnalyseTransport {
  analyse(position: string, nodeBudget: number): Promise<AnalysisResult>;
  terminate(): void;
}

/** Wall-clock time source, injectable so tests don't depend on real timing. */
export type Clock = () => number;

const defaultClock: Clock = () =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

function createWorkerTransport(): AnalyseTransport {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  let nextId = 1;
  let terminated = false;
  const pending = new Map<
    number,
    { resolve: (result: AnalysisResult) => void; reject: (err: Error) => void }
  >();

  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const data = event.data;
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    if ('error' in data) {
      entry.reject(new EngineError(data.error));
    } else {
      entry.resolve(data.result);
    }
  };

  worker.onerror = (event: ErrorEvent) => {
    // A worker-level failure (e.g. the wasm file failed to fetch) must not
    // leave callers waiting forever — reject everything still outstanding.
    const error = new EngineError(event.message || 'The analysis worker failed to start.');
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  };

  return {
    analyse(position, nodeBudget) {
      // Once terminated, `postMessage` to a dead worker is a silent no-op in
      // browsers — without this guard the returned promise would simply
      // never settle. Reject immediately and cleanly instead.
      if (terminated) {
        return Promise.reject(new EngineError('The analysis worker was terminated.'));
      }
      const id = nextId++;
      return new Promise<AnalysisResult>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        const request: AnalyseRequest = { id, position, nodeBudget };
        worker.postMessage(request);
      });
    },
    terminate() {
      if (terminated) return; // idempotent: never double-terminate the worker
      terminated = true;
      worker.terminate();
      for (const { reject } of pending.values()) {
        reject(new EngineError('The analysis worker was terminated.'));
      }
      pending.clear();
    },
  };
}

const BASE_BUDGET_STEPS = [100_000, 1_000_000, 5_000_000, 20_000_000];

/**
 * Escalating node budgets from the first base step up to (and including)
 * `budgetCeiling`. Example: ceiling 20_000_000 -> [100k, 1M, 5M, 20M].
 * A ceiling below the first base step produces a single-element list at the
 * ceiling. A ceiling above every base step keeps escalating geometrically
 * (x4 per step) until it reaches the ceiling.
 */
export function budgetSteps(budgetCeiling: number): number[] {
  if (budgetCeiling <= 0) {
    throw new EngineError(`budgetCeiling must be positive, got ${budgetCeiling}`);
  }
  const steps: number[] = [];
  for (const step of BASE_BUDGET_STEPS) {
    if (step >= budgetCeiling) {
      steps.push(budgetCeiling);
      return steps;
    }
    steps.push(step);
  }
  let budget = BASE_BUDGET_STEPS[BASE_BUDGET_STEPS.length - 1] * 4;
  while (budget < budgetCeiling) {
    steps.push(budget);
    budget *= 4;
  }
  steps.push(budgetCeiling);
  return steps;
}

export interface ProgressiveUpdate {
  result: AnalysisResult;
  budget: number;
  elapsedMs: number;
}

export interface AnalyseProgressiveOptions {
  /** Called after every escalation step, including the final one. */
  onUpdate: (update: ProgressiveUpdate) => void;
  /** Largest node budget this call is allowed to spend. */
  budgetCeiling: number;
  /** Abort further escalation (e.g. the user navigated away). */
  signal?: AbortSignal;
}

/**
 * Issues `analyse` with escalating node budgets, reporting each result via
 * `onUpdate` so the caller can render honest partial ("still thinking")
 * state — never a guessed score (`docs/SPEC.md` §6). Stops as soon as a
 * result reports `complete: true`, when `signal` aborts, or once
 * `budgetCeiling` has been spent.
 */
export async function analyseProgressive(
  transport: AnalyseTransport,
  position: string,
  options: AnalyseProgressiveOptions,
  clock: Clock = defaultClock,
): Promise<AnalysisResult> {
  const { onUpdate, budgetCeiling, signal } = options;
  const steps = budgetSteps(budgetCeiling);

  let last: AnalysisResult | null = null;
  for (const budget of steps) {
    if (signal?.aborted) break;
    const start = clock();
    const result = await transport.analyse(position, budget);
    const elapsedMs = clock() - start;
    last = result;
    onUpdate({ result, budget, elapsedMs });
    if (result.complete) break;
  }

  if (!last) {
    // Only reachable if `signal` was already aborted before the first step.
    throw new EngineError('analyseProgressive was aborted before any analysis ran.');
  }
  return last;
}

export interface Calibration {
  /** Nodes the engine solved per millisecond of wall time, from the probe. */
  nodesPerMs: number;
  /** Converts a time budget the user is willing to wait into a node budget. */
  msToNodeBudget: (ms: number) => number;
}

const CALIBRATION_POSITION = ''; // empty board: a known, always-legal position
const CALIBRATION_PROBE_BUDGET = 50_000;

/**
 * One-shot time -> nodes calibration (`docs/ENGINE.md` "Budgeted analysis":
 * "the worker maps a time preference to nodes ... calibrate once at load").
 * Runs a single bounded probe analysis, measures wall time, and derives a
 * nodes-per-ms rate so callers can turn "wait about 1s" into a node budget
 * without the engine ever touching a clock itself.
 */
export async function calibrate(
  transport: AnalyseTransport,
  clock: Clock = defaultClock,
): Promise<Calibration> {
  const start = clock();
  const result = await transport.analyse(CALIBRATION_POSITION, CALIBRATION_PROBE_BUDGET);
  const elapsedMs = Math.max(clock() - start, 1); // guard against a zero-duration probe
  const nodesPerMs = result.nodes / elapsedMs;
  return {
    nodesPerMs,
    msToNodeBudget: (ms: number) => Math.max(1, Math.round(nodesPerMs * ms)),
  };
}

export interface EngineClient {
  analyse(position: string, nodeBudget: number): Promise<AnalysisResult>;
  analyseProgressive(position: string, options: AnalyseProgressiveOptions): Promise<AnalysisResult>;
  calibrate(): Promise<Calibration>;
  terminate(): void;
}

/**
 * The production client: one Worker, one wasm instance, for the lifetime of
 * this object. Calibration is lazy (nothing runs until the first
 * `.calibrate()` call — see `App.tsx`, which triggers it on first real use
 * rather than at mount, so a React StrictMode create/cleanup/recreate dance
 * never races it) and, once it succeeds, cached.
 *
 * A rejected calibration is deliberately NOT cached: if this client is
 * terminated mid-probe (or the worker hiccups transiently), the rejection
 * is not remembered forever. The next `.calibrate()` call on this same,
 * still-alive client retries from scratch. Because `transport` and
 * `calibrationPromise` are private to one `createEngineClient()` closure,
 * one client's failure — cached or not — can never reach another client's
 * state; each is fully independent.
 *
 * `createTransport` defaults to the real Worker-backed transport; tests
 * inject a fake one so this can be exercised without a browser Worker.
 */
export function createEngineClient(createTransport: () => AnalyseTransport = createWorkerTransport): EngineClient {
  const transport = createTransport();
  let calibrationPromise: Promise<Calibration> | null = null;

  function calibrateOnce(): Promise<Calibration> {
    const promise = calibrate(transport).catch((err: unknown) => {
      // Only clear the cache if this rejected attempt is still the current
      // one (a later, successful attempt must not be discarded by an
      // earlier, now-irrelevant rejection settling after it).
      if (calibrationPromise === promise) calibrationPromise = null;
      throw err;
    });
    return promise;
  }

  return {
    analyse: (position, nodeBudget) => transport.analyse(position, nodeBudget),
    analyseProgressive: (position, options) => analyseProgressive(transport, position, options),
    calibrate: () => {
      if (!calibrationPromise) calibrationPromise = calibrateOnce();
      return calibrationPromise;
    },
    terminate: () => transport.terminate(),
  };
}
