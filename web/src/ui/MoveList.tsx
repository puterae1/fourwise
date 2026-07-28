// Move list — docs/DESIGN-DIRECTION.md §10 ("Move list"): a pull-up sheet
// on phone, jump-to-ply on tap. SPEC §3.1's amended honesty rule: moves
// chosen from a partial analysis are marked as such here.

import type { Colour } from '../game/seat.js';
import { ColourSwatch } from './ColourSwatch.js';
import './MoveList.css';

export interface MoveListEntry {
  ply: number; // 1-indexed displayed ply within the VISIBLE move list (setup prefix excluded)
  column: number;
  colour: Colour;
  partial: boolean;
}

export interface MoveListProps {
  open: boolean;
  onClose: () => void;
  entries: MoveListEntry[];
  currentPly: number;
  onJump: (ply: number) => void;
}

export function MoveList({ open, onClose, entries, currentPly, onJump }: MoveListProps) {
  if (!open) return null;

  return (
    <div className="move-list-overlay" role="presentation" onClick={onClose}>
      <div
        className="move-list-sheet"
        role="dialog"
        aria-label="Move list"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="move-list-sheet__header">
          <span className="move-list-sheet__title">Moves</span>
          <button type="button" className="move-list-sheet__close" onClick={onClose} aria-label="Close move list">
            ×
          </button>
        </div>
        <ul className="move-list">
          <li>
            <button
              type="button"
              className="move-list__row"
              data-current={currentPly === 0}
              onClick={() => onJump(0)}
            >
              <span className="move-list__ply">–</span>
              <span className="move-list__label">Start</span>
            </button>
          </li>
          {entries.map((entry) => (
            <li key={entry.ply}>
              <button
                type="button"
                className="move-list__row"
                data-current={currentPly === entry.ply}
                onClick={() => onJump(entry.ply)}
              >
                <span className="move-list__ply">{entry.ply}</span>
                <ColourSwatch colour={entry.colour} />
                <span className="move-list__column">Column {entry.column + 1}</span>
                {entry.partial && (
                  <span className="move-list__partial" title="Chosen from an incomplete analysis">
                    partial
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
