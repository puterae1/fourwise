// Parity ruler — docs/SPEC.md §2 (as amended 2026-07-28) and
// docs/DESIGN-DIRECTION.md §10 ("Parity ruler"). Highlights the USER's
// zugzwang-parity rows in the board's left gutter, computed from
// `userMovesFirst` alone (never from colour — see `game/parity.ts`).
//
// MANDATORY presentation rule (SPEC §2 amendment): an unlabelled row
// highlight reads as "build here to win", which is wrong whenever the actual
// win is a double threat (most wins). The ruler must always carry the
// explicit "waiting threats only" label alongside the highlight, and if a
// layout breakpoint cannot fit that label, the caller must hide the WHOLE
// ruler rather than show the highlight without it — `canShowParityRuler`
// below is the single place that decision is made, so it can never happen
// that one half renders without the other.

import type { Row } from '../game/parity.js';
import './ParityRuler.css';

/**
 * Below this viewport width the caption cannot be relied on to sit legibly
 * with the board (design's own supported minimum is 360px — this sits well
 * under it, so the ruler is visible for every width the design actually
 * targets, and only disappears in a genuinely cramped host). Exported so the
 * hide-not-degrade behaviour is testable as a plain function, independent of
 * any component.
 */
export const MIN_WIDTH_FOR_PARITY_RULER = 280;

export function canShowParityRuler(viewportWidth: number): boolean {
  return viewportWidth >= MIN_WIDTH_FOR_PARITY_RULER;
}

/** The mandatory label (SPEC §2: "e.g. 'waiting threats — yours on rows
 * 1·3·5'"). Never presented as a general targeting guide — see the module
 * comment and SPEC §2's "Scope this correctly" paragraph: this labels
 * WAITING THREATS only, not "where to build". */
export function parityLabel(userRows: Row[]): string {
  const sorted = [...userRows].sort((a, b) => a - b);
  return `Waiting threats — yours on rows ${sorted.join('·')}`;
}

const ROWS_TOP_DOWN: Row[] = [6, 5, 4, 3, 2, 1];

export interface ParityGutterProps {
  /** Rows (1 = bottom, per SPEC §4) on which the user wins a single waiting
   * threat by zugzwang. */
  userRows: Row[];
}

/** The 22px column of row numbers + Signal bars, meant to sit directly
 * beside the board frame (design §10). Purely presentational — the caller
 * decides whether to render this at all (see `canShowParityRuler`); this
 * component never hides itself; that would let a caller render only the
 * caption and end up with an "orphaned" highlight in some future refactor. */
export function ParityGutter({ userRows }: ParityGutterProps) {
  return (
    <>
      {ROWS_TOP_DOWN.map((row) => (
        <div key={row} className="parity-ruler__row" data-active={userRows.includes(row)}>
          <span className="parity-ruler__bar" aria-hidden="true" />
          <span className="parity-ruler__number" aria-hidden="true">
            {row}
          </span>
        </div>
      ))}
    </>
  );
}

export interface ParityCaptionProps {
  userRows: Row[];
}

/** The honest label itself (SPEC §2 amendment) — real text, not
 * `aria-hidden`, so a screen reader gets the explanation directly rather
 * than having to infer it from the (aria-hidden) coloured bars above. */
export function ParityCaption({ userRows }: ParityCaptionProps) {
  return <p className="parity-ruler__caption">{parityLabel(userRows)}</p>;
}
