// @vitest-environment jsdom

// Integration-level tests for SPEC §5's "current game survives a refresh"
// and the JSON export/import wiring, at the `App` seam (the isolated
// persistence functions are already covered by `gameStorage.test.ts` and
// `../game/gameStateStorage.test.ts`/`exportFormat.test.ts` -- these prove
// the real app actually calls them, and that a corrupt stored game never
// crashes the app it's restoring into).

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import App from './App.js';
import { SEAT_STORAGE_KEY } from './seatStorage.js';
import { GAME_STORAGE_KEY } from './gameStorage.js';
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

describe('game-state persistence (SPEC §5)', () => {
  it('restores a stored game with moves already played', () => {
    window.localStorage.setItem(
      GAME_STORAGE_KEY,
      JSON.stringify({
        seat: { firstMover: 'red', userColour: 'red' },
        mode: 'play',
        setupPrefix: '',
        moves: [{ column: 3 }, { column: 2 }],
        currentPly: 2,
      }),
    );

    render(<App />);
    expect(screen.getByText('Moves (2)')).toBeInTheDocument();
  });

  it('a corrupt stored game never crashes the app -- falls back to a fresh game', () => {
    window.localStorage.setItem(GAME_STORAGE_KEY, '{ not valid json at all');

    render(<App />);
    expect(screen.getByText('Moves (0)')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'PLAY' })).toBeInTheDocument();
  });

  it('a validly-shaped but illegal stored game (overfull column) never crashes -- falls back to a fresh game', () => {
    window.localStorage.setItem(
      GAME_STORAGE_KEY,
      JSON.stringify({
        seat: { firstMover: 'red', userColour: 'red' },
        mode: 'play',
        setupPrefix: '',
        moves: Array.from({ length: 7 }, () => ({ column: 3 })),
        currentPly: 7,
      }),
    );

    render(<App />);
    expect(screen.getByText('Moves (0)')).toBeInTheDocument();
  });

  it('playing a move persists the game -- reloading the app afterwards restores it', () => {
    const { unmount } = render(<App />);
    fireEvent.keyDown(window, { key: '4' });
    expect(screen.getByText('Moves (1)')).toBeInTheDocument();
    unmount();

    render(<App />);
    expect(screen.getByText('Moves (1)')).toBeInTheDocument();
  });
});

describe('export / import (SPEC §5 amendment)', () => {
  it('Export and Import controls are present', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import' })).toBeInTheDocument();
  });

  it('importing a well-formed exported file replaces the current game', async () => {
    render(<App />);
    fireEvent.keyDown(window, { key: '4' });
    expect(screen.getByText('Moves (1)')).toBeInTheDocument();

    const envelope = {
      version: 1,
      exported: '2026-07-28T00:00:00.000Z',
      games: [
        {
          seat: { firstMover: 'yellow', userColour: 'yellow' },
          setupPrefix: '',
          moves: [{ column: 0 }, { column: 1 }, { column: 2 }],
          date: '2026-07-28T00:00:00.000Z',
        },
      ],
    };
    const file = new File([JSON.stringify(envelope)], 'game.json', { type: 'application/json' });
    const input = screen.getByLabelText('Import game file') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await screen.findByText('Moves (3)');
    expect(screen.queryByText(/not valid JSON|This file/)).not.toBeInTheDocument();
  });

  it('importing a malformed file shows the honest failure message and leaves the game untouched', async () => {
    render(<App />);
    fireEvent.keyDown(window, { key: '4' });
    expect(screen.getByText('Moves (1)')).toBeInTheDocument();

    const file = new File(['{ not json'], 'bad.json', { type: 'application/json' });
    const input = screen.getByLabelText('Import game file') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await screen.findByText('That file is not valid JSON.');
    expect(screen.getByText('Moves (1)')).toBeInTheDocument();
  });
});
