// @vitest-environment jsdom

// Integration-level tests for the first-run seat prompt wired into `App`
// (owner ruling, `docs/SPEC.md` §1/§5, "on first run the app asks, once"):
// the prompt appears on a genuinely fresh load, Start reveals the live
// board with the chosen seat applied, and a stored seat skips the prompt
// entirely on a later load. `SeatPrompt.test.tsx` covers the prompt
// component itself (including the engine warm-up assertion); this file
// covers the seam between the prompt and the rest of the app.

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import App from './App.js';
import { SEAT_STORAGE_KEY } from './seatStorage.js';
import { installMemoryLocalStorage } from './testMemoryStorage.js';

installMemoryLocalStorage();

// jsdom has no Worker implementation -- see App.test.tsx's identical
// comment for why a minimal, never-answering fake is sufficient here too.
class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage(): void {}
  terminate(): void {}
}
(globalThis as unknown as { Worker: typeof FakeWorker }).Worker = FakeWorker;

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function firstMoverGroup() {
  return screen.getByRole('radiogroup', { name: 'Which colour moves first' });
}

function userColourGroup() {
  return screen.getByRole('radiogroup', { name: 'Your colour' });
}

describe('first run', () => {
  it('shows the seat prompt on a fresh load, with neither control preselected', () => {
    render(<App />);

    const start = screen.getByRole('button', { name: 'Start' });
    expect(start).toBeDisabled();
    for (const input of within(firstMoverGroup()).getAllByRole('radio') as HTMLInputElement[]) {
      expect(input.checked).toBe(false);
    }
    for (const input of within(userColourGroup()).getAllByRole('radio') as HTMLInputElement[]) {
      expect(input.checked).toBe(false);
    }
    // The live app (mode switch, board) is not rendered behind the prompt.
    expect(screen.queryByRole('tab', { name: 'PLAY' })).not.toBeInTheDocument();
  });

  it('Start reveals the live app with the chosen seat applied, and stores it', () => {
    render(<App />);

    fireEvent.click(within(firstMoverGroup()).getByRole('radio', { name: 'Yellow' }));
    fireEvent.click(within(userColourGroup()).getByRole('radio', { name: 'Red' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));

    // The live app's own seat controls reflect the chosen seat.
    const appFirstMover = screen.getByRole('radiogroup', { name: 'Which colour moves first' });
    const appUserColour = screen.getByRole('radiogroup', { name: 'Your colour' });
    expect((within(appFirstMover).getByRole('radio', { name: 'Yellow' }) as HTMLInputElement).checked).toBe(true);
    expect((within(appUserColour).getByRole('radio', { name: 'Red' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole('tab', { name: 'PLAY' })).toBeInTheDocument();

    expect(JSON.parse(window.localStorage.getItem(SEAT_STORAGE_KEY) ?? 'null')).toEqual({
      firstMover: 'yellow',
      userColour: 'red',
    });
  });

  it('skips the prompt entirely when a seat is already stored', () => {
    window.localStorage.setItem(SEAT_STORAGE_KEY, JSON.stringify({ firstMover: 'yellow', userColour: 'yellow' }));

    render(<App />);

    expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'PLAY' })).toBeInTheDocument();
    const appFirstMover = screen.getByRole('radiogroup', { name: 'Which colour moves first' });
    const appUserColour = screen.getByRole('radiogroup', { name: 'Your colour' });
    expect((within(appFirstMover).getByRole('radio', { name: 'Yellow' }) as HTMLInputElement).checked).toBe(true);
    expect((within(appUserColour).getByRole('radio', { name: 'Yellow' }) as HTMLInputElement).checked).toBe(true);
  });

  it('changing seat in-app updates the stored preference', () => {
    window.localStorage.setItem(SEAT_STORAGE_KEY, JSON.stringify({ firstMover: 'red', userColour: 'red' }));

    render(<App />);

    const appUserColour = screen.getByRole('radiogroup', { name: 'Your colour' });
    fireEvent.click(within(appUserColour).getByRole('radio', { name: 'Yellow' }));

    expect(JSON.parse(window.localStorage.getItem(SEAT_STORAGE_KEY) ?? 'null')).toEqual({
      firstMover: 'red',
      userColour: 'yellow',
    });
  });
});
