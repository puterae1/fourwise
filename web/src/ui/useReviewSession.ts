// The review stepper's orchestration hook — docs/DESIGN-DIRECTION.md §17.
// Owns the current ply, per-ply analysis (evaluated on demand as the user
// steps, cached per ply for the session — never a bulk pre-solve, keeping
// the first paint honest and cheap), the ply track, and the Show-me reveal
// gate (§17.4: gated exactly as Analyse, never Play's auto-reveal).
//
// Mirrors `useGameController.ts`'s own analysis effect closely (same
// escalating-budget-via-calibration shape, same `AnalysisSession` token
// discipline), but deliberately does NOT drive any engine auto-play, any
// controls, or any blunder-pending-ref bookkeeping — a `LoggedGame` is
// finished history, not a live game, so none of that applies here. The ply
// track's own blunder marks (`game/reviewTrack.ts`) are derived entirely
// from what THIS hook has cached, using `blunder.ts`'s comparator verbatim.
//
// Seat correctness (Wave 13 DoD item 4): every translation below uses
// `game.seat` — the REVIEWED game's own embedded seat — never any other
// seat. Callers must remount this hook (`key={game.id}` at the JSX call
// site) when a different game is opened; it does not reset its own state on
// a `game` identity change.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Calibration, EngineClient } from '../engine/client.js';
import type { AnalysisResult, ColumnEval } from '../engine/types.js';
import { AnalysisSession } from '../game/analysisSession.js';
import { enginePosition } from '../game/gameState.js';
import type { LoggedGame } from '../game/loggedGame.js';
import { loggedGameStateAt } from '../game/reviewGameState.js';
import { buildPlyTrack, type PlyKnowledge, type PlyTrack } from '../game/reviewTrack.js';
import { colourAtPly, type Colour } from '../game/seat.js';
import { translateAnalysis, type TranslatedAnalysis } from '../game/verdict.js';
import { terminalOutcome, type TerminalOutcome } from './copy.js';
import { deriveBoard, type BoardDerivation } from './deriveBoard.js';

// Mirrors `useGameController.ts`'s own `ANALYSE_THINK_MS`/`FALLBACK_BUDGET_CEILING`
// -- review inherits Analyse's own think budget (§17.4: "review inherits
// Analyse's Show me gate"), not duplicated by import to keep this hook
// testable/standalone without pulling in the live-game controller.
const REVIEW_THINK_MS = 3000;
const FALLBACK_BUDGET_CEILING = 5_000_000;

interface ReviewGate {
  ply: number;
  revealed: boolean;
  selected: number | null;
}

export interface ReviewSession {
  currentPly: number;
  totalPlies: number;
  board: BoardDerivation;
  /** Colour to move at `currentPly`, or `null` at a terminal position. */
  mover: Colour | null;
  translated: TranslatedAnalysis | null;
  rawColumns: ColumnEval[] | null;
  plyTrack: PlyTrack;
  revealed: boolean;
  selected: number | null;
  showBest: () => void;
  selectColumn: (column: number | null) => void;
  terminal: TerminalOutcome | null;

  goFirst: () => void;
  goPrev: () => void;
  goNext: () => void;
  goLast: () => void;
  jumpToPly: (ply: number) => void;
  canGoPrev: boolean;
  canGoNext: boolean;
  /** Design §17.5: only a genuine single move forward (`goNext`) plays the
   *  disc-drop animation -- every other way of changing ply places discs
   *  instantly. `Board`'s own `instant` prop is the negation of this. */
  animateForward: boolean;
}

