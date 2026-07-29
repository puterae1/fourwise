# OPPONENT MODEL — Phase 3

## The distinction that governs everything here

The solver answers **"what is the best move?"** — exact, solved, free.

The opponent model answers **"what will she actually play?"** — a different question
with a different method. Conflating them produces a tool that confidently predicts
perfect play from someone who does not play perfectly.

Both must be shown, always visually distinct, never merged into one recommendation.

---

## Data

```ts
interface LoggedGame {
  id: string;
  date: string;              // ISO
  opponent: string;          // label, e.g. "her"
  seat: { firstMover: Colour; userColour: Colour };
  moves: number[];           // column indices in play order
  result: 'win' | 'loss' | 'draw';
  source: 'live' | 'reconstructed';
}
```

Stored in `localStorage`, exportable as JSON.

`source` matters: a game reconstructed from memory after the fact is less reliable
than one recorded live. Weight live games higher and say so in the UI.

---

## The model

A weighted heuristic with Bayesian count updates. Not machine learning. At the data
volumes available — tens of games, hundreds of positions — a heuristic is both more
accurate and interpretable, and it produces useful output from the first game rather
than needing thousands.

For each opponent move in the log, classify the position and record which rule the
move is consistent with:

| Rule | Description | Initial prior |
|---|---|---|
| `takes_win` | An immediate win was available and taken | 0.97 |
| `blocks_loss` | An immediate loss was pending and blocked | 0.90 |
| `blocks_diagonal` | The pending loss was specifically diagonal | 0.65 |
| `extends_own` | Extends her longest existing line | 0.55 |
| `centre_bias` | Plays toward columns 3–5 | 0.45 |
| `repeats_column` | Plays her previous column again | 0.30 |
| `builds_double` | Creates two threats at once | 0.20 |

Update each rule's probability with plain Beta-Bernoulli counts: prior as
pseudo-counts, then increment successes and failures per observation. No training
loop, no gradients.

`blocks_diagonal` is separated from `blocks_loss` deliberately. Failing to see
diagonals is the single most common weakness in club-level play and is the most
exploitable thing the model can discover.

## Prediction

For a given position, score every legal move by the sum of the current probabilities
of the rules it satisfies, then normalise across legal moves.

Display the top three with confidence. Below 20 logged games, do not display
predictions at all — show the count and how many more are needed. An unreliable
prediction shown confidently is worse than no prediction.

## Exploitation

Once a rule's probability is confidently low, surface the tactical consequence in
plain language:

> She has missed a diagonal threat in 7 of 9 chances. Build diagonals.

This is the actual product of Phase 3. The move predictions are supporting evidence;
the exploitable-weakness summary is the thing worth reading.

---

## Pinned definitions and rulings (2026-07-29 — owner-approved, BINDING)

This section sharpens the prose above; where prose and pin differ, the pin
wins. Owner review resolved one reversal (D6, threshold weighted not raw)
and one refinement (D3, exclusivity only on a taken win) against the
orchestrator's draft.

### Shared machinery

- **D1 — What is classified.** Only the opponent's moves, never the
  user's. For each opponent move `m`, the classifier examines the position
  `P` immediately before `m`, opponent to move. "User"/"opponent" come
  from the game's seat record — never from colour.
- **D2 — Applicable vs satisfied.** Each rule is first tested for
  applicability (was there an opportunity?). Only applicable rules record
  an observation: success if `m` satisfies the rule, failure if not.
  Inapplicable rules record nothing — a move never fails a rule it had no
  chance to follow.
- **D3 — Precedence (owner-refined).** Exclusivity applies only when
  `takes_win` SUCCEEDS: a taken win records `takes_win` success and
  nothing else. If she had a win available and played something else,
  that move is the most informative move in the game — record the
  `takes_win` failure AND observe every other applicable rule on it.
- **D4 — Indexing.** Internal columns 0–6; every user-facing string 1–7
  left-to-right. Centre columns = internal {2,3,4} = displayed {3,4,5}.
  Geometric, orientation- and seat-independent.
- **D5 — Threat cell.** A user threat cell in `P` is an empty cell that
  would complete four for the user AND is currently playable (the landing
  cell of a legal move). Threats hanging higher in a column are not
  pending losses this turn.
