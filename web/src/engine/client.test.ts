import { describe, expect, it, vi } from 'vitest';
import {
  analyseProgressive,
  budgetSteps,
  calibrate,
  createEngineClient,
  fetchAndLoadBook,
  type AnalyseTransport,
  type Clock,
} from './client.js';
import { EngineError } from './wrapper.js';
import type { AnalysisResult, BookLoadResult, TacticalAnalysis } from './types.js';

// These tests exercise only the worker-independent parts of client.ts —
// budget escalation and calibration — against a fake transport. worker.ts
// itself stays thin and untested here on purpose (see its own comment).

function makeResult(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    columns: Array.from({ length: 7 }, () => ({ kind: 'unknown' as const })),
    best: null,
    complete: false,
    sideToMove: 'first',
    threats: { current: [], opponent: [] },
    nodes: 0,
    ...overrides,
  };
}

interface FakeCall {
  position: string;
  nodeBudget: number;
}

// Book/tactical-fallback methods are not exercised by `analyseProgressive`/
// `calibrate` at all -- these two stubs throw if ever accidentally called,
// exactly like the `analyse` guard the blunder/lamp controller-test fakes
// already use for methods outside a given test's scope.
function notUsedHere(name: string): never {
  throw new Error(`${name}() is not used by this test`);
}

function makeFakeTransport(
  results: AnalysisResult[],
): AnalyseTransport & { calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  return {
    calls,
    async analyse(position: string, nodeBudget: number) {
      calls.push({ position, nodeBudget });
      const result = results[calls.length - 1];
      if (!result) {
        throw new Error(`fake transport received more calls (${calls.length}) than scripted results`);
      }
      return result;
    },
    async tacticalFallback() {
      return notUsedHere('tacticalFallback');
    },
    async loadBook() {
      return notUsedHere('loadBook');
    },
    async setBookEnabled() {
      return notUsedHere('setBookEnabled');
    },
    terminate() {},
  };
}

/**
 * A transport whose `analyse` call does not resolve until the test tells it
 * to — needed to reproduce "terminated (or otherwise failed) while a call
 * is still in flight" (the React StrictMode create/cleanup/recreate race
 * the coordinator's repro describes), which `makeFakeTransport`'s instant
 * resolution cannot. Mirrors the real `createWorkerTransport` contract:
 * `terminate()` rejects everything pending and is idempotent; any `analyse`
 * call made after termination rejects immediately instead of hanging.
 */
function makeControllableTransport(): AnalyseTransport & {
  calls: FakeCall[];
  settleNext: (result: AnalysisResult) => void;
  rejectNext: (err: Error) => void;
} {
  const calls: FakeCall[] = [];
  const pending: Array<{ resolve: (result: AnalysisResult) => void; reject: (err: Error) => void }> = [];
  let terminated = false;
  return {
    calls,
    analyse(position: string, nodeBudget: number) {
      if (terminated) {
        return Promise.reject(new EngineError('The analysis worker was terminated.'));
      }
      calls.push({ position, nodeBudget });
      return new Promise<AnalysisResult>((resolve, reject) => {
        pending.push({ resolve, reject });
      });
    },
    async tacticalFallback() {
      return notUsedHere('tacticalFallback');
    },
    async loadBook() {
      return notUsedHere('loadBook');
    },
    async setBookEnabled() {
      return notUsedHere('setBookEnabled');
    },
    settleNext(result: AnalysisResult) {
      const entry = pending.shift();
      if (!entry) throw new Error('settleNext called with no pending analyse() call');
      entry.resolve(result);
    },
    rejectNext(err: Error) {
      const entry = pending.shift();
      if (!entry) throw new Error('rejectNext called with no pending analyse() call');
      entry.reject(err);
    },
    terminate() {
      if (terminated) return;
      terminated = true;
      for (const entry of pending.splice(0)) {
        entry.reject(new EngineError('The analysis worker was terminated.'));
      }
    },
  };
}

function makeFakeClock(times: number[]): Clock {
  let i = 0;
  return () => {
    const t = times[Math.min(i, times.length - 1)];
    i += 1;
    return t;
  };
}

