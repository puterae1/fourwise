// The first-run seat prompt (owner ruling, `docs/SPEC.md` §1 / §5). Any
// fixed default seat would silently answer the question this tool exists to
// make the user answer, so on a fresh load the app asks once, on one
// screen: "Which colour moves first?" and "Which colour are you?", side by
// side, both unselected, Start disabled until both are chosen. Not a
// wizard -- there is no sequence of steps here, just two independent
// controls and a submit button.
//
// docs/DESIGN-DIRECTION.md §5 ("the seat rule (visual) -- non-negotiable"):
// two separate, visually parallel controls, neither colour a default or a
// first item, colour never implying turn order. This reuses the same
// `Segmented` + `ColourSwatch` building blocks as `SeatControls.tsx` so the
// prompt and the in-app controls read as the same object, just asked once
// up front.
//
// Engine warm-up: while this prompt is on screen the app is already idle
// waiting for a tap, so this is exactly when to pay for calibration. The
// effect below fires `client.calibrate()` as soon as a client exists and
// never awaits it -- Start does not wait on it either. `client.calibrate()`
// is itself memoized per client instance and only un-caches on rejection
// (`engine/client.ts`), which is what makes this safe under React
// StrictMode's dev-mode double-mount: a transient first client that gets
// torn down mid-probe simply has its calibration attempt rejected and
// discarded, and the effect re-fires for the real client that replaces it.

import { useEffect, useState } from 'react';
import type { Colour, Seat } from '../game/seat.js';
import type { EngineClient } from '../engine/client.js';
import { Segmented } from './Segmented.js';
import { ColourSwatch } from './ColourSwatch.js';
import './SeatPrompt.css';

const COLOUR_OPTIONS = [
  { value: 'red' as const, label: (<><ColourSwatch colour="red" />Red</>) },
  { value: 'yellow' as const, label: (<><ColourSwatch colour="yellow" />Yellow</>) },
];

export interface SeatPromptProps {
  client: EngineClient | null;
  onStart: (seat: Seat) => void;
}

export function SeatPrompt({ client, onStart }: SeatPromptProps) {
  const [firstMover, setFirstMover] = useState<Colour | null>(null);
  const [userColour, setUserColour] = useState<Colour | null>(null);

  // Preload + warm calibration behind the prompt, not blocking it (SPEC §6,
  // "analysis never blocks input" -- the same principle applies to a cold
  // start). Fire-and-forget: a rejection here just means the next real
  // analysis calibrates from scratch, which `client.calibrate()` already
  // handles by not caching failures.
  useEffect(() => {
    if (!client) return;
    void client.calibrate().catch(() => {});
  }, [client]);

  const canStart = firstMover !== null && userColour !== null;

  return (
    <div className="seat-prompt">
      <p className="seat-prompt__lede">Colour and turn order are independent. Answer both, once.</p>
      <div className="seat-prompt__controls">
        <div className="seat-prompt__control">
          <span className="seat-prompt__caption">Which colour moves first?</span>
          <Segmented
            name="prompt-first-mover"
            legend="Which colour moves first"
            options={COLOUR_OPTIONS}
            value={firstMover}
            onChange={setFirstMover}
          />
        </div>
        <div className="seat-prompt__control">
          <span className="seat-prompt__caption">Which colour are you?</span>
          <Segmented
            name="prompt-user-colour"
            legend="Your colour"
            options={COLOUR_OPTIONS}
            value={userColour}
            onChange={setUserColour}
          />
        </div>
      </div>
      <button
        type="button"
        className="seat-prompt__start"
        disabled={!canStart}
        onClick={() => {
          if (firstMover === null || userColour === null) return;
          onStart({ firstMover, userColour });
        }}
      >
        Start
      </button>
    </div>
  );
}
