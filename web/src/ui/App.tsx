// The designed UI — docs/DESIGN-DIRECTION.md, replacing the Wave 3 smoke
// page. Board is the primary element; one headline slot above it, one
// mode-dependent action slot below it, the mode switch pinned at the
// bottom (design §8).

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useEngineClient } from './useEngineClient.js';
import { useBookLoad } from './useBookLoad.js';
import { useGameController, opponentColourOf } from './useGameController.js';
import { useSetupEditor } from './useSetupEditor.js';
import { SeatControls } from './SeatControls.js';
import { SeatPrompt } from './SeatPrompt.js';
import { loadStoredSeat, saveSeat } from './seatStorage.js';
import { loadStoredGame, saveGame } from './gameStorage.js';
import { ModeSwitch } from './ModeSwitch.js';
import { HeadlineSlot } from './HeadlineSlot.js';
import { Board } from './Board.js';
import { PlayPanel } from './PlayPanel.js';
import { AnalysePanel } from './AnalysePanel.js';
import { SetupPanel } from './SetupPanel.js';
import { MoveList } from './MoveList.js';
import { Rail, isDesktopLayout } from './Rail.js';
import { isColumnFull } from './deriveBoard.js';
import { canShowParityRuler } from './ParityRuler.js';
import { useViewportWidth } from './useViewportWidth.js';
import {
  blunderSentence,
  gameOverHeadline,
  namedColumnFull,
  namedColumnSentence,
  namedColumnUnknown,
  positionSummary,
  terminalOutcome,
  turnContextLine,
  type TerminalOutcome,
} from './copy.js';
import { userMovesFirst, type Seat } from '../game/seat.js';
import type { GameState } from '../game/gameState.js';
import { parityRows } from '../game/parity.js';
import { exportGameState } from '../game/exportFormat.js';
import type { TranslatedAnalysis } from '../game/verdict.js';
import './App.css';

const EDITABLE_KEYS = new Set(['1', '2', '3', '4', '5', '6', '7']);

// Text-entry types a native `<input>` can have -- the only inputs the global
// keydown listener below should defer to, because typing into one of these
// could plausibly contain a digit or the letters 'u'/'r'. This app has no
// free-text fields at all: every `<input>` on screen is a `type="radio"`
// (the `Segmented` seat/per-side/placing controls) or the hidden `type=
// "file"` import trigger, neither of which consumes digit keys natively.
// Excluding the whole `INPUT` tag (the previous behaviour) silently broke
// SPEC §4's "full keyboard control" the moment any Segmented radio held
// focus -- which is very reachable, since the seat bar sits at the top of
// every mode.
const TEXT_ENTRY_INPUT_TYPES = new Set(['text', 'search', 'email', 'password', 'tel', 'url', 'number']);

function isTextEntryTarget(target: HTMLElement | null): boolean {
  if (!target) return false;
  if (target.tagName === 'TEXTAREA') return true;
  if (target.isContentEditable) return true;
  if (target.tagName === 'INPUT') {
    return TEXT_ENTRY_INPUT_TYPES.has((target as HTMLInputElement).type);
  }
  // A native <select> (the per-side engine-level dropdown, PlayPanel.tsx)
  // stays excluded -- unlike a radio input, digit keys ARE meaningful there
  // (some browsers jump to an option by first-letter/digit match).
  return target.tagName === 'SELECT';
}

function selectedColumnSentence(index: number, translated: TranslatedAnalysis | null): string {
  const column = translated?.columns[index];
  if (!column || column.kind === 'unknown') return namedColumnUnknown(index);
  if (column.kind === 'full') return namedColumnFull(index);
  return namedColumnSentence(index, column.verdict);
}

