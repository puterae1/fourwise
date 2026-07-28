// The board — docs/DESIGN-DIRECTION.md §8, §9 ("Signature — The Backlight"),
// §10 ("Board", "Disc", "Column hit target"). Purely presentational: every
// decision about WHETHER the lamp is lit, which column, and whether a click
// is legal right now is made by the caller (`useGameController` +
// `App.tsx`) — this component only renders the grid it is handed and
// reports drops.

import { useMemo } from 'react';
import { BOARD_COLUMNS, BOARD_ROWS, type Grid } from '../game/setup.js';
import type { Colour } from '../game/seat.js';
import type { Row } from '../game/parity.js';
import { landingRow } from './deriveBoard.js';
import type { WinLine } from './deriveBoard.js';
import type { CSSVars } from './cssVars.js';
import { ParityCaption, ParityGutter } from './ParityRuler.js';
import './Board.css';

export interface BoardProps {
  grid: Grid;
  winLine: WinLine | null;
  /** Colour to move right now, for the turn caret — `null` when the game is
   * over (design §9, "Game over: Off"). */
  turnColour: Colour | null;
  /** The best column to backlight, or `null` when nothing is lit (Analyse
   * before `Show me`, Setup — never — or the position isn't solved yet). */
  litColumn: number | null;
  lastPlayedColumn: number | null;
  onDrop: (column: number) => void;
  canDrop: (column: number) => boolean;
  /** The user's zugzwang-parity rows (SPEC §2), or `null` when the ruler
   * should not render at all this render — either because the mode doesn't
   * call for it, or because `ParityRuler.canShowParityRuler` says the
   * viewport can't fit the mandatory label. `Board` never decides this
   * itself: passing `null` and passing rows are the caller's only two
   * options, so an unlabelled highlight can't happen by construction. */
  parityUserRows: Row[] | null;
}

const COLUMN_INDICES = Array.from({ length: BOARD_COLUMNS }, (_, i) => i);
const ROWS_TOP_DOWN = Array.from({ length: BOARD_ROWS }, (_, i) => BOARD_ROWS - 1 - i);

export function Board({
  grid,
  winLine,
  turnColour,
  litColumn,
  lastPlayedColumn,
  onDrop,
  canDrop,
  parityUserRows,
}: BoardProps) {
  const winCells = useMemo(() => {
    const set = new Set<string>();
    for (const c of winLine?.cells ?? []) set.add(`${c.column},${c.row}`);
    return set;
  }, [winLine]);

  return (
    <div className="board">
      <div className="board__topbar">
        <span
          className="board__turn-caret"
          data-visible={turnColour !== null}
          style={(turnColour ? { '--caret-colour': `var(--c-${turnColour})` } : undefined) as CSSVars}
          aria-hidden="true"
        />
        {litColumn !== null && (
          <span
            className="board__lamp-caret"
            style={{ '--lamp-col': litColumn } as CSSVars}
            aria-hidden="true"
          />
        )}
        {lastPlayedColumn !== null && (
          <span
            className="board__played-wedge"
            style={{ '--played-col': lastPlayedColumn } as CSSVars}
            aria-hidden="true"
          />
        )}
        <div className="board__labels" aria-hidden="true">
          {COLUMN_INDICES.map((col) => (
            <span key={col} className="board__label" data-lit={col === litColumn}>
              {col + 1}
            </span>
          ))}
        </div>
      </div>

      <div className="board__body">
        <div className="board__parity-gutter" aria-hidden="true">
          {parityUserRows !== null && <ParityGutter userRows={parityUserRows} />}
        </div>
        <div className="board__frame">
          <div className="board__grid" role="group" aria-label="Connect four board, columns 1 to 7">
            {COLUMN_INDICES.map((col) => {
              const landing = landingRow(grid, col);
              const isFull = landing === null;
              const interactive = canDrop(col);
              const lit = col === litColumn;
              return (
                <button
                  key={col}
                  type="button"
                  className="board__column"
                  data-lit={lit}
                  disabled={!interactive}
                  aria-label={isFull ? `Column ${col + 1}, full` : `Drop in column ${col + 1}`}
                  onClick={() => onDrop(col)}
                >
                  {ROWS_TOP_DOWN.map((row) => {
                    const colour = grid[col]![row];
                    return (
                      <span
                        key={row}
                        className="board__cell"
                        data-colour={colour ?? undefined}
                        data-landing={row === landing}
                        data-lit-well={lit && colour === null}
                        data-win={winCells.has(`${col},${row}`)}
                      >
                        {colour && (
                          <span className="board__disc" data-colour={colour}>
                            <span className="disc-marker" aria-hidden="true" />
                          </span>
                        )}
                      </span>
                    );
                  })}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {parityUserRows !== null && <ParityCaption userRows={parityUserRows} />}
    </div>
  );
}
