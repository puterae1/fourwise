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
});
