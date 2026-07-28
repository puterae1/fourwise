// The orchestration hook: owns the seat, the mode, the `GameState`, the
// per-side Play controls, and the analysis session that feeds both the
// Play-mode auto-reveal lamp and the Analyse verdict strip. This is the one
// place engine queries get issued from — everything downstream (Board,
// AnalysePanel, MoveList) is handed already-translated, already-decided
// props and makes no seat or engine decisions of its own.
//
// CLAUDE.md invariant #1: `setFirstMover`/`setUserColour` below are two
// independent setters. Neither ever reads the other, and nothing here
// derives one from the other -- `userMovesFirst` is computed on demand from
// `game/seat.ts`'s own function wherever it's needed, never duplicated.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  absolutePly,
  colourToMove as gameColourToMove,
  createGame,
  enginePosition,
  jumpToPly as gameJumpToPly,
  legalColumns,
  playMove,
  redo as gameRedo,
  setMode as gameSetMode,
  startFromSetup,
  undo as gameUndo,
  type GameState,
  type Mode,
} from '../game/gameState.js';
import { colourAtPly, otherColour, type Colour, type Seat } from '../game/seat.js';
import type { Grid } from '../game/setup.js';
import { translateAnalysis, type TranslatedAnalysis } from '../game/verdict.js';
import { LEVEL_THINK_MS, pickEngineMove, type Level } from '../game/levels.js';
import { AnalysisSession } from '../game/analysisSession.js';
import type { AnalysisResult } from '../engine/types.js';
import type { Calibration, EngineClient } from '../engine/client.js';
import { deriveBoard, type BoardDerivation } from './deriveBoard.js';
import type { Controls, Levels, SideControl } from './types.js';

const ANALYSE_THINK_MS = 3000;
const AUTO_REVEAL_THINK_MS = 2000;
const FALLBACK_BUDGET_CEILING = 5_000_000;

export interface MoveListEntry {
  ply: number;
  column: number;
  colour: Colour;
  partial: boolean;
}

interface AnalyseGate {
  position: string;
  revealed: boolean;
  selected: number | null;
}

export interface GameController {
  seat: Seat;
  setUserColour: (colour: Colour) => void;
  setFirstMover: (colour: Colour) => void;

  mode: Mode;
  setMode: (mode: Mode) => void;

  game: GameState;
  board: BoardDerivation;

  controls: Controls;
  setControl: (colour: Colour, value: SideControl) => void;
  levels: Levels;
  setLevel: (colour: Colour, value: Level) => void;

