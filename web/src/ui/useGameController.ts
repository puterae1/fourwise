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

const DEFAULT_SEAT: Seat = { firstMover: 'red', userColour: 'red' };

export function useGameController(client: EngineClient | null): GameController {
  // `seat` is NOT separate state: `GameState` already carries its own
  // `seat` field (`game/gameState.ts`), and `colourToMove`/`sideToMove`/
  // `absolutePly` all read `state.seat` internally. A standalone `seat`
  // state here would desync from it -- keeping the game's `seat` as the
  // only source of truth is what makes "changing seat re-renders colours
  // from the same game state, no reset" true by construction rather than
  // by careful bookkeeping.
  const [game, setGame] = useState<GameState>(() => createGame(DEFAULT_SEAT, 'play'));
  const seat = game.seat;
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

  const board = useMemo(() => deriveBoard(game), [game]);
  const positionKey = enginePosition(game);
  const legal = useMemo(() => new Set(legalColumns(game)), [game]);

  const setUserColour = useCallback(
    (colour: Colour) => setGame((g) => ({ ...g, seat: { ...g.seat, userColour: colour } })),
    [],
  );
  const setFirstMover = useCallback(
    (colour: Colour) => setGame((g) => ({ ...g, seat: { ...g.seat, firstMover: colour } })),
    [],
  );

  const setModeFn = useCallback((mode: Mode) => setGame((g) => gameSetMode(g, mode)), []);

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
      const result = playMove(g, column);
      return result.ok ? result.state : g;
    });
  }, []);

  const undo = useCallback(() => setGame((g) => gameUndo(g)), []);
  const redo = useCallback(() => setGame((g) => gameRedo(g)), []);
  const jumpToPly = useCallback((ply: number) => {
    setGame((g) => {
      const result = gameJumpToPly(g, ply);
      return result.ok ? result.state : g;
    });
  }, []);

  const canDrop = useCallback(
    (column: number) => {
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
    if (!client || !session) return;
    if (game.mode === 'setup' || board.isGameOver) {
      setThinking(false);
      return;
    }

    const position = enginePosition(game);
    const mover = gameColourToMove(game);
    const moverControl = controls[mover];
    const showLampForThisMove = game.mode === 'play' && mover === seat.userColour && moverControl === 'human';
    const needsAnalysis = game.mode === 'analyse' || moverControl === 'engine' || showLampForThisMove;

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
        game.mode === 'analyse' ? ANALYSE_THINK_MS : moverControl === 'engine' ? LEVEL_THINK_MS[levels[mover]] : AUTO_REVEAL_THINK_MS;
      const ceiling = Math.max(calibration ? calibration.msToNodeBudget(ms) : FALLBACK_BUDGET_CEILING, 50_000);
      const ply = absolutePly(game);

      const tokened = await session.start(position, ceiling, (update) => {
        if (cancelled) return;
        setRawAnalysis({ position: update.position, result: update.update.result });
      });
      if (cancelled || !tokened) return;

      setRawAnalysis({ position: tokened.position, result: tokened.result });
      setThinking(false);

      if (game.mode === 'play' && moverControl === 'engine') {
        const chosen = pickEngineMove(tokened.result, ply, levels[mover]);
        setGame((g) => {
          if (enginePosition(g) !== position) return g; // position moved on already -- discard
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
    () => (analysisIsCurrent && rawAnalysis ? translateAnalysis(rawAnalysis.result, absolutePly(game), seat) : null),
    [analysisIsCurrent, rawAnalysis, game, seat],
  );
  const rawColumns = analysisIsCurrent && rawAnalysis ? rawAnalysis.result.columns : null;

  const gateIsCurrent = analyseGate.position === positionKey;
  const analyseRevealed = gateIsCurrent && analyseGate.revealed;
  const analyseSelected = gateIsCurrent ? analyseGate.selected : null;

  const litColumn = useMemo(() => {
    if (board.isGameOver || translated?.best == null) return null;
    if (game.mode === 'play') {
      const mover = gameColourToMove(game);
      const showLamp = mover === seat.userColour && controls[mover] === 'human';
      return showLamp ? translated.best : null;
    }
    if (game.mode === 'analyse') {
      return analyseRevealed ? translated.best : null;
    }
    return null;
  }, [board.isGameOver, translated, game, seat, controls, analyseRevealed]);

  const turnColour = game.mode === 'setup' || board.isGameOver ? null : gameColourToMove(game);

  const moveListEntries: MoveListEntry[] = useMemo(
    () =>
      game.moves.map((m, i) => ({
        ply: i + 1,
        column: m.column,
        colour: colourAtPly(seat, game.setupPrefix.length + i),
        partial: m.partial ?? false,
      })),
    [game.moves, game.setupPrefix, seat],
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
