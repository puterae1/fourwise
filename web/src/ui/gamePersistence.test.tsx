// @vitest-environment jsdom

// Integration-level tests for SPEC §5's "current game survives a refresh"
// and the JSON export/import wiring, at the `App` seam (the isolated
// persistence functions are already covered by `gameStorage.test.ts` and
// `../game/gameStateStorage.test.ts`/`exportFormat.test.ts` -- these prove
// the real app actually calls them, and that a corrupt stored game never
// crashes the app it's restoring into).

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

  // Verifier audit, Wave 6a, item 4 -- a direct single-flow test for a
  // property that otherwise only holds by COMPOSING two separate tests
  // (`firstRun.test.tsx`'s "does NOT touch the stored preference" plus this
  // file's "a restored game keeps its OWN seat"). Exercised here end to
  // end: change seat in-app, unmount (simulating a tab close), remount
  // (simulating reopening it), and assert the restored game is playing
  // under the CHANGED seat, not the original stored preference.
  it('changing seat in-app, then unmounting and remounting, restores the game under the CHANGED seat', () => {
    // beforeEach seeded the preference as { firstMover: red, userColour:
    // red } -- deliberately left untouched below, so this also proves the
    // remount reads the changed seat from the GAME record, not from it.
    const { unmount } = render(<App />);

    const appUserColour = screen.getByRole('radiogroup', { name: 'Your colour' });
    fireEvent.click(within(appUserColour).getByRole('radio', { name: 'Yellow' }));
    unmount();

    render(<App />);

    const restoredUserColour = screen.getByRole('radiogroup', { name: 'Your colour' });
    const restoredFirstMover = screen.getByRole('radiogroup', { name: 'Which colour moves first' });
    expect((within(restoredUserColour).getByRole('radio', { name: 'Yellow' }) as HTMLInputElement).checked).toBe(
      true,
    );
    // "Moves first" was never touched -- still red, exactly as seeded.
    expect((within(restoredFirstMover).getByRole('radio', { name: 'Red' }) as HTMLInputElement).checked).toBe(true);

    // And the preference on disk is still the original -- the remount's
    // correct seat came from the game record, not from it.
    expect(JSON.parse(window.localStorage.getItem(SEAT_STORAGE_KEY) ?? 'null')).toEqual({
      firstMover: 'red',
      userColour: 'red',
    });
  });

  // Seat persistence architecture (owner ruling, 2026-07-28, mid-Wave-6a):
  // a restored game's OWN embedded seat wins outright, even when the
  // separately-stored `fourwise:seat` preference disagrees with it -- the
  // preference is a first-run default, not a standing override. This is the
  // integration-level pin for the property `useGameController.controls.
  // test.tsx`'s "a restored game's seat wins over a differing stored
  // preference" already proves at the hook level.
  it("a restored game keeps its OWN seat even when the stored preference disagrees, and the preference is left untouched", () => {
    // `beforeEach` already seeded the preference as { firstMover: red,
    // userColour: red } -- the restored game below deliberately uses a
    // DIFFERENT seat.
    window.localStorage.setItem(
      GAME_STORAGE_KEY,
      JSON.stringify({
        seat: { firstMover: 'yellow', userColour: 'yellow' },
        mode: 'play',
        setupPrefix: '',
        moves: [{ column: 3 }],
        currentPly: 1,
      }),
    );

    render(<App />);

    // The live seat controls reflect the GAME's seat, not the preference.
    const appFirstMover = screen.getByRole('radiogroup', { name: 'Which colour moves first' });
    const appUserColour = screen.getByRole('radiogroup', { name: 'Your colour' });
    expect((within(appFirstMover).getByRole('radio', { name: 'Yellow' }) as HTMLInputElement).checked).toBe(true);
    expect((within(appUserColour).getByRole('radio', { name: 'Yellow' }) as HTMLInputElement).checked).toBe(true);

    // The preference on disk is untouched by merely restoring/rendering.
    expect(JSON.parse(window.localStorage.getItem(SEAT_STORAGE_KEY) ?? 'null')).toEqual({
      firstMover: 'red',
      userColour: 'red',
    });
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

  // Owner ruling, 2026-07-28, mid-Wave-6a, task item 1 -- "the verifier
  // proved it empirically": importing used to leak the file's seat into the
  // stored PREFERENCE via `App.tsx`'s old blanket `saveSeat` effect (keyed on
  // every `controller.seat` change, imports included). Pinned here: the
  // ACTIVE game/board takes the file's seat immediately, but `fourwise:seat`
  // keeps whatever preference was already there.
  it('importing a file updates the ACTIVE seat only -- the stored preference is never touched', async () => {
    // `beforeEach` seeds the preference as { firstMover: red, userColour:
    // red }; the file below brings a DIFFERENT seat.
    render(<App />);

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

    // The ACTIVE game/board uses the file's own seat.
    const appFirstMover = screen.getByRole('radiogroup', { name: 'Which colour moves first' });
    const appUserColour = screen.getByRole('radiogroup', { name: 'Your colour' });
    expect((within(appFirstMover).getByRole('radio', { name: 'Yellow' }) as HTMLInputElement).checked).toBe(true);
    expect((within(appUserColour).getByRole('radio', { name: 'Yellow' }) as HTMLInputElement).checked).toBe(true);

    // The stored PREFERENCE is exactly as it was before the import.
    expect(JSON.parse(window.localStorage.getItem(SEAT_STORAGE_KEY) ?? 'null')).toEqual({
      firstMover: 'red',
      userColour: 'red',
    });
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
