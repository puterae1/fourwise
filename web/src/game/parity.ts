// Zugzwang parity — SPEC.md §2.
//
// "The player who moves first wins single waiting threats on odd rows
// (1, 3, 5). The player who moves second wins them on even rows (2, 4, 6)."
// This depends on TURN ORDER only, never on colour, and is computed from
// `userMovesFirst` alone — never from `Seat` directly, so it cannot
// accidentally be re-derived from colour.
//
// Scope (SPEC §2): parity governs SINGLE threats resolved by zugzwang. A
// double threat wins immediately and is parity-independent; this module
// makes no claim about double threats, and callers must not present these
// rows as though they did.

export type Row = 1 | 2 | 3 | 4 | 5 | 6;

const ODD_ROWS: Row[] = [1, 3, 5];
const EVEN_ROWS: Row[] = [2, 4, 6];

export interface ParityRows {
  /** Rows on which the USER wins a single waiting threat by zugzwang. */
  user: Row[];
  /** Rows on which the OPPONENT wins a single waiting threat by zugzwang. */
  opponent: Row[];
}

/**
 * `userMovesFirst` -> the parity ruler for this seat. The player who moves
 * first owns the odd rows; the player who moves second owns the even rows.
 */
export function parityRows(userMovesFirst: boolean): ParityRows {
  return userMovesFirst ? { user: ODD_ROWS, opponent: EVEN_ROWS } : { user: EVEN_ROWS, opponent: ODD_ROWS };
}
