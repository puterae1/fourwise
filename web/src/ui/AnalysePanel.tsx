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

import type { TranslatedAnalysis } from '../game/verdict.js';
import type { ColumnEval } from '../engine/types.js';
import { capitalize } from './copy.js';
import './AnalysePanel.css';

const MAX_OWN_MOVE_DISTANCE = 21; // 42-square board, halved

function barHeightPercent(distance: number): number {
  const pct = 100 - ((distance - 1) / (MAX_OWN_MOVE_DISTANCE - 1)) * 88;
  return Math.max(12, Math.min(100, pct));
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
            if (verdict.kind === 'draw') {
              heightPct = 40;
              numeral = '';
            } else {
              heightPct = barHeightPercent(verdict.distance!);
              numeral = String(verdict.distance);
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
