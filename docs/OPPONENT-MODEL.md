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

## Reality check on "real time"

The owner originally wanted live prediction during a physical game. Two problems
worth stating plainly:

1. Entering her position on a phone mid-game is slow and error-prone, and she is
   sitting across the table watching.
2. It changes what winning means.

The better shape, and what Phase 3 builds: log the game, review it afterwards, drill
the position where it was lost. Six review sessions and the phone stays in the
pocket. Build the trainer, not the oracle.
