// The Play action slot — docs/SPEC.md §3.1 (per-side human/engine control,
// all four combinations valid; level select) plus Undo/Redo (design §8.1:
// "no hint control in Play"). The design's phone mockup doesn't reserve
// space for the per-side controls (it only shows the seat bar, headline,
// board and Undo/Redo) — this wave adds a compact "Players" row to house
// them, since the task requires them and nowhere else in the layout fits.
// Ordered by ROLE (You, then Opponent) per design §5's seat-neutrality
// rule, never by colour.

import type { Colour } from '../game/seat.js';
import type { Level } from '../game/levels.js';
import type { Controls, LevelQualifier, Levels, SideControl } from './types.js';
import { Segmented } from './Segmented.js';
import { ColourSwatch } from './ColourSwatch.js';
import './PlayPanel.css';

// SPEC §3.1's amended "Level-label honesty": plain-language qualifiers,
// rendered as real visible text right next to the "Level" label/select --
// NOT just a DOM/CSS attribute (the Wave 5a lesson: attribute-only styling
// that sighted users can't perceive was a verifier FAIL). The move list's
// `partial` badge is "necessary but not sufficient" per the amendment; this
// is the level's OWN surface saying so.
const LEVEL_QUALIFIER_TEXT: Record<Exclude<LevelQualifier, null>, string> = {
  tactical: 'last move was a quick check, not full depth',
  'centre-fallback': 'last move was a fallback, not evaluated',
};

const CONTROL_OPTIONS: ReadonlyArray<{ value: SideControl; label: string }> = [
  { value: 'human', label: 'Human' },
  { value: 'engine', label: 'Engine' },
];

const LEVELS: ReadonlyArray<Level> = ['perfect', 'strong', 'fair', 'weak'];
const LEVEL_LABEL: Record<Level, string> = {
  perfect: 'Perfect',
  strong: 'Strong',
  fair: 'Fair',
  weak: 'Weak',
};

export interface PlayPanelProps {
  userColour: Colour;
  opponentColour: Colour;
  controls: Controls;
  onControlChange: (colour: Colour, value: SideControl) => void;
  levels: Levels;
  onLevelChange: (colour: Colour, value: Level) => void;
  /** SPEC §3.1's amended "Level-label honesty" -- see `LEVEL_QUALIFIER_TEXT`
   *  above and `useGameController.ts`'s `levelQualifiers`. */
  levelQualifiers: Record<Colour, LevelQualifier>;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

function PlayerRow({
  roleLabel,
  colour,
  control,
  onControlChange,
  level,
  onLevelChange,
  qualifier,
}: {
  roleLabel: string;
  colour: Colour;
  control: SideControl;
  onControlChange: (value: SideControl) => void;
  level: Level;
  onLevelChange: (value: Level) => void;
  qualifier: LevelQualifier;
}) {
  return (
    <div className="player-row">
      <span className="player-row__role">
        <ColourSwatch colour={colour} />
        {roleLabel}
      </span>
      <Segmented
        name={`control-${colour}`}
        legend={`${roleLabel}'s control`}
        options={CONTROL_OPTIONS}
        value={control}
        onChange={onControlChange}
      />
      {control === 'engine' && (
        <>
          <label className="player-row__level">
            <span className="player-row__level-label">Level</span>
            <select
              className="player-row__level-select"
              value={level}
              onChange={(event) => onLevelChange(event.target.value as Level)}
            >
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {LEVEL_LABEL[l]}
                </option>
              ))}
            </select>
          </label>
          {qualifier && (
            <span className="player-row__level-qualifier" role="status">
              {LEVEL_QUALIFIER_TEXT[qualifier]}
            </span>
          )}
        </>
      )}
    </div>
  );
}

export function PlayPanel({
  userColour,
  opponentColour,
  controls,
  onControlChange,
  levels,
  onLevelChange,
  levelQualifiers,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: PlayPanelProps) {
  return (
    <div className="play-panel">
      <div className="play-panel__players">
        <PlayerRow
          roleLabel="You"
          colour={userColour}
          control={controls[userColour]}
          onControlChange={(v) => onControlChange(userColour, v)}
          level={levels[userColour]}
          onLevelChange={(v) => onLevelChange(userColour, v)}
          qualifier={levelQualifiers[userColour]}
        />
        <PlayerRow
          roleLabel="Opponent"
          colour={opponentColour}
          control={controls[opponentColour]}
          onControlChange={(v) => onControlChange(opponentColour, v)}
          level={levels[opponentColour]}
          onLevelChange={(v) => onLevelChange(opponentColour, v)}
          qualifier={levelQualifiers[opponentColour]}
        />
      </div>
      <div className="play-panel__actions">
        <button type="button" className="play-panel__action" onClick={onUndo} disabled={!canUndo}>
          Undo
        </button>
        <button type="button" className="play-panel__action" onClick={onRedo} disabled={!canRedo}>
          Redo
        </button>
      </div>
    </div>
  );
}