export function useReviewSession(client: EngineClient | null, game: LoggedGame): ReviewSession {
  const totalPlies = game.moves.length;
  const [currentPly, setCurrentPlyState] = useState(0);
  const [animateForward, setAnimateForward] = useState(false);

  const setCurrentPly = useCallback((next: number, animate: boolean) => {
    setAnimateForward(animate);
    setCurrentPlyState(next);
  }, []);

  const gameStateAtCurrentPly = useMemo(() => loggedGameStateAt(game, currentPly), [game, currentPly]);
  const board = useMemo(() => deriveBoard(gameStateAtCurrentPly), [gameStateAtCurrentPly]);
  const mover = currentPly < totalPlies ? colourAtPly(game.seat, currentPly) : null;

  const sessionRef = useRef<AnalysisSession | null>(null);
  useEffect(() => {
    if (client && !sessionRef.current) sessionRef.current = new AnalysisSession(client);
  }, [client]);
  const calibrationRef = useRef<Calibration | null>(null);

  // Settled per-ply results, kept for the lifetime of this hook instance
  // (one open review = one session, design §17: "cached per ply for the
  // session"). A plain ref, not state -- `cacheVersion` is the signal that
  // tells React to re-render/re-derive the track after a write.
  const cacheRef = useRef<Map<number, AnalysisResult>>(new Map());
  const [cacheVersion, setCacheVersion] = useState(0);
  const [liveResult, setLiveResult] = useState<{ ply: number; result: AnalysisResult } | null>(null);

  useEffect(() => {
    const session = sessionRef.current;
    if (!client || !session) return;
    if (board.isGameOver) return; // terminal -- SPEC §3.2, nothing left to analyse
    if (cacheRef.current.has(currentPly)) return; // already settled this session

    let cancelled = false;
    const position = enginePosition(gameStateAtCurrentPly);

    void (async () => {
      let calibration = calibrationRef.current;
      if (!calibration) {
        try {
          calibration = await client.calibrate();
          if (!cancelled) calibrationRef.current = calibration;
        } catch {
          // No calibration available -- fall back to the fixed ceiling below.
        }
      }
      if (cancelled) return;

      const ceiling = Math.max(
        calibration ? calibration.msToNodeBudget(REVIEW_THINK_MS) : FALLBACK_BUDGET_CEILING,
        50_000,
      );

      const tokened = await session.start(position, ceiling, (update) => {
        if (cancelled) return;
        setLiveResult({ ply: currentPly, result: update.update.result });
      });
      if (cancelled || !tokened) return;

      cacheRef.current.set(currentPly, tokened.result);
      setLiveResult({ ply: currentPly, result: tokened.result });
      setCacheVersion((v) => v + 1);
    })();

    return () => {
      cancelled = true;
    };
  }, [client, currentPly, board.isGameOver, gameStateAtCurrentPly]);

  const settledResult = cacheRef.current.get(currentPly) ?? null;
  const activeResult = settledResult ?? (liveResult?.ply === currentPly ? liveResult.result : null);
  const translated = useMemo(
    () => (activeResult ? translateAnalysis(activeResult, currentPly, game.seat) : null),
    [activeResult, currentPly, game.seat],
  );
  const rawColumns = activeResult?.columns ?? null;

  const plyTrack = useMemo(() => {
    const knowledgeAt = (ply: number): PlyKnowledge | undefined => {
      const result = cacheRef.current.get(ply);
      if (!result) return undefined;
      const t = translateAnalysis(result, ply, game.seat);
      return { evaluated: t.complete, kind: t.position?.kind ?? null, best: t.best };
    };
    return buildPlyTrack(totalPlies, knowledgeAt);
    // `cacheVersion` is the recompute trigger -- `cacheRef` itself is a ref
    // and never causes a re-render on its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalPlies, game.seat, cacheVersion]);

  // Design §17.4: "stepping to any other ply clears it and Show me returns."
  const [gate, setGate] = useState<ReviewGate>({ ply: 0, revealed: false, selected: null });
  useEffect(() => {
    setGate({ ply: currentPly, revealed: false, selected: null });
  }, [currentPly]);
  const gateIsCurrent = gate.ply === currentPly;
  const revealed = gateIsCurrent && gate.revealed;
  const selected = gateIsCurrent ? gate.selected : null;
  const showBest = useCallback(() => setGate((g) => ({ ...g, revealed: true })), []);
  const selectColumn = useCallback((column: number | null) => setGate((g) => ({ ...g, selected: column })), []);

  // Design §17.3: only the three human-seat-facing outcomes exist for a
  // reviewed game (a `LoggedGame` carries no per-side control/engine data at
  // all) -- `winnerControl` is fixed to `'human'`, never `'engine'`.
  const terminal = board.isGameOver
    ? terminalOutcome(game.seat, board.winLine?.colour ?? null, 'human')
    : null;

  const canGoPrev = currentPly > 0;
  const canGoNext = currentPly < totalPlies;

  const goFirst = useCallback(() => setCurrentPly(0, false), [setCurrentPly]);
  const goPrev = useCallback(
    () => setCurrentPly(Math.max(0, currentPly - 1), false),
    [setCurrentPly, currentPly],
  );
  const goNext = useCallback(
    () => setCurrentPly(Math.min(totalPlies, currentPly + 1), true),
    [setCurrentPly, currentPly, totalPlies],
  );
  const goLast = useCallback(() => setCurrentPly(totalPlies, false), [setCurrentPly, totalPlies]);
  const jumpToPly = useCallback(
    (ply: number) => setCurrentPly(Math.max(0, Math.min(totalPlies, ply)), false),
    [setCurrentPly, totalPlies],
  );

  return {
    currentPly,
    totalPlies,
    board,
    mover,
    translated,
    rawColumns,
    plyTrack,
    revealed,
    selected,
    showBest,
    selectColumn,
    terminal,
    goFirst,
    goPrev,
    goNext,
    goLast,
    jumpToPly,
    canGoPrev,
    canGoNext,
    animateForward,
  };
}
