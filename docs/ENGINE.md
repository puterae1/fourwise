# ENGINE — Rust bitboard solver

## Why Rust and WASM

The engine is bitboard arithmetic on 49-bit integers. Rust gives native `u64` and
compiles to WASM that runs at close to native speed in the browser. TypeScript would
force either `BigInt` (roughly an order of magnitude slower) or a manual split across
two 32-bit numbers, which is both slower and far more error-prone. A mid-game
position must solve in well under a second on a phone, and that is not achievable in
plain JS.

**Do not invent the algorithm.** Pascal Pons published a complete, correct tutorial
series on solving Connect 4 with exactly this approach. Follow it. The work here is
porting it cleanly and wrapping it well, not researching it.

---

## Representation

Two `u64` values, 7 bits per column (6 playable + 1 sentinel) = 49 bits used.

```rust
pub struct Position {
    current: u64,      // discs belonging to the player to move
    mask: u64,         // all discs on the board
    moves: u32,        // ply count
}
```

The sentinel bit at the top of each column is what makes the alignment check work
without wrap-around between columns. Do not remove it.

Key derived values:

```rust
const WIDTH: u32 = 7;
const HEIGHT: u32 = 6;

fn bottom_mask(col: u32) -> u64 { 1u64 << (col * (HEIGHT + 1)) }
fn column_mask(col: u32) -> u64 { ((1u64 << HEIGHT) - 1) << (col * (HEIGHT + 1)) }
fn top_mask(col: u32)    -> u64 { 1u64 << ((HEIGHT - 1) + col * (HEIGHT + 1)) }
```

Playing a move:

```rust
fn play(&mut self, col: u32) {
    self.current ^= self.mask;                        // swap sides
    self.mask |= self.mask + bottom_mask(col);        // add the disc
    self.moves += 1;
}
```

Note `current ^= mask` — after the swap, `current` holds the *other* player's discs,
which is now the player to move. This is the trick that keeps the engine
colour-agnostic and is exactly what the seat model depends on.

Legality: `mask & top_mask(col) == 0`.

## Alignment detection

Four shift distances cover all directions on a 7-bit-per-column layout:

| Shift | Direction |
|---|---|
| 1 | vertical |
| 7 | horizontal (`HEIGHT + 1`) |
| 6 | diagonal `\` |
| 8 | diagonal `/` |

```rust
fn alignment(pos: u64) -> bool {
    for &d in &[1u32, 6, 7, 8] {
        let m = pos & (pos >> d);
        if m & (m >> (2 * d)) != 0 { return true; }
    }
    false
}
```

Also implement `winning_positions(current, mask) -> u64` returning the bitmask of
every square that would complete a four. It is needed for move ordering, for
immediate-win detection, and — importantly for this project — for the UI to render
threat squares directly.

---

## Search

Negamax with alpha-beta, null-window iterative deepening.

**Score convention.** Positive means the player to move wins. The magnitude encodes
speed: `score = 22 - stones_the_winner_will_have_played`. Range −18 to +18, with 0 a
draw. A faster win scores higher.

The UI must translate this into plain language. Do not surface the raw number as the
primary display; see `docs/SPEC.md` §3.2.

Required optimisations, roughly in order of payoff:

1. **Alpha-beta** — the baseline.
2. **Immediate win check** — if a winning move exists, return without searching.
3. **Avoid losing moves** — prune moves that let the opponent win next ply.
4. **Move ordering, centre-out** — column order `[3, 2, 4, 1, 5, 0, 6]`. Cheap,
   large effect.
5. **Transposition table** — Chinese-remainder-style key of `current + mask`, which
   uniquely identifies the position. Fixed-size open-addressed table, ~64 MB budget.
6. **Iterative deepening with null-window search** — narrows the window fast.
7. **Better move ordering by threat count** — order by the number of winning squares
   each move creates.

**Stop condition (amended 2026-07-28, owner-approved):** stop optimising when
every reference fixture returns its exact score and mid-game positions solve
well under a second. Opening-board speed is Phase 2's problem — the opening
book exists precisely because deep openings are slow to search (a full
empty-board solve measured ~115 s with the optimisation set above, consistent
with Pons's own published benchmarks for this technique set). This amends an
invented stop condition from an earlier version of this document ("empty board
under one second"), which was unachievable with the sanctioned techniques. The
ROADMAP Phase 1 gate — any reachable mid-game position under 1 s on a
mid-range phone — is a gate, was always the real bar, and is unchanged by
this amendment.

---

## Correctness

**Non-negotiable and gates Phase 1.** Pons publishes test sets of positions with
known scores, graded by difficulty (end/middle/begin × easy/medium/hard). Wire them
into `cargo test`.

```
engine/tests/
  fixtures/
    test_l3_r1.txt      # position, expected score, one per line
    ...
  reference.rs          # runs every fixture, asserts exact score match
  position.rs           # unit tests: legality, gravity, alignment, key uniqueness
