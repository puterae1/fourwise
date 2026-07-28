// Derives a renderable grid (plus game-over state) from a `GameState`. This
// is a UI-only concern: nothing in `game/` currently detects four-in-a-row
// or a full board for the LIVE game (only `setup.ts` checks a hand-built
// grid). Rather than adding that detection to `game/` — out of bounds for
// this wave — we reuse the exported grid primitives (`emptyGrid`,
// `dropDisc`) that `setup.ts` already provides and replay the move list
// through them, which keeps the seat/colour mapping in exactly one place
// (`colourAtPly`, from `game/seat.ts`).

import { colourAtPly, type Colour } from '../game/seat.js';
import { BOARD_COLUMNS, BOARD_ROWS, dropDisc, emptyGrid, type Grid } from '../game/setup.js';
import { enginePosition, type GameState } from '../game/gameState.js';

export interface WinLine {
  colour: Colour;
  cells: ReadonlyArray<{ column: number; row: number }>;
}

export interface BoardDerivation {
  grid: Grid;
  winLine: WinLine | null;
  isFull: boolean;
  isGameOver: boolean;
  /** The column played to reach this position, if any — used for the small
   * "disc just played" wedge marker (design §10, "Disc"). */
  lastPlayedColumn: number | null;
}

const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], // horizontal
  [0, 1], // vertical
  [1, 1], // diagonal /
  [1, -1], // diagonal \
];

function findWinLine(grid: Grid): WinLine | null {
  for (let c = 0; c < BOARD_COLUMNS; c++) {
    for (let r = 0; r < BOARD_ROWS; r++) {
      const colour = grid[c]![r];
      if (!colour) continue;
      for (const [dc, dr] of DIRECTIONS) {
        const cells: Array<{ column: number; row: number }> = [{ column: c, row: r }];
        for (let k = 1; k < 4; k++) {
          const cc = c + dc * k;
          const rr = r + dr * k;
          if (cc < 0 || cc >= BOARD_COLUMNS || rr < 0 || rr >= BOARD_ROWS) break;
          if (grid[cc]![rr] !== colour) break;
          cells.push({ column: cc, row: rr });
        }
        if (cells.length >= 4) return { colour, cells: cells.slice(0, 4) };
      }
    }
  }
  return null;
}

export function deriveBoard(state: GameState): BoardDerivation {
  const position = enginePosition(state);
  let grid: Grid = emptyGrid();
  for (let ply = 0; ply < position.length; ply++) {
    const column = Number(position[ply]) - 1;
    grid = dropDisc(grid, column, colourAtPly(state.seat, ply));
  }
  const winLine = findWinLine(grid);
  const isFull = position.length === BOARD_COLUMNS * BOARD_ROWS;
  const lastPlayedColumn = position.length > 0 ? Number(position[position.length - 1]) - 1 : null;
  return { grid, winLine, isFull, isGameOver: winLine !== null || isFull, lastPlayedColumn };
}

export function isColumnFull(grid: Grid, column: number): boolean {
  return grid[column]!.every((cell) => cell !== null);
}

/** The row (0-indexed, 0 = bottom) a disc would land on if dropped now, or
 * `null` if the column is full. Used for the hover/focus landing preview
 * (SPEC §4). */
export function landingRow(grid: Grid, column: number): number | null {
  const row = grid[column]!.findIndex((cell) => cell === null);
  return row === -1 ? null : row;
}
