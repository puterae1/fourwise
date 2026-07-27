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

### Acceptance test

Take one position. Play it through the app four times, once per seat combination.
The engine's internal evaluation of the position must be **identical** every time.
Only the disc colours on screen and the wording of the analysis may differ. If any
score changes, the layers are fused and must be separated.

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