describe('budgetSteps', () => {
  it('produces the example escalation up to a 20M ceiling', () => {
    expect(budgetSteps(20_000_000)).toEqual([100_000, 1_000_000, 5_000_000, 20_000_000]);
  });

  it('produces a single step when the ceiling is below the first base step', () => {
    expect(budgetSteps(50_000)).toEqual([50_000]);
  });

  it('stops early at the ceiling when it falls between base steps', () => {
    expect(budgetSteps(1_000_000)).toEqual([100_000, 1_000_000]);
  });

  it('keeps escalating geometrically past the last base step for a high ceiling', () => {
    const steps = budgetSteps(100_000_000);
    expect(steps.slice(0, 4)).toEqual([100_000, 1_000_000, 5_000_000, 20_000_000]);
    expect(steps[steps.length - 1]).toBe(100_000_000);
    // Strictly increasing, never exceeding the ceiling until the final entry.
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]).toBeGreaterThan(steps[i - 1]);
    }
  });

  it('rejects a non-positive ceiling', () => {
    expect(() => budgetSteps(0)).toThrow(EngineError);
    expect(() => budgetSteps(-1)).toThrow(EngineError);
  });
});

describe('analyseProgressive', () => {
  it('stops as soon as a step reports complete, without spending the remaining budget', async () => {
    const transport = makeFakeTransport([
      makeResult({ complete: false, nodes: 100_000 }),
      makeResult({ complete: true, nodes: 1_000_000, best: 3 }),
    ]);
    const updates: number[] = [];

    const final = await analyseProgressive(
      transport,
      '',
      {
        budgetCeiling: 20_000_000,
        onUpdate: (update) => updates.push(update.budget),
      },
      makeFakeClock([0, 1, 2, 3]),
    );

    expect(transport.calls).toHaveLength(2);
    expect(transport.calls.map((c) => c.nodeBudget)).toEqual([100_000, 1_000_000]);
    expect(updates).toEqual([100_000, 1_000_000]);
    expect(final.complete).toBe(true);
    expect(final.best).toBe(3);
  });

  it('exhausts every step up to the ceiling when nothing ever completes', async () => {
    const transport = makeFakeTransport([
      makeResult({ nodes: 100_000 }),
      makeResult({ nodes: 1_000_000 }),
      makeResult({ nodes: 5_000_000 }),
      makeResult({ nodes: 20_000_000 }),
    ]);

    const final = await analyseProgressive(
      transport,
      '',
      { budgetCeiling: 20_000_000, onUpdate: () => {} },
      makeFakeClock([0, 1]),
    );

    expect(transport.calls).toHaveLength(4);
    expect(final.complete).toBe(false);
  });

  it('reports elapsedMs to onUpdate from the injected clock', async () => {
    const transport = makeFakeTransport([makeResult({ complete: true })]);
    const updates: number[] = [];

    await analyseProgressive(
      transport,
      '',
      { budgetCeiling: 50_000, onUpdate: (u) => updates.push(u.elapsedMs) },
      makeFakeClock([10, 37]),
    );

    expect(updates).toEqual([27]);
  });

  it('stops issuing further calls once the caller aborts', async () => {
    const controller = new AbortController();
    const transport = makeFakeTransport([
      makeResult({ complete: false }),
      makeResult({ complete: false }),
      makeResult({ complete: false }),
      makeResult({ complete: false }),
    ]);

    const final = await analyseProgressive(
      transport,
      '',
      {
        budgetCeiling: 20_000_000,
        signal: controller.signal,
        onUpdate: () => {
          controller.abort();
        },
      },
      makeFakeClock([0, 1]),
    );

    expect(transport.calls).toHaveLength(1);
    expect(final.complete).toBe(false);
  });

  it('rejects if the signal is already aborted before any analysis runs', async () => {
    const controller = new AbortController();
    controller.abort();
    const transport = makeFakeTransport([makeResult()]);

    await expect(
      analyseProgressive(transport, '', {
        budgetCeiling: 20_000_000,
        signal: controller.signal,
        onUpdate: () => {},
      }),
    ).rejects.toThrow(EngineError);

    expect(transport.calls).toHaveLength(0);
  });
});

