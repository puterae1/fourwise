import { describe, expect, it } from 'vitest';
import { analyseProgressive, budgetSteps, calibrate, createEngineClient, type AnalyseTransport, type Clock } from './client.js';
import { EngineError } from './wrapper.js';
import type { AnalysisResult } from './types.js';

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
});
