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
  /** Design §17.5 (review stepper): "stepping back, jumping more than one
   * ply, tapping the track, or scrubbing places discs instantly — a rewind
   * animation would assert a physical event that never happened." Every
   * OTHER caller (Play, Analyse, Setup) always plays a genuine single move
   * forward, so this defaults to `false` (the existing drop animation,
   * unchanged) and is never passed by them. `prefers-reduced-motion` already
   * removes the animation globally regardless of this prop (index.css) — this
   * is the ADDITIONAL, non-motion-preference case where a caller knows no
   * physical drop actually just happened. */
  instant?: boolean;
}

const COLUMN_INDICES = Array.from({ length: BOARD_COLUMNS }, (_, i) => i);
const ROWS_TOP_DOWN = Array.from({ length: BOARD_ROWS }, (_, i) => BOARD_ROWS - 1 - i);

// Cell-centre coordinates in the win-line overlay's own coordinate space --
// its `viewBox` is `0 0 BOARD_COLUMNS BOARD_ROWS` (one user-unit per cell),
// so these are plain "column/row index + 0.5", independent of `--cell`'s
// actual pixel size at any viewport width (SPEC's "track the disc centres
// exactly ... not just desktop"). Row 0 is the BOTTOM (SPEC §4), but the
// board renders top-down (`ROWS_TOP_DOWN` above), so Y is flipped.
function cellCentreX(column: number): number {
  return column + 0.5;
}
function cellCentreY(row: number): number {
  return BOARD_ROWS - 1 - row + 0.5;
}

export function Board({
  grid,
  winLine,
  turnColour,
  litColumn,
  lastPlayedColumn,
  onDrop,
  canDrop,
  parityUserRows,
  instant = false,
}: BoardProps) {
  const winCells = useMemo(() => {
    const set = new Set<string>();
    for (const c of winLine?.cells ?? []) set.add(`${c.column},${c.row}`);
    return set;
  }, [winLine]);

  // §9 "Game over": the winning four is drawn as a line through the disc
  // centres, not lit -- endpoints are the FIRST and LAST winning cell
  // (`deriveBoard.ts`'s `findWinLine` always returns them in-order along the
  // direction it found, so the two ends of `cells` are the two ends of the
  // four; the two middle cells are colinear between them by construction of
  // four-in-a-row, so a straight line between the ends passes through all
  // four centres). `null` on a draw or mid-game -- there is no winning four.
  const winLineEndpoints = useMemo(() => {
    const cells = winLine?.cells;
    if (!cells || cells.length < 4) return null;
    const first = cells[0]!;
    const last = cells[cells.length - 1]!;
    return { x1: cellCentreX(first.column), y1: cellCentreY(first.row), x2: cellCentreX(last.column), y2: cellCentreY(last.row) };
  }, [winLine]);

  return (
    <div className="board" data-instant={instant}>
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
            {winLineEndpoints && (
              // §9 "Game over": "the winning four is drawn instead: a 5px
              // `Frame` line through the disc centres with a 2px `--c-n-0`
              // outer stroke." Two stacked, non-scaling-strokes give an
              // exact-pixel-width line (5px inner, 9px outer) regardless of
              // `--cell`'s clamped size, while the line's ENDPOINTS still
              // live in the viewBox's cell-unit coordinate space, so they
              // track the disc centres exactly at every viewport width.
              <svg
                className="board__win-line"
                viewBox={`0 0 ${BOARD_COLUMNS} ${BOARD_ROWS}`}
                preserveAspectRatio="none"
                aria-hidden="true"
                data-testid="win-line"
              >
                <line
                  className="board__win-line-outer"
                  x1={winLineEndpoints.x1}
                  y1={winLineEndpoints.y1}
                  x2={winLineEndpoints.x2}
                  y2={winLineEndpoints.y2}
                  vectorEffect="non-scaling-stroke"
                />
                <line
                  className="board__win-line-inner"
                  x1={winLineEndpoints.x1}
                  y1={winLineEndpoints.y1}
                  x2={winLineEndpoints.x2}
                  y2={winLineEndpoints.y2}
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            )}
          </div>
        </div>
      </div>

      {parityUserRows !== null && <ParityCaption userRows={parityUserRows} />}
    </div>
  );
}
