// @vitest-environment jsdom

// Wave 13 (docs/DESIGN-DIRECTION.md §17, review stepper) — integration-level
// tests at the `App` seam, mirroring `App.gamesLog.test.tsx`'s own house
// style: `ReviewStepper`/`useReviewSession`/`GamesSheet`'s row-tap are each
// unit-tested on their own; these prove the real app wires them together --
// the sheet's row actually opens the review of THAT logged game, review
// closes back to the sheet, and the live game underneath is left untouched.

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import App from './App.js';
import { SEAT_STORAGE_KEY } from './seatStorage.js';
import { installMemoryLocalStorage } from './testMemoryStorage.js';

installMemoryLocalStorage();

class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage(): void {}
  terminate(): void {}
}
(globalThis as unknown as { Worker: typeof FakeWorker }).Worker = FakeWorker;

beforeEach(() => {
  window.localStorage.setItem(SEAT_STORAGE_KEY, JSON.stringify({ firstMover: 'red', userColour: 'red' }));
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

// Seeds one logged game (seat DELIBERATELY different from the active
// session's { firstMover: red, userColour: red } above -- DoD item 4: the
// review must use the LOGGED game's own seat) via the same import path
// `App.gamesLog.test.tsx`'s own "non-empty loggedGames" test already proves
// end to end.
function seedLoggedGame() {
  const envelope = {
    version: 2,
    exported: '2026-07-29T00:00:00.000Z',
    games: [{ seat: { firstMover: 'red', userColour: 'red' }, setupPrefix: '', moves: [], date: '2026-07-29T00:00:00.000Z' }],
    loggedGames: [
      {
        id: 'seeded-1',
        date: '2026-07-20T00:00:00.000Z',
        opponent: 'Carla',
        seat: { firstMover: 'yellow', userColour: 'yellow' },
        moves: [3, 0, 3, 1, 3, 2, 3], // finished: yellow (the first mover = the user) stacks column 4 -> yellow wins vertically -> "You won"; stored result deliberately disagrees (board-derived truth must win)
        result: 'loss',
        source: 'live',
      },
    ],
  };
  const file = new File([JSON.stringify(envelope)], 'game.json', { type: 'application/json' });
  const input = screen.getByLabelText('Import game file') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

describe('Games sheet row -> review (design §16.2/§17, Wave 13)', () => {
  it('tapping a row opens the review of that logged game, using its OWN seat, not the active session seat', async () => {
    render(<App />);
    seedLoggedGame();

    fireEvent.click(screen.getByRole('button', { name: 'Games ▸' }));
    fireEvent.click(await screen.findByRole('button', { name: /review the game against carla/i }));

    expect(screen.getByRole('dialog', { name: 'Game review' })).toBeInTheDocument();
    // The reviewed game's seat is { firstMover: yellow, userColour: yellow }
    // -- distinct from the active session's { firstMover: red, userColour:
    // red } seeded in beforeEach -- so the seat line must read from ITS OWN
    // seat, not the app's.
    expect(screen.getByText('You were yellow. You moved first.')).toBeInTheDocument();
    expect(screen.getByText('Ply 0 of 7 — your move.')).toBeInTheDocument();
  });

  it('"‹ Games" returns to the sheet with the same row still there', async () => {
    render(<App />);
    seedLoggedGame();

    fireEvent.click(screen.getByRole('button', { name: 'Games ▸' }));
    fireEvent.click(await screen.findByRole('button', { name: /review the game against carla/i }));
    fireEvent.click(screen.getByRole('button', { name: '‹ Games' }));

    expect(screen.queryByRole('dialog', { name: 'Game review' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Games' })).toBeInTheDocument();
    expect(screen.getByText('Carla')).toBeInTheDocument();
  });

  it('the live game\'s digit/undo/redo keys do nothing while review is open, and resume once it closes', async () => {
    render(<App />);
    seedLoggedGame();

    fireEvent.click(screen.getByRole('button', { name: 'Games ▸' }));
    fireEvent.click(await screen.findByRole('button', { name: /review the game against carla/i }));

    // The live game had 0 moves at import time (see envelope's `games[0]`) --
    // pressing a digit key must NOT play a move on the live game while
    // review owns the keyboard.
    fireEvent.keyDown(window, { key: '4' });
    fireEvent.click(screen.getByRole('button', { name: '‹ Games' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByText('Moves (0)')).toBeInTheDocument();

    // Now that review is closed, the SAME key plays normally.
    fireEvent.keyDown(window, { key: '4' });
    expect(screen.getByText('Moves (1)')).toBeInTheDocument();
  });
});