```

Every fixture position must return its exact expected score. Not close. Exact.

Additional invariant tests:

- Playing a move then undoing returns the identical `(current, mask, moves)` triple
- `key()` collides for no two distinct reachable positions in a depth-10 enumeration
- A position and its left-right mirror score identically
- **Negamax self-consistency:** for a sample of non-terminal fixture
  positions, the score equals the maximum of the children's negated scores
  (terminal win/draw cases handled directly)

**Why there is no "colour independence" test (amended 2026-07-28,
owner-approved).** An earlier version of this document required: "the same
position constructed with either side to move produces evaluations that are
exact negations of each other." That claim is mathematically false, not
merely hard to test. Counterexample: on an empty board both bitboards are
zero, so swapping which side is to move changes nothing — the claim would
force score(empty) = −score(empty) = 0, but Connect 4 from an empty board is
a proven first-player win (this engine correctly scores it +1). Negation
under side-swap does not hold in a game with zugzwang. The engine's
colour-blindness needs no such test because it is structural: engine state is
only `(current, mask)` — there is no colour in `engine/` to leak. The
seat-model proof is the game layer's four-seat-combination test (ROADMAP
gate 2), supported engine-side by the mirror and self-consistency invariants
above.

---

## WASM boundary

Keep it narrow. Exported surface (amended 2026-07-28, owner-approved — five
interface decisions pinned before Wave 3):

```rust
#[wasm_bindgen]
pub fn analyse(position: &str, node_budget: u32) -> JsValue;  // -> AnalysisResult
#[wasm_bindgen]
pub fn legal_moves(position: &str) -> Vec<u32>;               // 0-indexed columns
```

`best_move` is deliberately absent — see "Levels" below.

Position encoding is the standard notation: a string of column digits 1–7 in play
order, e.g. `"4453"`. Compact, human-readable, trivially serialisable into the game
log, and directly compatible with the published test fixtures.

**Indexing (pin).** 0-indexed everywhere in the API: `columns`, `best`,
`legal_moves` entries, and threat square indices are all 0-based. The ONLY
1-indexed surface is the position-string digits, which exist for human
readability and fixture compatibility; the parser maps digit `'1'` → column 0.
Threat square indices use the bitboard layout, `col * 7 + row`, row 0 at the
bottom, sentinel row never reported.

**Budgeted analysis (pin).** Search from near-empty boards can take minutes
(see the stop-condition amendment above), and Wave 3 ships before the Phase 2
book exists. `analyse` therefore takes an explicit budget and never runs
unbounded. The budget is in NODES, not milliseconds — deterministic,
clock-free, natively testable; the worker maps a time preference to nodes
(order of 10–20 M nodes ≈ 1 s in WASM; calibrate once at load). When the
budget is exhausted, unsolved columns report `kind: 'unknown'` and
`complete: false`. Because the TT persists across calls (pin below), the
worker re-issues `analyse` with a larger budget to make progress — that is
the "still thinking" loop. Per SPEC §6 (no placeholder data), the UI must
render `unknown` honestly as still-thinking/not-computed, never as a score,
a guess, or a blank verdict.

`AnalysisResult` shape:

```ts
type ColumnEval =
  | { kind: 'score'; score: number }  // exact; from the CURRENT MOVER's perspective
  | { kind: 'full' }                  // column is full, no move exists
  | { kind: 'unknown' };              // budget exhausted before this column solved

