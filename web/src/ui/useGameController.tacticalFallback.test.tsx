// @vitest-environment jsdom

// Controller-level coverage for the SPEC §3.1a post-gate amendment: on cap
// expiry (`complete: false`), `useGameController` calls `tacticalFallback`
// instead of restricting the level rule to a partial deep search's solved
// subset (the superseded rule), falling back to the centre-most legal
// column only if the tactical call itself fails. Same responding-fake
// `EngineClient` pattern as `useGameController.blunder.test.tsx`/
// `useGameController.lamp.test.tsx` (a fake that answers ON DEMAND, unlike
// `App.test.tsx`'s never-answering `FakeWorker`), extended with a
// controllable `tacticalFallback`.

import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useGameController } from './useGameController.js';
import { TACTICAL_HORIZON_PLY } from '../game/levels.js';
import type { AnalyseProgressiveOptions, Calibration, EngineClient } from '../engine/client.js';
import type { AnalysisResult, TacticalAnalysis } from '../engine/types.js';
import type { Seat, Side } from '../game/seat.js';

interface PendingAnalyse {
  position: string;
  onUpdate: AnalyseProgressiveOptions['onUpdate'];
  resolve: (result: AnalysisResult) => void;
}

interface PendingTactical {
  position: string;
  maxPly: number;
  resolve: (result: TacticalAnalysis) => void;
  reject: (err: Error) => void;
}

function createFakeClient(): {
  client: EngineClient;
  pending: PendingAnalyse[];
  tactical: PendingTactical[];
  bookEnabledCalls: boolean[];
} {
  const pending: PendingAnalyse[] = [];
  const tactical: PendingTactical[] = [];
  const bookEnabledCalls: boolean[] = [];
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
    tacticalFallback: (position, maxPly) =>
      new Promise<TacticalAnalysis>((resolve, reject) => {
        tactical.push({ position, maxPly, resolve, reject });
      }),
    loadBookFromNetwork: async () => {
      throw new Error('loadBookFromNetwork() is not used by this test');
    },
    setBookEnabled: async (enabled: boolean) => {
      bookEnabledCalls.push(enabled);
    },
    terminate: () => {},
  };
  return { client, pending, tactical, bookEnabledCalls };
}

/** A budget-exhausted result: some columns solved, `complete: false` -- the
 * shape that must now trigger `tacticalFallback`, never the old "restrict to
 * solved" rule. */
function partialResult(sideToMove: Side): AnalysisResult {
  return {
    columns: [
      { kind: 'score', score: 1 },
      { kind: 'unknown' },
      { kind: 'unknown' },
      { kind: 'unknown' },
      { kind: 'unknown' },
      { kind: 'unknown' },
      { kind: 'unknown' },
    ],
    best: null,
    complete: false,
    sideToMove,
    threats: { current: [], opponent: [] },
    nodes: 100,
  };
}

function tacticalResult(best: number): TacticalAnalysis {
  return {
    columns: Array.from({ length: 7 }, (_, i) => ({ kind: 'score' as const, score: i === best ? 5 : 0 })),
    best,
  };
}

async function respondToAnalyse(pending: PendingAnalyse[], position: string, result: AnalysisResult): Promise<void> {
  let idx = -1;
  for (let i = pending.length - 1; i >= 0; i--) {
    if (pending[i]!.position === position) {
      idx = i;
      break;
    }
  }
  if (idx === -1) throw new Error(`No pending analyseProgressive call for position ${JSON.stringify(position)}.`);
  const [call] = pending.splice(idx, 1);
  await act(async () => {
    call!.onUpdate({ result, budget: result.nodes, elapsedMs: 0 });
    call!.resolve(result);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  });
}

function findTactical(tactical: PendingTactical[], position: string): PendingTactical {
  const idx = tactical.map((t) => t.position).lastIndexOf(position);
  if (idx === -1) {
    throw new Error(
      `No pending tacticalFallback call for position ${JSON.stringify(position)}. Pending: [${tactical
        .map((t) => t.position)
        .join(', ')}]`,
    );
  }
  const [call] = tactical.splice(idx, 1);
  return call!;
}