describe('calibrate', () => {
  it('derives nodesPerMs from a single probe call and converts ms to a node budget', async () => {
    const transport = makeFakeTransport([makeResult({ nodes: 200_000 })]);
    const clock = makeFakeClock([0, 100]); // probe took 100ms, solved 200_000 nodes -> 2000 nodes/ms

    const calibration = await calibrate(transport, clock);

    expect(calibration.nodesPerMs).toBe(2000);
    expect(calibration.msToNodeBudget(1000)).toBe(2_000_000);
    expect(transport.calls).toHaveLength(1);
  });

  it('guards against a zero-duration probe instead of dividing by zero', async () => {
    const transport = makeFakeTransport([makeResult({ nodes: 500 })]);
    const clock = makeFakeClock([5, 5]); // no measurable elapsed time

    const calibration = await calibrate(transport, clock);

    expect(Number.isFinite(calibration.nodesPerMs)).toBe(true);
    expect(Number.isFinite(calibration.msToNodeBudget(1000))).toBe(true);
  });

  it('never returns a budget below 1, even for a vanishingly small time preference', async () => {
    const transport = makeFakeTransport([makeResult({ nodes: 1 })]);
    const clock = makeFakeClock([0, 1000]);

    const calibration = await calibrate(transport, clock);

    expect(calibration.msToNodeBudget(0)).toBeGreaterThanOrEqual(1);
  });
});

describe('createEngineClient', () => {
  // Regression coverage for the React StrictMode repro: a client created,
  // terminated mid-calibration (dev double-invoke's cleanup pass), and
  // replaced by a second client must not leave the survivor unable to
  // calibrate. `createEngineClient` takes an injectable transport factory
  // precisely so this is testable without a real Worker.
  it("terminating one client mid-calibration does not poison a second client's calibration", async () => {
    const transports: ReturnType<typeof makeControllableTransport>[] = [];
    const createTransport = () => {
      const transport = makeControllableTransport();
      transports.push(transport);
      return transport;
    };

    const client1 = createEngineClient(createTransport);
    const calibration1 = client1.calibrate();
    client1.terminate(); // rejects client1's in-flight probe; must not touch client2

    await expect(calibration1).rejects.toThrow(EngineError);

    const client2 = createEngineClient(createTransport);
    const calibration2Promise = client2.calibrate();
    expect(transports).toHaveLength(2);
    transports[1].settleNext(makeResult({ nodes: 300_000 }));

    const calibration2 = await calibration2Promise;
    expect(calibration2.nodesPerMs).toBeGreaterThan(0);
    expect(calibration2.msToNodeBudget(1000)).toBeGreaterThan(0);
  });

  it('retries calibration on the same client after a transient failure instead of caching the rejection', async () => {
    const transport = makeControllableTransport();
    const client = createEngineClient(() => transport);

    // A transient failure (e.g. a one-off worker hiccup) rejects the probe
    // without terminating anything — the client itself is still alive.
    const firstAttempt = client.calibrate();
    transport.rejectNext(new EngineError('transient probe failure'));
    await expect(firstAttempt).rejects.toThrow('transient probe failure');

    // The cache must have been cleared: calling `.calibrate()` again issues
    // a genuinely new `analyse()` call rather than returning the same
    // rejected promise forever.
    const secondAttemptPromise = client.calibrate();
    expect(transport.calls).toHaveLength(2);
    transport.settleNext(makeResult({ nodes: 100_000 }));

    const calibration = await secondAttemptPromise;
    expect(calibration.nodesPerMs).toBeGreaterThan(0);
  });

  it("rejects analyse() calls made after terminate() instead of leaving them pending forever", async () => {
    const transport = makeControllableTransport();
    const client = createEngineClient(() => transport);
    client.terminate();

    await expect(client.analyse('', 100)).rejects.toThrow(EngineError);
  });

  it('forwards tacticalFallback and setBookEnabled straight to the transport (Wave 9 passthrough)', async () => {
    const tactical: TacticalAnalysis = {
      columns: Array.from({ length: 7 }, () => ({ kind: 'score' as const, score: 0 })),
      best: 3,
    };
    const transport: AnalyseTransport = {
      analyse: async () => notUsedHere('analyse'),
      tacticalFallback: vi.fn(async (position: string, maxPly: number) => {
        expect(position).toBe('44');
        expect(maxPly).toBe(7);
        return tactical;
      }),
      loadBook: async () => notUsedHere('loadBook'),
      setBookEnabled: vi.fn(async (enabled: boolean) => {
        expect(enabled).toBe(false);
      }),
      terminate() {},
    };
    const client = createEngineClient(() => transport);

    const result = await client.tacticalFallback('44', 7);
    expect(result).toBe(tactical);
    expect(transport.tacticalFallback).toHaveBeenCalledTimes(1);

    await client.setBookEnabled(false);
    expect(transport.setBookEnabled).toHaveBeenCalledTimes(1);
  });
});