interface AnalysisResult {
  columns: ColumnEval[];   // length 7, index = 0-based column
  best: number | null;     // 0-based; null unless every non-full column is 'score'
  complete: boolean;       // true iff no column is 'unknown'
  sideToMove: 'first' | 'second';   // NOT a colour
  threats: { current: number[]; opponent: number[] };  // 0-based square indices
  nodes: number;           // nodes actually spent in this call
}
```

There is no `elapsedMs`: the engine is clock-free by design; the worker
measures wall time itself.

**Score point of view (pin).** Each column `score` is from the perspective of
the side to move in the ANALYSED position: it is the negation of the child
position's own score. Positive = playing this column wins for the player
about to move. Getting this wrong inverts every verdict in the app — the
exact bug class this project exists to kill, arriving through a different
door — so tests must assert it directly: a column's entry equals minus the
solved score of the resulting child position.

**Levels (pin).** `best_move(position, level)` is removed from the surface.
SPEC §3.1's play-strength levels are implemented in the game layer, in
TypeScript, from the candidate set `analyse` already returns — e.g. "Strong"
picks uniformly among columns within 2 points of the best. Rationale: an RNG
inside the engine would drag in `getrandom`, make the engine
non-deterministic, and put the handicap logic in the least testable place.
The engine stays deterministic; JS picks.

**Transposition-table lifetime (pin).** The ~64 MB table is allocated ONCE
per worker at module level (`thread_local!` or equivalent) and reused across
every `analyse` call — never allocated per call. Cross-position reuse is safe
(keys are globally unique) and is what makes the bigger-budget re-issue loop
cheap. The worker holds exactly one WASM instance.

`sideToMove` is deliberately not a colour. The game layer maps it.

Run analysis in a Web Worker. Deep positions must never block the UI thread.

**Boundary mechanics (amended 2026-07-28 — pinned from the implementation so
the TS wrapper cannot guess wrong; verified by running the built module in a
worker context):**

- `AnalysisResult` crosses the boundary as a plain JS object via
  `serde-wasm-bindgen` — NOT a JSON string. Field names are camelCase;
  `ColumnEval` arrives as the tagged unions above (`{ kind: 'score', score }`
  etc.); `sideToMove` as the strings `'first'` / `'second'`.
- **`best` arrives as `undefined`, not `null`,** when absent (serde `None` →
  `undefined`). The typed TS wrapper in `web/src/engine/` must normalise it
  to `null` so application code sees `number | null` exactly as specced
  above. Normalisation is the wrapper's job; nothing downstream may see
  `undefined`.
- `legal_moves` returns a `Uint32Array`; the wrapper converts to `number[]`.
- Invalid position strings make both exports throw a JS exception with a
  readable message (wasm-bindgen `Result` → thrown error). They never panic
  and never return a partial result. The thrown value is a plain string,
  not an `Error` instance — the TS wrapper catches either and always
  surfaces a typed `EngineError` to callers.
- `best` tie-break: lowest column index wins among equal scores.
- The immediate-win check is exempt from the node budget: a position with a
  win-in-one always reports that column as `score` even at budget 0 (O(1),
  never wrong).

**Stale-result discard (amended 2026-07-28, owner-approved).** History
jump-to-ply can land mid-progressive-loop, and a result computed for the old
position must never be rendered against the new one — wrong verdicts on a
board that looks right. Protocol: every worker request carries a token; the
client tracks only the token belonging to the currently displayed position,
discards any response bearing a different token, and a position change
aborts the escalation loop (no further re-issues for the abandoned
position). The UI keys rendered analysis by position string and must never
display a result whose token does not match the shown board. A test must
force the race: start a progressive analyse, change position before it
completes, assert no update for the old position is delivered afterwards.

Solving from an empty board is slow enough to feel broken on a phone. Precompute.

`tools/gen_book.rs` enumerates all positions at depth 8, solves each exactly, and
writes a compact binary keyed on the position key. Deduplicate mirrored positions —
roughly halves the size.

Ship as a static asset, fetch on load, consult before searching. Expected size in the
low single-digit megabytes. If it exceeds 10 MB, reduce the depth rather than adding
a loading screen.
