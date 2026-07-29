// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { GamesSheet } from './GamesSheet.js';
import { buildLoggedGame, type LoggedGame } from '../game/loggedGame.js';
import type { Seat } from '../game/seat.js';

afterEach(cleanup);

const noop = () => {};

const RED_USER_YELLOW_FIRST: Seat = { firstMover: 'yellow', userColour: 'red' };
const YELLOW_USER_RED_FIRST: Seat = { firstMover: 'red', userColour: 'yellow' };

function liveGame(overrides: Partial<Parameters<typeof buildLoggedGame>[0]> = {}): LoggedGame {
  return buildLoggedGame({
    seat: RED_USER_YELLOW_FIRST,
    moves: Array.from({ length: 27 }, (_, i) => i % 7),
    winner: 'red',
    opponent: 'Anna',
    source: 'live',
    id: 'live-1',
    date: '2026-07-29T00:00:00.000Z',
    ...overrides,
  });
}

function reconstructedGame(overrides: Partial<Parameters<typeof buildLoggedGame>[0]> = {}): LoggedGame {
  return buildLoggedGame({
    seat: YELLOW_USER_RED_FIRST,
    moves: Array.from({ length: 19 }, (_, i) => i % 7),
    winner: 'red',
    opponent: 'Anna',
    source: 'reconstructed',
    id: 'reconstructed-1',
    date: '2026-07-27T00:00:00.000Z',
    ...overrides,
  });
}

describe('GamesSheet', () => {
  it('renders nothing when closed', () => {
    render(
      <GamesSheet open={false} onClose={noop} games={[]} onAddFromMemory={noop} onExport={noop} onImport={noop} />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the empty state, with no Export control, when there are no games', () => {
    render(<GamesSheet open games={[]} onClose={noop} onAddFromMemory={noop} onExport={noop} onImport={noop} />);
    expect(screen.getByText('No games logged yet.')).toBeInTheDocument();
    expect(screen.getByText(/add one from memory/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /export/i })).not.toBeInTheDocument();
  });

  it('renders a LIVE row and a RECONSTRUCTED row, each labelled, each seat-derived (design §16.2)', () => {
    render(
      <GamesSheet
        open
        games={[liveGame(), reconstructedGame()]}
        onClose={noop}
        onAddFromMemory={noop}
        onExport={noop}
        onImport={noop}
      />,
    );

    expect(screen.getByText('LIVE')).toBeInTheDocument();
    expect(screen.getByText('RECONSTRUCTED · COUNTS HALF')).toBeInTheDocument();

    // live game: red user, yellow first mover -> "You were red · she moved first", "You won"
    expect(screen.getByText('You were red · she moved first')).toBeInTheDocument();
    expect(screen.getByText(/You won/)).toBeInTheDocument();
    expect(screen.getByText(/27 moves/)).toBeInTheDocument();

    // reconstructed game: yellow user, red first mover -> "You were yellow · she moved first", "She won"
    expect(screen.getByText('You were yellow · she moved first')).toBeInTheDocument();
    expect(screen.getByText(/She won/)).toBeInTheDocument();
    expect(screen.getByText(/19 moves/)).toBeInTheDocument();
  });

  it('sorts by date only, newest first', () => {
    render(
      <GamesSheet
        open
        games={[reconstructedGame(), liveGame()]} // reconstructed is dated earlier
        onClose={noop}
        onAddFromMemory={noop}
        onExport={noop}
        onImport={noop}
      />,
    );
    const labels = screen.getAllByText('Anna');
    // Both rows are labelled "Anna" -- assert order via the date text instead.
    const dates = screen.getAllByText(/29 Jul|27 Jul/);
    expect(dates[0]!.textContent).toBe('29 Jul');
    expect(dates[1]!.textContent).toBe('27 Jul');
    expect(labels).toHaveLength(2);
  });

  it('an unlabelled opponent reads "Unlabelled", never a guessed name', () => {
    render(
      <GamesSheet open games={[liveGame({ opponent: '' })]} onClose={noop} onAddFromMemory={noop} onExport={noop} onImport={noop} />,
    );
    expect(screen.getByText('Unlabelled')).toBeInTheDocument();
  });

  it('Close calls onClose', () => {
    const onClose = vi.fn();
    render(<GamesSheet open games={[]} onClose={onClose} onAddFromMemory={noop} onExport={noop} onImport={noop} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('"Add a game from memory" calls onAddFromMemory', () => {
    const onAddFromMemory = vi.fn();
    render(<GamesSheet open games={[]} onClose={noop} onAddFromMemory={onAddFromMemory} onExport={noop} onImport={noop} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a game from memory' }));
    expect(onAddFromMemory).toHaveBeenCalled();
  });

  it('Export/Import controls call through when there is at least one game', () => {
    const onExport = vi.fn();
    const onImport = vi.fn();
    render(
      <GamesSheet open games={[liveGame()]} onClose={noop} onAddFromMemory={noop} onExport={onExport} onImport={onImport} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Export ▸' }));
    fireEvent.click(screen.getByRole('button', { name: 'Import ▸' }));
    expect(onExport).toHaveBeenCalled();
    expect(onImport).toHaveBeenCalled();
  });
});
