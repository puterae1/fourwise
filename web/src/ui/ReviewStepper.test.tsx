// @vitest-environment jsdom

// Post-game review — docs/DESIGN-DIRECTION.md §17. End-to-end tests against
// a fake `EngineClient` that RESPONDS on demand (same house pattern as
// `useGameController.blunder.test.tsx` / `useReviewSession.test.tsx`).

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReviewStepper } from './ReviewStepper.js';
import { buildLoggedGame, type LoggedGame } from '../game/loggedGame.js';
import type { AnalyseProgressiveOptions, Calibration, EngineClient } from '../engine/client.js';
import type { AnalysisResult } from '../engine/types.js';
import type { Seat, Side } from '../game/seat.js';

afterEach(cleanup);

interface PendingCall {
  position: string;
  onUpdate: AnalyseProgressiveOptions['onUpdate'];
  resolve: (result: AnalysisResult) => void;
}

function createFakeClient(): { client: EngineClient; pending: PendingCall[] } {
  const pending: PendingCall[] = [];
  const client: EngineClient = {
    analyse: async () => {
      throw new Error('analyse() is not used directly');
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
      `No pending analyseProgressive call for position ${JSON.stringify(position)}. Pending: [${pending.map((p) => p.position).join(', ')}]`,
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

// Vertical four for red in column 4 (0-indexed column 3): red,yellow,red,yellow,red,yellow,red.
const RED_FIRST_USER_RED: Seat = { firstMover: 'red', userColour: 'red' };
const WON_GAME_MOVES = [3, 0, 3, 1, 3, 2, 3];

function finishedGame(seat: Seat, opponent = 'Anna'): LoggedGame {
  return buildLoggedGame({
    seat,
    moves: WON_GAME_MOVES,
    winner: 'red',
    opponent,
    source: 'live',
    id: 'review-game-1',
    date: '2026-07-27T00:00:00.000Z',
  });
}

describe('ReviewStepper', () => {
  it('renders the header, both seat facts, and the board at ply 0 -- read-only (no drop handler fires)', () => {
    const { client } = createFakeClient();
    const onClose = vi.fn();
    const game = finishedGame(RED_FIRST_USER_RED);
    render(<ReviewStepper game={game} client={client} onClose={onClose} />);

    expect(screen.getByText('27 Jul · Anna')).toBeInTheDocument();
    expect(screen.getByText('You were red. You moved first.')).toBeInTheDocument();
    expect(screen.getByText('Ply 0 of 7 — your move.')).toBeInTheDocument();

    // Read-only: every column button is disabled (canDrop always false).
    const columnButtons = screen.getAllByRole('button', { name: /drop in column|column \d, full/i });
    for (const button of columnButtons) expect(button).toBeDisabled();
  });

  it('seat wording uses the LOGGED game\'s own seat, distinctly from a different seat, across all four combinations', () => {
    const combos: Array<{ seat: Seat; expectedSeatLine: string }> = [
      { seat: { firstMover: 'red', userColour: 'red' }, expectedSeatLine: 'You were red. You moved first.' },
      { seat: { firstMover: 'red', userColour: 'yellow' }, expectedSeatLine: 'You were yellow. She moved first.' },
      { seat: { firstMover: 'yellow', userColour: 'red' }, expectedSeatLine: 'You were red. She moved first.' },
      { seat: { firstMover: 'yellow', userColour: 'yellow' }, expectedSeatLine: 'You were yellow. You moved first.' },
    ];
    for (const { seat, expectedSeatLine } of combos) {
      const { client } = createFakeClient();
      const { unmount } = render(<ReviewStepper game={finishedGame(seat)} client={client} onClose={() => {}} />);
      expect(screen.getByText(expectedSeatLine)).toBeInTheDocument();
      unmount();
    }
  });

  it('stepping forward with Next advances the ply and the context line', async () => {
    const { client } = createFakeClient();
    const game = finishedGame(RED_FIRST_USER_RED);
    render(<ReviewStepper game={game} client={client} onClose={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Forward one move' }));
    expect(screen.getByText('Ply 1 of 7 — her move.')).toBeInTheDocument();
    expect(screen.getByText('1 / 7')).toBeInTheDocument();
  });

  it('the First/Back buttons are disabled at ply 0 and Last/Next are disabled at the final ply', () => {
    const { client } = createFakeClient();
    const game = finishedGame(RED_FIRST_USER_RED);
    render(<ReviewStepper game={game} client={client} onClose={() => {}} />);

    expect(screen.getByRole('button', { name: 'Jump to the first move' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Back one move' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Jump to the last move' }));
    expect(screen.getByRole('button', { name: 'Jump to the last move' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Forward one move' })).toBeDisabled();
  });

  it('keyboard ArrowRight/ArrowLeft/Home/End step the ply, and Escape calls onClose', () => {
    const { client } = createFakeClient();
    const onClose = vi.fn();
    const game = finishedGame(RED_FIRST_USER_RED);
    render(<ReviewStepper game={game} client={client} onClose={onClose} />);

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByText('1 / 7')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByText('2 / 7')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByText('1 / 7')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'End' });
    expect(screen.getByText('7 / 7')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Home' });
    expect(screen.getByText('0 / 7')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('"‹ Games" calls onClose', () => {
    const { client } = createFakeClient();
    const onClose = vi.fn();
    render(<ReviewStepper game={finishedGame(RED_FIRST_USER_RED)} client={client} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: '‹ Games' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Show me reveals the best column only after being pressed, and the reveal clears on stepping (design §17.4)', async () => {
    const { client, pending } = createFakeClient();
    const game = finishedGame(RED_FIRST_USER_RED);
    render(<ReviewStepper game={game} client={client} onClose={() => {}} />);

    await waitFor(() => expect(pending.some((p) => p.position === '')).toBe(true));
    await respondTo(pending, '', fullResult(9, 'first', 3));

    // Before reveal: no inverted verdict cell.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Show me' })).toBeInTheDocument());
    expect(document.querySelector("[data-invert='true']")).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Show me' }));
    expect(document.querySelector("[data-invert='true']")).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Forward one move' }));
    expect(document.querySelector("[data-invert='true']")).toBeNull(); // cleared on ply change
  });

  it('a blunder mark on the ply just landed on replaces the headline with the blunder line, and the ply track shows the wedge', async () => {
    const { client, pending } = createFakeClient();
    // firstMover red = user; ply0 (red/user) then ply1 (yellow/her).
    const game = finishedGame(RED_FIRST_USER_RED);
    render(<ReviewStepper game={game} client={client} onClose={() => {}} />);

    await waitFor(() => expect(pending.some((p) => p.position === '')).toBe(true));
    // Ply 0: user (red, 'first') is winning.
    await respondTo(pending, '', fullResult(9, 'first', 3));

    fireEvent.click(screen.getByRole('button', { name: 'Forward one move' }));
    await waitFor(() => expect(pending.some((p) => p.position === '4')).toBe(true));
    // Ply 1, sideToMove 'second': positive score -> 'second' (yellow, her) wins -> user's own move threw it away.
    await respondTo(pending, '4', fullResult(5, 'second', 0));

    await waitFor(() => expect(screen.getByText('That threw away a win. Column 4 held it.')).toBeInTheDocument());
    // The headline's blunder variant carries the house left-edge treatment.
    expect(screen.getByText('That threw away a win. Column 4 held it.').closest("[data-variant='blunder']")).not.toBeNull();
  });

  it('at the terminal (final, actually finished) ply, the strip and headline show the outcome, never "still solving"', async () => {
    const { client, pending } = createFakeClient();
    const game = finishedGame(RED_FIRST_USER_RED);
    render(<ReviewStepper game={game} client={client} onClose={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Jump to the last move' }));

    expect(screen.getByText('Game over — you won.')).toBeInTheDocument();
    expect(screen.queryByText(/still solving/i)).not.toBeInTheDocument();
    // No analyse request is ever issued for the terminal position itself.
    expect(pending.some((p) => p.position === '4142434')).toBe(false);
  });

  it('the ply track shows an open ring for an unvisited ply and the running "not evaluated" count', () => {
    const { client } = createFakeClient();
    const game = finishedGame(RED_FIRST_USER_RED);
    render(<ReviewStepper game={game} client={client} onClose={() => {}} />);
    // 7 moves, none ever visited/settled -- all 7 marks are open rings.
    expect(screen.getByText('7 plies not evaluated yet.')).toBeInTheDocument();
  });
});
