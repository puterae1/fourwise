# SPEC — functional behaviour

## 1. The seat model

This is the reason the project exists. Get it right first.

Three independent pieces of state:

```ts
type Colour = 'red' | 'yellow';

interface Seat {
  firstMover: Colour;   // which colour moves first THIS game
  userColour: Colour;   // which colour the user is playing
}
// firstMover and userColour are set independently.
// All four combinations are legal and must work identically.
```

Derived, never stored:

```ts
const userMovesFirst = seat.firstMover === seat.userColour;
```

### Why this matters

The engine has no concept of colour. It only knows *side to move*. Colour is a
presentation concern. The bug in gamesolver.org is that it fuses the two.

Required separation:

- **Engine layer** — speaks only in "player to move" and "opponent". Never sees a colour.
- **Game layer** — owns the seat, maps ply number to colour: on ply `n` (0-indexed),
  the mover is `firstMover` when `n` is even, the other colour when odd.
- **UI layer** — renders colours, and phrases every score from `userColour`'s point
  of view regardless of whose turn it is.

### Acceptance test (amended 2026-07-28, owner-approved)

The original test here — "the engine's internal evaluation must be identical
across all four seat combinations" — is structurally guaranteed and cannot
fail: seat is not an engine input (`analyse` takes a move string and a budget,
nothing else), so identical evaluation holds even for an empty implementation.
Same vacuous-invariant class as the removed colour-independence test
(ENGINE.md §Correctness), arriving from the other side.

The assertion that carries weight is the **translation**. The gate #2 test:

1. Take one position and ONE engine result — a fixed `AnalysisResult` literal
   is fine; the engine need not run for this test.
2. Feed it through the game layer four times, once per seat combination.
3. Assert the four presentation outputs **differ where they must**: verdict
   wording ("you win in 11" vs "she wins in 11" from the same score), disc
   colours, parity rows.
4. Assert each output is **independently correct** against hand-written
   expected values for that seat — not derived from each other, and not
   computed by a helper that mirrors the code under test.
5. Assert the engine-facing inputs (position string, budget) are
   byte-identical across all four runs.

Write this test before the seat model is implemented, against this amended
assertion — not the original one.

---

## 2. Parity

Zugzwang parity depends on **turn order**, never on colour.

- The player who moves first wins single waiting threats on **odd rows** (1, 3, 5).
- The player who moves second wins them on **even rows** (2, 4, 6).

The UI shows a parity ruler beside the board highlighting the user's rows, computed
from `userMovesFirst`. It updates when the seat changes.

**Scope this correctly:** parity governs *single* threats resolved by zugzwang. A
double threat wins immediately and is parity-independent. The UI must not imply
otherwise — a common misunderstanding, and one the tool exists to correct.

---

## 3. Modes

Three modes, switchable at any time without losing the position.

### 3.1 Play
User plays one side, engine plays the other. Per-side control:

```ts
type SideControl = 'human' | 'engine';
interface Controls { red: SideControl; yellow: SideControl; }
```

All four combinations valid, including engine-vs-engine (useful for verifying the
opening theory) and human-vs-human (recording a real game live).

Engine strength is a **handicap**, not a lobotomy:

| Level | Behaviour |
|---|---|
| Perfect | Always the optimal move |
| Strong | Optimal unless a move within 2 points of optimal exists; then random among them |
| Fair | Depth-limited to 8 ply |
| Weak | Depth-limited to 4 ply |

Never implement difficulty as "sometimes plays a random column". It produces
positions that teach nothing.

**Level mechanics (amended 2026-07-28).** The engine exposes only exact
budgeted analysis (ENGINE.md §WASM boundary); all level logic lives in the
game layer, in TypeScript:

- *Perfect* — best column from the analysis.
- *Strong* — uniform random among columns within 2 points of best.
- *Fair / Weak* — implemented as a **score-horizon clamp** on the exact
  analysis, not a weaker search: any outcome further than 8 ply (Fair) or
  4 ply (Weak) away — derivable from the score magnitude, which encodes
  distance — is treated as a draw (0) when ranking moves. The level "sees"
  only what would resolve within its horizon, which is what depth-limiting
  means, without adding a heuristic search to an exact engine.

**Engine move under an incomplete analysis (amended 2026-07-28,
owner-approved).** Before the Phase 2 book exists, early positions will not
reach `complete: true` quickly. The engine player must never stall the game:

- Each level has a think cap, expressed as a time preference mapped to a node
  budget via the client's calibration (defaults: Perfect 2 s, Strong 1 s,
  Fair/Weak 0.5 s; tune in Wave 5/6 if needed).
