// Wave 14a — SHAPE VALIDATION ONLY for the classifier oracle fixtures.
//
// This suite checks FORM, never content: it never computes whether any rule
// is applicable or satisfied for any position (that would be 14b's job, and
// writing it here would defeat the oracle-first point of this wave). It only
// confirms that each fixture is well-formed enough for 14b to consume
// verbatim: legal move replay (via the EXISTING, pre-dating production
// legality gate `replayIsLegal`), all seven rules present on every case, the
// D2 applicable/satisfied null-iff-inapplicable shape contract, unique ids,
// non-empty derivations, and that the classified move actually belongs to
// the opponent under the case's own seat (never the user, per D1).

import { describe, expect, it } from 'vitest';
import {
  classifierOracleCases,
  priorPseudocountCases,
  weightingBoundaryCases,
  RULE_NAMES,
  type ClassifierOracleCase,
} from './classifierOracle.js';
import { replayIsLegal } from '../game/gameRecordValidation.js';
import { colourAtPly, otherColour } from '../game/seat.js';
import type { Move } from '../game/gameState.js';
import { BOARD_COLUMNS } from '../game/setup.js';

function asMoves(columns: number[]): Move[] {
  return columns.map((column) => ({ column }));
}

describe('classifierOracleCases — shape only', () => {
  it('is non-empty', () => {
    expect(classifierOracleCases.length).toBeGreaterThan(0);
  });

  it('every id is a non-empty string and unique across the fixture set', () => {
    const ids = classifierOracleCases.map((c) => c.id);
    for (const id of ids) {
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every case has a non-empty title and a non-empty derivation string', () => {
    for (const c of classifierOracleCases) {
      expect(typeof c.title).toBe('string');
      expect(c.title.length).toBeGreaterThan(0);
      expect(typeof c.derivation).toBe('string');
      expect(c.derivation.trim().length).toBeGreaterThan(0);
    }
  });

  it('every case lists all seven rules explicitly, no omissions', () => {
    for (const c of classifierOracleCases) {
      const keys = Object.keys(c.expected).sort();
      expect(keys).toEqual([...RULE_NAMES].sort());
    }
  });

  it('every rule observation obeys the D2 shape contract: satisfied is null iff not applicable', () => {
    for (const c of classifierOracleCases) {
      for (const rule of RULE_NAMES) {
        const obs = c.expected[rule];
        expect(typeof obs.applicable).toBe('boolean');
        if (obs.applicable) {
          expect(typeof obs.satisfied).toBe('boolean');
        } else {
          expect(obs.satisfied).toBeNull();
        }
      }
    }
  });

  it('every move list is non-empty and every column is a valid 0-indexed board column', () => {
    for (const c of classifierOracleCases) {
      expect(c.moves.length).toBeGreaterThan(0);
      for (const column of c.moves) {
        expect(Number.isInteger(column)).toBe(true);
        expect(column).toBeGreaterThanOrEqual(0);
        expect(column).toBeLessThan(BOARD_COLUMNS);
      }
    }
  });

  it('every move sequence replays legally from an empty board (existing production legality gate)', () => {
    for (const c of classifierOracleCases) {
      const legal = replayIsLegal(c.seat, '', asMoves(c.moves));
      expect(legal, `case "${c.id}" does not replay legally`).toBe(true);
    }
  });

  it('the classified (last) move in every case belongs to the OPPONENT, never the user (D1)', () => {
    for (const c of classifierOracleCases) {
      const lastPly = c.moves.length - 1;
      const moverColour = colourAtPly(c.seat, lastPly);
      const opponentColour = otherColour(c.seat.userColour);
      expect(moverColour, `case "${c.id}": classified move must be the opponent's`).toBe(opponentColour);
    }
  });

  it('every seat is a well-formed Seat (firstMover and userColour independently red|yellow)', () => {
    for (const c of classifierOracleCases) {
      expect(['red', 'yellow']).toContain(c.seat.firstMover);
      expect(['red', 'yellow']).toContain(c.seat.userColour);
    }
  });
});

describe('coverage checklist (form only — presence, not correctness)', () => {
  function statesFor(rule: (typeof RULE_NAMES)[number]) {
    return classifierOracleCases.map((c) => c.expected[rule]);
  }

  it('every one of the seven rules has at least one applicable+satisfied, one applicable+failed, and one inapplicable case somewhere in the set', () => {
    for (const rule of RULE_NAMES) {
      const states = statesFor(rule);
      const hasSatisfied = states.some((s) => s.applicable && s.satisfied === true);
      const hasFailed = states.some((s) => s.applicable && s.satisfied === false);
      const hasInapplicable = states.some((s) => !s.applicable);
      expect(hasSatisfied, `${rule}: missing an applicable+satisfied case`).toBe(true);
      expect(hasFailed, `${rule}: missing an applicable+failed case`).toBe(true);
      expect(hasInapplicable, `${rule}: missing an inapplicable case`).toBe(true);
    }
  });

  it('the blocks_diagonal adversarial set has at least five dedicated cases', () => {
    const diagonalIds = classifierOracleCases
      .map((c) => c.id)
      .filter((id) => id.startsWith('diag-'));
    expect(diagonalIds.length).toBeGreaterThanOrEqual(5);
  });

  it('both D3 precedence cases (taken win, missed win) are present', () => {
    const ids = classifierOracleCases.map((c) => c.id);
    expect(ids).toContain('d3-taken-win-exclusivity');
    expect(ids).toContain('d3-missed-win-observes-all');
  });

  it('the R6 first-move-of-game case is present', () => {
    const ids = classifierOracleCases.map((c) => c.id);
    expect(ids).toContain('first-move-of-game');
  });

  it('both builds_double cases (stacked-exclusion, genuine double) are present', () => {
    const ids = classifierOracleCases.map((c) => c.id);
    expect(ids).toContain('stacked-same-column-not-double');
    expect(ids).toContain('genuine-two-column-double');
  });

  function findCase(id: string): ClassifierOracleCase {
    const found = classifierOracleCases.find((c) => c.id === id);
    if (!found) throw new Error(`fixture "${id}" not found`);
    return found;
  }

  it('the D3 taken-win case shows exclusivity: every other rule is inapplicable', () => {
    const c = findCase('d3-taken-win-exclusivity');
    expect(c.expected.takes_win).toEqual({ applicable: true, satisfied: true });
    for (const rule of RULE_NAMES) {
      if (rule === 'takes_win') continue;
      expect(c.expected[rule], `${rule} should be inapplicable on a taken win`).toEqual({
        applicable: false,
        satisfied: null,
      });
    }
  });

  it('the D3 missed-win case shows takes_win failed and at least one other rule genuinely observed', () => {
    const c = findCase('d3-missed-win-observes-all');
    expect(c.expected.takes_win).toEqual({ applicable: true, satisfied: false });
    const othersObserved = RULE_NAMES.filter((r) => r !== 'takes_win' && c.expected[r].applicable);
    expect(othersObserved.length).toBeGreaterThan(0);
  });
});

describe('weightingBoundaryCases (PIN 2 / D6 arithmetic, data only)', () => {
  it('is non-empty and every row is internally well-formed', () => {
    expect(weightingBoundaryCases.length).toBeGreaterThan(0);
    for (const row of weightingBoundaryCases) {
      expect(typeof row.label).toBe('string');
      expect(row.label.length).toBeGreaterThan(0);
      expect(typeof row.liveObs).toBe('number');
      expect(typeof row.reconObs).toBe('number');
      expect(typeof row.weightedCount).toBe('number');
      expect(typeof row.firesAtThreshold).toBe('boolean');
    }
  });

  it('covers the five pinned boundary combinations', () => {
    const combos = weightingBoundaryCases.map((r) => `${r.liveObs}/${r.reconObs}/${r.weightedCount}/${r.firesAtThreshold}`);
    expect(combos).toContain('6/0/6/true');
    expect(combos).toContain('0/9/4.5/false');
    expect(combos).toContain('0/12/6/true');
    expect(combos).toContain('5/2/6/true');
    expect(combos).toContain('5/1/5.5/false');
  });
});

describe('priorPseudocountCases (D7, data only)', () => {
  it('reproduces the doc prior table for takes_win and blocks_diagonal', () => {
    const takesWin = priorPseudocountCases.find((r) => r.rule === 'takes_win');
    const blocksDiagonal = priorPseudocountCases.find((r) => r.rule === 'blocks_diagonal');
    expect(takesWin).toEqual({ rule: 'takes_win', priorP: 0.97, alpha0: 1.94, beta0: 0.06 });
    expect(blocksDiagonal).toEqual({ rule: 'blocks_diagonal', priorP: 0.65, alpha0: 1.3, beta0: 0.7 });
  });
});
