// @vitest-environment jsdom

// Unit-level tests for the first-run seat prompt itself (owner ruling,
// `docs/SPEC.md` §1/§5): both controls unselected on mount, Start disabled
// until both are chosen, Start reports the exact seat chosen, and the
// engine warm-up (client.calibrate()) begins as soon as the prompt mounts
// -- well before Start is pressed. This stays at the component level (no
// `App`, no real engine, no Worker) so the warm-up assertion is a direct
// spy on an injected fake `EngineClient`, per the delegation brief.

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { SeatPrompt } from './SeatPrompt.js';
import type { EngineClient } from '../engine/client.js';

afterEach(cleanup);

function makeFakeClient(overrides: Partial<EngineClient> = {}): EngineClient {
  return {
    analyse: vi.fn().mockResolvedValue(undefined),
    analyseProgressive: vi.fn().mockResolvedValue(undefined),
    calibrate: vi.fn().mockResolvedValue({ nodesPerMs: 1, msToNodeBudget: (ms: number) => ms }),
    terminate: vi.fn(),
    ...overrides,
  } as unknown as EngineClient;
}

function firstMoverGroup() {
  return screen.getByRole('radiogroup', { name: 'Which colour moves first' });
}

function userColourGroup() {
  return screen.getByRole('radiogroup', { name: 'Your colour' });
}

describe('SeatPrompt', () => {
  it('renders both seat controls with neither option preselected', () => {
    render(<SeatPrompt client={null} onStart={() => {}} />);

    for (const input of within(firstMoverGroup()).getAllByRole('radio') as HTMLInputElement[]) {
      expect(input.checked).toBe(false);
    }
    for (const input of within(userColourGroup()).getAllByRole('radio') as HTMLInputElement[]) {
      expect(input.checked).toBe(false);
    }
  });

  it('Start is disabled until both controls are chosen', () => {
    render(<SeatPrompt client={null} onStart={() => {}} />);

    const start = screen.getByRole('button', { name: 'Start' });
    expect(start).toBeDisabled();

    fireEvent.click(within(firstMoverGroup()).getByRole('radio', { name: 'Red' }));
    expect(start).toBeDisabled(); // only one of the two chosen

    fireEvent.click(within(userColourGroup()).getByRole('radio', { name: 'Yellow' }));
    expect(start).not.toBeDisabled();
  });

  it('Start reports the exact seat chosen, independently for each control', () => {
    const onStart = vi.fn();
    render(<SeatPrompt client={null} onStart={onStart} />);

    fireEvent.click(within(firstMoverGroup()).getByRole('radio', { name: 'Yellow' }));
    fireEvent.click(within(userColourGroup()).getByRole('radio', { name: 'Red' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));

    expect(onStart).toHaveBeenCalledWith({ firstMover: 'yellow', userColour: 'red' });
  });

  it('warms the engine calibration as soon as a client exists, before Start is pressed', () => {
    const client = makeFakeClient();
    render(<SeatPrompt client={client} onStart={() => {}} />);

    // Neither control has been touched and Start has not been pressed --
    // the warm-up must already have fired.
    expect(client.calibrate).toHaveBeenCalledTimes(1);
  });

  it('does not attempt to warm up when no client is available yet', () => {
    const { rerender } = render(<SeatPrompt client={null} onStart={() => {}} />);
    const client = makeFakeClient();
    rerender(<SeatPrompt client={client} onStart={() => {}} />);

    expect(client.calibrate).toHaveBeenCalledTimes(1);
  });
});
