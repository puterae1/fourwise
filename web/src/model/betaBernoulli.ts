// Wave 14b — Beta-Bernoulli state, D7 priors, D6/PIN-3 weighting.
//
// Per docs/OPPONENT-MODEL.md D7: each rule's prior probability `p` becomes
// pseudo-counts `alpha0 = 2p`, `beta0 = 2(1-p)` (prior strength 2), PINNED to
// the >=6 firing threshold — if either number ever moves, both move together
// (owner condition, do not touch independently of the threshold).
//
// D6/PIN 3: a live observation updates the Beta counts by weight 1.0; a
// reconstructed observation by 0.5. The POSTERIOR uses the WEIGHTED counts;
// the DISPLAY uses RAW (unweighted) event counts, tracked separately here so
// neither can accidentally leak into the other's job.
//
// PIN 4: counts are kept per opponent label, never pooled — this module
// itself is label-agnostic (it operates on one label's games at a time); the
// caller (Wave 15's UI, or this wave's own tests) is what enforces the
// separation by never mixing games from two labels into one call.

import type { LoggedGame, LoggedGameSource } from '../game/loggedGame.js';
import { classifyLoggedGame } from './classifier.js';
import { RULE_NAMES, type RuleName } from './classifierOracle.js';

/** The doc's own prior table (§"The model"), in the doc's row order. */
export const RULE_PRIORS: Readonly<Record<RuleName, number>> = {
  takes_win: 0.97,
  blocks_loss: 0.9,
  blocks_diagonal: 0.65,
  extends_own: 0.55,
  centre_bias: 0.45,
  repeats_column: 0.3,
  builds_double: 0.2,
};

/** Prior strength 2 (D7), guarded against floating-point drift so
 * `alpha0 + beta0` is exactly 2 by construction (`beta0` is derived as the
 * remainder of `alpha0`, not computed independently). */
function round10(value: number): number {
  return Math.round(value * 1e10) / 1e10;
}

export interface PriorPseudocounts {
  alpha0: number;
  beta0: number;
}

export function priorPseudocounts(rule: RuleName): PriorPseudocounts {
  const p = RULE_PRIORS[rule];
  const alpha0 = round10(2 * p);
  const beta0 = round10(2 - alpha0);
  return { alpha0, beta0 };
}

export function weightForSource(source: LoggedGameSource): number {
  return source === 'live' ? 1.0 : 0.5;
}

/** One rule's running state for one opponent label. `alpha`/`beta` are the
 * WEIGHTED Beta-Bernoulli counts (prior pseudo-counts + weighted
 * observations) that the posterior mean is computed from. `rawSuccesses`/
 * `rawTotal` are the UNWEIGHTED event counts (a reconstructed observation
 * counts as a full 1 here) — PIN 2: display uses these, never the posterior
 * and never the weighted total. */
export interface RuleState {
  alpha: number;
  beta: number;
  rawSuccesses: number;
  rawTotal: number;
}

export type OpponentRuleStates = Readonly<Record<RuleName, RuleState>>;

export function initialRuleState(rule: RuleName): RuleState {
  const { alpha0, beta0 } = priorPseudocounts(rule);
  return { alpha: alpha0, beta: beta0, rawSuccesses: 0, rawTotal: 0 };
}

export function initialRuleStates(): OpponentRuleStates {
  const states = {} as Record<RuleName, RuleState>;
  for (const rule of RULE_NAMES) states[rule] = initialRuleState(rule);
  return states;
}

/** Folds one applicable-rule observation into `state`, at the given weight
 * (1.0 live, 0.5 reconstructed — D6/PIN 3). Pure: returns a new state. */
export function applyObservation(state: RuleState, satisfied: boolean, weight: number): RuleState {
  return {
    alpha: state.alpha + (satisfied ? weight : 0),
    beta: state.beta + (satisfied ? 0 : weight),
    rawSuccesses: state.rawSuccesses + (satisfied ? 1 : 0),
    rawTotal: state.rawTotal + 1,
  };
}

/** The Beta posterior mean, `alpha / (alpha + beta)` — internal machinery
 * only (PIN 2: never displayed directly). */
export function posteriorMean(state: RuleState): number {
  return state.alpha / (state.alpha + state.beta);
}

/** The WEIGHTED observation count actually folded into `state` since the
 * prior — `(alpha + beta) - priorStrength`. Prior strength is always exactly
 * 2 (D7), so this is `alpha + beta - 2`. This is what D6's >=6 firing
 * threshold gates on — NEVER `rawTotal`. */
export function weightedObservationCount(state: RuleState): number {
  return state.alpha + state.beta - 2;
}

/**
 * Builds the per-rule Beta-Bernoulli state for exactly one opponent label
 * (PIN 4: never pooled — pass only the games for the label you mean).
 * Filters `games` to `game.opponent === opponentLabel` itself, so a caller
 * can safely pass the whole log.
 */
export function buildOpponentModel(games: readonly LoggedGame[], opponentLabel: string): OpponentRuleStates {
  let states = initialRuleStates();
  for (const game of games) {
    if (game.opponent !== opponentLabel) continue;
    const weight = weightForSource(game.source);
    for (const { observations } of classifyLoggedGame(game)) {
      for (const rule of RULE_NAMES) {
        const obs = observations[rule];
        if (!obs.applicable) continue;
        states = { ...states, [rule]: applyObservation(states[rule], obs.satisfied === true, weight) };
      }
    }
  }
  return states;
}
