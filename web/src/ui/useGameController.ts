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
import { parseImportFile, toGameState } from '../game/exportFormat.js';
import { colourAtPly, otherColour, type Colour, type Seat } from '../game/seat.js';
import type { Grid } from '../game/setup.js';
import { translateAnalysis, translateScore, type TranslatedAnalysis, type VerdictKind } from '../game/verdict.js';
import {
  centreMostMove,
  LEVEL_THINK_MS,
  pickEngineMove,
  pickEngineMoveFromTactical,
  TACTICAL_HORIZON_PLY,
  type Level,
  type LevelMove,
} from '../game/levels.js';
import { AnalysisSession } from '../game/analysisSession.js';
import type { AnalysisResult } from '../engine/types.js';
import type { Calibration, EngineClient } from '../engine/client.js';
import { deriveBoard, type BoardDerivation } from './deriveBoard.js';
import { checkForBlunder, type BlunderInput } from './blunderCheck.js';
import { defaultControls, type Controls, type LevelQualifier, type Levels, type SideControl } from './types.js';

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
  /** SPEC §3.1's amended "Level-label honesty" -- see `LevelQualifier`'s own
   *  doc comment. Keyed by colour, mirroring `controls`/`levels`. */
  levelQualifiers: Record<Colour, LevelQualifier>;

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

  /**
   * The Play-mode blunder flag (SPEC §3.2, amended Firing rule) — set only
   * after the USER's own human move degrades the position's verdict (win ->
   * draw, draw -> loss, win -> loss), and only once the "after" position has
   * a settled (complete or budget-exhausted) analysis to compare against;
   * `null` otherwise, including while that comparison is still pending or
   * came back partial. `beforeKind` is the verdict just before the move, for
   * phrasing (`copy.ts`'s `blunderSentence`). Cleared automatically the
   * moment the position changes again (undo/redo/jump/a further move) —
   * this is keyed by position, not a timer, so nothing needs to remember to
   * clear it.
   */
  blunder: { bestColumn: number; beforeKind: VerdictKind } | null;
  /** Non-blocking manual dismiss for `blunder` (task requirement) — hides it
   * for the CURRENT position only; it reappears if the position is left and
   * revisited (e.g. undo then redo back to it). */
  dismissBlunder: () => void;

  commitSetup: (grid: Grid, targetMode: 'play' | 'analyse') => { ok: true } | { ok: false; message: string };

  /** JSON import (SPEC §5 amendment) -- parses raw file text end-to-end via
   * `game/exportFormat.ts` and, on success, REPLACES the current game
   * (`setGame`), its seat included, exactly as brought by the file. This
   * updates the ACTIVE seat only (owner ruling, 2026-07-28, mid-Wave-6a):
   * unlike a restored game (which keeps its own seat too, for the same
   * reason -- see this function's own doc comment above), an import must
   * NOT touch the separately-persisted `fourwise:seat` preference, which
   * `App.tsx` only ever writes from the first-run prompt now. Never throws;
   * a failure returns the exact honest message `exportFormat.ts` produced,
   * one of the three distinct failure modes (SPEC §5 amendment). */
  importGame: (fileText: string) => { ok: true } | { ok: false; message: string };
}

/** Converts a chosen engine move into `playMove`'s `options` -- the one
 * place `LevelMove.origin === 'complete'` becomes "no `partial`/`origin` at
 * all" (matches a human move's own shape exactly), so a complete engine move
 * is indistinguishable in storage from a human one, as it always has been. */
