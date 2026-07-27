// The seat model — SPEC.md §1. This is the reason the project exists: colour
// and turn order are independent, all four combinations are legal, and
// nothing below this file may ever see a colour (the engine boundary speaks
// only in 'first' | 'second' — see engine/types.ts).
//
// `firstMover` and `userColour` are set independently and stored separately.
// `userMovesFirst` is ALWAYS derived, never stored — see the module-level
// function below, which is the ONLY place that equality is computed.

export type Colour = 'red' | 'yellow';

/** The engine's side-to-move vocabulary. Colour-blind by construction. */
export type Side = 'first' | 'second';

export interface Seat {
  /** Which colour moves first THIS game. */
  firstMover: Colour;
  /** Which colour the user is playing THIS game. */
  userColour: Colour;
}

export function otherColour(colour: Colour): Colour {
  return colour === 'red' ? 'yellow' : 'red';
}

export function otherSide(side: Side): Side {
  return side === 'first' ? 'second' : 'first';
}

/**
 * Derived, never stored (SPEC §1). This is the ONLY function permitted to
 * compare `firstMover` and `userColour` for equality — do not duplicate this
 * comparison elsewhere.
 */
export function userMovesFirst(seat: Seat): boolean {
  return seat.firstMover === seat.userColour;
}

/**
 * Which colour is to move on 0-indexed ply `ply`: `firstMover` on even plies,
 * the other colour on odd plies (SPEC §1, "Game layer").
 */
export function colourAtPly(seat: Seat, ply: number): Colour {
  return ply % 2 === 0 ? seat.firstMover : otherColour(seat.firstMover);
}

/**
 * Maps an engine-facing side to a colour under this seat. This mapping
 * depends ONLY on `firstMover` — never on `userColour` — which is exactly
 * the independence the seat model exists to preserve.
 */
export function colourForSide(seat: Seat, side: Side): Colour {
  return side === 'first' ? seat.firstMover : otherColour(seat.firstMover);
}

/** Maps a colour to the engine-facing side it corresponds to, under this seat. */
export function sideForColour(seat: Seat, colour: Colour): Side {
  return colour === seat.firstMover ? 'first' : 'second';
}

/** Which engine-facing side the user is playing, under this seat. */
export function userSide(seat: Seat): Side {
  return sideForColour(seat, seat.userColour);
}

/** Which engine-facing side the opponent is playing, under this seat. */
export function opponentSide(seat: Seat): Side {
  return otherSide(userSide(seat));
}
