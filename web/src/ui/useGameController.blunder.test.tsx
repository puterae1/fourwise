// @vitest-environment jsdom

// End-to-end blunder-flag tests for `useGameController`, against a fake
// `EngineClient` that RESPONDS on demand (unlike `App.test.tsx`'s
// `FakeWorker`, which never answers and so never exercises the pending-check
// / analysis-resolution wiring this file targets). Requested by the Wave 5a
// verifier audit: the session/pending-blunder plumbing was previously
// verified only by manual trace.
//
// The fake sits at the `EngineClient` boundary (not the lower `AnalyseTransport`
// one `analysisSession.test.ts` already covers) so each test controls exactly
// one `AnalysisResult` per position, with no wasm engine and no escalation
// loop to manage.

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useGameController } from './useGameController.js';
import type { AnalyseProgressiveOptions, Calibration, EngineClient } from '../engine/client.js';
import type { AnalysisResult } from '../engine/types.js';
import type { Seat, Side } from '../game/seat.js';

interface PendingCall {
  position: string;
  onUpdate: AnalyseProgressiveOptions['onUpdate'];
  resolve: (result: AnalysisResult) => void;
}

function createFakeClient(): { client: EngineClient; pending: PendingCall[] } {
  const pending: PendingCall[] = [];
  const client: EngineClient = {
    analyse: async () => {
      throw new Error('analyse() is not used by useGameController directly');
    },
    analyseProgressive: (position, options) =>
      new Promise<AnalysisResult>((resolve) => {
        pending.push({ position, onUpdate: options.onUpdate, resolve });
      }),
    calibrate: async (): Promise<Calibration> => ({
      nodesPerMs: 1_000_000,
      msToNodeBudget: (ms) => Math.max(1, Math.round(ms * 1_000_000)),
    }),
    tacticalFallback: async () => {
      throw new Error('tacticalFallback() is not used by this file -- see useGameController.tacticalFallback.test.tsx');
    },
    loadBookFromNetwork: async () => {
      throw new Error('loadBookFromNetwork() is not used by this test');
    },
    setBookEnabled: async () => {
      throw new Error('setBookEnabled() is not used by this test');
    },
    terminate: () => {},
  };
  return { client, pending };
}

/** A full, solved result: every column scores `score` (the panel's own best
 * accounting is irrelevant to these tests -- only `best`'s score is ever
 * read as the position verdict). */
function fullResult(score: number, sideToMove: Side, best = 0): AnalysisResult {
  return {
    columns: Array.from({ length: 7 }, () => ({ kind: 'score' as const, score })),
    best,
    complete: true,
    sideToMove,
    threats: { current: [], opponent: [] },
    nodes: 1000,
  };
}

/** A budget-exhausted result: nothing solved, `complete: false`, `best: null`
 * -- the "not evaluated" shape SPEC §3.1/§3.2 require. */
function partialResult(sideToMove: Side): AnalysisResult {
  return {
    columns: Array.from({ length: 7 }, () => ({ kind: 'unknown' as const })),
    best: null,
    complete: false,
    sideToMove,
    threats: { current: [], opponent: [] },
    nodes: 100,
  };
}

/**
 * Resolves the MOST RECENT pending call for `position` (a stale duplicate
 * can be left behind by a controls/position change that re-issued the
 * request -- `AnalysisSession`'s own token invalidation already makes an
 * older one inert, so picking the latest is what's actually "live"). Wrapped
 * in `act` with a couple of macrotask ticks so the whole microtask chain
 * (fake promise -> `AnalysisSession`'s `.then` -> the controller's `await
 * session.start(...)` continuation -> any resulting `setState` calls) settles
 * before this returns.
 */
async function respondTo(pending: PendingCall[], position: string, result: AnalysisResult): Promise<void> {
  let idx = -1;
  for (let i = pending.length - 1; i >= 0; i--) {
    if (pending[i]!.position === position) {
      idx = i;
      break;
    }
  }
  if (idx === -1) {
    throw new Error(
      `No pending analyseProgressive call for position ${JSON.stringify(position)}. Pending: [${pending
        .map((p) => p.position)
        .join(', ')}]`,
    );
  }
  const [call] = pending.splice(idx, 1);
  await act(async () => {
    call!.onUpdate({ result, budget: result.nodes, elapsedMs: 0 });
    call!.resolve(result);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  });
}

