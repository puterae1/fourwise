// The live-play save control — DoD item 3, design §16.4's "said before the
// save" honesty note extended to the LIVE path too (nothing is fabricated:
// the seat/moves/result are already fixed facts of the finished game by the
// time this renders). Appears in Play mode's action slot only once
// `board.isGameOver` is true. `source: 'live'` is never offered as a
// choice here (§16.4: "a game recorded live is never offered a provenance
// choice") -- the caller (`App.tsx`) always builds the record with
// `source: 'live'`.

import { useState } from 'react';
import './SaveLiveGameControl.css';

export interface SaveLiveGameControlProps {
  /** design §16.4 / the delegation brief: default = the most recent logged
   *  game's opponent label, empty log -> empty field. */
  defaultOpponent: string;
  onSave: (opponent: string) => void;
}

export function SaveLiveGameControl({ defaultOpponent, onSave }: SaveLiveGameControlProps) {
  const [opponent, setOpponent] = useState(defaultOpponent);
  const [saved, setSaved] = useState(false);

  if (saved) {
    return <p className="save-live-game__confirmation">Saved to your games.</p>;
  }

  return (
    <div className="save-live-game">
      <label className="save-live-game__label">
        <span className="save-live-game__label-text">Opponent</span>
        <input
          className="save-live-game__input"
          type="text"
          value={opponent}
          placeholder="Unlabelled"
          onChange={(event) => setOpponent(event.target.value)}
        />
      </label>
      <button
        type="button"
        className="save-live-game__button"
        onClick={() => {
          onSave(opponent);
          setSaved(true);
        }}
      >
        Save this game
      </button>
    </div>
  );
}
