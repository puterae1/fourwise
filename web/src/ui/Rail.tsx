// The desktop rail — docs/DESIGN-DIRECTION.md §8.4 (>=900px). Board stays
// left and large (`App.tsx` is unchanged there); this is the companion
// column: "the phone's verdict strip unrolled into full sentences, plus the
// move list that was a pull-up sheet".
//
// THE CRITICAL RULE (delegation brief, §8.4's own wording, pre-verified):
// "the rail re-sorts best-first on REVEAL, whenever reveal happens, not on
// mode." This file never inspects a mode string to decide sort order --
// `revealed` is a single boolean the CALLER supplies, and `App.tsx` passes
// exactly the same signal that already decides whether the board's lamp is
// lit (`useGameController`'s `litColumn !== null`), which is itself already
// correct per mode (automatic in Play, gated behind `Show me` in Analyse,
// never in Setup) -- one shared source of truth, not two rules that could
// drift apart.

import type { TranslatedAnalysis, VerdictKind } from '../game/verdict.js';
import { capitalize, type TerminalOutcome } from './copy.js';
import type { MoveListEntry } from './useGameController.js';
import { ColourSwatch } from './ColourSwatch.js';
import './Rail.css';

export const DESKTOP_MIN_WIDTH = 900;

export function isDesktopLayout(viewportWidth: number): boolean {
  return viewportWidth >= DESKTOP_MIN_WIDTH;
}

interface RailRow {
  column: number;
  kind: VerdictKind | 'full' | 'unknown';
  sentence: string;
  distance: number | null;
}

/**
 * SPEC §3.2's terminal-display amendment: once the game is over there is
 * nothing left to solve, so EVERY row reports the same seat-translated
 * outcome instead of the normal per-column verdict/pending state — never
 * "Still solving this column." under a headline that already says the game
 * ended. `terminal.kind` reuses the existing win/draw/loss `RailRow.kind`
 * so the bar styling needs no new CSS at all.
 */
function buildRows(translated: TranslatedAnalysis | null, terminal: TerminalOutcome | null): RailRow[] {
  if (terminal) {
    return Array.from({ length: 7 }, (_, column) => ({
      column,
      kind: terminal.kind,
      sentence: terminal.sentence,
      distance: null,
    }));
  }
  return Array.from({ length: 7 }, (_, column) => {
    const entry = translated?.columns[column];
    if (!entry || entry.kind === 'unknown') {
      return { column, kind: 'unknown' as const, sentence: 'Still solving this column.', distance: null };
    }
    if (entry.kind === 'full') {
      return { column, kind: 'full' as const, sentence: 'Column is full.', distance: null };
    }
    return {
      column,
      kind: entry.verdict.kind,
      sentence: `${capitalize(entry.verdict.sentence)}.`,
      distance: entry.verdict.distance,
    };
  });
}

const KIND_RANK: Record<RailRow['kind'], number> = { win: 0, draw: 1, loss: 2, unknown: 3, full: 4 };

/**
 * Best-first when `revealed`, plain column order (1-7) otherwise. THE ONLY
 * sort decision in this file, and it reads `revealed` alone -- see the
 * module comment's "critical rule".
 */
export function orderRows(rows: RailRow[], revealed: boolean): RailRow[] {
  if (!revealed) return rows;
  return [...rows].sort((a, b) => {
    const rankDiff = KIND_RANK[a.kind] - KIND_RANK[b.kind];
    if (rankDiff !== 0) return rankDiff;
    if (a.kind === 'win' || a.kind === 'loss') {
      return (a.distance ?? Infinity) - (b.distance ?? Infinity);
    }
    return a.column - b.column;
  });
}

export interface RailProps {
  /** `null` hides the verdict list entirely (Setup mode: there is nothing
   * to rank, and showing a stale pre-Setup analysis would be dishonest). */
  translated: TranslatedAnalysis | null;
  showVerdicts: boolean;
  /** Whether reveal has happened for the CURRENT position, under whichever
   * mode-specific rule already decided that upstream (`useGameController`'s
   * `litColumn`) -- see the module comment. */
  revealed: boolean;
  moveListEntries: MoveListEntry[];
  currentPly: number;
  onJump: (ply: number) => void;
  /** SPEC §3.2's terminal-display amendment (default `null`, i.e. no change
   * for a non-terminal position): when set, every row reports this outcome
   * instead of the normal per-column verdict -- see `buildRows`'s own doc
   * comment. */
  terminal?: TerminalOutcome | null;
}

export function Rail({ translated, showVerdicts, revealed, moveListEntries, currentPly, onJump, terminal = null }: RailProps) {
  const rows = orderRows(buildRows(translated, terminal), revealed);

  return (
    <aside className="rail">
      {showVerdicts && (
        <ul className="rail__verdicts" aria-label="Column evaluations, ranked">
          {rows.map((row) => (
            <li key={row.column} className="rail__verdict-row" data-kind={row.kind}>
              <span className="rail__verdict-bar" data-kind={row.kind} aria-hidden="true" />
              <span className="rail__verdict-column">{row.column + 1}</span>
              <span className="rail__verdict-sentence">{row.sentence}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="rail__moves">
        <h2 className="rail__moves-title">Moves</h2>
        <ul className="rail__move-list">
          <li>
            <button
              type="button"
              className="rail__move-row"
              data-current={currentPly === 0}
              onClick={() => onJump(0)}
            >
              <span className="rail__move-ply">–</span>
              <span>Start</span>
            </button>
          </li>
          {moveListEntries.map((entry) => (
            <li key={entry.ply}>
              <button
                type="button"
                className="rail__move-row"
                data-current={currentPly === entry.ply}
                onClick={() => onJump(entry.ply)}
              >
                <span className="rail__move-ply">{entry.ply}</span>
                <ColourSwatch colour={entry.colour} />
                <span>Column {entry.column + 1}</span>
                {entry.partial && (
                  <span className="rail__move-partial" title="Chosen from an incomplete analysis">
                    partial
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
