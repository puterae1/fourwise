// The Analyse action slot — docs/DESIGN-DIRECTION.md §8.2. The verdict
// strip: one cell per column, aligned under the board, bar height encoding
// speed and fill TREATMENT (never hue) encoding win/draw/loss. The best
// column is gated behind `Show me` per the owner override (§14.1) — see
// `docs/SPEC.md` §3.3 header note in the delegation prompt for this wave.
//
// Distance is the winner's remaining OWN moves (`game/verdict.ts`) for
// win/loss columns. A draw's `distance` is `null` by contract (score 0
// carries no speed information) — CLAUDE.md "no placeholder data" means
// this renders as a plain "draw" label, never a fabricated number.

import type { TranslatedAnalysis, VerdictKind } from '../game/verdict.js';
import type { ColumnEval } from '../engine/types.js';
import { capitalize } from './copy.js';
import './AnalysePanel.css';

const MAX_OWN_MOVE_DISTANCE = 21; // 42-square board, halved

function barHeightPercent(distance: number): number {
  const pct = 100 - ((distance - 1) / (MAX_OWN_MOVE_DISTANCE - 1)) * 88;
  return Math.max(12, Math.min(100, pct));
}

/**
 * SPEC §3.2's "Rank" bullet: "moves that throw away a win flagged distinctly
 * from moves that were already losing". A column throws the win away when a
 * win was actually on the board (the POSITION's own verdict, already visible
 * pre-reveal per design §8.2 -- naming no column, so this doesn't touch the
 * `Show me` gate) and this particular column doesn't hold it. When the
 * position was already a draw or a loss, nothing was there to throw away --
 * that column was "already losing", not flagged. Exported so this
 * distinction is directly testable without rendering the whole panel.
 */
export function columnThrowsAwayWin(positionKind: VerdictKind | null, columnKind: VerdictKind): boolean {
  return positionKind === 'win' && columnKind !== 'win';
}

export interface AnalysePanelProps {
  translated: TranslatedAnalysis | null;
  rawColumns: ColumnEval[] | null;
  revealed: boolean;
  selected: number | null;
  onSelect: (column: number | null) => void;
  onShowMe: () => void;
  rawScoresOn: boolean;
  onToggleRawScores: () => void;
}

export function AnalysePanel({
  translated,
  rawColumns,
  revealed,
  selected,
  onSelect,
  onShowMe,
  rawScoresOn,
  onToggleRawScores,
}: AnalysePanelProps) {
  const columns = Array.from({ length: 7 }, (_, i) => i);
  const best = translated?.best ?? null;
  // The POSITION's own verdict -- visible pre-reveal already (design §8.2:
  // it names no column), so reading it here to distinguish "throws away a
  // win" from "already losing" does not touch the `Show me` gate.
  const positionKind: VerdictKind | null = translated?.position?.kind ?? null;
  const bestColumnEval = best !== null ? translated?.columns[best] : null;
  const bestDistance =
    bestColumnEval?.kind === 'score' && bestColumnEval.verdict.kind === 'win' ? bestColumnEval.verdict.distance : null;

  return (
    <div className="analyse-panel">
      <div className="verdict-strip" role="group" aria-label="Column evaluations">
        {columns.map((index) => {
          const column = translated?.columns[index];
          const raw = rawColumns?.[index];
          const inverted = revealed && best === index;
          const isSelected = selected === index;

          let kind: 'full' | 'unknown' | 'win' | 'draw' | 'loss' = 'unknown';
          let numeral = '';
          let heightPct = 0;
          let sentenceForAria = 'Still solving this column.';
          let throwsAwayWin = false;
          let slowerThanBest = false;

          if (!column || column.kind === 'unknown') {
            kind = 'unknown';
          } else if (column.kind === 'full') {
            kind = 'full';
            numeral = '—';
            sentenceForAria = 'Column is full.';
          } else {
            const verdict = column.verdict;
            kind = verdict.kind;
            sentenceForAria = capitalize(verdict.sentence) + '.';
            throwsAwayWin = columnThrowsAwayWin(positionKind, verdict.kind);
            if (throwsAwayWin) sentenceForAria += ' This throws away the win.';
            if (verdict.kind === 'draw') {
              heightPct = 40;
              numeral = '';
            } else {
              heightPct = barHeightPercent(verdict.distance!);
              numeral = String(verdict.distance);
              // A quiet, passive note only -- never the interrupting flag
              // (that's the Play-mode blunder line, SPEC §3.2's amended
              // Firing rule). Shown only once revealed: comparing this
              // column's speed to the best one's is itself a ranking
              // signal, which the `Show me` gate protects pre-reveal.
              if (
                revealed &&
                verdict.kind === 'win' &&
                index !== best &&
                bestDistance !== null &&
                verdict.distance !== null &&
                verdict.distance > bestDistance
              ) {
                slowerThanBest = true;
              }
            }
          }

          return (
            <button
              key={index}
              type="button"
              className="verdict-cell"
              data-kind={kind}
              data-invert={inverted}
              data-selected={isSelected}
              data-throws-away-win={throwsAwayWin}
              aria-pressed={isSelected}
              aria-label={`Column ${index + 1}. ${sentenceForAria}`}
              onClick={() => onSelect(isSelected ? null : index)}
            >
              <span className="verdict-cell__track">
                {(kind === 'win' || kind === 'loss' || kind === 'draw') && (
                  <span className="verdict-cell__bar" data-kind={kind} style={{ height: `${heightPct}%` }} />
                )}
                {kind === 'unknown' && <span className="verdict-cell__pending" aria-hidden="true">···</span>}
              </span>
              <span className="verdict-cell__column-number">{index + 1}</span>
              <span className="verdict-cell__numeral">
                {kind === 'draw' ? 'draw' : numeral}
              </span>
              {throwsAwayWin && <span className="verdict-cell__flag">threw away win</span>}
              {slowerThanBest && <span className="verdict-cell__note">slower than best</span>}
              <span className="verdict-cell__raw" data-visible={rawScoresOn}>
                {raw?.kind === 'score' ? `raw ${raw.score}` : ' '}
              </span>
            </button>
          );
        })}
      </div>

      <div className="analyse-panel__footer">
        <button type="button" className="analyse-panel__show-me" onClick={onShowMe} disabled={revealed}>
          Show me
        </button>
        <button
          type="button"
          className="analyse-panel__raw-toggle"
          aria-pressed={rawScoresOn}
          onClick={onToggleRawScores}
        >
          raw scores {rawScoresOn ? '▾' : '▸'}
        </button>
      </div>
    </div>
  );
}
