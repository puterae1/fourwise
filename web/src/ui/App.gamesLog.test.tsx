// @vitest-environment jsdom

// Wave 12 (OPPONENT-MODEL.md game log) — integration-level tests at the
// `App` seam, mirroring `gamePersistence.test.tsx`'s own house style: the
// isolated pieces (`game/loggedGame.ts`, `ui/logStorage.ts`,
// `ui/useGameLog.ts`, `GamesSheet.tsx`, `SaveLiveGameControl.tsx`,
// `SaveReconstructedPanel.tsx`) are unit-tested on their own; these prove
// the real app wires them together end to end.

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

// firstMover: red, userColour: red -- red moves first AND is the user, so
// every ply of a human-vs-human game can be driven by keyboard once both
// sides are set to Human (see `setBothSidesHuman` below).
beforeEach(() => {
  window.localStorage.setItem(SEAT_STORAGE_KEY, JSON.stringify({ firstMover: 'red', userColour: 'red' }));
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function setBothSidesHuman() {
  const opponentControl = screen.getByRole('radiogroup', { name: "Opponent's control" });
  fireEvent.click(within(opponentControl).getByRole('radio', { name: 'Human' }));
}

function playColumns(columns: number[]) {
  for (const column of columns) {
    fireEvent.keyDown(window, { key: String(column) });
  }
}

describe('Games door + sheet (design §15.2/§16)', () => {
  it('the Games ▸ door is present in Play mode and opens the sheet showing the empty state', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Games ▸' }));
    expect(screen.getByRole('dialog', { name: 'Games' })).toBeInTheDocument();
    expect(screen.getByText('No games logged yet.')).toBeInTheDocument();
  });

  it('Close returns to exactly the position and mode the user left', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: '4' });
    expect(screen.getByText('Moves (1)')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Games ▸' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Moves (1)')).toBeInTheDocument();
  });
});

describe('Record from live play (DoD item 3)', () => {
  it('offers "Save this game" only once the game is over, and saving logs it as LIVE with the seat-derived result', () => {
    render(<App />);
    setBothSidesHuman();

    // Red (moves first, is the user) wins a vertical four in column 4
    // (displayed digit '4'), yellow plays column 1 in between.
    // ply0 red->4, ply1 yellow->1, ply2 red->4, ply3 yellow->1,
    // ply4 red->4, ply5 yellow->1, ply6 red->4 (four red, column 4).
    playColumns([4, 1, 4, 1, 4, 1, 4]);

    expect(screen.getByText('You win.')).toBeInTheDocument();

    const saveButton = screen.getByRole('button', { name: 'Save this game' });
    const opponentInput = screen.getByPlaceholderText('Unlabelled') as HTMLInputElement;
    fireEvent.change(opponentInput, { target: { value: 'Anna' } });
    fireEvent.click(saveButton);

    expect(screen.getByText('Saved to your games.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Games ▸' }));
    expect(screen.getByText('LIVE')).toBeInTheDocument();
    expect(screen.getByText('Anna')).toBeInTheDocument();
    expect(screen.getByText('You were red · you moved first')).toBeInTheDocument();
    expect(screen.getByText(/You won/)).toBeInTheDocument();
    expect(screen.getByText(/7 moves/)).toBeInTheDocument();
  });
});

