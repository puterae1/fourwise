// The mandated forced-race test (ENGINE.md "Stale-result discard", amended
// 2026-07-28): start a progressive analyse, switch position before it
// completes, and assert no update for the OLD position is ever delivered,
// even once its already-in-flight request resolves afterwards.

import { describe, expect, it } from 'vitest';
import { AnalysisSession, type TokenedResult, type TokenedUpdate } from './analysisSession.js';
import { analyseProgressive, type AnalyseTransport } from '../engine/client.js';
import type { AnalysisResult } from '../engine/types.js';

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

/** A transport whose `analyse` calls do not resolve until the test tells
 * them to, so a request can be left deliberately in flight across a
 * position switch -- exactly the race ENGINE.md describes. */
function makeControllableTransport(): AnalyseTransport & {
  calls: Array<{ position: string; nodeBudget: number }>;
  settle: (callIndex: number, result: AnalysisResult) => void;
} {
  const calls: Array<{ position: string; nodeBudget: number }> = [];
  const pending: Array<(result: AnalysisResult) => void> = [];
  return {
    calls,
    analyse(position: string, nodeBudget: number) {
      calls.push({ position, nodeBudget });
      return new Promise<AnalysisResult>((resolve) => {
        pending.push(resolve);
      });
    },
    settle(callIndex: number, result: AnalysisResult) {
      const resolve = pending[callIndex];
      if (!resolve) throw new Error(`no pending call at index ${callIndex}`);
      resolve(result);
    },
    async tacticalFallback() {
      throw new Error('tacticalFallback() is not used by this test');
    },
    async loadBook() {
      throw new Error('loadBook() is not used by this test');
    },
    async setBookEnabled() {
      throw new Error('setBookEnabled() is not used by this test');
    },
    terminate() {},
  };
}

/** Adapts the tested real `analyseProgressive` escalation logic (already
 * covered by client.test.ts) onto the narrow interface `AnalysisSession`
 * needs, over a fake transport -- so this test exercises the session's own
 * token-filtering logic against real escalation/abort behaviour, not a
 * reimplementation of it. */
function analyserOver(transport: AnalyseTransport) {
  return {
    analyseProgressive: (position: string, options: Parameters<typeof analyseProgressive>[2]) =>
      analyseProgressive(transport, position, options),
  };
}

describe('AnalysisSession — forced race (ENGINE.md "Stale-result discard")', () => {
  it('drops an old position result that resolves after the position has already switched', async () => {
    const transport = makeControllableTransport();
    const session = new AnalysisSession(analyserOver(transport));

    const oldUpdates: TokenedUpdate[] = [];
    const oldResults: Array<TokenedResult | null> = [];
    const oldPromise = session
      .start('OLD_POSITION', 20_000_000, (u) => oldUpdates.push(u))
      .then((r) => {
        oldResults.push(r);
        return r;
      });

    // The old position's first (and only, since it never resolves in time
    // to escalate) analyse() call is now in flight.
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]).toEqual({ position: 'OLD_POSITION', nodeBudget: 100_000 });

    // The position changes -- e.g. the user played a move or jumped to a
    // different ply -- before the old call ever resolved.
    const newUpdates: TokenedUpdate[] = [];
    const newPromise = session.start('NEW_POSITION', 20_000_000, (u) => newUpdates.push(u));

    expect(transport.calls).toHaveLength(2);
    expect(transport.calls[1]).toEqual({ position: 'NEW_POSITION', nodeBudget: 100_000 });

    // Now the OLD position's already-in-flight request resolves. Per the
    // protocol, this must be dropped: no update, no resolved result.
    transport.settle(0, makeResult({ complete: false, nodes: 100_000 }));
    const oldResult = await oldPromise;

    expect(oldUpdates).toHaveLength(0);
    expect(oldResult).toBeNull();

    // And because a position change aborts the escalation loop, the old
    // position must never be re-issued at a bigger budget either.
    expect(transport.calls).toHaveLength(2);
    expect(transport.calls.some((c) => c.position === 'OLD_POSITION' && c.nodeBudget !== 100_000)).toBe(false);

    // The NEW position, meanwhile, behaves completely normally.
    transport.settle(1, makeResult({ complete: true, nodes: 100_000, best: 4 }));
    const newResult = await newPromise;

    expect(newUpdates).toHaveLength(1);
    expect(newUpdates[0]!.position).toBe('NEW_POSITION');
    expect(newResult).not.toBeNull();
    expect(newResult!.result.best).toBe(4);
    expect(newResult!.position).toBe('NEW_POSITION');
  });

  it('assigns a fresh, strictly increasing token to every call to start()', () => {
    const transport = makeControllableTransport();
    const session = new AnalysisSession(analyserOver(transport));

    void session.start('A', 100_000, () => {});
    const tokenAfterA = session.currentToken;
    void session.start('B', 100_000, () => {});
    const tokenAfterB = session.currentToken;

    expect(tokenAfterB).toBeGreaterThan(tokenAfterA);
  });

  it('stop() invalidates any still-in-flight update without starting a new position', async () => {
    const transport = makeControllableTransport();
    const session = new AnalysisSession(analyserOver(transport));

    const updates: TokenedUpdate[] = [];
    const promise = session.start('SOME_POSITION', 100_000, (u) => updates.push(u));

    session.stop();
    transport.settle(0, makeResult({ complete: true, best: 1 }));

    const result = await promise;
    expect(updates).toHaveLength(0);
    expect(result).toBeNull();
  });
});
