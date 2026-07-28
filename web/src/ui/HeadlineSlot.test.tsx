// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { HeadlineSlot } from './HeadlineSlot.js';

afterEach(cleanup);

describe('HeadlineSlot', () => {
  it('renders no dismiss control by default', () => {
    render(<HeadlineSlot sentence="You win in 11." />);
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument();
  });

  it('renders a dismiss control for the blunder variant and calls onDismiss when clicked (non-blocking: the game continues regardless)', () => {
    const onDismiss = vi.fn();
    render(<HeadlineSlot sentence="That threw away a win. Column 4 held it." variant="blunder" onDismiss={onDismiss} />);

    const dismiss = screen.getByRole('button', { name: 'Dismiss' });
    fireEvent.click(dismiss);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('the error variant (Setup illegal position) never gets a dismiss control', () => {
    render(<HeadlineSlot sentence="Yellow has 3 discs, red has 5 — impossible." variant="error" />);
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument();
  });
});
