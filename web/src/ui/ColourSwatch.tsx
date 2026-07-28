// A small disc swatch carrying the same colour-blind marker as the board
// disc (design §4: colour is never the only signal, even in a control).

import type { Colour } from '../game/seat.js';
import './ColourSwatch.css';

export function ColourSwatch({ colour }: { colour: Colour }) {
  return (
    <span className="colour-swatch" data-colour={colour} aria-hidden="true">
      <span className="disc-marker" />
    </span>
  );
}