describe('fetchAndLoadBook', () => {
  function makeLoadBookTransport(result: BookLoadResult): AnalyseTransport & { calls: Uint8Array[] } {
    const calls: Uint8Array[] = [];
    return {
      analyse: async () => notUsedHere('analyse'),
      tacticalFallback: async () => notUsedHere('tacticalFallback'),
      async loadBook(bytes: Uint8Array) {
        calls.push(bytes);
        return result;
      },
      setBookEnabled: async () => notUsedHere('setBookEnabled'),
      terminate() {},
      calls,
    };
  }

  function okFetch(bytes: Uint8Array): typeof fetch {
    return (async () =>
      new Response(bytes as unknown as BodyInit, { status: 200 })) as unknown as typeof fetch;
  }

  it('fetches book.bin under the given BASE_URL and hands the bytes to loadBook', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const okResult: BookLoadResult = { ok: true, entries: 10, depth: 8, error: null };
    const transport = makeLoadBookTransport(okResult);
    let requestedUrl = '';
    const fetchImpl = (async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return new Response(bytes as unknown as BodyInit, { status: 200 });
    }) as unknown as typeof fetch;

    const result = await fetchAndLoadBook(transport, fetchImpl, '/fourwise/');

    expect(requestedUrl).toBe('/fourwise/book.bin');
    expect(result).toEqual(okResult);
    expect(transport.calls).toHaveLength(1);
    expect(Array.from(transport.calls[0]!)).toEqual([1, 2, 3]);
  });

  it('never hardcodes the unprefixed path either -- BASE_URL "/" produces "/book.bin"', async () => {
    const transport = makeLoadBookTransport({ ok: true, entries: 1, depth: 8, error: null });
    let requestedUrl = '';
    const fetchImpl = (async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return new Response(new Uint8Array([1]), { status: 200 });
    }) as unknown as typeof fetch;

    await fetchAndLoadBook(transport, fetchImpl, '/');
    expect(requestedUrl).toBe('/book.bin');
  });

  it('rejects on a network-level fetch failure (fetchImpl throws)', async () => {
    const transport = makeLoadBookTransport({ ok: true, entries: 1, depth: 8, error: null });
    const fetchImpl = (async () => {
      throw new TypeError('network down');
    }) as unknown as typeof fetch;

    await expect(fetchAndLoadBook(transport, fetchImpl, '/')).rejects.toThrow(EngineError);
    expect(transport.calls).toHaveLength(0); // never reached loadBook
  });

  it('rejects on an HTTP error status -- the CURRENT live state, since book.bin does not exist yet', async () => {
    const transport = makeLoadBookTransport({ ok: true, entries: 1, depth: 8, error: null });
    const fetchImpl = (async () => new Response(null, { status: 404 })) as unknown as typeof fetch;

    await expect(fetchAndLoadBook(transport, fetchImpl, '/')).rejects.toThrow(/404/);
    expect(transport.calls).toHaveLength(0);
  });

  it('does NOT reject on a validation rejection (corrupt bytes) -- resolves with the honest ok:false instead', async () => {
    const corrupt: BookLoadResult = { ok: false, entries: 0, depth: 0, error: 'header too short' };
    const transport = makeLoadBookTransport(corrupt);
    const result = await fetchAndLoadBook(transport, okFetch(new Uint8Array([9])), '/');
    expect(result).toEqual(corrupt);
  });
});

