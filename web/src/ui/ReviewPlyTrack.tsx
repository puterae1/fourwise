// The review ply track + stepper controls — docs/DESIGN-DIRECTION.md §17.2.
// One tick per move, tinted to the hue of the side that played it (R8: the
// first tick's hue comes from `seat.firstMover`, never assumed), with one of
// three evaluation marks below each: an open ring says "not evaluated yet"
// honestly (SPEC §3.1) rather than guessing; a dot says "evaluated, clean";
// a wedge says "this move threw something away" (verdict-only firing,
// `game/blunder.ts`, reused unchanged via `game/reviewTrack.ts`).
//
// The track's ticks/marks are backward-looking provenance about SPECIFIC
// PAST moves and stay visible even at a terminal position (SPEC §3.2 scope
// precision, design §17.3) -- unlike the analysis strip, which the caller
// (`ReviewStepper.tsx`) already replaces with the terminal outcome.
//
// Per design §17.2/§17.5: "The track itself is one focusable control with an
// accessible name naming the current ply and its evaluation state." The
// ticks themselves are decorative (`aria-hidden`); the group's own
// `aria-label` carries the accessible summary, and stepping is done via the
// four buttons below (and the caller's own global arrow-key handler) rather
// than by focusing individual ticks.

import type { PlyMark } from '../game/reviewTrack.js';
import { notEvaluatedLine } from '../game/reviewTrack.js';
import { colourAtPly, type Seat } from '../game/seat.js';
import type { CSSVars } from './cssVars.js';
import './ReviewPlyTrack.css';

export interface ReviewPlyTrackProps {
  seat: Seat;
  currentPly: number;
  totalPlies: number;
  marks: PlyMark[];
  notEvaluatedCount: number;
  onFirst: () => void;
  onPrev: () => void;
  onNext: () => void;
  onLast: () => void;
  canGoPrev: boolean;
  canGoNext: boolean;
}

function markSummary(mark: PlyMark | undefined): string {
  if (!mark) return 'the start of the game';
  if (mark.kind === 'unevaluated') return 'not evaluated yet';
  if (mark.kind === 'blunder') return 'a blunder';
  return 'no blunder';
}

export function ReviewPlyTrack({
  seat,
  currentPly,
  totalPlies,
  marks,
  notEvaluatedCount,
  onFirst,
  onPrev,
  onNext,
  onLast,
  canGoPrev,
  canGoNext,
}: ReviewPlyTrackProps) {
  const caption = notEvaluatedLine(notEvaluatedCount);
  // The mark for the move that landed on the CURRENT ply -- `marks[i]` is
  // the transition INTO ply `i + 1` (see `game/reviewTrack.ts`'s own doc
  // comment), so the mark that describes "how we got here" is at index
  // `currentPly - 1`.
  const currentMark = currentPly > 0 ? marks[currentPly - 1] : undefined;
  const trackLabel = `Ply track. Ply ${currentPly} of ${totalPlies}: ${markSummary(currentMark)}.${
    caption ? ` ${caption}` : ''
  }`;

  return (
    <div className="review-track">
      <div className="review-track__ticks" role="group" tabIndex={0} aria-label={trackLabel}>
        {marks.map((mark, index) => {
          const tickNumber = index + 1; // 1-indexed: tick i represents moves[i]
          const colour = colourAtPly(seat, index);
          const isCurrent = tickNumber === currentPly;
          return (
            <div key={index} className="review-track__tick-col" aria-hidden="true">
              <span
                className="review-track__tick"
                data-current={isCurrent}
                style={{ '--tick-colour': `var(--c-${colour})` } as CSSVars}
              />
              <span className="review-track__mark" data-kind={mark.kind} />
            </div>
          );
        })}
      </div>

      {caption && <p className="review-track__caption">{caption}</p>}

      <div className="review-track__stepper">
        <button
          type="button"
          className="review-track__step-button"
          onClick={onFirst}
          disabled={!canGoPrev}
          aria-label="Jump to the first move"
        >
          « First
        </button>
        <button
          type="button"
          className="review-track__step-button"
          onClick={onPrev}
          disabled={!canGoPrev}
          aria-label="Back one move"
        >
          ‹ Back
        </button>
        <span className="review-track__counter" aria-hidden="true">
          {currentPly} / {totalPlies}
        </span>
        <button
          type="button"
          className="review-track__step-button"
          onClick={onNext}
          disabled={!canGoNext}
          aria-label="Forward one move"
        >
          Next ›
        </button>
        <button
          type="button"
          className="review-track__step-button"
          onClick={onLast}
          disabled={!canGoNext}
          aria-label="Jump to the last move"
        >
          Last »
        </button>
      </div>
    </div>
  );
}
