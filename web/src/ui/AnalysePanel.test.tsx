// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { AnalysePanel, columnThrowsAwayWin } from './AnalysePanel.js';
import type { TranslatedAnalysis } from '../game/verdict.js';

afterEach(cleanup);

const noop = () => {};

function verdictColumn(kind: 'win' | 'draw' | 'loss', distance: number | null) {
  return {
    kind: 'score' as const,
    verdict: {
      kind,
      distance,
      sentence: kind === 'win' ? `you win in ${distance} moves` : kind === 'loss' ? `the opponent wins in ${distance} moves` : 'draw',
    },
  };
}

describe('columnThrowsAwayWin (SPEC §3.2 "Rank": distinct from "already losing")', () => {
  it('flags a losing/drawing column when the position itself is a win', () => {
    expect(columnThrowsAwayWin('win', 'loss')).toBe(true);
    expect(columnThrowsAwayWin('win', 'draw')).toBe(true);
  });

  it('does not flag a losing column when the position was already lost or drawn -- nothing to throw away', () => {
    expect(columnThrowsAwayWin('loss', 'loss')).toBe(false);
    expect(columnThrowsAwayWin('draw', 'loss')).toBe(false);
  });

  it('does not flag a winning column even when the position is a win (it holds the win, doesn\'t throw it away)', () => {
    expect(columnThrowsAwayWin('win', 'win')).toBe(false);
  });

  it('never flags anything when the position verdict is unknown (still solving)', () => {
    expect(columnThrowsAwayWin(null, 'loss')).toBe(false);
  });
});

describe('AnalysePanel — unknown honesty', () => {
  it('renders a pending marker, no numeral, and no throws-away flag for an unsolved column', () => {
    const translated: TranslatedAnalysis = {
      position: null,
      best: null,
      complete: false,
      columns: [
        { kind: 'unknown' },
        { kind: 'unknown' },
        { kind: 'unknown' },
        { kind: 'unknown' },
        { kind: 'unknown' },
        { kind: 'unknown' },
        { kind: 'unknown' },
      ],
    };

    render(
      <AnalysePanel
        translated={translated}
        rawColumns={null}
        revealed={false}
        selected={null}
        onSelect={noop}
        onShowMe={noop}
        rawScoresOn={false}
        onToggleRawScores={noop}
      />,
    );

    const cell1 = screen.getByRole('button', { name: /^Column 1\./ });
    expect(cell1).toHaveAttribute('data-kind', 'unknown');
    expect(cell1).toHaveAttribute('data-throws-away-win', 'false');
    expect(cell1).toHaveAccessibleName('Column 1. Still solving this column.');
  });
});

describe('AnalysePanel — throws-away-win vs already-losing distinction', () => {
  function analysisWith(columns: TranslatedAnalysis['columns'], best: number): TranslatedAnalysis {
    return { position: null, best, complete: true, columns };
  }

  it('flags a losing column distinctly when the position overall is a win (best column wins)', () => {
    const columns: TranslatedAnalysis['columns'] = [
      verdictColumn('win', 9),
      verdictColumn('loss', 5),
      { kind: 'unknown' },
      { kind: 'unknown' },
      { kind: 'unknown' },
      { kind: 'unknown' },
      { kind: 'unknown' },
    ];
    const translated = analysisWith(columns, 0);
    // `translated.position` mirrors the best column's verdict per
    // `translateAnalysis` -- reproduced directly here since this is a
    // hand-built fixture, not routed through `game/verdict.ts`.
    translated.position = columns[0]!.kind === 'score' ? columns[0].verdict : null;

    render(
      <AnalysePanel
        translated={translated}
        rawColumns={null}
        revealed={false}
        selected={null}
        onSelect={noop}
        onShowMe={noop}
        rawScoresOn={false}
        onToggleRawScores={noop}
      />,
    );

    const losingCell = screen.getByRole('button', { name: /^Column 2\./ });
    expect(losingCell).toHaveAttribute('data-throws-away-win', 'true');
    expect(losingCell).toHaveAccessibleName(/This throws away the win\./);
    // Visible to sighted users, not just present in the DOM attribute/aria-label
    // (verifier audit): a real, on-screen badge inside the flagged cell.
    expect(within(losingCell).getByText('threw away win')).toBeVisible();

    const winningCell = screen.getByRole('button', { name: /^Column 1\./ });
    expect(winningCell).toHaveAttribute('data-throws-away-win', 'false');
    expect(within(winningCell).queryByText('threw away win')).not.toBeInTheDocument();
  });

  it('does NOT flag a losing column when the position overall was already lost -- no win existed to throw away', () => {
    const columns: TranslatedAnalysis['columns'] = [
      verdictColumn('loss', 9),
      verdictColumn('loss', 5),
      { kind: 'unknown' },
      { kind: 'unknown' },
      { kind: 'unknown' },
      { kind: 'unknown' },
      { kind: 'unknown' },
    ];
    const translated = analysisWith(columns, 0);
    translated.position = columns[0]!.kind === 'score' ? columns[0].verdict : null;

    render(
      <AnalysePanel
        translated={translated}
        rawColumns={null}
        revealed={false}
        selected={null}
        onSelect={noop}
        onShowMe={noop}
        rawScoresOn={false}
        onToggleRawScores={noop}
      />,
    );

    const secondCell = screen.getByRole('button', { name: /^Column 2\./ });
    expect(secondCell).toHaveAttribute('data-throws-away-win', 'false');
    expect(secondCell.getAttribute('aria-label')).not.toContain('throws away');
    expect(within(secondCell).queryByText('threw away win')).not.toBeInTheDocument();
  });
});

