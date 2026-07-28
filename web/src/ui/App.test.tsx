// @vitest-environment jsdom

// Component-level tests for the designed UI. These deliberately stay at the
// jsdom level (render, query, fireEvent) rather than chasing pixel output —
// per the delegation brief, the goal is to prove mode switching preserves
// the position, seat changes re-render without a state reset, Setup
// surfaces the exact `setup.ts` rejection messages, and keyboard control
// works, not to snapshot CSS.
//
// The engine is never mocked out entirely: `useEngineClient` creates a real
// Worker, which jsdom does not implement, so `client` stays `null` here —
// which `useGameController` already treats as "no analysis running".
// Everything these tests assert (position preservation across mode/seat
// changes, Setup's live legality, keyboard input) holds regardless of
// whether an engine is attached, so this is the right level to test it at
// without faking the engine boundary.

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import App from './App.js';
import { SEAT_STORAGE_KEY } from './seatStorage.js';
import { installMemoryLocalStorage } from './testMemoryStorage.js';

installMemoryLocalStorage();

// jsdom has no Worker implementation. `useEngineClient` creates one on
// mount (`engine/client.ts`'s `createWorkerTransport`); a minimal fake that
// never actually answers keeps that effect from throwing without pretending
// to be a real engine -- these tests never need an analysis result to
// arrive (see the file header comment).
class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage(): void {}
  terminate(): void {}
}
(globalThis as unknown as { Worker: typeof FakeWorker }).Worker = FakeWorker;

// These tests are about the game/mode/seat behaviour that already existed
// before the first-run prompt (`SeatPrompt.test.tsx` and
// `firstRun.test.tsx` cover the prompt itself), so they seed a stored seat
// before every render -- matching the seat these tests were written
// against (firstMover: red, userColour: red) -- so `App` skips the prompt
// and renders the live game exactly as it did before the prompt existed.
beforeEach(() => {
  window.localStorage.setItem(SEAT_STORAGE_KEY, JSON.stringify({ firstMover: 'red', userColour: 'red' }));
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function youAreGroup() {
  return screen.getByRole('radiogroup', { name: 'Your colour' });
}

function firstMoverGroup() {
  return screen.getByRole('radiogroup', { name: 'Which colour moves first' });
}

function dropColumn(n: number) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`Drop in column ${n}|Column ${n}, full`) }));
}

describe('mode switching preserves the position', () => {
  it('Play -> Analyse -> Play keeps the same move count', () => {
    render(<App />);

    fireEvent.keyDown(window, { key: '4' });
    expect(screen.getByText('Moves (1)')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'ANALYSE' }));
    expect(screen.getByText('Moves (1)')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'PLAY' }));
    expect(screen.getByText('Moves (1)')).toBeInTheDocument();
  });

  it('entering Setup and leaving without pressing Done leaves the game untouched', () => {
    render(<App />);

    fireEvent.keyDown(window, { key: '4' });
    expect(screen.getByText('Moves (1)')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'SETUP' }));
    fireEvent.click(screen.getByRole('tab', { name: 'PLAY' }));

    expect(screen.getByText('Moves (1)')).toBeInTheDocument();
  });
});

describe('seat controls', () => {
  it('are two independent radiogroups, not one combined control', () => {
    render(<App />);
    expect(youAreGroup()).not.toBe(firstMoverGroup());
  });

  it('changing "you are" re-renders without resetting game state, and leaves "moves first" alone', () => {
    render(<App />);

    fireEvent.keyDown(window, { key: '4' });
    expect(screen.getByText('Moves (1)')).toBeInTheDocument();

    const redFirstMover = within(firstMoverGroup()).getByRole('radio', { name: 'Red' }) as HTMLInputElement;
    expect(redFirstMover.checked).toBe(true);

    fireEvent.click(within(youAreGroup()).getByRole('radio', { name: 'Yellow' }));

    // The position is unaffected by a seat change.
    expect(screen.getByText('Moves (1)')).toBeInTheDocument();
    // "Moves first" was never touched by changing "you are".
    expect((within(firstMoverGroup()).getByRole('radio', { name: 'Red' }) as HTMLInputElement).checked).toBe(true);
  });
});

describe('setup verdict surfacing', () => {
  it('shows the exact setup.ts rejection message for a disc-count mismatch', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: 'SETUP' }));

    // Placing defaults to the seat's user colour (red). Three in column 1.
    dropColumn(1);
    dropColumn(1);
    dropColumn(1);

    // Switch placing colour to yellow and drop one -- a 3-1 split.
    const placingGroup = screen.getByRole('radiogroup', { name: 'Colour to place' });
    fireEvent.click(within(placingGroup).getByRole('radio', { name: 'Yellow' }));
    dropColumn(2);

    expect(screen.getByText('Yellow has 1 disc, red has 3 — impossible.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled();
  });

  it('Done is enabled for a legal, empty position', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: 'SETUP' }));
    expect(screen.getByRole('button', { name: 'Done' })).not.toBeDisabled();
  });
});

