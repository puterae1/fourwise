// The "add a game from memory" action slot — design §16.4. Reuses Setup's
// existing board/grid-editing machinery wholesale (`App.tsx` still renders
// the same `Board`, driven by the same `useSetupEditor` grid, with the same
// digit-key/click placement); this panel only replaces `SetupPanel`'s
// `Done` step with the log-specific ending: an opponent label, and the
// explicit "this counts half" statement BEFORE the save, never discovered
// afterwards in a row label.

import { useState } from 'react';
import type { Colour } from '../game/seat.js';
import { Segmented } from './Segmented.js';
import { ColourSwatch } from './ColourSwatch.js';
import './SaveReconstructedPanel.css';

const PLACING_OPTIONS = (colour: Colour) => ({
  value: colour,
  label: (
    <>
      <ColourSwatch colour={colour} />
      {colour === 'red' ? 'Red' : 'Yellow'}
    </>
  ),
});

export interface SaveReconstructedPanelProps {
  /** Same PLACING control as `SetupPanel.tsx` (design §8.3) -- this flow
   *  reuses the identical `useSetupEditor` grid state, so it needs the same
   *  "which colour am I placing next" toggle to actually build a position. */
  placing: Colour;
  onPlacingChange: (colour: Colour) => void;
  onUndo: () => void;
  onClear: () => void;
  onCancel: () => void;
  onSave: (opponent: string) => void;
  canUndo: boolean;
  /** Whether the CURRENT grid is a validly finished, reconstructable game --
   *  the headline slot (`App.tsx`) already shows the specific reason when
   *  this is `false` (Setup's own legality copy, or the "not finished yet"
   *  reason), so this panel only needs the boolean to gate `Save`. */
  canSave: boolean;
  defaultOpponent: string;
}

export function SaveReconstructedPanel({
  placing,
  onPlacingChange,
  onUndo,
  onClear,
  onCancel,
  onSave,
  canUndo,
  canSave,
  defaultOpponent,
}: SaveReconstructedPanelProps) {
  const [opponent, setOpponent] = useState(defaultOpponent);

  return (
    <div className="save-reconstructed-panel">
      <p className="save-reconstructed-panel__notice">
        This will be saved as reconstructed, and counts half as much as a game recorded live.
      </p>
      <div className="save-reconstructed-panel__placing">
        <span className="save-reconstructed-panel__placing-label">Placing</span>
        <Segmented
          name="save-reconstructed-placing-colour"
          legend="Colour to place"
          options={[PLACING_OPTIONS('red'), PLACING_OPTIONS('yellow')]}
          value={placing}
          onChange={onPlacingChange}
        />
      </div>
      <label className="save-reconstructed-panel__label">
        <span className="save-reconstructed-panel__label-text">Opponent</span>
        <input
          className="save-reconstructed-panel__input"
          type="text"
          value={opponent}
          placeholder="Unlabelled"
          onChange={(event) => setOpponent(event.target.value)}
        />
      </label>
      <div className="save-reconstructed-panel__actions">
        <button type="button" className="save-reconstructed-panel__action" onClick={onUndo} disabled={!canUndo}>
          Undo
        </button>
        <button type="button" className="save-reconstructed-panel__action" onClick={onClear} disabled={!canUndo}>
          Clear
        </button>
        <button type="button" className="save-reconstructed-panel__action" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="save-reconstructed-panel__action save-reconstructed-panel__action--primary"
          onClick={() => onSave(opponent)}
          disabled={!canSave}
        >
          Save game
        </button>
      </div>
    </div>
  );
}
