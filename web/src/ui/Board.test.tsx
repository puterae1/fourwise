// @vitest-environment jsdom

// Win-line overlay — docs/DESIGN-DIRECTION.md §9, "Game over": "the winning
// four is drawn instead: a 5px `Frame` line through the disc centres with a
// 2px `--c-n-0` outer stroke." `Board` is purely presentational (see its own
// file header), so these tests drive it directly with a hand-built `Grid`
// and `WinLine` rather than playing a whole game through `App` -- the
// geometry claim ("tracks the disc centres exactly") is a property of the
// SVG's coordinate math alone, independent of how a win was reached.

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { Board } from './Board.js';
import type { WinLine } from './deriveBoard.js';
import { dropDisc, emptyGrid, type Grid } from '../game/setup.js';

afterEach(cleanup);

// Mirrors the geometric definition an SVG "cell centre" has to satisfy in a
// 7-column x 6-row grid (one user-unit per cell, row 0 = bottom per SPEC
// §4 but the board paints top-down) -- not a copy of `Board.tsx`'s internal
// helper, just the same unavoidable arithmetic any correct implementation
// has to produce for a coordinate to actually sit on a disc's centre.
function expectedX(column: number): number {
  return column + 0.5;
}
function expectedY(row: number): number {
  return 6 - 1 - row + 0.5;
}

function noop() {}
function alwaysFalse() {
  return false;
}

function baseProps() {
  return {
    turnColour: null,
    litColumn: null,
    lastPlayedColumn: null,
    onDrop: noop,
    canDrop: alwaysFalse,
    parityUserRows: null,
  } as const;
}

function winLineEls(container: HTMLElement) {
  return {
    svg: container.querySelector('[data-testid="win-line"]'),
    outer: container.querySelector('.board__win-line-outer'),
    inner: container.querySelector('.board__win-line-inner'),
  };
}

describe('win-line overlay (design §9, "Game over")', () => {
  it('renders a line through the four cell centres for a horizontal win', () => {
    let grid: Grid = emptyGrid();
    // Red across the bottom row, columns 1-4 (0-indexed 0-3).
    for (let c = 0; c < 4; c++) grid = dropDisc(grid, c, 'red');
    const winLine: WinLine = {
      colour: 'red',
      cells: [
        { column: 0, row: 0 },
        { column: 1, row: 0 },
        { column: 2, row: 0 },
        { column: 3, row: 0 },
      ],
    };

    const { container } = render(<Board grid={grid} winLine={winLine} {...baseProps()} />);
    const { svg, outer, inner } = winLineEls(container);

    expect(svg).toBeInTheDocument();
    expect(outer).toBeInTheDocument();
    expect(inner).toBeInTheDocument();

    for (const line of [outer!, inner!]) {
      expect(Number(line.getAttribute('x1'))).toBeCloseTo(expectedX(0));
      expect(Number(line.getAttribute('y1'))).toBeCloseTo(expectedY(0));
      expect(Number(line.getAttribute('x2'))).toBeCloseTo(expectedX(3));
      expect(Number(line.getAttribute('y2'))).toBeCloseTo(expectedY(0));
    }
  });

  it('renders a line through the four cell centres for a rising diagonal win', () => {
    // A rising diagonal (bottom-left to top-right): (0,0), (1,1), (2,2), (3,3).
    // Needs supporting discs underneath each cell for the grid to be a legal
    // shape (Board itself never validates gravity -- this is just realism).
    let grid: Grid = emptyGrid();
    grid = dropDisc(grid, 0, 'red');
    grid = dropDisc(grid, 1, 'yellow');
    grid = dropDisc(grid, 1, 'red');
    grid = dropDisc(grid, 2, 'yellow');
    grid = dropDisc(grid, 2, 'yellow');
    grid = dropDisc(grid, 2, 'red');
    grid = dropDisc(grid, 3, 'yellow');
    grid = dropDisc(grid, 3, 'yellow');
    grid = dropDisc(grid, 3, 'yellow');
    grid = dropDisc(grid, 3, 'red');
    const winLine: WinLine = {
      colour: 'red',
      cells: [
        { column: 0, row: 0 },
        { column: 1, row: 1 },
        { column: 2, row: 2 },
        { column: 3, row: 3 },
      ],
    };

    const { container } = render(<Board grid={grid} winLine={winLine} {...baseProps()} />);
    const { svg, outer, inner } = winLineEls(container);

    expect(svg).toBeInTheDocument();
    for (const line of [outer!, inner!]) {
      expect(Number(line.getAttribute('x1'))).toBeCloseTo(expectedX(0));
      expect(Number(line.getAttribute('y1'))).toBeCloseTo(expectedY(0));
      expect(Number(line.getAttribute('x2'))).toBeCloseTo(expectedX(3));
      expect(Number(line.getAttribute('y2'))).toBeCloseTo(expectedY(3));
    }
  });

  it('renders no win-line for a mid-game position (no winLine yet)', () => {
    let grid: Grid = emptyGrid();
    grid = dropDisc(grid, 3, 'red');
    grid = dropDisc(grid, 2, 'yellow');

    const { container } = render(<Board grid={grid} winLine={null} {...baseProps()} />);
    expect(winLineEls(container).svg).not.toBeInTheDocument();
  });

  it('renders no win-line on a draw (full board, no winning four)', () => {
    // A minimal stand-in for "board full, nothing won" -- the overlay is
    // gated purely on `winLine`, so a full grid with `winLine={null}` is
    // exactly the draw case as far as `Board` is concerned.
    let grid: Grid = emptyGrid();
    for (let c = 0; c < 7; c++) {
      for (let r = 0; r < 6; r++) {
        grid = dropDisc(grid, c, (c + r) % 2 === 0 ? 'red' : 'yellow');
      }
    }

    const { container } = render(<Board grid={grid} winLine={null} {...baseProps()} />);
    expect(winLineEls(container).svg).not.toBeInTheDocument();
  });
});