- **D6 — Weighting (owner-REVERSED from draft: threshold is WEIGHTED).**
  A live-game observation updates the Beta counts by 1.0; reconstructed
  by 0.5 (PIN 3). The exploitation-line firing threshold gates evidence
  sufficiency, and the weighted count IS the evidence: **fire on weighted
  count ≥ 6; display raw event counts** (a reconstructed observation
  displays as 1 of 1). Documented consequence, deliberate: a rule with 6
  live observations can fire while one with 9 reconstructed observations
  (weighted 4.5) does not — the provenance labels in the UI
  (`RECONSTRUCTED · COUNTS HALF`, DESIGN-DIRECTION §16/§18) are what
  explain this to the user, and the surface must keep them for exactly
  this reason.
- **D7 — Priors as pseudo-counts.** Each rule's prior probability `p`
  becomes `α₀ = 2p`, `β₀ = 2(1−p)` — prior strength 2. This is PINNED TO
  the ≥6 threshold: data dominates from roughly the sixth observation. If
  either number ever moves, both move together (owner condition).

### The seven rules

- **R1 `takes_win`** — Applicable: ≥1 legal move completes four for the
  opponent. Satisfied: `m` is one of them.
- **R2 `blocks_loss`** — Applicable: `takes_win` not applicable AND ≥1
  user threat cell (D5) exists. Satisfied: `m` lands on a user threat
  cell. Any other move is failure even if objectively stronger — the
  model measures consistency with the habit, not move quality; the solver
  owns "was it good".
- **R3 `blocks_diagonal`** — Applicable: R2 applicable AND ≥1 user threat
  cell carries a DIAGONAL threat (a completing four through it lies in a
  diagonal direction; one cell may carry several directions). Satisfied:
  `m` lands on a diagonal-carrying threat cell. Pinned consequences:
  blocking a cell that is both diagonal and horizontal satisfies R2 and
  R3 (separate Bernoullis, no double-count within either); blocking a
  horizontal-only cell while a diagonal-only cell pends = R2 success, R3
  failure (the sees-horizontals-misses-diagonals signal — the point of
  the model); only diagonal threats pending and she plays elsewhere = R2
  failure and R3 failure.
- **R4 `extends_own`** — Let `L` = length of the opponent's longest
  contiguous line, any direction, counting only lines of length ≥ 2
  (single discs are not lines — without this floor the rule fires on
  nearly every second move and drowns the signal; owner-accepted).
  Applicable: such a line exists AND ≥1 legal move's landing cell joins a
  length-`L` line, making it longer. Satisfied: `m` is such a move.
  Contiguous discs only; gaps do not count.
- **R5 `centre_bias`** — Applicable: ≥1 centre column (D4) legal.
  Satisfied: `m` is in a centre column.
- **R6 `repeats_column`** — Applicable: she has a previous move in this
  game AND that column is legal. Satisfied: `m` is that column. Her first
  move: inapplicable.
- **R7 `builds_double`** — Applicable: ≥1 legal move would leave the
  opponent, after the move, with ≥2 winning cells in DISTINCT columns
  (stacked same-column "threats" are never simultaneous and do not
  count). Satisfied: `m` is such a move.

### Prediction and gating (restated with the pins)

For a position, each legal move scores the sum of posterior means of every
rule that move would satisfy (same satisfaction tests; D3's taken-win
exclusivity included); normalise over legal moves; display top-3 with
confidence. Exploitation lines fire per PIN 2 as amended by D6: weighted
observations ≥ 6 AND posterior mean < 0.4 (weakness) or > 0.75 (strength);
DISPLAY RAW COUNTS, never the posterior — "missed a diagonal in 7 of 9
chances" is the product; the mean is internal machinery only. The 20-game
floor counts WHOLE logged games for the active opponent label, whatever
their provenance (§19 ruling); below it, no predictions — show the count
and how many more are needed. Counts are keyed by opponent label (PIN 4);
pooling opponents is forbidden — it averages away the only thing the
model is for. Single-opponent UI first.

### Fixture mandate (owner-ordered)

`blocks_diagonal` receives the most adversarial fixture set in Wave 14,
explicitly including: the dual-direction threat cell (diagonal +
horizontal through one cell), the block-the-horizontal-miss-the-diagonal
asymmetry, diagonal-only pending with play-elsewhere, and both diagonal
directions. The dual-direction case is mutation-tested specifically:
break the direction attribution and a named test must fail.

## Reality check on "real time"

The owner originally wanted live prediction during a physical game. Two problems
worth stating plainly:

1. Entering her position on a phone mid-game is slow and error-prone, and she is
   sitting across the table watching.
2. It changes what winning means.

The better shape, and what Phase 3 builds: log the game, review it afterwards, drill
the position where it was lost. Six review sessions and the phone stays in the
pocket. Build the trainer, not the oracle.