// User moves first (firstMover === userColour === 'red'): ply 0's mover is
// the user. Both sides default to human control unless a test says
// otherwise, so nothing here is muddied by an auto engine move.
const USER_FIRST: Seat = { firstMover: 'red', userColour: 'red' };

afterEach(() => {
  // Nothing global to reset -- each test builds its own fake client/hook
  // instance -- kept as a documented no-op so a future addition here isn't
  // the first thing anyone reaches for.
});

describe('useGameController — blunder flag end-to-end (SPEC §3.2, amended Firing rule)', () => {
  it('(a) fires when the user\'s own human move drops the verdict from win to loss', async () => {
    const { client, pending } = createFakeClient();
    const { result } = renderHook(() => useGameController(client, USER_FIRST));

    act(() => result.current!.setControl('yellow', 'human'));

    await waitFor(() => expect(pending.some((p) => p.position === '')).toBe(true));
    // Ply 0, sideToMove 'first' (the user): positive score -> 'first' wins -> user wins.
    await respondTo(pending, '', fullResult(9, 'first', 3));
    await waitFor(() => expect(result.current!.translated?.position?.kind).toBe('win'));
    expect(result.current!.translated?.best).toBe(3);

    act(() => result.current!.play(2)); // column 3; any legal column does

    await waitFor(() => expect(pending.some((p) => p.position === '3')).toBe(true));
    // Ply 1, sideToMove 'second' (the opponent): positive score -> 'second' wins -> user loses.
    await respondTo(pending, '3', fullResult(5, 'second', 0));

    await waitFor(() => expect(result.current!.blunder).not.toBeNull());
    expect(result.current!.blunder!.beforeKind).toBe('win');
    expect(result.current!.blunder!.bestColumn).toBe(3);
  });

  it('(b) does NOT fire on a speed-only change: same verdict kind before and after with genuinely different distances, both complete', async () => {
    const { client, pending } = createFakeClient();
    const { result } = renderHook(() => useGameController(client, USER_FIRST));

    act(() => result.current!.setControl('yellow', 'human'));

    await waitFor(() => expect(pending.some((p) => p.position === '')).toBe(true));
    // Ply 0: score +9 at 'first' -> user wins, far from resolution (distance data present).
    await respondTo(pending, '', fullResult(9, 'first', 3));
    await waitFor(() => expect(result.current!.translated?.position?.kind).toBe('win'));
    const beforeDistance = result.current!.translated!.position!.distance;
    expect(beforeDistance).not.toBeNull();

    act(() => result.current!.play(2));

    await waitFor(() => expect(pending.some((p) => p.position === '3')).toBe(true));
    // Ply 1, sideToMove 'second': NEGATIVE score -> winner is otherSide('second') = 'first' = the
    // user, still a win -- but a different magnitude, so the underlying distance genuinely
    // differs from `beforeDistance`. If distance leaked into the comparator this would be
    // indistinguishable from a real change; it must still read as "ok".
    await respondTo(pending, '3', fullResult(-3, 'second', 0));
    await waitFor(() => expect(result.current!.translated?.position?.kind).toBe('win'));
    const afterDistance = result.current!.translated!.position!.distance;
    expect(afterDistance).not.toBeNull();
    expect(afterDistance).not.toBe(beforeDistance); // genuinely a different distance...

    expect(result.current!.blunder).toBeNull(); // ...but never fires: kind is unchanged (win -> win).
  });

  it('(c) does NOT fire when the "before" side was a partial (budget-exhausted) analysis', async () => {
    const { client, pending } = createFakeClient();
    const { result } = renderHook(() => useGameController(client, USER_FIRST));

    act(() => result.current!.setControl('yellow', 'human'));

    await waitFor(() => expect(pending.some((p) => p.position === '')).toBe(true));
    await respondTo(pending, '', partialResult('first'));
    await waitFor(() => expect(result.current!.thinking).toBe(false));
    expect(result.current!.translated?.complete).toBe(false);

    act(() => result.current!.play(2));

    await waitFor(() => expect(pending.some((p) => p.position === '3')).toBe(true));
    await respondTo(pending, '3', fullResult(5, 'second', 0)); // a fully solved "loss for the user"

    await waitFor(() => expect(result.current!.translated?.position?.kind).toBe('loss'));
    expect(result.current!.blunder).toBeNull();
  });

  it('(c) does NOT fire when the "after" side is a partial (budget-exhausted) analysis', async () => {
    const { client, pending } = createFakeClient();
    const { result } = renderHook(() => useGameController(client, USER_FIRST));

    act(() => result.current!.setControl('yellow', 'human'));

    await waitFor(() => expect(pending.some((p) => p.position === '')).toBe(true));
    await respondTo(pending, '', fullResult(9, 'first', 3)); // a fully solved win
    await waitFor(() => expect(result.current!.translated?.position?.kind).toBe('win'));

    act(() => result.current!.play(2));

    await waitFor(() => expect(pending.some((p) => p.position === '3')).toBe(true));
    await respondTo(pending, '3', partialResult('second'));

    await waitFor(() => expect(result.current!.thinking).toBe(false));
    expect(result.current!.translated?.complete).toBe(false);
    expect(result.current!.blunder).toBeNull();
  });

  it('(d) undo before the "after" analysis resolves leaves no stale flag for the departed position', async () => {
    const { client, pending } = createFakeClient();
    const { result } = renderHook(() => useGameController(client, USER_FIRST));

    act(() => result.current!.setControl('yellow', 'human'));

    await waitFor(() => expect(pending.some((p) => p.position === '')).toBe(true));
    await respondTo(pending, '', fullResult(9, 'first', 3));
    await waitFor(() => expect(result.current!.translated?.position?.kind).toBe('win'));

    act(() => result.current!.play(2));
    await waitFor(() => expect(pending.some((p) => p.position === '3')).toBe(true));

    // Undo BEFORE the after-position's analysis ever resolves.
    act(() => result.current!.undo());
    await waitFor(() => expect(result.current!.game.currentPly).toBe(0));

    // The abandoned position's request now resolves late, reporting a
    // dramatic loss -- if this were ever attributed to the departed move, it
    // would be a stale blunder flag on a position the user is no longer at.
    await respondTo(pending, '3', fullResult(9, 'second', 0));

    expect(result.current!.blunder).toBeNull();
    expect(result.current!.game.currentPly).toBe(0);
  });

  it('(d) jump-to-ply before the "after" analysis resolves leaves no stale flag for the departed position', async () => {
    const { client, pending } = createFakeClient();
    const { result } = renderHook(() => useGameController(client, USER_FIRST));

    act(() => result.current!.setControl('yellow', 'human'));

    await waitFor(() => expect(pending.some((p) => p.position === '')).toBe(true));
    await respondTo(pending, '', fullResult(9, 'first', 3));
    await waitFor(() => expect(result.current!.translated?.position?.kind).toBe('win'));

    act(() => result.current!.play(2));
    await waitFor(() => expect(pending.some((p) => p.position === '3')).toBe(true));

    act(() => result.current!.jumpToPly(0));
    await waitFor(() => expect(result.current!.game.currentPly).toBe(0));

    await respondTo(pending, '3', fullResult(9, 'second', 0));

    expect(result.current!.blunder).toBeNull();
  });

  it('(e) an engine move never fires the flag, even into a position that looks like a degradation', async () => {
    // The user does NOT move first here: firstMover is yellow, so ply 0's
    // mover is yellow -- engine-controlled by default (`{red:'human',
    // yellow:'engine'}`). The engine's own move must never populate
    // `pendingBlunderRef` (that only happens inside `play()`, which the
    // engine's auto-play path bypasses entirely).
    const seat: Seat = { firstMover: 'yellow', userColour: 'red' };
    const { client, pending } = createFakeClient();
    const { result } = renderHook(() => useGameController(client, seat));

    await waitFor(() => expect(pending.some((p) => p.position === '')).toBe(true));
    // A fully solved result that hands victory to the SIDE TO MOVE ('first' =
    // yellow = the engine) -- i.e. bad news for the user, exactly the shape
    // that would be a "blunder" if it were ever (wrongly) attributed to a
    // human move.
    await respondTo(pending, '', fullResult(9, 'first', 0));

    await waitFor(() => expect(result.current!.game.moves.length).toBe(1)); // the engine auto-played
    expect(result.current!.blunder).toBeNull();
  });
});