describe('Add a game from memory (design §16.4, DoD item 4)', () => {
  it('builds a finished position via the reused Setup grid and saves it as RECONSTRUCTED', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Games ▸' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add a game from memory' }));

    // Now in Setup mode, logging-from-memory flow -- the notice + placing
    // toggle + Save game control should be present, sheet closed.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText(/saved as reconstructed/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save game' })).toBeDisabled();

    // Placing defaults to the user's own colour (red, per useSetupEditor) --
    // build a vertical red four in column 4, yellow filler in column 1,
    // toggling the placing colour between drops exactly as Setup requires.
    const placingGroup = screen.getByRole('radiogroup', { name: 'Colour to place' });
    function setPlacing(colour: 'Red' | 'Yellow') {
      fireEvent.click(within(placingGroup).getByRole('radio', { name: new RegExp(colour, 'i') }));
    }

    setPlacing('Red');
    fireEvent.keyDown(window, { key: '4' });
    setPlacing('Yellow');
    fireEvent.keyDown(window, { key: '1' });
    setPlacing('Red');
    fireEvent.keyDown(window, { key: '4' });
    setPlacing('Yellow');
    fireEvent.keyDown(window, { key: '1' });
    setPlacing('Red');
    fireEvent.keyDown(window, { key: '4' });
    setPlacing('Yellow');
    fireEvent.keyDown(window, { key: '1' });
    setPlacing('Red');
    fireEvent.keyDown(window, { key: '4' }); // fourth red in column 4 -- finished

    expect(screen.getByRole('button', { name: 'Save game' })).not.toBeDisabled();

    const opponentInput = screen.getByPlaceholderText('Unlabelled') as HTMLInputElement;
    fireEvent.change(opponentInput, { target: { value: 'Beth' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save game' }));

    // Saving returns to Play mode -- and the log now has the entry.
    expect(screen.getByRole('tab', { name: 'PLAY' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Games ▸' }));
    expect(screen.getByText('RECONSTRUCTED · COUNTS HALF')).toBeInTheDocument();
    expect(screen.getByText('Beth')).toBeInTheDocument();
    expect(screen.getByText(/You won/)).toBeInTheDocument();
  });

  it('Cancel discards the in-progress reconstruction and returns to Play without touching the live game', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: '4' }); // one real move in the live game
    expect(screen.getByText('Moves (1)')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Games ▸' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add a game from memory' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByRole('tab', { name: 'PLAY' })).toBeInTheDocument();
    expect(screen.getByText('Moves (1)')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Games ▸' }));
    expect(screen.getByText('No games logged yet.')).toBeInTheDocument();
  });
});

describe('Import with a non-empty loggedGames array never touches the stored seat preference', () => {
  // Verifier send-back: the existing Wave 5b pin (`gamePersistence.test.tsx`
  // "importing a file updates the ACTIVE seat only -- the stored preference
  // is never touched", lines 199-233) only covers a v1 file with NO
  // `loggedGames` field. This is the same pin, mirrored, for a file whose
  // `loggedGames` array is non-empty -- so a future edit threading
  // `mergeImported` or the import handler through `seatStorage` would be
  // caught here even though it wouldn't touch that older test at all.
  it('importing a file with logged games updates the ACTIVE seat only, leaves the stored preference untouched, AND actually merges the games (so this can\'t pass vacuously on a rejected import)', async () => {
    // `beforeEach` seeds the preference as { firstMover: red, userColour:
    // red }; the file below brings a DIFFERENT seat for the active game.
    render(<App />);

    const envelope = {
      version: 2,
      exported: '2026-07-29T00:00:00.000Z',
      games: [
        {
          seat: { firstMover: 'yellow', userColour: 'yellow' },
          setupPrefix: '',
          moves: [{ column: 0 }, { column: 1 }, { column: 2 }],
          date: '2026-07-29T00:00:00.000Z',
        },
      ],
      loggedGames: [
        {
          id: 'imported-1',
          date: '2026-07-20T00:00:00.000Z',
          opponent: 'Carla',
          seat: { firstMover: 'red', userColour: 'red' },
          // 19 moves cycling columns 0-6 -- every column gets 2 or 3 discs,
          // well under the 6-row limit, so this replays legally
          // (`replayIsLegal`) and the import is actually accepted.
          moves: [0, 1, 2, 3, 4, 5, 6, 0, 1, 2, 3, 4, 5, 6, 0, 1, 2, 3, 4],
          result: 'loss',
          source: 'reconstructed',
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

    // The stored PREFERENCE is exactly as it was before the import -- byte
    // identical, not just structurally equal.
    expect(window.localStorage.getItem(SEAT_STORAGE_KEY)).toBe(
      JSON.stringify({ firstMover: 'red', userColour: 'red' }),
    );

    // The import was NOT rejected -- the logged game actually merged into
    // the log (proves this test cannot pass vacuously).
    fireEvent.click(screen.getByRole('button', { name: 'Games ▸' }));
    expect(screen.getByText('Carla')).toBeInTheDocument();
    expect(screen.getByText('RECONSTRUCTED · COUNTS HALF')).toBeInTheDocument();
  });
});
