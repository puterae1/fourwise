// The games sheet — docs/DESIGN-DIRECTION.md §16. Full-height sheet over
// whatever mode is active (mirrors `MoveList.tsx`'s own sheet pattern:
// `--c-n-0` ground, `--r-lg` top corners, `Close` returns to exactly where
// the user left). Wave 12 scope: the log list ONLY -- no exploitation
// summary (§18, Wave 15), no review entry point on a row (§17, Wave 13:
// rows are not yet tappable into anything), no prediction floor count.
// Newest first, sorted by date and ONLY date (never result, never
// provenance, never colour).

import type { LoggedGame } from '../game/loggedGame.js';
import {
  loggedGameDateLabel,
  loggedGameMoveCountClause,
  loggedGameOpponentLabel,
  loggedGameProvenanceLabel,
  loggedGameResultLine,
  loggedGameSeatLine,
} from './logCopy.js';
import './GamesSheet.css';

export interface GamesSheetProps {
  open: boolean;
  onClose: () => void;
  games: readonly LoggedGame[];
  onAddFromMemory: () => void;
  onExport: () => void;
  onImport: () => void;
}

function GameRow({ game }: { game: LoggedGame }) {
  return (
    <li className="games-sheet__row" data-source={game.source}>
      <span className="games-sheet__row-edge" data-source={game.source} aria-hidden="true" />
      <p className="games-sheet__row-line1">
        <span className="games-sheet__row-date">{loggedGameDateLabel(game.date)}</span>{' '}
        <span className="games-sheet__row-label">{loggedGameOpponentLabel(game.opponent)}</span>
      </p>
      <p className="games-sheet__row-line2">{loggedGameSeatLine(game.seat)}</p>
      <p className="games-sheet__row-line3">
        {loggedGameResultLine(game.result)} {loggedGameMoveCountClause(game.moves.length)}
      </p>
      <p className="games-sheet__row-line4">{loggedGameProvenanceLabel(game.source)}</p>
    </li>
  );
}

export function GamesSheet({ open, onClose, games, onAddFromMemory, onExport, onImport }: GamesSheetProps) {
  if (!open) return null;

  // Design §16.1: "Newest first. The sort key is date and only date." A
  // fresh array, never mutating the caller's `games`.
  const sorted = [...games].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return (
    <div className="games-sheet-overlay" role="presentation" onClick={onClose}>
      <div className="games-sheet" role="dialog" aria-label="Games" onClick={(event) => event.stopPropagation()}>
        <div className="games-sheet__header">
          <span className="games-sheet__title">Games</span>
          <button type="button" className="games-sheet__close" onClick={onClose}>
            Close
          </button>
        </div>

        {games.length === 0 ? (
          <div className="games-sheet__empty">
            <p className="games-sheet__empty-headline">No games logged yet.</p>
            <p className="games-sheet__empty-body">Finish a game in Play and it is saved here. Or add one from memory.</p>
          </div>
        ) : (
          <>
            <p className="games-sheet__count">{games.length} logged</p>
            <ul className="games-sheet__list">
              {sorted.map((game) => (
                <GameRow key={game.id} game={game} />
              ))}
            </ul>
          </>
        )}

        <div className="games-sheet__footer">
          <button type="button" className="games-sheet__add-from-memory" onClick={onAddFromMemory}>
            Add a game from memory
          </button>
          {games.length > 0 && (
            <div className="games-sheet__io">
              <button type="button" className="games-sheet__io-button" onClick={onExport}>
                Export ▸
              </button>
              <button type="button" className="games-sheet__io-button" onClick={onImport}>
                Import ▸
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