  play: (column: number) => void;
  undo: () => void;
  redo: () => void;
  jumpToPly: (ply: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  canDrop: (column: number) => boolean;

  moveListEntries: MoveListEntry[];

  thinking: boolean;
  translated: TranslatedAnalysis | null;
  rawColumns: AnalysisResult['columns'] | null;
  litColumn: number | null;
  turnColour: Colour | null;

  analyseRevealed: boolean;
  analyseSelected: number | null;
  showBest: () => void;
  selectAnalyseColumn: (column: number | null) => void;

  markersOn: boolean;
  setMarkersOn: (on: boolean) => void;
  rawScoresOn: boolean;
  setRawScoresOn: (on: boolean) => void;

  commitSetup: (grid: Grid, targetMode: 'play' | 'analyse') => { ok: true } | { ok: false; message: string };
}

// No fixed default seat (owner ruling, see `SeatPrompt.tsx`): a hardcoded
// default would silently answer the question this tool exists to make the
// user answer. The seat comes from the first-run prompt or from storage,
// via `initialSeat` below, and until one exists this hook returns `null` --
// there is no game to derive a `GameController` from yet.
//
// `PLACEHOLDER_SEAT` exists only to keep the internal hooks below
// type-safe before `initialSeat` arrives; it is never observable. Every
// value derived from it is discarded by the `if (!game) return null;` gate
// at the bottom of this hook, so nothing downstream can ever render a game
// from it -- the placeholder cannot leak past this file.
const PLACEHOLDER_SEAT: Seat = { firstMover: 'red', userColour: 'red' };

export function useGameController(client: EngineClient | null, initialSeat: Seat | null): GameController | null {
  // `seat` is NOT separate state: `GameState` already carries its own
  // `seat` field (`game/gameState.ts`), and `colourToMove`/`sideToMove`/
  // `absolutePly` all read `state.seat` internally. A standalone `seat`
  // state here would desync from it -- keeping the game's `seat` as the
  // only source of truth is what makes "changing seat re-renders colours
  // from the same game state, no reset" true by construction rather than
  // by careful bookkeeping.
  const [game, setGame] = useState<GameState | null>(() => (initialSeat ? createGame(initialSeat, 'play') : null));

  // Starts the game the first time `initialSeat` goes from absent to
  // present (the prompt's Start button, or a stored seat arriving after
  // mount) -- deliberately done DURING render, not in a `useEffect`, per
  // React's documented "adjusting state when a prop changes" pattern: a
  // `setState` call in an effect would still commit and paint one frame of
  // this hook returning `null` (the caller's prompt) before the effect
  // flushed and a second render showed the live game. Adjusting state here
  // means React discards that stale render and retries immediately with
  // `game` already set, so there is no in-between frame to paint --
  // "tapping Start must land on a live board, not a spinner" holds for the
  // very first frame, not eventually.
  const [seenInitialSeat, setSeenInitialSeat] = useState(initialSeat);
  if (initialSeat !== seenInitialSeat) {
    setSeenInitialSeat(initialSeat);
    if (!game && initialSeat) {
      setGame(createGame(initialSeat, 'play'));
    }
  }

  // Always defined, so every hook below can read it unconditionally; only
  // meaningful once `game` itself is non-null, which the final `if (!game)
  // return null;` gate guarantees for anything this hook actually returns.
  const placeholderGame = useMemo(() => createGame(PLACEHOLDER_SEAT, 'play'), []);
  const effectiveGame = game ?? placeholderGame;
  const seat = effectiveGame.seat;
  const [controls, setControls] = useState<Controls>({ red: 'human', yellow: 'engine' });
  const [levels, setLevels] = useState<Levels>({ red: 'strong', yellow: 'strong' });
  const [markersOn, setMarkersOn] = useState(true);
  const [rawScoresOn, setRawScoresOn] = useState(false);

  const [rawAnalysis, setRawAnalysis] = useState<{ position: string; result: AnalysisResult } | null>(null);
  const [thinking, setThinking] = useState(false);
  const [analyseGate, setAnalyseGate] = useState<AnalyseGate>({ position: '', revealed: false, selected: null });

  const sessionRef = useRef<AnalysisSession | null>(null);
  const calibrationRef = useRef<Calibration | null>(null);

  useEffect(() => {
    if (client && !sessionRef.current) {
      sessionRef.current = new AnalysisSession(client);
    }
  }, [client]);

  const board = useMemo(() => deriveBoard(effectiveGame), [effectiveGame]);
  const positionKey = enginePosition(effectiveGame);
  const legal = useMemo(() => new Set(legalColumns(effectiveGame)), [effectiveGame]);

  // Every `setGame` updater below guards `g` for null: before `initialSeat`
  // arrives `game` is `null` and none of these are reachable from the UI
  // (the controller itself is `null` then -- see the final gate), but the
  // guard keeps the updaters honest regardless of call order.
  const setUserColour = useCallback(
    (colour: Colour) => setGame((g) => (g ? { ...g, seat: { ...g.seat, userColour: colour } } : g)),
    [],
  );
  const setFirstMover = useCallback(
    (colour: Colour) => setGame((g) => (g ? { ...g, seat: { ...g.seat, firstMover: colour } } : g)),
    [],
  );

  const setModeFn = useCallback((mode: Mode) => setGame((g) => (g ? gameSetMode(g, mode) : g)), []);

  const setControl = useCallback(
    (colour: Colour, value: SideControl) => setControls((c) => ({ ...c, [colour]: value })),
    [],
  );
  const setLevel = useCallback(
    (colour: Colour, value: Level) => setLevels((l) => ({ ...l, [colour]: value })),
    [],
  );

  const play = useCallback((column: number) => {
    setGame((g) => {
      if (!g) return g;
      const result = playMove(g, column);
      return result.ok ? result.state : g;
    });
  }, []);

  const undo = useCallback(() => setGame((g) => (g ? gameUndo(g) : g)), []);
  const redo = useCallback(() => setGame((g) => (g ? gameRedo(g) : g)), []);
  const jumpToPly = useCallback((ply: number) => {
    setGame((g) => {
      if (!g) return g;
      const result = gameJumpToPly(g, ply);
      return result.ok ? result.state : g;
    });
  }, []);

  const canDrop = useCallback(
    (column: number) => {
      if (!game) return false;
      if (game.mode !== 'play') return false;
      if (board.isGameOver) return false;
      if (!legal.has(column)) return false;
      const mover = gameColourToMove(game);
      return controls[mover] === 'human';
    },
    [game, board.isGameOver, legal, controls],
  );

  // ---------------------------------------------------------------------
  // Analysis + engine auto-play. Runs whenever the position, mode, controls
  // or levels change. Re-derives `mover`/`moverControl` fresh each time so
  // it never depends on a stale closure.
  // ---------------------------------------------------------------------
  useEffect(() => {
    const session = sessionRef.current;
    if (!client || !session || !game) return;
    // Captured into its own `const` with an explicit non-null type so the
    // nested async closure below sees `GameState`, not `GameState | null`
    // -- TypeScript's narrowing of `game` from the guard above does not
    // reliably survive into a nested function expression's closure.
    const activeGame: GameState = game;
    if (activeGame.mode === 'setup' || board.isGameOver) {
      setThinking(false);
      return;
    }

    const position = enginePosition(activeGame);
    const mover = gameColourToMove(activeGame);
    const moverControl = controls[mover];
    const showLampForThisMove = activeGame.mode === 'play' && mover === seat.userColour && moverControl === 'human';
    const needsAnalysis = activeGame.mode === 'analyse' || moverControl === 'engine' || showLampForThisMove;

    if (!needsAnalysis) {
      setThinking(false);
      return;
    }

    let cancelled = false;
    setThinking(true);

    void (async () => {
      let calibration = calibrationRef.current;
      if (!calibration) {
        try {
          calibration = await client.calibrate();
          if (!cancelled) calibrationRef.current = calibration;
        } catch {
          // No calibration available -- fall back to a fixed ceiling below.
        }
      }
      if (cancelled) return;

      const ms =
        activeGame.mode === 'analyse'
          ? ANALYSE_THINK_MS
          : moverControl === 'engine'
            ? LEVEL_THINK_MS[levels[mover]]
            : AUTO_REVEAL_THINK_MS;
      const ceiling = Math.max(calibration ? calibration.msToNodeBudget(ms) : FALLBACK_BUDGET_CEILING, 50_000);
      const ply = absolutePly(activeGame);

      const tokened = await session.start(position, ceiling, (update) => {
        if (cancelled) return;
        setRawAnalysis({ position: update.position, result: update.update.result });
      });
      if (cancelled || !tokened) return;

      setRawAnalysis({ position: tokened.position, result: tokened.result });
      setThinking(false);

      if (activeGame.mode === 'play' && moverControl === 'engine') {
        const chosen = pickEngineMove(tokened.result, ply, levels[mover]);
        setGame((g) => {
          if (!g || enginePosition(g) !== position) return g; // position moved on already -- discard
          const result = playMove(g, chosen.column, { partial: chosen.partial });
          return result.ok ? result.state : g;
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [client, game, seat, controls, levels, board.isGameOver]);

  // Analyse's reveal/selection gate clears on any change of position or
  // seat (design §9's states table) -- never on a mode switch alone.
  useEffect(() => {
    setAnalyseGate({ position: positionKey, revealed: false, selected: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positionKey, seat]);

  const showBest = useCallback(() => setAnalyseGate((g) => ({ ...g, revealed: true })), []);
  const selectAnalyseColumn = useCallback(
    (column: number | null) => setAnalyseGate((g) => ({ ...g, selected: column })),
    [],
  );

  const analysisIsCurrent = rawAnalysis?.position === positionKey;
  const translated = useMemo(
    () =>
      analysisIsCurrent && rawAnalysis ? translateAnalysis(rawAnalysis.result, absolutePly(effectiveGame), seat) : null,
    [analysisIsCurrent, rawAnalysis, effectiveGame, seat],
  );
  const rawColumns = analysisIsCurrent && rawAnalysis ? rawAnalysis.result.columns : null;

  const gateIsCurrent = analyseGate.position === positionKey;
  const analyseRevealed = gateIsCurrent && analyseGate.revealed;
  const analyseSelected = gateIsCurrent ? analyseGate.selected : null;

  const litColumn = useMemo(() => {
    if (board.isGameOver || translated?.best == null) return null;
    if (effectiveGame.mode === 'play') {
      const mover = gameColourToMove(effectiveGame);
      const showLamp = mover === seat.userColour && controls[mover] === 'human';
      return showLamp ? translated.best : null;
    }
    if (effectiveGame.mode === 'analyse') {
      return analyseRevealed ? translated.best : null;
    }
    return null;
  }, [board.isGameOver, translated, effectiveGame, seat, controls, analyseRevealed]);

  const turnColour = effectiveGame.mode === 'setup' || board.isGameOver ? null : gameColourToMove(effectiveGame);

  const moveListEntries: MoveListEntry[] = useMemo(
    () =>
      effectiveGame.moves.map((m, i) => ({
        ply: i + 1,
        column: m.column,
        colour: colourAtPly(seat, effectiveGame.setupPrefix.length + i),
        partial: m.partial ?? false,
      })),
    [effectiveGame.moves, effectiveGame.setupPrefix, seat],
  );

  const commitSetup = useCallback(
    (grid: Grid, targetMode: 'play' | 'analyse') => {
      const outcome = startFromSetup(seat, grid, targetMode);
      if (!outcome.ok) return { ok: false as const, message: outcome.rejection.message };
      setGame(outcome.state);
      return { ok: true as const };
    },
    [seat],
  );

  // No seat chosen yet (first-run prompt still up): there is no game to
  // hand back, by construction rather than by convention -- everything
  // above this point used `effectiveGame`/`PLACEHOLDER_SEAT` only to keep
  // React's hooks unconditional; nothing derived from them escapes past
  // this gate.
  if (!game) return null;

  return {
    seat,
    setUserColour,
    setFirstMover,
    mode: game.mode,
    setMode: setModeFn,
    game,
    board,
    controls,
    setControl,
    levels,
    setLevel,
    play,
    undo,
    redo,
    jumpToPly,
    canUndo: game.currentPly > 0,
    canRedo: game.currentPly < game.moves.length,
    canDrop,
    moveListEntries,
    thinking,
    translated,
    rawColumns,
    litColumn,
    turnColour,
    analyseRevealed,
    analyseSelected,
    showBest,
    selectAnalyseColumn,
    markersOn,
    setMarkersOn,
    rawScoresOn,
    setRawScoresOn,
    commitSetup,
  };
}

export function opponentColourOf(seat: Seat): Colour {
  return otherColour(seat.userColour);
}
