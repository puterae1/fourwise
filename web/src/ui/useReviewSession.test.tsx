// @vitest-environment jsdom

// End-to-end tests for `useReviewSession` against a fake `EngineClient` that
// RESPONDS on demand (mirrors `useGameController.blunder.test.tsx`'s own
// house pattern -- see that file's header comment for why this sits at the
// `EngineClient` boundary rather than the lower `AnalyseTransport` one).

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useReviewSession } from './useReviewSession.js';
import { buildLoggedGame, type LoggedGame } from '../game/loggedGame.js';
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
      throw new Error('analyse() is not used by useReviewSession directly');
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
      throw new Error('tacticalFallback() is not used by review');
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

// Red moves first and IS the user -- ply 0's mover is the user.
const USER_FIRST: Seat = { firstMover: 'red', userColour: 'red' };

function gameOf(moves: number[], seat: Seat = USER_FIRST): LoggedGame {
  return buildLoggedGame({
    seat,
    moves,
    winner: null,
    opponent: 'Anna',
    source: 'live',
    id: 'g1',
    date: '2026-07-29T00:00:00.000Z',
  });
}

afterEach(() => {});

describe('useReviewSession', () => {
  it('starts at ply 0 and evaluates the position at the current ply on demand', async () => {
    const { client, pending } = createFakeClient();
    const game = gameOf([3, 0, 3]);
    const { result } = renderHook(() => useReviewSession(client, game));

    expect(result.current.currentPly).toBe(0);
    await waitFor(() => expect(pending.some((p) => p.position === '')).toBe(true));
    await respondTo(pending, '', fullResult(9, 'first', 3));

    await waitFor(() => expect(result.current.translated?.position?.kind).toBe('win'));
    expect(result.current.translated?.best).toBe(3);
  });

  it('stepping forward evaluates the NEW position, not a bulk pre-solve of the whole game', async () => {
    const { client, pending } = createFakeClient();
    const game = gameOf([3, 0, 3]);
    const { result } = renderHook(() => useReviewSession(client, game));

    await waitFor(() => expect(pending.some((p) => p.position === '')).toBe(true));
    await respondTo(pending, '', fullResult(9, 'first', 3));

    act(() => result.current.goNext());
    expect(result.current.currentPly).toBe(1);

    // Only ply 1's position is requested -- plies 2/3 were never touched.
    await waitFor(() => expect(pending.some((p) => p.position === '4')).toBe(true));
    expect(pending.some((p) => p.position === '41' || p.position === '414')).toBe(false);
  });

  it('caches a settled result per ply -- revisiting an already-evaluated ply issues no new request', async () => {
    const { client, pending } = createFakeClient();
    const game = gameOf([3, 0]);
    const { result } = renderHook(() => useReviewSession(client, game));

    await waitFor(() => expect(pending.some((p) => p.position === '')).toBe(true));
    await respondTo(pending, '', fullResult(9, 'first', 3));

    act(() => result.current.goNext());
    await waitFor(() => expect(pending.some((p) => p.position === '4')).toBe(true));
    await respondTo(pending, '4', fullResult(5, 'second', 0));

    act(() => result.current.goPrev()); // back to ply 0 -- already cached
    expect(result.current.currentPly).toBe(0);
    expect(result.current.translated?.position?.kind).toBe('win'); // instantly available, no new pending call
    expect(pending.length).toBe(0);
  });

  it('the ply track shows an open ring for a never-visited ply and a running not-evaluated count', async () => {
    const { client, pending } = createFakeClient();
    const game = gameOf([3, 0, 3, 1]); // 4 moves -> 4 track marks
    const { result } = renderHook(() => useReviewSession(client, game));

    await waitFor(() => expect(pending.some((p) => p.position === '')).toBe(true));
    // Never respond -- ply 0 stays unevaluated forever in this test.
    expect(result.current.plyTrack.marks).toHaveLength(4);
    expect(result.current.plyTrack.marks.every((m) => m.kind === 'unevaluated')).toBe(true);
    expect(result.current.plyTrack.notEvaluatedCount).toBe(4);
  });

  it('a blunder mark appears once BOTH neighbouring plies have a settled, complete analysis showing a degradation', async () => {
    const { client, pending } = createFakeClient();
    const game = gameOf([3, 0]); // 2 moves: ply0 -(move 3)-> ply1 -(move 0)-> ply2
    const { result } = renderHook(() => useReviewSession(client, game));

    await waitFor(() => expect(pending.some((p) => p.position === '')).toBe(true));
    // Ply 0, sideToMove 'first' (user, red): positive score -> user wins.
    await respondTo(pending, '', fullResult(9, 'first', 3));
    expect(result.current.plyTrack.marks[0]).toEqual({ kind: 'unevaluated' }); // ply1 not visited yet

    act(() => result.current.goNext());
    await waitFor(() => expect(pending.some((p) => p.position === '4')).toBe(true));
    // Ply 1, sideToMove 'second': positive score -> 'second' wins -> user (red) loses.
    await respondTo(pending, '4', fullResult(5, 'second', 0));

    await waitFor(() =>
      expect(result.current.plyTrack.marks[0]).toEqual({ kind: 'blunder', bestColumnBefore: 3, beforeKind: 'win' }),
    );
    expect(result.current.plyTrack.notEvaluatedCount).toBe(1); // the 1->2 transition still unvisited
  });

  it('a partial (budget-exhausted) analysis on either side never produces a blunder mark, only an open ring', async () => {
    const { client, pending } = createFakeClient();
    const game = gameOf([3, 0]);
    const { result } = renderHook(() => useReviewSession(client, game));

    await waitFor(() => expect(pending.some((p) => p.position === '')).toBe(true));
    await respondTo(pending, '', partialResult('first'));

    act(() => result.current.goNext());
    await waitFor(() => expect(pending.some((p) => p.position === '4')).toBe(true));
    await respondTo(pending, '4', fullResult(9, 'second', 0)); // a fully solved "loss for the user"

    expect(result.current.plyTrack.marks[0]).toEqual({ kind: 'unevaluated' });
  });

  it('Show me reveals the best column only for the CURRENT ply, and stepping clears it', async () => {
    const { client, pending } = createFakeClient();
    const game = gameOf([3, 0]);
    const { result } = renderHook(() => useReviewSession(client, game));

    await waitFor(() => expect(pending.some((p) => p.position === '')).toBe(true));
    await respondTo(pending, '', fullResult(9, 'first', 3));

    expect(result.current.revealed).toBe(false);
    act(() => result.current.showBest());
    expect(result.current.revealed).toBe(true);

    act(() => result.current.goNext());
    expect(result.current.revealed).toBe(false); // gate cleared on ply change

    act(() => result.current.goPrev());
    expect(result.current.revealed).toBe(false); // does NOT come back on its own either
  });

  it('goNext sets animateForward true; every other navigation sets it false (design §17.5)', async () => {
    const { client } = createFakeClient();
    const game = gameOf([3, 0, 3]);
    const { result } = renderHook(() => useReviewSession(client, game));

    expect(result.current.animateForward).toBe(false);
    act(() => result.current.goNext());
    expect(result.current.animateForward).toBe(true);
    act(() => result.current.goPrev());
    expect(result.current.animateForward).toBe(false);
    act(() => result.current.goNext());
    expect(result.current.animateForward).toBe(true);
    act(() => result.current.goLast());
    expect(result.current.animateForward).toBe(false);
    act(() => result.current.goFirst());
    expect(result.current.animateForward).toBe(false);
    act(() => result.current.goNext());
    expect(result.current.animateForward).toBe(true);
    act(() => result.current.jumpToPly(2));
    expect(result.current.animateForward).toBe(false);
  });

  it('rawColumns mirrors the settled AnalysisResult\'s own columns for the current ply', async () => {
    const { client, pending } = createFakeClient();
    const game = gameOf([3]);
    const { result } = renderHook(() => useReviewSession(client, game));

    await waitFor(() => expect(pending.some((p) => p.position === '')).toBe(true));
    const solved = fullResult(9, 'first', 3);
    await respondTo(pending, '', solved);

    await waitFor(() => expect(result.current.rawColumns).not.toBeNull());
    expect(result.current.rawColumns).toEqual(solved.columns);
  });

  it('a genuinely finished game never issues an analyse call at its final ply, and reports the terminal outcome', async () => {
    const { client, pending } = createFakeClient();
    // Vertical four for red (the user, first mover) in column 4: red,yellow,red,yellow,red,yellow,red.
    const game = gameOf([3, 0, 3, 1, 3, 2, 3]);
    const { result } = renderHook(() => useReviewSession(client, game));

    act(() => result.current.goLast());
    expect(result.current.currentPly).toBe(7);
    expect(result.current.board.isGameOver).toBe(true);
    expect(result.current.terminal).toEqual({ kind: 'win', sentence: 'Game over — you won.' });
    // No analyse call for the terminal ply itself.
    expect(pending.some((p) => p.position === '4142434')).toBe(false);
  });
});
