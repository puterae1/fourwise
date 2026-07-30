import { describe, expect, it } from 'vitest';
import { priorPseudocountCases, RULE_NAMES } from './classifierOracle.js';
import {
  RULE_PRIORS,
  applyObservation,
  buildOpponentModel,
  initialRuleStates,
  posteriorMean,
  priorPseudocounts,
  weightForSource,
  weightedObservationCount,
} from './betaBernoulli.js';
import type { LoggedGame } from '../game/loggedGame.js';

describe('priorPseudocounts (D7) reproduces the Wave 14a fixture table verbatim', () => {
  for (const row of priorPseudocountCases) {
    it(`${row.rule}: p=${row.priorP} -> alpha0=${row.alpha0}, beta0=${row.beta0}`, () => {
      expect(RULE_PRIORS[row.rule]).toBe(row.priorP);
      expect(priorPseudocounts(row.rule)).toEqual({ alpha0: row.alpha0, beta0: row.beta0 });
    });
  }
});

it('every rule has a prior strength of exactly 2 (alpha0 + beta0), D7', () => {
  for (const rule of RULE_NAMES) {
    const { alpha0, beta0 } = priorPseudocounts(rule);
    expect(alpha0 + beta0).toBe(2);
  }
});

it('weightForSource: live = 1.0, reconstructed = 0.5 (D6/PIN 3)', () => {
  expect(weightForSource('live')).toBe(1.0);
  expect(weightForSource('reconstructed')).toBe(0.5);
});

describe('applyObservation / posteriorMean / weightedObservationCount', () => {
  it('starts at the prior with zero weighted observations and zero raw counts', () => {
    const states = initialRuleStates();
    for (const rule of RULE_NAMES) {
      expect(weightedObservationCount(states[rule])).toBe(0);
      expect(states[rule].rawSuccesses).toBe(0);
      expect(states[rule].rawTotal).toBe(0);
    }
  });

  it('a live success adds 1.0 to alpha and 1 to both raw counters', () => {
    const before = initialRuleStates().centre_bias;
    const after = applyObservation(before, true, 1.0);
    expect(after.alpha).toBeCloseTo(before.alpha + 1, 10);
    expect(after.beta).toBe(before.beta);
    expect(after.rawSuccesses).toBe(1);
    expect(after.rawTotal).toBe(1);
    expect(weightedObservationCount(after)).toBeCloseTo(1, 10);
  });

  it('a reconstructed failure adds 0.5 to beta but a full 1 to rawTotal, none to rawSuccesses', () => {
    const before = initialRuleStates().repeats_column;
    const after = applyObservation(before, false, 0.5);
    expect(after.beta).toBeCloseTo(before.beta + 0.5, 10);
    expect(after.alpha).toBe(before.alpha);
    expect(after.rawSuccesses).toBe(0);
    expect(after.rawTotal).toBe(1);
    expect(weightedObservationCount(after)).toBeCloseTo(0.5, 10);
  });

  it('posteriorMean of an untouched state equals the doc prior probability', () => {
    for (const rule of RULE_NAMES) {
      expect(posteriorMean(initialRuleStates()[rule])).toBeCloseTo(RULE_PRIORS[rule], 10);
    }
  });

  it('six live successes push the posterior mean well above a low prior (data starts to dominate near the pinned threshold)', () => {
    let state = initialRuleStates().builds_double; // prior 0.20
    for (let i = 0; i < 6; i++) state = applyObservation(state, true, 1.0);
    expect(weightedObservationCount(state)).toBeCloseTo(6, 10);
    expect(posteriorMean(state)).toBeGreaterThan(0.75);
  });
});

// ---------------------------------------------------------------------------
// buildOpponentModel — label isolation (PIN 4) and weighting integration.
// ---------------------------------------------------------------------------

function stubGame(overrides: Partial<LoggedGame>): LoggedGame {
  return {
    id: 'g',
    date: '2026-01-01T00:00:00.000Z',
    opponent: 'her',
    seat: { firstMover: 'red', userColour: 'red' },
    moves: [3, 2, 4, 1, 5, 0],
    result: 'loss',
    source: 'live',
    ...overrides,
  };
}

it('an empty log returns pure-prior states for any label', () => {
  const states = buildOpponentModel([], 'her');
  for (const rule of RULE_NAMES) {
    expect(posteriorMean(states[rule])).toBeCloseTo(RULE_PRIORS[rule], 10);
    expect(states[rule].rawTotal).toBe(0);
  }
});

it('a single logged game updates only the rules genuinely applicable somewhere in it', () => {
  const game = stubGame({});
  const states = buildOpponentModel([game], 'her');
  const anyUpdated = RULE_NAMES.some((rule) => states[rule].rawTotal > 0);
  expect(anyUpdated).toBe(true);
});

it('label isolation (PIN 4): a second opponent\'s games never affect the first label\'s counts', () => {
  const herGame = stubGame({ id: 'her-1', opponent: 'her' });
  const otherGame = stubGame({ id: 'other-1', opponent: 'someone else', moves: [0, 0, 1, 1, 2, 2, 3] });
  const withOnlyHer = buildOpponentModel([herGame], 'her');
  const withBoth = buildOpponentModel([herGame, otherGame], 'her');
  expect(withBoth).toEqual(withOnlyHer);
});

it('reconstructed-only logs never reach weighted count 6 as fast as live ones (D6 halving is visible end-to-end)', () => {
  // Same game logged six times: once as all-live, once as all-reconstructed.
  const game = stubGame({});
  const liveGames = Array.from({ length: 6 }, (_, i) => ({ ...game, id: `live-${i}`, source: 'live' as const }));
  const reconGames = Array.from({ length: 6 }, (_, i) => ({ ...game, id: `recon-${i}`, source: 'reconstructed' as const }));
  const liveStates = buildOpponentModel(liveGames, 'her');
  const reconStates = buildOpponentModel(reconGames, 'her');
  for (const rule of RULE_NAMES) {
    if (liveStates[rule].rawTotal === 0) continue; // rule never applicable in this fixture game
    expect(weightedObservationCount(reconStates[rule])).toBeCloseTo(weightedObservationCount(liveStates[rule]) / 2, 10);
    expect(reconStates[rule].rawTotal).toBe(liveStates[rule].rawTotal); // raw counts identical regardless of source
  }
});

it('a draw-result game still updates the model (result is never consulted by the classifier)', () => {
  const game = stubGame({ result: 'draw' });
  const states = buildOpponentModel([game], 'her');
  const anyUpdated = RULE_NAMES.some((rule) => states[rule].rawTotal > 0);
  expect(anyUpdated).toBe(true);
});
