// Main-thread promise API over the worker. `docs/SPEC.md` §6: analysis must
// never block input, so every call here is async and backed by a Web
// Worker; nothing in this file runs the wasm engine directly.

import { EngineError } from './wrapper.js';
import type { AnalysisResult, BookLoadResult, TacticalAnalysis } from './types.js';
import type { WorkerRequest, WorkerResponse } from './protocol.js';

/**
 * The narrow surface `analyseProgressive`/`calibrate`/the Wave 9 book and
 * tactical-fallback plumbing need. A real client backs this with a Worker
 * (`createWorkerTransport`); tests inject a fake one, so the escalation,
 * calibration, and cap-expiry logic is testable without a browser Worker or
 * the real wasm engine.
 */
export interface AnalyseTransport {
  analyse(position: string, nodeBudget: number): Promise<AnalysisResult>;
  /** `docs/SPEC.md` §3.1a / `docs/ENGINE.md`'s `tactical_fallback` export —
   *  a complete, ply-bounded search for the game layer's cap-expiry path. */
  tacticalFallback(position: string, maxPly: number): Promise<TacticalAnalysis>;
  /** `docs/ENGINE.md`'s `load_book` export. Takes bytes already fetched by
   *  the caller (this transport never touches `fetch` itself — see
   *  `fetchAndLoadBook`/`EngineClient.loadBookFromNetwork` below, which is
   *  the layer that owns the network request). */
  loadBook(bytes: Uint8Array): Promise<BookLoadResult>;
  /** `docs/ENGINE.md`'s `set_book_enabled` export — the permanent
   *  book-disabled flag. No UI control exists for this (task requirement);
   *  it exists so tests and future waves can exercise the no-book path. */
  setBookEnabled(enabled: boolean): Promise<void>;
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
    { resolve: (response: WorkerResponse) => void; reject: (err: Error) => void }
  >();

  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const data = event.data;
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    entry.resolve(data);
  };

  worker.onerror = (event: ErrorEvent) => {
    // A worker-level failure (e.g. the wasm file failed to fetch) must not
    // leave callers waiting forever — reject everything still outstanding.
    const error = new EngineError(event.message || 'The analysis worker failed to start.');
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  };

  // Once terminated, `postMessage` to a dead worker is a silent no-op in
  // browsers — without this guard the returned promise would simply never
  // settle. Reject immediately and cleanly instead. Every request kind below
  // shares this one issuing/correlation path.
  function issue(build: (id: number) => WorkerRequest, transfer: Transferable[] = []): Promise<WorkerResponse> {
    if (terminated) {
      return Promise.reject(new EngineError('The analysis worker was terminated.'));
    }
    const id = nextId++;
    return new Promise<WorkerResponse>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage(build(id), transfer);
    });
  }

  return {
    analyse(position, nodeBudget) {
      return issue((id) => ({ id, kind: 'analyse', position, nodeBudget })).then((data) => {
        if (data.kind === 'error') throw new EngineError(data.error);
        if (data.kind !== 'analyse') throw new EngineError(`Unexpected worker response kind '${data.kind}' for analyse`);
        return data.result;
      });
    },
    tacticalFallback(position, maxPly) {
      return issue((id) => ({ id, kind: 'tacticalFallback', position, maxPly })).then((data) => {
        if (data.kind === 'error') throw new EngineError(data.error);
        if (data.kind !== 'tacticalFallback') {
          throw new EngineError(`Unexpected worker response kind '${data.kind}' for tacticalFallback`);
        }
        return data.result;
      });
    },
    loadBook(bytes) {
      // Transferred, not copied: `bytes` is a freshly-fetched, full-buffer
      // Uint8Array (never a sub-view) by the time it reaches this transport
      // (`fetchAndLoadBook` below), so handing the worker its underlying
      // `ArrayBuffer` outright avoids a multi-MB structured-clone copy. The
      // caller's own `bytes` is unusable after this call, which is fine —
      // nothing on the main thread needs the raw book bytes again.
      return issue((id) => ({ id, kind: 'loadBook', bytes }), [bytes.buffer]).then((data) => {
        if (data.kind === 'error') throw new EngineError(data.error);
        if (data.kind !== 'loadBook') throw new EngineError(`Unexpected worker response kind '${data.kind}' for loadBook`);
        return data.result;
      });
    },
    setBookEnabled(enabled) {
      return issue((id) => ({ id, kind: 'setBookEnabled', enabled })).then((data) => {
        if (data.kind === 'error') throw new EngineError(data.error);
        if (data.kind !== 'setBookEnabled') {
          throw new EngineError(`Unexpected worker response kind '${data.kind}' for setBookEnabled`);
        }
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

// Wave 9: opening-book fetch. `book.bin` is a static asset shipped alongside
// the app (same category as the `.wasm` file itself, already fetched
// same-origin) — this is not the "no network calls" backend/API kind
// CLAUDE.md invariant #3 forbids, just lazily loading a static file this
// build already produced. `baseUrl` must come from Vite's `BASE_URL`
// (`/fourwise/` in production, `/` in dev) — see `createEngineClient`; never
// hardcode either prefix here.
const BOOK_ASSET_PATH = 'book.bin';

function describeFetchError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function fetchBookBytes(fetchImpl: typeof fetch, baseUrl: string): Promise<Uint8Array> {
  const url = `${baseUrl}${BOOK_ASSET_PATH}`;
  let response: Response;
  try {
    response = await fetchImpl(url);
  } catch (err) {
    throw new EngineError(`Opening book fetch failed: ${describeFetchError(err)}`);
  }
  if (!response.ok) {
    throw new EngineError(`Opening book fetch returned HTTP ${response.status} for ${url}`);
  }
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Fetches `book.bin` and hands the bytes to the transport's `loadBook`.
 * Rejects ONLY on a network/fetch/HTTP failure — a successfully fetched but
 * corrupt book is not a rejection here, it resolves with the transport's own
 * honest `{ ok: false, ... }` (same rule `loadBook` itself follows; see
 * `wrapper.ts`/ENGINE.md's "corrupt or absent file is a silent fallback").
 * Exported for `EngineClient.loadBookFromNetwork`'s single-flight wrapper
 * and for direct testing with a fake `fetchImpl`.
 */
export async function fetchAndLoadBook(
  transport: Pick<AnalyseTransport, 'loadBook'>,
  fetchImpl: typeof fetch,
  baseUrl: string,
): Promise<BookLoadResult> {
  const bytes = await fetchBookBytes(fetchImpl, baseUrl);
  return transport.loadBook(bytes);
}

export interface EngineClient {
  analyse(position: string, nodeBudget: number): Promise<AnalysisResult>;
  analyseProgressive(position: string, options: AnalyseProgressiveOptions): Promise<AnalysisResult>;
  calibrate(): Promise<Calibration>;
  /** `docs/SPEC.md` §3.1a's cap-expiry tactical fallback — see
   *  `engine/wrapper.ts`'s `tacticalFallback` for the shape/horizon
   *  contract this forwards to, over the same Worker `client.ts` already
   *  owns for `analyse`. */
  tacticalFallback(position: string, maxPly: number): Promise<TacticalAnalysis>;
  /**
   * Fetches the opening book (Vite `BASE_URL`-aware, never a hardcoded path)
   * and loads it into the worker's engine instance, WITHOUT blocking first
   * paint or engine init — callers fire this once (e.g. at app mount) and
   * never await it before rendering. Single-flight and retryable, mirroring
   * `calibrate()`'s own pattern: concurrent callers share one in-flight
   * attempt; a REJECTED attempt (network failure, non-OK HTTP status) clears
   * the cache so a LATER explicit call can retry, but nothing here loops on
   * failure automatically — `book.bin` not existing yet (the live state as
   * of this wave) rejects via a 404, which the one production caller
   * (`ui/useBookLoad.ts`) degrades from silently (SPEC: no user-visible
   * error, at most one console.info line). A validation rejection
   * (`ok: false`, corrupt bytes) is NOT a rejection of this promise — it
   * resolves normally with `ok: false`, per `fetchAndLoadBook`'s own rule.
   */
  loadBookFromNetwork(): Promise<BookLoadResult>;
  /** `docs/ENGINE.md`'s permanent book-disabled flag passthrough. No UI
   *  control exists for this (task requirement) — it exists purely so tests
   *  and future waves can exercise the no-book path deliberately. */
  setBookEnabled(enabled: boolean): Promise<void>;
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
 *
 * `network` is injectable the same way, for the same reason: tests supply a
 * fake `fetchImpl` (and, if they care, a fake `baseUrl`) so
 * `loadBookFromNetwork`'s single-flight/retry behaviour is testable without
 * a real network or a real Vite build. Production never passes it — the
 * defaults are the real global `fetch` and Vite's own `import.meta.env.
 * BASE_URL` (statically replaced at build time; `/fourwise/` in production,
 * `/` in dev — see `vite.config.ts`).
 */
export function createEngineClient(
  createTransport: () => AnalyseTransport = createWorkerTransport,
  network: { fetchImpl?: typeof fetch; baseUrl?: string } = {},
): EngineClient {
  const transport = createTransport();
  const fetchImpl = network.fetchImpl ?? fetch;
  const baseUrl = network.baseUrl ?? import.meta.env.BASE_URL;
  let calibrationPromise: Promise<Calibration> | null = null;
  let bookLoadPromise: Promise<BookLoadResult> | null = null;

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

  function loadBookFromNetworkOnce(): Promise<BookLoadResult> {
    const promise = fetchAndLoadBook(transport, fetchImpl, baseUrl).catch((err: unknown) => {
      // Same retryable-on-rejection shape as `calibrateOnce` above: only
      // clear the cache if this rejected attempt is still the current one.
      if (bookLoadPromise === promise) bookLoadPromise = null;
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
    tacticalFallback: (position, maxPly) => transport.tacticalFallback(position, maxPly),
    loadBookFromNetwork: () => {
      if (!bookLoadPromise) bookLoadPromise = loadBookFromNetworkOnce();
      return bookLoadPromise;
    },
    setBookEnabled: (enabled) => transport.setBookEnabled(enabled),
    terminate: () => transport.terminate(),
  };
}
