// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { parityRows } from '../game/parity.js';
import { canShowParityRuler, MIN_WIDTH_FOR_PARITY_RULER, ParityCaption, ParityGutter, parityLabel } from './ParityRuler.js';

afterEach(cleanup);

describe('canShowParityRuler (SPEC §2 amended Presentation rule: hide entirely, never unlabelled)', () => {
  it('shows at and above the minimum width', () => {
    expect(canShowParityRuler(MIN_WIDTH_FOR_PARITY_RULER)).toBe(true);
    expect(canShowParityRuler(390)).toBe(true);
    expect(canShowParityRuler(1200)).toBe(true);
  });

  it('hides below the minimum width', () => {
    expect(canShowParityRuler(MIN_WIDTH_FOR_PARITY_RULER - 1)).toBe(false);
    expect(canShowParityRuler(0)).toBe(false);
  });
});

describe('parityLabel', () => {
  it('names the exact rows, ascending, with the mandatory "waiting threats" wording', () => {
    expect(parityLabel([1, 3, 5])).toBe('Waiting threats — yours on rows 1·3·5');
    expect(parityLabel([2, 4, 6])).toBe('Waiting threats — yours on rows 2·4·6');
  });

  it('sorts rows regardless of input order', () => {
    expect(parityLabel([5, 1, 3])).toBe('Waiting threats — yours on rows 1·3·5');
  });
});

describe('ParityCaption (rows track seat changes via userMovesFirst)', () => {
  it('renders the label for userMovesFirst = true (odd rows)', () => {
    render(<ParityCaption userRows={parityRows(true).user} />);
    expect(screen.getByText('Waiting threats — yours on rows 1·3·5')).toBeInTheDocument();
  });

  it('renders the label for userMovesFirst = false (even rows)', () => {
    render(<ParityCaption userRows={parityRows(false).user} />);
    expect(screen.getByText('Waiting threats — yours on rows 2·4·6')).toBeInTheDocument();
  });

  it('is real (non-aria-hidden) text, so a screen reader gets the explanation directly', () => {
    render(<ParityCaption userRows={parityRows(true).user} />);
    const caption = screen.getByText('Waiting threats — yours on rows 1·3·5');
    expect(caption).not.toHaveAttribute('aria-hidden');
  });
});

describe('ParityGutter', () => {
  it('marks exactly the user rows active, 1 (bottom) through 6 (top)', () => {
    const { container } = render(<ParityGutter userRows={[1, 3, 5]} />);
    const rows = Array.from(container.querySelectorAll('.parity-ruler__row'));
    expect(rows).toHaveLength(6);
    // Rendered top-down (6 first) per SPEC §4's row numbering.
    expect(rows.map((r) => r.textContent)).toEqual(['6', '5', '4', '3', '2', '1']);
    const active = rows.filter((r) => r.getAttribute('data-active') === 'true').map((r) => r.textContent);
    expect(active.sort()).toEqual(['1', '3', '5']);
  });

  it('tracks a seat change from userMovesFirst true to false', () => {
    const { container, rerender } = render(<ParityGutter userRows={parityRows(true).user} />);
    let active = Array.from(container.querySelectorAll('.parity-ruler__row[data-active="true"]')).map(
      (r) => r.textContent,
    );
    expect(active.sort()).toEqual(['1', '3', '5']);

    rerender(<ParityGutter userRows={parityRows(false).user} />);
    active = Array.from(container.querySelectorAll('.parity-ruler__row[data-active="true"]')).map((r) => r.textContent);
    expect(active.sort()).toEqual(['2', '4', '6']);
  });
});
