// @vitest-environment jsdom

// Desktop rail — docs/DESIGN-DIRECTION.md §8.4. THE CRITICAL RULE under
// test: the rail re-sorts best-first on REVEAL, whenever reveal happens --
// never on a mode name. `Rail` itself has no concept of "mode" at all (see
// its own module comment); these tests drive `revealed` directly, which is
// exactly what proves the rule holds regardless of which mode produced that
// boolean.

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Rail, isDesktopLayout, orderRows } from './Rail.js';
import type { TranslatedAnalysis } from '../game/verdict.js';

afterEach(cleanup);

function verdict(kind: 'win' | 'loss', distance: number) {
  return {
    kind: 'score' as const,
    verdict: { kind, distance, sentence: kind === 'win' ? `you win in ${distance} moves` : `the opponent wins in ${distance} moves` },
  };
}

const draw = { kind: 'score' as const, verdict: { kind: 'draw' as const, distance: null, sentence: 'draw' } };
const full = { kind: 'full' as const };

// Column order 1..7 (0-indexed 0..6): win(3), draw(0), draw(2), draw(5),
// loss(6), loss(1), full(4) -- matches the design §8.4 wireframe's own
// example order/spread.
const TRANSLATED: TranslatedAnalysis = {
  position: { kind: 'win', distance: 11, sentence: 'you win in 11 moves' },
  best: 3,
  complete: true,
  columns: [draw, verdict('loss', 9), draw, verdict('win', 11), full, draw, verdict('loss', 5)],
};

describe('isDesktopLayout', () => {
  it('is false below 900px and true at/above it', () => {
    expect(isDesktopLayout(899)).toBe(false);
    expect(isDesktopLayout(900)).toBe(true);
    expect(isDesktopLayout(1440)).toBe(true);
  });
});

describe('orderRows -- the critical rule (reveal alone decides the sort, never a mode)', () => {
  it('column order (1-7) when not revealed', () => {
    render(
      <Rail
        translated={TRANSLATED}
        showVerdicts
        revealed={false}
        moveListEntries={[]}
        currentPly={0}
        onJump={() => {}}
      />,
    );
    const columns = screen.getAllByText(/^[1-7]$/).map((el) => el.textContent);
    expect(columns).toEqual(['1', '2', '3', '4', '5', '6', '7']);
  });

  it('best-first (win, then draw, then loss, full last; ties broken by distance) once revealed', () => {
    render(
      <Rail
        translated={TRANSLATED}
        showVerdicts
        revealed
        moveListEntries={[]}
        currentPly={0}
        onJump={() => {}}
      />,
    );
    const columns = screen.getAllByText(/^[1-7]$/).map((el) => el.textContent);
    // win: col 4. draws: cols 1, 3, 6 (column order among ties). losses:
    // col 7 (distance 5) before col 2 (distance 9). full: col 5 last.
    expect(columns).toEqual(['4', '1', '3', '6', '7', '2', '5']);
  });

  it('re-sorts without needing any prop OTHER than revealed to change', () => {
    const base = orderRows(
      [
        { column: 0, kind: 'loss' as const, sentence: '', distance: 3 },
        { column: 1, kind: 'win' as const, sentence: '', distance: 5 },
      ],
      false,
    );
    expect(base.map((r) => r.column)).toEqual([0, 1]); // untouched, column order

    const revealedOrder = orderRows(
      [
        { column: 0, kind: 'loss' as const, sentence: '', distance: 3 },
        { column: 1, kind: 'win' as const, sentence: '', distance: 5 },
      ],
      true,
    );
    expect(revealedOrder.map((r) => r.column)).toEqual([1, 0]); // win first
  });
});

describe('Rail — verdicts section', () => {
  it('is hidden entirely when showVerdicts is false (Setup mode)', () => {
    render(
      <Rail
        translated={TRANSLATED}
        showVerdicts={false}
        revealed={false}
        moveListEntries={[]}
        currentPly={0}
        onJump={() => {}}
      />,
    );
    expect(screen.queryByLabelText('Column evaluations, ranked')).not.toBeInTheDocument();
  });

  it('shows full sentences, not just numerals', () => {
    render(
      <Rail translated={TRANSLATED} showVerdicts revealed moveListEntries={[]} currentPly={0} onJump={() => {}} />,
    );
    expect(screen.getByText('You win in 11 moves.')).toBeInTheDocument();
    expect(screen.getByText('Column is full.')).toBeInTheDocument();
  });
});

describe('Rail — move list', () => {
  it('renders every entry inline (no click needed to open it) and marks the current ply', () => {
    render(
      <Rail
        translated={null}
        showVerdicts={false}
        revealed={false}
        moveListEntries={[
          { ply: 1, column: 3, colour: 'red', partial: false },
          { ply: 2, column: 2, colour: 'yellow', partial: true },
        ]}
        currentPly={1}
        onJump={() => {}}
      />,
    );
    expect(screen.getByText('Column 4').closest('button')).toHaveAttribute('data-current', 'true');
    expect(screen.getByText('Column 3')).toBeInTheDocument();
    expect(screen.getByText('partial')).toBeInTheDocument();
    expect(screen.getByText('Start').closest('button')).toHaveAttribute('data-current', 'false');
  });
});