describe('seat model — colour and turn order are independent (CLAUDE.md invariant #1)', () => {
  it('disc colour follows firstMover, never userColour, for the same move history', () => {
    render(<App />);

    // Default seat: firstMover=red, userColour=red. Play one move (ply 0 ->
    // coloured by firstMover).
    fireEvent.keyDown(window, { key: '4' });
    const columnButton = () => screen.getByRole('button', { name: /Drop in column 4|Column 4, full/ });
    expect(columnButton().querySelector('.board__disc')).toHaveAttribute('data-colour', 'red');

    // Changing userColour alone (red -> yellow) must NOT touch the disc
    // already on the board: colourAtPly depends only on firstMover.
    fireEvent.click(within(youAreGroup()).getByRole('radio', { name: 'Yellow' }));
    expect(columnButton().querySelector('.board__disc')).toHaveAttribute('data-colour', 'red');

    // Changing firstMover (red -> yellow), with the SAME move history, DOES
    // flip the disc's colour -- this is design §5's "on seat change the disc
    // colours swap in place", exercised here as ply-0's mover recolouring.
    fireEvent.click(within(firstMoverGroup()).getByRole('radio', { name: 'Yellow' }));
    expect(columnButton().querySelector('.board__disc')).toHaveAttribute('data-colour', 'yellow');
  });
});

describe('parity ruler (SPEC §2, amended)', () => {
  afterEach(() => {
    // Restore a normal width after any test that narrows it.
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1024 });
  });

  it('labels the user\'s rows for the stored seat (firstMover: red, userColour: red -> user moves first -> odd rows)', () => {
    render(<App />);
    expect(screen.getByText('Waiting threats — yours on rows 1·3·5')).toBeInTheDocument();
  });

  it('tracks a seat change: flipping firstMover to yellow makes the user move second -> even rows', () => {
    render(<App />);
    fireEvent.click(within(firstMoverGroup()).getByRole('radio', { name: 'Yellow' }));
    expect(screen.getByText('Waiting threats — yours on rows 2·4·6')).toBeInTheDocument();
  });

  it('hides entirely (no label, no highlight row markup) below the minimum viewport width -- never shows unlabelled', () => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 200 });
    render(<App />);
    expect(screen.queryByText(/Waiting threats/)).not.toBeInTheDocument();
    expect(document.querySelector('.parity-ruler__row')).not.toBeInTheDocument();
  });

  it('is absent in Setup mode -- no label and no gutter marks, even at a normal viewport width', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: 'SETUP' }));
    expect(screen.queryByText(/Waiting threats/)).not.toBeInTheDocument();
    expect(document.querySelector('.parity-ruler__row')).not.toBeInTheDocument();
  });

  // SPEC §3.2's scope clarification (2026-07-29): the ruler is an
  // analysis-derived surface ("waiting threats" is meaningless once the game
  // has actually ended) and must hide, not degrade, on a terminal position --
  // the established convention (Wave 5a), matching AnalysePanel/Rail's own
  // `terminal` gate rather than inventing a second treatment.
  it('is present mid-game (baseline for the two terminal cases below)', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: '4' });
    expect(screen.getByText(/Waiting threats/)).toBeInTheDocument();
    expect(document.querySelector('.parity-ruler__row')).toBeInTheDocument();
  });

  it('hides on a WON game -- red completes a horizontal four', () => {
    render(<App />);

    // Build red 1-2-3 on the bottom row and yellow 5-6-7 on the bottom row
    // via Setup (equal 3-3 counts, red to move next under firstMover=red --
    // SPEC §3.3's reconstruction), then win in Play by dropping column 4.
    fireEvent.click(screen.getByRole('tab', { name: 'SETUP' }));
    dropColumn(1);
    dropColumn(2);
    dropColumn(3);
    const placingGroup = screen.getByRole('radiogroup', { name: 'Colour to place' });
    fireEvent.click(within(placingGroup).getByRole('radio', { name: 'Yellow' }));
    dropColumn(5);
    dropColumn(6);
    dropColumn(7);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    dropColumn(4); // red completes columns 1-4 on the bottom row

    expect(screen.getByText('You win.')).toBeInTheDocument();
    expect(screen.queryByText(/Waiting threats/)).not.toBeInTheDocument();
    expect(document.querySelector('.parity-ruler__row')).not.toBeInTheDocument();
  });

  it('hides on a DRAWN game -- full board, no four for either side', () => {
    render(<App />);

    // A full board (21 red, 21 yellow -- equal counts, consistent with
    // firstMover=red), built via Setup so Play-mode engine/human control
    // gating never comes into it, verified offline to contain no
    // four-in-a-row for either colour in any of the four directions. Each
    // column's sequence below is bottom-to-top.
    const DRAWN_BOARD: Record<number, Array<'red' | 'yellow'>> = {
      1: ['yellow', 'yellow', 'yellow', 'red', 'yellow', 'yellow'],
      2: ['yellow', 'red', 'yellow', 'red', 'red', 'red'],
      3: ['red', 'red', 'yellow', 'yellow', 'yellow', 'red'],
      4: ['red', 'yellow', 'red', 'yellow', 'red', 'yellow'],
      5: ['red', 'red', 'yellow', 'red', 'red', 'red'],
      6: ['yellow', 'red', 'yellow', 'red', 'yellow', 'red'],
      7: ['yellow', 'red', 'yellow', 'yellow', 'red', 'yellow'],
    };

    fireEvent.click(screen.getByRole('tab', { name: 'SETUP' }));
    const placingGroup = screen.getByRole('radiogroup', { name: 'Colour to place' });
    let placing: 'red' | 'yellow' = 'red'; // Setup's own default (the seat's user colour)
    function setPlacing(colour: 'red' | 'yellow') {
      if (placing === colour) return;
      fireEvent.click(within(placingGroup).getByRole('radio', { name: colour === 'red' ? 'Red' : 'Yellow' }));
      placing = colour;
    }
    for (let column = 1; column <= 7; column++) {
      for (const colour of DRAWN_BOARD[column]!) {
        setPlacing(colour);
        dropColumn(column);
      }
    }
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(screen.getByText('Drawn.')).toBeInTheDocument();
    expect(screen.queryByText(/Waiting threats/)).not.toBeInTheDocument();
    expect(document.querySelector('.parity-ruler__row')).not.toBeInTheDocument();
  });
});