async function respondToTactical(tactical: PendingTactical[], position: string, result: TacticalAnalysis): Promise<void> {
  const call = findTactical(tactical, position);
  await act(async () => {
    call.resolve(result);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function rejectTactical(tactical: PendingTactical[], position: string, err: Error): Promise<void> {
  const call = findTactical(tactical, position);
  await act(async () => {
    call.reject(err);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  });
}

// yellow moves first, engine-controlled by the role-based default (the user
// is red) -- so ply 0 is immediately the engine's own turn, with no human
// move needed to trigger it.
const ENGINE_MOVES_FIRST: Seat = { firstMover: 'yellow', userColour: 'red' };

describe('useGameController — cap-expiry engine move (SPEC §3.1a, post-gate amendment)', () => {
  it('calls tacticalFallback (never the old solved-subset rule) when the analysis is incomplete, and plays its result marked "tactical"', async () => {
    const { client, pending, tactical } = createFakeClient();
    const { result } = renderHook(() => useGameController(client, ENGINE_MOVES_FIRST));

    await waitFor(() => expect(pending.some((p) => p.position === '')).toBe(true));
    await respondToAnalyse(pending, '', partialResult('first'));

    await waitFor(() => expect(tactical.some((t) => t.position === '')).toBe(true));
    // Default level is 'strong' -- the horizon mapping this wave chose.
    const call = tactical.find((t) => t.position === '')!;
    expect(call.maxPly).toBe(TACTICAL_HORIZON_PLY.strong);

    await respondToTactical(tactical, '', tacticalResult(4));

    await waitFor(() => expect(result.current!.game.moves.length).toBe(1));
    expect(result.current!.game.moves[0]).toEqual({ column: 4, partial: true, origin: 'tactical' });
    expect(result.current!.moveListEntries[0]!.partial).toBe(true);
  });

  it('the level label\'s own surface (levelQualifiers) reflects "tactical" for the colour that just moved this way', async () => {
    const { client, pending, tactical } = createFakeClient();
    const { result } = renderHook(() => useGameController(client, ENGINE_MOVES_FIRST));

    await waitFor(() => expect(pending.some((p) => p.position === '')).toBe(true));
    await respondToAnalyse(pending, '', partialResult('first'));
    await waitFor(() => expect(tactical.some((t) => t.position === '')).toBe(true));
    await respondToTactical(tactical, '', tacticalResult(4));

    await waitFor(() => expect(result.current!.game.moves.length).toBe(1));
    expect(result.current!.levelQualifiers.yellow).toBe('tactical');
    expect(result.current!.levelQualifiers.red).toBeNull(); // red hasn't moved at all yet
  });

  it('falls back to the centre-most legal column, marked "centre-fallback", when tacticalFallback itself rejects', async () => {
    const { client, pending, tactical } = createFakeClient();
    const { result } = renderHook(() => useGameController(client, ENGINE_MOVES_FIRST));

    await waitFor(() => expect(pending.some((p) => p.position === '')).toBe(true));
    await respondToAnalyse(pending, '', partialResult('first'));
    await waitFor(() => expect(tactical.some((t) => t.position === '')).toBe(true));
    await rejectTactical(tactical, '', new Error('tactical_fallback could not run'));

    await waitFor(() => expect(result.current!.game.moves.length).toBe(1));
    // Empty board -> the true centre (0-indexed column 3) is legal.
    expect(result.current!.game.moves[0]).toEqual({ column: 3, partial: true, origin: 'centre-fallback' });
    expect(result.current!.levelQualifiers.yellow).toBe('centre-fallback');
  });

  it('a COMPLETE analysis never calls tacticalFallback at all, and clears any earlier qualifier', async () => {
    const { client, pending, tactical } = createFakeClient();
    const { result } = renderHook(() => useGameController(client, ENGINE_MOVES_FIRST));

    await waitFor(() => expect(pending.some((p) => p.position === '')).toBe(true));
    // The default level is 'strong', which picks uniformly among every
    // column within 2 points of the best -- column 2 must be the ONLY
    // candidate for this assertion to be deterministic, so every other
    // column scores far enough below it to be excluded.
    await respondToAnalyse(pending, '', {
      columns: Array.from({ length: 7 }, (_, i) => ({ kind: 'score' as const, score: i === 2 ? 5 : -18 })),
      best: 2,
      complete: true,
      sideToMove: 'first',
      threats: { current: [], opponent: [] },
      nodes: 999,
    });

    await waitFor(() => expect(result.current!.game.moves.length).toBe(1));
    expect(result.current!.game.moves[0]).toEqual({ column: 2 });
    expect(tactical).toHaveLength(0);
    expect(result.current!.levelQualifiers.yellow).toBeNull();
  });

  it('stale-race: the position moving on (a human undo) while tacticalFallback is still in flight discards the late result -- no misapplied move', async () => {
    // The user (red) moves first here so there's a human move to undo;
    // yellow (engine) is the opponent, engine-controlled by default.
    const seat: Seat = { firstMover: 'red', userColour: 'red' };
    const { client, pending, tactical } = createFakeClient();
    const { result } = renderHook(() => useGameController(client, seat));

    await waitFor(() => expect(pending.some((p) => p.position === '')).toBe(true));
    await respondToAnalyse(pending, '', {
      columns: Array.from({ length: 7 }, () => ({ kind: 'score' as const, score: 1 })),
      best: 3,
      complete: true,
      sideToMove: 'first',
      threats: { current: [], opponent: [] },
      nodes: 999,
    });

    act(() => result.current!.play(3)); // the user's own human move, column 4
    await waitFor(() => expect(pending.some((p) => p.position === '4')).toBe(true));
    await respondToAnalyse(pending, '4', partialResult('second')); // now yellow's (engine) turn, cap expires

    await waitFor(() => expect(tactical.some((t) => t.position === '4')).toBe(true));

    // The user undoes BEFORE yellow's tacticalFallback call ever resolves.
    act(() => result.current!.undo());
    await waitFor(() => expect(result.current!.game.currentPly).toBe(0));

    // The abandoned position's tactical call now resolves late.
    await respondToTactical(tactical, '4', tacticalResult(0));

    // Still at ply 0, still exactly the one (undone-but-kept) human move --
    // the stale tactical result must never have appended a second move.
    expect(result.current!.game.currentPly).toBe(0);
    expect(result.current!.game.moves).toHaveLength(1);
    expect(result.current!.game.moves[0]).toEqual({ column: 3 });
  });
});