describe('AnalysePanel — best highlight stays behind the Show me gate', () => {
  it('does not invert the best column before reveal, and does before/after onShowMe', () => {
    const columns: TranslatedAnalysis['columns'] = [
      verdictColumn('win', 5),
      { kind: 'unknown' },
      { kind: 'unknown' },
      { kind: 'unknown' },
      { kind: 'unknown' },
      { kind: 'unknown' },
      { kind: 'unknown' },
    ];
    const translated: TranslatedAnalysis = { position: null, best: 0, complete: true, columns };

    const { rerender } = render(
      <AnalysePanel
        translated={translated}
        rawColumns={null}
        revealed={false}
        selected={null}
        onSelect={noop}
        onShowMe={noop}
        rawScoresOn={false}
        onToggleRawScores={noop}
      />,
    );
    expect(screen.getByRole('button', { name: /^Column 1\./ })).toHaveAttribute('data-invert', 'false');

    rerender(
      <AnalysePanel
        translated={translated}
        rawColumns={null}
        revealed
        selected={null}
        onSelect={noop}
        onShowMe={noop}
        rawScoresOn={false}
        onToggleRawScores={noop}
      />,
    );
    expect(screen.getByRole('button', { name: /^Column 1\./ })).toHaveAttribute('data-invert', 'true');
  });
});

describe('AnalysePanel — quiet "slower than best" note', () => {
  it('never appears before reveal, even for a win column slower than the best', () => {
    const columns: TranslatedAnalysis['columns'] = [
      verdictColumn('win', 5),
      verdictColumn('win', 11),
      { kind: 'unknown' },
      { kind: 'unknown' },
      { kind: 'unknown' },
      { kind: 'unknown' },
      { kind: 'unknown' },
    ];
    const translated: TranslatedAnalysis = { position: null, best: 0, complete: true, columns };

    render(
      <AnalysePanel
        translated={translated}
        rawColumns={null}
        revealed={false}
        selected={null}
        onSelect={vi.fn()}
        onShowMe={noop}
        rawScoresOn={false}
        onToggleRawScores={noop}
      />,
    );

    expect(screen.queryByText('slower than best')).not.toBeInTheDocument();
  });

  it('appears after reveal for a win column slower than the best, and never for the best column itself', () => {
    const columns: TranslatedAnalysis['columns'] = [
      verdictColumn('win', 5),
      verdictColumn('win', 11),
      { kind: 'unknown' },
      { kind: 'unknown' },
      { kind: 'unknown' },
      { kind: 'unknown' },
      { kind: 'unknown' },
    ];
    const translated: TranslatedAnalysis = { position: null, best: 0, complete: true, columns };

    render(
      <AnalysePanel
        translated={translated}
        rawColumns={null}
        revealed
        selected={null}
        onSelect={noop}
        onShowMe={noop}
        rawScoresOn={false}
        onToggleRawScores={noop}
      />,
    );

    expect(screen.getAllByText('slower than best')).toHaveLength(1);
  });
});