- At the cap with `complete: true` — apply the level rule above.
- At the cap with `complete: false` — play the level rule restricted to the
  SOLVED columns. If no column is solved, play the centre-most legal column.
  Deterministic given the same solved set (Strong's randomness excepted).
- Honesty (§6): moves made from a partial analysis are marked as such in the
  move list, and the blunder flag never fires from a partial comparison — if
  either side of the before/after comparison is incomplete, it says "not
  evaluated" rather than guessing.

### 3.2 Analyse
Every legal column shows its exact evaluation. This is the headline feature — do it
better than the reference tool by translating raw scores into plain language.

For each of the 7 columns display:

- **Verdict** — Win / Draw / Loss, always phrased from the user's seat ("you win
  in 11", "she wins in 9"), regardless of whose turn it is. The engine reports
  side-to-move scores and never changes; the game layer translates them to the
  user's seat in exactly one place; the UI only ever sees the translated form.
- **Distance** — "in 11 moves", derived from the score magnitude
- **Rank** — best move highlighted; moves that throw away a win flagged distinctly
  from moves that were already losing

Raw score shown as a secondary, toggleable detail. It confuses people and it is the
main thing that makes gamesolver.org feel like a research tool rather than a trainer.

**Blunder flag:** after each human move, compare the evaluation before and after. If
the verdict degrades (win → draw, draw → loss, win → loss), surface it immediately
with the move that should have been played. This is the feature that actually
improves the user's play.

### 3.3 Setup
Reconstruct an arbitrary position — for replaying a game that was lost at the table.

- Click a column to drop a disc of the currently selected colour
- Toggle which colour is being placed
- Undo, clear, and a legality check on every edit

Reject illegal positions with a specific reason, not a generic error:

- Floating discs (impossible with column-drop input, but validate anyway)
- Disc counts differing by more than one
- Counts inconsistent with the declared `firstMover`
- A four-in-a-row already on the board for either side

State the actual problem: "Yellow has 3 discs, red has 5 — impossible." Never
"Invalid position."

**Path to the engine (amended 2026-07-28, owner-approved).** The engine
consumes only move-sequence strings; Setup produces a board, and nothing
previously specced the bridge. Decision: **the game layer (TypeScript, not
the engine) reconstructs a legal move ordering.** Discs map to first/second
mover via the declared `firstMover`; a deterministic backtracking search
finds an ordering that alternates movers and respects gravity (deterministic
tie-break: lowest column first). The engine's surface is unchanged.

Why the four checks above plus an ordering are exactly sufficient: an
intermediate position's discs are always a subset of the final board's, so a
four-in-a-row at any intermediate ply would still be on the final board —
which check 4 already rejects. No ordering of a four-free board can pass
through a completed four.

This creates a **fifth rejection**, with its own specific verdict: a board
can pass all four checks and still admit no legal ordering under the
declared `firstMover` (example: equal counts, but the only playable bottom
disc belongs to the second mover). Verdict: "No legal game reaches this
position with {colour} moving first." If flipping `firstMover` makes it
reachable, offer that: "…but it is reachable if {other} moved first."

The reconstructed ordering is an internal encoding, not history: the move
list of a Setup-derived game starts at the setup point.

---

## 4. Board and interaction

- 7 columns × 6 rows, standard.
- Rows numbered 1 (bottom) to 6 (top) in all UI and docs. The engine indexes
  internally however it likes; the boundary translates.
- Columns numbered 1–7 left to right.
- Hover or focus on a column previews the landing square.
- Full keyboard control: number keys 1–7 to play, `u` undo, `r` redo.
- Move list with jump-to-ply. Every position in history re-analysable.

---

## 5. Persistence

`localStorage` only. No accounts, no server.

- Current game survives a refresh
- Seat preference remembered
- Phase 3 adds a game archive; see `docs/OPPONENT-MODEL.md`

Explicit export and import as JSON, so a game archive can be moved between the
laptop and the phone by hand.

---

## 6. Quality floor

Not optional, not a later pass:

- Works on a phone. The board is the primary element and must be usable one-handed
  in portrait.
- Visible keyboard focus on every interactive element.
- `prefers-reduced-motion` respected — disc-drop animation disabled, not just shortened.
- Colour is never the only signal. Red and yellow discs must be distinguishable by
  a shape or pattern marker for colour-blind users, toggleable.
- Analysis updates must not block input. Solve off the main thread (Web Worker) once
  positions get deep enough to take longer than one frame.
