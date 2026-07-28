// Two independent seat controls — docs/DESIGN-DIRECTION.md §5 ("the seat
// rule (visual) — non-negotiable"). CLAUDE.md invariant #1: firstMover and
// userColour are set separately here and NOWHERE derives one from the
// other. Both controls are always visible, in every mode, on one row.

import type { Colour } from '../game/seat.js';
import { Segmented } from './Segmented.js';
import { ColourSwatch } from './ColourSwatch.js';
import './SeatControls.css';

const COLOUR_OPTIONS = (colour: Colour) => ({
  value: colour,
  label: (
    <>
      <ColourSwatch colour={colour} />
      {colour === 'red' ? 'Red' : 'Yellow'}
    </>
  ),
});

export interface SeatControlsProps {
  userColour: Colour;
  firstMover: Colour;
  onUserColourChange: (colour: Colour) => void;
  onFirstMoverChange: (colour: Colour) => void;
}

export function SeatControls({ userColour, firstMover, onUserColourChange, onFirstMoverChange }: SeatControlsProps) {
  const options = [COLOUR_OPTIONS('red'), COLOUR_OPTIONS('yellow')];

  return (
    <div className="seat-bar">
      <div className="seat-bar__control">
        <span className="seat-bar__caption">You are</span>
        <Segmented name="seat-user-colour" legend="Your colour" options={options} value={userColour} onChange={onUserColourChange} />
      </div>
      <div className="seat-bar__control seat-bar__control--suffixed">
        <Segmented
          name="seat-first-mover"
          legend="Which colour moves first"
          options={options}
          value={firstMover}
          onChange={onFirstMoverChange}
        />
        <span className="seat-bar__caption">moves first</span>
      </div>
    </div>
  );
}