describe('EngineClient.loadBookFromNetwork -- single-flight, retryable, no re-fetch loop', () => {
  function controllableFetch(): {
    fetchImpl: typeof fetch;
    calls: number;
    settleNext: (status: number, bytes?: Uint8Array) => void;
    rejectNext: (err: Error) => void;
  } {
    const pending: Array<{ resolve: (r: Response) => void; reject: (e: Error) => void }> = [];
    let calls = 0;
    const fetchImpl = (() => {
      calls++;
      return new Promise<Response>((resolve, reject) => pending.push({ resolve, reject }));
    }) as unknown as typeof fetch;
    return {
      fetchImpl,
      get calls() {
        return calls;
      },
      settleNext(status: number, bytes: Uint8Array = new Uint8Array([1])) {
        const entry = pending.shift();
        if (!entry) throw new Error('settleNext called with no pending fetch');
        entry.resolve(new Response(bytes as unknown as BodyInit, { status }));
      },
      rejectNext(err: Error) {
        const entry = pending.shift();
        if (!entry) throw new Error('rejectNext called with no pending fetch');
        entry.reject(err);
      },
    };
  }

  function transportWithLoadBook(result: BookLoadResult): AnalyseTransport {
    return {
      analyse: async () => notUsedHere('analyse'),
      tacticalFallback: async () => notUsedHere('tacticalFallback'),
      loadBook: async () => result,
      setBookEnabled: async () => notUsedHere('setBookEnabled'),
      terminate() {},
    };
  }

  it('concurrent callers before the fetch resolves share exactly one in-flight fetch (single-flight)', async () => {
    const control = controllableFetch();
    const transport = transportWithLoadBook({ ok: true, entries: 5, depth: 8, error: null });
    const client = createEngineClient(() => transport, { fetchImpl: control.fetchImpl, baseUrl: '/' });

    const first = client.loadBookFromNetwork();
    const second = client.loadBookFromNetwork();
    expect(control.calls).toBe(1); // only one fetch issued for both callers

    control.settleNext(200);
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b);
  });

  it('a failed attempt (network error) resolves silently to a rejection the caller controls, and clears the cache so a later call retries', async () => {
    const control = controllableFetch();
    const transport = transportWithLoadBook({ ok: true, entries: 5, depth: 8, error: null });
    const client = createEngineClient(() => transport, { fetchImpl: control.fetchImpl, baseUrl: '/' });

    const first = client.loadBookFromNetwork();
    control.rejectNext(new TypeError('network down'));
    await expect(first).rejects.toThrow(EngineError);

    // Retryable: a later explicit call issues a genuinely NEW fetch, not the
    // same rejected promise forever.
    const second = client.loadBookFromNetwork();
    expect(control.calls).toBe(2);
    control.settleNext(200);
    await expect(second).resolves.toEqual({ ok: true, entries: 5, depth: 8, error: null });
  });

  it('an HTTP 404 (book.bin absent -- the live state of this wave) rejects, and nothing here retries automatically (no loop)', async () => {
    const control = controllableFetch();
    const transport = transportWithLoadBook({ ok: true, entries: 5, depth: 8, error: null });
    const client = createEngineClient(() => transport, { fetchImpl: control.fetchImpl, baseUrl: '/' });

    const attempt = client.loadBookFromNetwork();
    control.settleNext(404);
    await expect(attempt).rejects.toThrow(EngineError);

    // Nothing automatically re-issued a second fetch -- exactly one call was
    // made for the one `loadBookFromNetwork()` invocation above.
    expect(control.calls).toBe(1);
  });

  it('a validation rejection (corrupt book) resolves normally with ok:false -- never a thrown/rejected promise', async () => {
    const control = controllableFetch();
    const transport = transportWithLoadBook({ ok: false, entries: 0, depth: 0, error: 'bad header' });
    const client = createEngineClient(() => transport, { fetchImpl: control.fetchImpl, baseUrl: '/' });

    const attempt = client.loadBookFromNetwork();
    control.settleNext(200);
    await expect(attempt).resolves.toEqual({ ok: false, entries: 0, depth: 0, error: 'bad header' });
  });

  it('each client is independent -- one client\'s failed book load never poisons another client\'s attempt', async () => {
    const controlA = controllableFetch();
    const controlB = controllableFetch();
    const clientA = createEngineClient(() => transportWithLoadBook({ ok: true, entries: 1, depth: 8, error: null }), {
      fetchImpl: controlA.fetchImpl,
      baseUrl: '/',
    });
    const clientB = createEngineClient(() => transportWithLoadBook({ ok: true, entries: 2, depth: 8, error: null }), {
      fetchImpl: controlB.fetchImpl,
      baseUrl: '/',
    });

    const attemptA = clientA.loadBookFromNetwork();
    controlA.rejectNext(new TypeError('A network down'));
    await expect(attemptA).rejects.toThrow(EngineError);

    const attemptB = clientB.loadBookFromNetwork();
    controlB.settleNext(200);
    await expect(attemptB).resolves.toEqual({ ok: true, entries: 2, depth: 8, error: null });
  });
});
