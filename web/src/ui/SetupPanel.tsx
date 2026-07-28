// The Setup action slot — docs/DESIGN-DIRECTION.md §8.3. `PLACING` is
// deliberately a different shape from the seat controls (full width, tall,
// at the bottom) so it can never be mistaken for "which colour I am".
//
// `Done` commits the reconstructed position and enters PLAY (SPEC §3.3's
// "entry into Play/Analyse via the reconstruction" — the design's own
// mockup shows a single `Done` button, not a mode choice; since mode
// switching never loses the position, Analyse is one tap away on the mode
// switch immediately afterward, so a second entry point isn't needed here).

import type { Colour } from '../game/seat.js';
import { Segmented } from './Segmented.js';
import { ColourSwatch } from './ColourSwatch.js';
import './SetupPanel.css';

const PLACING_OPTIONS = (colour: Colour) => ({
  value: colour,
  label: (
    <>
      <ColourSwatch colour={colour} />
      {colour === 'red' ? 'Red' : 'Yellow'}
    </>
  ),
});

export interface SetupPanelProps {
  placing: Colour;
  onPlacingChange: (colour: Colour) => void;
  onUndo: () => void;
  onClear: () => void;
  onDone: () => void;
  canUndo: boolean;
  canDone: boolean;
}

export function SetupPanel({ placing, onPlacingChange, onUndo, onClear, onDone, canUndo, canDone }: SetupPanelProps) {
  return (
    <div className="setup-panel">
      <div className="setup-panel__placing">
        <span className="setup-panel__placing-label">Placing</span>
        <Segmented
          name="setup-placing-colour"
          legend="Colour to place"
          options={[PLACING_OPTIONS('red'), PLACING_OPTIONS('yellow')]}
          value={placing}
          onChange={onPlacingChange}
        />
      </div>
      <div className="setup-panel__actions">
        <button type="button" className="setup-panel__action" onClick={onUndo} disabled={!canUndo}>
          Undo
        </button>
        <button type="button" className="setup-panel__action" onClick={onClear} disabled={!canUndo}>
          Clear
        </button>
        <button type="button" className="setup-panel__action setup-panel__action--primary" onClick={onDone} disabled={!canDone}>
          Done
        </button>
      </div>
    </div>
  );
}