function App() {
  const client = useEngineClient();
  const viewportWidth = useViewportWidth();

  // Wave 9: fetches and loads the opening book, entirely off the critical
  // render path -- see `useBookLoad.ts`'s own doc comment. Started as soon
  // as a client exists (same moment `SeatPrompt.tsx` warms calibration),
  // well before the first-run prompt's Start button, so it is already
  // in flight (or resolved) by the time a real game exists to analyse.
  useBookLoad(client);

  // First-run seat prompt (owner ruling, SPEC.md §1/§5): read once at
  // mount, never defaulted. A stored seat here means `useGameController`
  // starts the real game immediately -- no prompt render, no flash. `null`
  // means the prompt is up and `chosenSeat` stays `null` until Start.
  const [chosenSeat, setChosenSeat] = useState<Seat | null>(() => loadStoredSeat());
  // SPEC §5, "current game survives a refresh". Read once at mount, same
  // pattern as `chosenSeat` above. Seat persistence architecture (owner
  // ruling, 2026-07-28, mid-Wave-6a): `useGameController` no longer
  // reconciles a restored game's seat against `chosenSeat` -- a restored
  // game's OWN embedded seat wins outright (see that hook's own doc
  // comment). `chosenSeat`/`fourwise:seat` is a first-run DEFAULT only, used
  // solely to seed a brand-new game when `restoredGame` is absent.
  const [restoredGame] = useState<GameState | null>(() => loadStoredGame());
  const controller = useGameController(client, chosenSeat, restoredGame);

  // The FIRST-RUN prompt's Start button is the ONLY place `fourwise:seat`
  // is written (owner ruling, 2026-07-28, mid-Wave-6a). It used to also be
  // written by a `useEffect` keyed on `controller.seat` (removed below),
  // which fired on every in-app seat change AND on every import -- silently
  // overwriting the user's remembered preference with whatever colour a
  // one-off imported file happened to declare. In-app seat changes and
  // imports still take effect immediately (they change `controller.game.
  // seat`, which the `saveGame` effect below already persists), they just no
  // longer touch the separate preference.
  function handleSeatChosen(seat: Seat) {
    saveSeat(seat);
    setChosenSeat(seat);
  }

  // `useSetupEditor` needs to stay hooks-unconditional while the prompt is
  // up (`controller` is `null` then) -- it takes `null` directly rather
  // than a per-colour fallback, and re-syncs its own `placing` colour the
  // moment a real seat arrives (see that hook's own doc comment for why:
  // this is occurrence three of the "silently falls back to red" bug
  // class, verifier audit Wave 6a).
  const setup = useSetupEditor(controller?.seat ?? null);
  const prevModeRef = useRef(controller?.mode ?? 'play');
  const [moveListOpen, setMoveListOpen] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const showRail = isDesktopLayout(viewportWidth);

  // Persist the current game (SPEC §5, "current game survives a refresh")
  // on every change -- moves, undo/redo, jump-to-ply, mode switches, and a
  // fresh Setup-derived game all funnel through `controller.game`, so one
  // effect here covers every one of them.
  useEffect(() => {
    if (controller) saveGame(controller.game);
  }, [controller?.game]);

  // Setup mode is a fresh edit every time it's entered (see useSetupEditor's
  // own comment) -- reset when the mode transitions INTO setup, not on
  // every render while already there.
  useEffect(() => {
    if (!controller) return;
    if (controller.mode === 'setup' && prevModeRef.current !== 'setup') {
      setup.reset();
    }
    prevModeRef.current = controller.mode;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller?.mode]);

  useEffect(() => {
    if (!controller) return;
    document.documentElement.dataset.markers = controller.markersOn ? 'on' : 'off';
  }, [controller?.markersOn]);

  // SPEC §4: "Full keyboard control: number keys 1-7 to play, u undo, r
  // redo." Global listener -- design §10 notes columns are individually
  // focusable for :focus-visible, but the digits themselves drive play
  // regardless of what currently has focus.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!controller) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (isTextEntryTarget(target)) return;

      if (controller.mode === 'setup') {
        if (EDITABLE_KEYS.has(event.key)) {
          event.preventDefault();
          setup.place(Number(event.key) - 1);
        }
        return;
      }

      if (EDITABLE_KEYS.has(event.key)) {
        const column = Number(event.key) - 1;
        if (controller.canDrop(column)) {
          event.preventDefault();
          controller.play(column);
        }
      } else if (event.key === 'u') {
        controller.undo();
      } else if (event.key === 'r') {
        controller.redo();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [controller, setup]);

  if (!controller) {
    return (
      <div className="page">
        <header className="page__utility">
          <span className="page__title">fourwise</span>
        </header>
        <SeatPrompt client={client} onStart={handleSeatChosen} />
      </div>
    );
  }

  const opponentColour = opponentColourOf(controller.seat);

  // ---- export / import (SPEC §5 amendment) ---------------------------
  // Export = download; import = file picker. No network calls anywhere
  // (CLAUDE.md invariant #3) -- both go through a plain `Blob`/`<a download>`
  // and a hidden `<input type="file">`, entirely client-side.
  function handleExport() {
    const envelope = exportGameState(controller!.game);
    const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fourwise-game-${envelope.exported.replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function handleImportClick() {
    setImportError(null);
    importInputRef.current?.click();
  }

  async function handleImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow re-picking the same filename later
    if (!file) return;
    const text = await file.text();
    const result = controller!.importGame(text);
    setImportError(result.ok ? null : result.message);
  }

  // ---- headline slot ------------------------------------------------
  let contextLine: string | undefined;
  let sentence: string;
  let variant: 'default' | 'error' | 'blunder' = 'default';
  // SPEC §3.2's terminal-display amendment -- computed once here (Setup
  // excluded, same as the headline's own `isGameOver` branch below: freely
  // placing discs isn't a finished game) and handed to both `Rail` and
  // `AnalysePanel`, which otherwise show a per-column verdict/pending state
  // that has nothing left to mean once the game has actually ended.
  let terminal: TerminalOutcome | null = null;

  if (controller.mode === 'setup') {
    if (setup.rejection) {
      variant = 'error';
      sentence = setup.rejection.message;
    } else {
      sentence = 'Set up the position, then press Done.';
    }
  } else if (controller.board.isGameOver) {
    const winner = controller.board.winLine?.colour ?? null;
    const winnerControl = winner ? controller.controls[winner] : 'human';
    sentence = gameOverHeadline(controller.seat, winner, winnerControl);
    terminal = terminalOutcome(controller.seat, winner, winnerControl);
  } else if (controller.mode === 'play') {
    if (controller.blunder) {
      // SPEC §3.2's blunder flag replaces the normal headline for as long as
      // this position stands (design §8.1) -- non-blocking (the game already
      // continued; this is purely presentational) and dismissible (task
      // requirement) via `HeadlineSlot`'s `onDismiss`.
      variant = 'blunder';
      sentence = blunderSentence(controller.blunder.beforeKind, controller.blunder.bestColumn);
    } else {
      const mover = controller.turnColour!;
      contextLine = turnContextLine(controller.seat, mover, controller.controls[mover]);
      sentence = positionSummary(controller.translated?.position ?? null);
    }
  } else {
    // analyse
    if (controller.analyseSelected !== null) {
      sentence = selectedColumnSentence(controller.analyseSelected, controller.translated);
    } else if (controller.analyseRevealed && controller.translated?.best != null) {
      sentence = namedColumnSentence(controller.translated.best, controller.translated.position!);
    } else {
      contextLine = 'Tap a column, or show the best.';
      sentence = positionSummary(controller.translated?.position ?? null);
    }
  }

  // ---- board props ---------------------------------------------------
  const isSetup = controller.mode === 'setup';
  const boardGrid = isSetup ? setup.grid : controller.board.grid;
  const boardWinLine = isSetup ? null : controller.board.winLine;
  const boardLastPlayed = isSetup ? null : controller.board.lastPlayedColumn;
  const boardOnDrop = isSetup ? setup.place : controller.play;
  const boardCanDrop = isSetup ? (col: number) => !isColumnFull(setup.grid, col) : controller.canDrop;

  // ---- parity ruler ---------------------------------------------------
  // SPEC §2 (amended) + SPEC §3.2's scope clarification (2026-07-29): the
  // ruler names the USER's rows, computed from `userMovesFirst` alone, and
  // never appears without its "waiting threats only" label --
  // `canShowParityRuler` is the one place that "hide entirely, never
  // unlabelled" decision is made (Setup gets its own `null` here for a
  // separate, unrelated reason: freely placing discs isn't a turn sequence
  // to have parity about). It is itself an analysis-derived surface -- rows
  // that will win a WAITING THREAT have nothing left to mean once the game
  // has actually ended, so it hides outright on a terminal position (hides,
  // not degrades -- the established convention, Wave 5a) rather than showing
  // parity rows for a game that is already decided.
  const parityUserRows =
    !isSetup && !controller.board.isGameOver && canShowParityRuler(viewportWidth)
      ? parityRows(userMovesFirst(controller.seat)).user
      : null;

  return (
    <div className="page">
      <header className="page__utility">
        <span className="page__title">fourwise</span>
        <div className="page__utility-actions">
          <button type="button" className="page__utility-button" onClick={() => setMoveListOpen(true)}>
            Moves ({controller.game.moves.length})
          </button>
          <button
            type="button"
            className="page__utility-button"
            aria-pressed={controller.markersOn}
            onClick={() => controller.setMarkersOn(!controller.markersOn)}
          >
            Markers {controller.markersOn ? 'on' : 'off'}
          </button>
          <button type="button" className="page__utility-button" onClick={handleExport}>
            Export
          </button>
          <button type="button" className="page__utility-button" onClick={handleImportClick}>
            Import
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json"
            aria-label="Import game file"
            className="page__import-input"
            onChange={handleImportFile}
          />
        </div>
      </header>

      {importError && (
        <p className="page__import-error" role="alert">
          {importError}
        </p>
      )}

      <div className="page__layout">
        <div className="page__main">
          <SeatControls
            userColour={controller.seat.userColour}
            firstMover={controller.seat.firstMover}
            onUserColourChange={controller.setUserColour}
            onFirstMoverChange={controller.setFirstMover}
          />

          <HeadlineSlot
            contextLine={contextLine}
            sentence={sentence}
            variant={variant}
            onDismiss={variant === 'blunder' ? controller.dismissBlunder : undefined}
          />

          <Board
            grid={boardGrid}
            winLine={boardWinLine}
            turnColour={controller.turnColour}
            litColumn={controller.litColumn}
            lastPlayedColumn={boardLastPlayed}
            onDrop={boardOnDrop}
            canDrop={boardCanDrop}
            parityUserRows={parityUserRows}
          />

          <div className="page__action-slot">
            {controller.mode === 'play' && (
              <PlayPanel
                userColour={controller.seat.userColour}
                opponentColour={opponentColour}
                controls={controller.controls}
                onControlChange={controller.setControl}
                levels={controller.levels}
                onLevelChange={controller.setLevel}
                levelQualifiers={controller.levelQualifiers}
                onUndo={controller.undo}
                onRedo={controller.redo}
                canUndo={controller.canUndo}
                canRedo={controller.canRedo}
              />
            )}
            {controller.mode === 'analyse' && (
              <AnalysePanel
                translated={controller.translated}
                rawColumns={controller.rawColumns}
                revealed={controller.analyseRevealed}
                selected={controller.analyseSelected}
                onSelect={controller.selectAnalyseColumn}
                onShowMe={controller.showBest}
                rawScoresOn={controller.rawScoresOn}
                onToggleRawScores={() => controller.setRawScoresOn(!controller.rawScoresOn)}
                terminal={terminal}
              />
            )}
            {controller.mode === 'setup' && (
              <SetupPanel
                placing={setup.placing}
                onPlacingChange={setup.setPlacing}
                onUndo={setup.undo}
                onClear={setup.clear}
                onDone={() => controller.commitSetup(setup.grid, 'play')}
                canUndo={setup.canUndo}
                canDone={setup.rejection === null}
              />
            )}
          </div>

          <ModeSwitch mode={controller.mode} onChange={controller.setMode} />
        </div>

        {showRail && (
          <Rail
            translated={controller.translated}
            showVerdicts={controller.mode !== 'setup'}
            revealed={controller.litColumn !== null}
            moveListEntries={controller.moveListEntries}
            currentPly={controller.game.currentPly}
            onJump={controller.jumpToPly}
            terminal={terminal}
          />
        )}
      </div>

      <MoveList
        open={moveListOpen}
        onClose={() => setMoveListOpen(false)}
        entries={controller.moveListEntries}
        currentPly={controller.game.currentPly}
        onJump={(ply) => {
          controller.jumpToPly(ply);
          setMoveListOpen(false);
        }}
      />
    </div>
  );
}

export default App;
