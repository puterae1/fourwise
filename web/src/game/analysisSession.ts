// Stale-result discard — ENGINE.md "Stale-result discard" (amended
// 2026-07-28). A thin layer OVER `engine/client.ts` (not a modification of
// it): history jump-to-ply can land mid progressive-analyse loop, and a
// result computed for the old position must never be rendered against the
// new one.
//
// Protocol implemented here:
//   - every call to `AnalysisSession.start` carries a fresh token;
//   - starting a new position aborts the previous position's escalation
//     loop (via the `signal` `client.analyseProgressive` already supports —
//     see client.ts: "a position change aborts the loop... no further
//     re-issues for the abandoned position");
//   - any update that arrives after the token has moved on (an in-flight
//     `analyse()` call that was already running when the switch happened)
//     is dropped, never forwarded to the caller.
//
// The UI (Wave 4b) keys rendered analysis by position string; this session
// is what guarantees it is never handed a result for the wrong one.

import type { AnalysisResult } from '../engine/types.js';
import type { ProgressiveUpdate } from '../engine/client.js';

/** The narrow slice of `EngineClient` this session needs -- keeps it
 * testable against a fake without a real Worker (see the forced-race test).
 */
export interface ProgressiveAnalyser {
  analyseProgressive(
    position: string,
    options: {
      onUpdate: (update: ProgressiveUpdate) => void;
      budgetCeiling: number;
      signal?: AbortSignal;
    },
  ): Promise<AnalysisResult>;
}

export interface TokenedUpdate {
  position: string;
  /** Opaque, increases monotonically; a UI keying rendered analysis by
   * position string does not need this directly, but it is exposed for
   * callers (e.g. game state) that want to assert freshness themselves. */
  token: number;
  update: ProgressiveUpdate;
}

export interface TokenedResult {
  position: string;
  token: number;
  result: AnalysisResult;
}

/**
 * Runs progressive analysis for exactly one position at a time. Calling
 * `start` again — for a new position, e.g. after a move or a jump-to-ply —
 * immediately invalidates the previous call: its escalation loop is
 * aborted, and any of its results that were already in flight are dropped
 * on arrival rather than delivered to `onUpdate`.
 */
export class AnalysisSession {
  private readonly client: ProgressiveAnalyser;
  private nextToken = 0;
  private activeToken = 0;
  private controller: AbortController | null = null;

  constructor(client: ProgressiveAnalyser) {
    this.client = client;
  }

  /** The token belonging to the position currently being analysed. Exposed
   * so callers can double check a result before rendering it, on top of the
   * filtering this class already does. */
  get currentToken(): number {
    return this.activeToken;
  }

  /**
   * Begins analysing `position`. Any previous call's escalation loop is
   * aborted and its future updates/result are discarded, even if a request
   * it already issued resolves after this call starts.
   */
  start(
    position: string,
    budgetCeiling: number,
    onUpdate: (update: TokenedUpdate) => void,
  ): Promise<TokenedResult | null> {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const token = ++this.nextToken;
    this.activeToken = token;

    return this.client
      .analyseProgressive(position, {
        budgetCeiling,
        signal: controller.signal,
        onUpdate: (update) => {
          if (token !== this.activeToken) return; // stale -- position moved on
          onUpdate({ position, token, update });
        },
      })
      .then((result): TokenedResult | null => {
        if (token !== this.activeToken) return null; // stale -- discard
        return { position, token, result };
      })
      .catch((err: unknown) => {
        if (token !== this.activeToken) return null; // abandoned position's own abort/failure, not a real error
        throw err;
      });
  }

  /** Aborts any in-flight analysis without starting a new one (e.g. the
   * game state is being torn down). */
  stop(): void {
    this.controller?.abort();
    this.controller = null;
    this.activeToken = ++this.nextToken; // invalidates any still-in-flight update
  }
}
