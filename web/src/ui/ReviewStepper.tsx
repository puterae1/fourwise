// Post-game review — docs/DESIGN-DIRECTION.md §17. "Nothing new is invented
// here": the board and the analysis panel are §8.2's own components,
// unmodified (`Board.tsx`/`AnalysePanel.tsx`, imported verbatim) -- this file
// only adds the ply track/stepper (`ReviewPlyTrack.tsx`) and drives
// everything from a `LoggedGame` instead of the live `GameState`
// (`useReviewSession.ts`). §19 ratified review as a surface reached from the
// games sheet, not a fourth mode -- it renders as a full-screen overlay, not
// a mode the ModeSwitch knows about.
//
// Seat correctness (Wave 13 DoD item 4): every sentence below is translated
// through the LOGGED game's OWN embedded seat (`game.seat`), never the
// active session's seat -- the two can legitimately differ (a reviewed game
// may have been played under a different seat than the one currently
// selected in Play/Analyse/Setup).

import { useEffect, useState } from 'react';
import type { EngineClient } from '../engine/client.js';
import type { LoggedGame } from '../game/loggedGame.js';
import { parityRows } from '../game/parity.js';
import { userMovesFirst } from '../game/seat.js';
import type { TranslatedAnalysis } from '../game/verdict.js';
import { AnalysePanel } from './AnalysePanel.js';
import { Board } from './Board.js';
import {
  blunderSentence,
  namedColumnFull,
  namedColumnSentence,
  namedColumnUnknown,
  positionSummary,
  reviewPlyContextLine,
} from './copy.js';
import { HeadlineSlot } from './HeadlineSlot.js';
import { loggedGameDateLabel, loggedGameOpponentLabel, reviewSeatSentence } from './logCopy.js';
import { canShowParityRuler } from './ParityRuler.js';
import { ReviewPlyTrack } from './ReviewPlyTrack.js';
import { useReviewSession } from './useReviewSession.js';
import { useViewportWidth } from './useViewportWidth.js';
import './ReviewStepper.css';

function noop(): void {}
function neverDrop(): boolean {
  return false;
}

function selectedColumnSentence(index: number, translated: TranslatedAnalysis | null): string {
  const column = translated?.columns[index];
  if (!column || column.kind === 'unknown') return namedColumnUnknown(index);
  if (column.kind === 'full') return namedColumnFull(index);
  return namedColumnSentence(index, column.verdict);
}

export interface ReviewStepperProps {
  game: LoggedGame;
  client: EngineClient | null;
  onClose: () => void;
}

export function ReviewStepper({ game, client, onClose }: ReviewStepperProps) {
  const session = useReviewSession(client, game);
  const viewportWidth = useViewportWidth();
  const [rawScoresOn, setRawScoresOn] = useState(false);

  // Design §17.5: "Home/End jump to first and last ply, Escape returns to
  // the games sheet" -- a review-scoped listener, the same pattern as
  // `App.tsx`'s own global keydown handler for the live game.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        session.goPrev();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        session.goNext();
      } else if (event.key === 'Home') {
        event.preventDefault();
        session.goFirst();
      } else if (event.key === 'End') {
        event.preventDefault();
        session.goLast();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [session, onClose]);

  // ---- headline (mirrors Analyse mode's own precedence in App.tsx, with
  // the blunder mark for THIS ply's own transition inserted -- design §17.1
  // shows the ply context line and the blunder line together, unlike Play's
  // headline which drops the context line entirely when a blunder shows). --
  const contextLine = reviewPlyContextLine(session.currentPly, session.totalPlies, game.seat, session.mover);
  const currentMark = session.currentPly > 0 ? session.plyTrack.marks[session.currentPly - 1] : undefined;

  let sentence: string;
  let variant: 'default' | 'blunder' = 'default';
  if (session.terminal) {
    sentence = session.terminal.sentence;
  } else if (session.selected !== null) {
    sentence = selectedColumnSentence(session.selected, session.translated);
  } else if (currentMark?.kind === 'blunder') {
    variant = 'blunder';
    sentence = blunderSentence(currentMark.beforeKind, currentMark.bestColumnBefore);
  } else if (session.revealed && session.translated?.best != null && session.translated.position) {
    sentence = namedColumnSentence(session.translated.best, session.translated.position);
  } else {
    sentence = positionSummary(session.translated?.position ?? null);
  }

  const parityUserRows =
    !session.board.isGameOver && canShowParityRuler(viewportWidth) ? parityRows(userMovesFirst(game.seat)).user : null;

  const lastPlayedColumn = session.currentPly > 0 ? (game.moves[session.currentPly - 1] ?? null) : null;
  const litColumn = !session.board.isGameOver && session.revealed ? (session.translated?.best ?? null) : null;

  return (
    <div className="review-stepper" role="dialog" aria-label="Game review">
      <div className="review-stepper__main">
        <div className="review-stepper__header">
          <button type="button" className="review-stepper__back" onClick={onClose}>
            ‹ Games
          </button>
          <span className="review-stepper__title">
            {loggedGameDateLabel(game.date)} · {loggedGameOpponentLabel(game.opponent)}
          </span>
        </div>
        <p className="review-stepper__seat-line">{reviewSeatSentence(game.seat)}</p>

        <HeadlineSlot contextLine={contextLine} sentence={sentence} variant={variant} />

        <Board
          grid={session.board.grid}
          winLine={session.board.winLine}
          turnColour={session.board.isGameOver ? null : session.mover}
          litColumn={litColumn}
          lastPlayedColumn={lastPlayedColumn}
          onDrop={noop}
          canDrop={neverDrop}
          parityUserRows={parityUserRows}
          instant={!session.animateForward}
        />

        <AnalysePanel
          translated={session.translated}
          rawColumns={session.rawColumns}
          revealed={session.revealed}
          selected={session.selected}
          onSelect={session.selectColumn}
          onShowMe={session.showBest}
          rawScoresOn={rawScoresOn}
          onToggleRawScores={() => setRawScoresOn((v) => !v)}
          terminal={session.terminal}
        />

        <ReviewPlyTrack
          seat={game.seat}
          currentPly={session.currentPly}
          totalPlies={session.totalPlies}
          marks={session.plyTrack.marks}
          notEvaluatedCount={session.plyTrack.notEvaluatedCount}
          onFirst={session.goFirst}
          onPrev={session.goPrev}
          onNext={session.goNext}
          onLast={session.goLast}
          canGoPrev={session.canGoPrev}
          canGoNext={session.canGoNext}
        />
      </div>
    </div>
  );
}