describe('keyboard control', () => {
  it('digit keys drop a disc, "u" undoes, "r" redoes (jump-to-ply reflects each)', () => {
    render(<App />);

    fireEvent.keyDown(window, { key: '3' });
    fireEvent.click(screen.getByText('Moves (1)'));
    expect(within(screen.getByRole('dialog')).getByText('Column 3').closest('button')).toHaveAttribute(
      'data-current',
      'true',
    );
    fireEvent.click(screen.getByLabelText('Close move list'));

    fireEvent.keyDown(window, { key: 'u' });
    fireEvent.click(screen.getByText('Moves (1)'));
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: /Start/ })).toHaveAttribute(
      'data-current',
      'true',
    );
    fireEvent.click(screen.getByLabelText('Close move list'));

    fireEvent.keyDown(window, { key: 'r' });
    fireEvent.click(screen.getByText('Moves (1)'));
    expect(within(screen.getByRole('dialog')).getByText('Column 3').closest('button')).toHaveAttribute(
      'data-current',
      'true',
    );
  });

  // Quality-floor audit (Wave 6a): SPEC §4's "full keyboard control" must
  // hold "including while the rail/panels are present" -- concretely, while
  // one of the app's own focusable controls has focus, not just when focus
  // sits on `<body>` (which is all `fireEvent.keyDown(window, ...)` above
  // exercises, since a bare `window` target's `tagName` is `undefined` and
  // was never excluded by the old guard either). The previous guard
  // excluded every `<input>` tag outright, which included the seat bar's
  // and per-side controls' `type="radio"` inputs -- meaning digits 1-7 (and
  // u/r) silently stopped working the moment a user tabbed to "You are" or
  // a per-side Human/Engine control, both of which sit on screen in every
  // mode. This is the regression test for that fix.
  it('digit keys still drop a disc while a seat-control radio button has focus', () => {
    render(<App />);

    const redRadio = within(youAreGroup()).getByRole('radio', { name: 'Red' }) as HTMLInputElement;
    redRadio.focus();
    expect(document.activeElement).toBe(redRadio);

    const columnButton = () => screen.getByRole('button', { name: /Drop in column 4|Column 4, full/ });
    expect(columnButton().querySelector('.board__disc')).not.toBeInTheDocument();

    fireEvent.keyDown(redRadio, { key: '4' });
    expect(columnButton().querySelector('.board__disc')).toBeInTheDocument();

    // `moves.length` never shrinks on undo (only `currentPly` does -- see
    // `game/gameState.ts`'s `undo`), so the observable effect of 'u' here is
    // the disc coming back OFF the board, not the "Moves (n)" count changing.
    fireEvent.keyDown(redRadio, { key: 'u' });
    expect(columnButton().querySelector('.board__disc')).not.toBeInTheDocument();
  });
});