function engineMovePlayOptions(chosen: LevelMove): { partial?: boolean; origin?: 'tactical' | 'centre-fallback' } {
  if (chosen.origin === 'complete') return {};
  return { partial: true, origin: chosen.origin };
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

/**
 * `initialGame`, if supplied, is a game restored from `localStorage`
 * (`ui/gameStorage.ts`, SPEC §5 "current game survives a refresh"). Seat
 * persistence architecture (owner ruling, 2026-07-28, mid-Wave-6a --
 * supersedes an earlier "reconcile against `initialSeat`" step, removed):
 * `initialGame`'s OWN `seat` field is used exactly as stored, never
 * overridden by `initialSeat` (the separately-persisted `fourwise:seat`
 * preference) -- that preference is a first-run DEFAULT only, consulted
 * solely to seed a BRAND-NEW game when no game is stored yet. A restored
 * game's own seat is what "current game survives a refresh" has to mean:
 * an in-app seat change or an import already changes `game.seat` (and
 * `App.tsx` persists the whole game, seat included), so if a reload then
 * re-applied the OLDER, unrelated `fourwise:seat` preference on top, the
 * board and the seat controls would disagree about whose seat the restored
 * game is actually playing under.
 */
export function useGameController(
  client: EngineClient | null,
  initialSeat: Seat | null,
  initialGame?: GameState | null,
): GameController | null {
  // `seat` is NOT separate state: `GameState` already carries its own
  // `seat` field (`game/gameState.ts`), and `colourToMove`/`sideToMove`/
  // `absolutePly` all read `state.seat` internally. A standalone `seat`
  // state here would desync from it -- keeping the game's `seat` as the
  // only source of truth is what makes "changing seat re-renders colours
  // from the same game state, no reset" true by construction rather than
  // by careful bookkeeping.
  //
  // Precedence: a restored `initialGame` wins outright (its own `seat`,
  // untouched -- see this function's doc comment above); only when there is
  // NO restored game does `initialSeat` get used, to seed a brand-new one.
  // `initialSeat` being present is still the overall gate for "is there a
  // seat to play under at all" (unchanged from before this ruling): with
  // neither a restored game nor a preference, there is nothing to build a
  // game from yet, and this hook returns `null` (the caller shows the
  // first-run prompt).
  function buildGame(seat: Seat | null, restored: GameState | null | undefined): GameState | null {
    if (restored) return restored;
    if (!seat) return null;
    return createGame(seat, 'play');
  }

  const [game, setGame] = useState<GameState | null>(() => buildGame(initialSeat, initialGame));

  // Role-based default (Wave 6a, carried-defect fix): the user's own colour
  // starts human-controlled, the opponent's starts engine-controlled --
  // `defaultControls` reads whatever `game` ACTUALLY ended up being (a
  // restored game's own seat if one exists, otherwise the freshly-created
  // one), never a standing derivation recomputed on every render, which is
  // what keeps a later in-app seat change from silently reassigning who
  // controls which colour (CLAUDE.md invariant #1; the `setUserColour`/
  // `setFirstMover` setters below never touch `controls`).
  const [controls, setControls] = useState<Controls>(() => defaultControls(game?.seat.userColour ?? 'red'));

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
      const built = buildGame(initialSeat, initialGame);
      setGame(built);
      // The `controls` `useState` initializer above only ever saw `game` as
      // it was AT MOUNT (typically still absent, before the first-run
      // prompt's Start button fires) -- this is the other moment a real
      // game can arrive, so the role-based default is (re)applied here too,
      // off the same `built` value `setGame` just received. Still a
      // one-time default, never a standing derivation from `seat`.
      setControls(defaultControls(built?.seat.userColour ?? 'red'));
    }
  }

  // Always defined, so every hook below can read it unconditionally; only
  // meaningful once `game` itself is non-null, which the final `if (!game)
  // return null;` gate guarantees for anything this hook actually returns.
  const placeholderGame = useMemo(() => createGame(PLACEHOLDER_SEAT, 'play'), []);
  const effectiveGame = game ?? placeholderGame;
  const seat = effectiveGame.seat;
  const [levels, setLevels] = useState<Levels>({ red: 'strong', yellow: 'strong' });
  const [markersOn, setMarkersOn] = useState(true);
  const [rawScoresOn, setRawScoresOn] = useState(false);

  const [rawAnalysis, setRawAnalysis] = useState<{ position: string; result: AnalysisResult } | null>(null);
  const [thinking, setThinking] = useState(false);
  const [analyseGate, setAnalyseGate] = useState<AnalyseGate>({ position: '', revealed: false, selected: null });

  // Blunder flag (SPEC §3.2) bookkeeping. `pendingBlunderRef` is set the
  // instant the user's own human move is played, capturing the verdict AS OF
  // JUST BEFORE it (already on hand -- it's whatever was feeding the Play
  // lamp) and the position that move landed on; the analysis effect below
  // resolves it once that landing position's analysis settles (complete, or
  // its think-budget exhausted), by comparing via `checkForBlunder`
  // (`game/blunder.ts`'s `compareForBlunder`, untouched). `blunder` is keyed
  // by the position it was raised for, so a later move/undo/jump makes it
  // stale for free -- see `activeBlunder` near the bottom of this hook.
  const pendingBlunderRef = useRef<{
    afterPosition: string;
    beforeInput: BlunderInput;
    bestColumnBefore: number | null;
  } | null>(null);
  const [blunder, setBlunder] = useState<{ positionKey: string; bestColumn: number; beforeKind: VerdictKind } | null>(
    null,
  );
  const [dismissedBlunderPosition, setDismissedBlunderPosition] = useState<string | null>(null);

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
    // Every non-setup, non-terminal Play/Analyse position gets analysed now,
    // not only when the engine needs a move or the lamp needs lighting: the
    // blunder flag (SPEC §3.2) has to compare the verdict just AFTER the
    // user's move against the verdict just before it, and that "after"
    // position is frequently the OPPONENT's turn under human-vs-human or
    // human-then-engine controls -- nothing else here would ever trigger
    // that analysis otherwise. (`activeGame.mode` is 'play' or 'analyse' by
    // construction at this point -- 'setup' and game-over already returned
    // above.)

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

      // Resolve a pending blunder check the moment ITS landing position's
      // analysis settles -- whether that's `complete: true` or the level's
      // think-budget simply ran out. Only ever consumed once; a later move
      // overwrites/clears `pendingBlunderRef` before this can run again for
      // an abandoned position (see `play` below).
      const pending = pendingBlunderRef.current;
      if (pending && pending.afterPosition === position) {
        pendingBlunderRef.current = null;
        const bestColumn = tokened.result.best;
        const bestEval = bestColumn !== null ? tokened.result.columns[bestColumn] : undefined;
        const afterVerdict =
          bestEval?.kind === 'score' ? translateScore(bestEval.score, absolutePly(activeGame), tokened.result.sideToMove, seat) : null;
        const afterInput: BlunderInput =
          tokened.result.complete && afterVerdict ? { evaluated: true, kind: afterVerdict.kind } : { evaluated: false };
        const check = checkForBlunder(pending.beforeInput, afterInput);
        if (check.status === 'blunder' && pending.bestColumnBefore !== null && check.beforeKind !== null) {
          setBlunder({ positionKey: position, bestColumn: pending.bestColumnBefore, beforeKind: check.beforeKind });
        }
      }

      if (activeGame.mode === 'play' && moverControl === 'engine') {
        const level = levels[mover];
        let chosen: LevelMove;
        if (tokened.result.complete) {
          chosen = pickEngineMove(tokened.result, ply, level);
        } else {
          // SPEC §3.1a's post-gate amendment: cap expired without a
          // complete analysis -- call the COMPLETE, ply-bounded
          // `tacticalFallback` search instead of restricting the level rule
          // to a partial deep search's unevenly-solved columns (the
          // superseded rule; a partial DEEP search missed a trivial tactic
          // a complete SHALLOW one would have caught). Falls back to the
          // centre-most legal column only if the tactical call itself
          // cannot run at all.
          try {
            const tactical = await client.tacticalFallback(position, TACTICAL_HORIZON_PLY[level]);
            if (cancelled) return; // position moved on while tacticalFallback was in flight
            chosen = pickEngineMoveFromTactical(tactical, ply, tokened.result.sideToMove, level);
          } catch {
            if (cancelled) return;
            chosen = centreMostMove(legalColumns(activeGame));
          }
        }
        setGame((g) => {
          if (!g || enginePosition(g) !== position) return g; // position moved on already -- discard
          const result = playMove(g, chosen.column, engineMovePlayOptions(chosen));
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

  // `play` captures the blunder-check "before" state at the moment the move
  // is made -- scoped to the USER's own human moves in Play mode (see the
  // controller's `blunder` doc comment): that's the one case where
  // `translated`/`board`/`seat`/`controls` from THIS render are exactly the
  // state the move is being played from, with no perspective-flip ambiguity
  // (the translated verdict is already framed in the user's own seat, so
  // "before" and "after" compare on the same scale regardless of whose turn
  // it becomes next).
  const play = useCallback(
    (column: number) => {
      setGame((g) => {
        if (!g) return g;
        const result = playMove(g, column);
        if (!result.ok) return g;

        const mover = gameColourToMove(g);
        const isUsersOwnHumanMove =
          g.mode === 'play' && !board.isGameOver && mover === seat.userColour && controls[seat.userColour] === 'human';

        if (isUsersOwnHumanMove) {
          const beforeInput: BlunderInput =
            translated?.complete && translated.position ? { evaluated: true, kind: translated.position.kind } : { evaluated: false };
          pendingBlunderRef.current = {
            afterPosition: enginePosition(result.state),
            beforeInput,
            bestColumnBefore: translated?.best ?? null,
          };
        } else {
          pendingBlunderRef.current = null;
        }

        return result.state;
      });
    },
    [board.isGameOver, seat, controls, translated],
  );

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

  // SPEC §3.1's amended "Level-label honesty" -- the LAST move actually made
  // by each colour, within the currently-VISIBLE position (`currentPly`
  // respected: undo/jump make a later move invisible again, same as
  // `moveListEntries`' own history scope). Iterating in ply order and
  // overwriting per colour means the most recent move for that colour always
  // wins; a later COMPLETE move (no `origin`) correctly clears an earlier
  // qualifier. A move flagged `partial` but missing `origin` (possible only
  // via an imported/restored game from before this field existed) defaults
  // to `'tactical'`, the less severe/more common of the two -- an
  // unspecified-but-honest qualifier, never a silently-dropped one.
  const levelQualifiers: Record<Colour, LevelQualifier> = useMemo(() => {
    const result: Record<Colour, LevelQualifier> = { red: null, yellow: null };
    const visible = effectiveGame.moves.slice(0, effectiveGame.currentPly);
    visible.forEach((m, i) => {
      const colour = colourAtPly(seat, effectiveGame.setupPrefix.length + i);
      result[colour] = m.partial ? (m.origin ?? 'tactical') : null;
    });
    return result;
  }, [effectiveGame.moves, effectiveGame.currentPly, effectiveGame.setupPrefix, seat]);

  // `blunder` is stale the instant the position moves on (a further move,
  // undo, redo or jump) -- keying by `positionKey` rather than clearing it
  // imperatively means every one of those already invalidates it for free.
  // `dismissedBlunderPosition` hides it manually for THIS position only
  // (task requirement: non-blocking, dismissible) without discarding the
  // underlying result, so undoing then redoing back to the same position
  // shows it again.
  const activeBlunder =
    blunder && blunder.positionKey === positionKey && dismissedBlunderPosition !== positionKey
      ? { bestColumn: blunder.bestColumn, beforeKind: blunder.beforeKind }
      : null;
  const dismissBlunder = useCallback(() => setDismissedBlunderPosition(positionKey), [positionKey]);

  const commitSetup = useCallback(
    (grid: Grid, targetMode: 'play' | 'analyse') => {
      const outcome = startFromSetup(seat, grid, targetMode);
      if (!outcome.ok) return { ok: false as const, message: outcome.rejection.message };
      setGame(outcome.state);
      return { ok: true as const };
    },
    [seat],
  );

  // SPEC §5 amendment: import replaces the whole game, seat included -- an
  // imported file brings its OWN seat, used exactly as-is, the same way a
  // restored `localStorage` game keeps its own seat rather than being
  // reconciled against anything else (see `initialGame`'s doc comment
  // above; owner ruling, 2026-07-28, mid-Wave-6a). `App.tsx`'s existing
  // `saveGame` effect (keyed on `controller.game`) already persists
  // whatever this sets, with no separate wiring needed here -- and,
  // correctly, does NOT also write `fourwise:seat`: that preference is
  // written only once, from the first-run prompt's `Start` (`App.tsx`'s
  // `handleSeatChosen`), so an import changes the ACTIVE seat without ever
  // touching the separately-persisted preference.
  const importGame = useCallback((fileText: string) => {
    const outcome = parseImportFile(fileText);
    if (!outcome.ok) return { ok: false as const, message: outcome.message };
    const first = outcome.games[0];
    if (!first) return { ok: false as const, message: 'This file has no games in it.' };
    setGame(toGameState(first));
    return { ok: true as const };
  }, []);

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
    levelQualifiers,
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
    blunder: activeBlunder,
    dismissBlunder,
    commitSetup,
    importGame,
  };
}

export function opponentColourOf(seat: Seat): Colour {
  return otherColour(seat.userColour);
}
