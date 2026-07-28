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

**Book and tactical-fallback exports (Wave 8 addition, 2026-07-28, pinned from the
implementation, verifier-confirmed).** Three more `#[wasm_bindgen]` exports, additive
to the two above — nothing about `analyse`'s or `legal_moves`'s own name, parameters,
0-indexing, or boundary mechanics changes:

```rust
#[wasm_bindgen]
pub fn load_book(bytes: &[u8]) -> Result<JsValue, JsValue>;      // -> BookLoadResult
#[wasm_bindgen]
pub fn set_book_enabled(enabled: bool);
#[wasm_bindgen]
pub fn tactical_fallback(position: &str, max_ply: u32) -> Result<JsValue, JsValue>;  // -> TacticalAnalysis
```

`load_book` and `tactical_fallback` return `Result<JsValue, JsValue>` for the same
mechanical reason `analyse` does (`wasm_bindgen`'s `Err` → thrown-exception plumbing),
but **a corrupt or invalid book is never reported by throwing.** `load_book` always
succeeds at the JS-visible level for well-formed input bytes of any content — a
corrupt book is reported as `ok: false` inside the returned `BookLoadResult`, never as
a thrown error, per the "corrupt or absent file is a silent fallback" pin below. The
`Result` channel exists only for the (unreachable in normal operation)
result-serialisation-failure case, exactly like `analyse`'s.

`BookLoadResult` shape:

```ts
interface BookLoadResult {
  ok: boolean;
  entries: number;   // 0 when ok is false
  depth: number;      // 0 when ok is false
  error: string | null;  // null only via the TS wrapper's normalisation -- see below
}
```

- `entries` is the book's entry count (`Book::len()`); `depth` is the book's stored
  `--depth` byte. Both are `0` when `ok` is `false`.
- **`error` arrives as `undefined`, not `null`, when absent** (`ok: true`) — the same
  serde `Option<T>` → `undefined` mapping `AnalysisResult.best` already has. The typed
  TS wrapper must normalise it to `null`, same rule as `best`.
- Calling `load_book` again after a successful load, with bytes that fail to parse,
  does **not** discard the previously-loaded good book — see `book.rs`'s
  `load_book_into` for the runtime behaviour this reflects.

`set_book_enabled(enabled: boolean): void` — the PERMANENT book-disabled flag. Once
set `false`, every subsequent book lookup (from both `analyse` and
`tactical_fallback`) misses, indistinguishable from no book ever having loaded,
**regardless of any later `load_book` call** — loading a new book never implicitly
re-enables it. Only an explicit `set_book_enabled(true)` re-enables. Exists so the
tactical-fallback and plain-search paths can be exercised deliberately once the book
is otherwise always available.

`analyse` (unchanged export, updated behaviour) now consults the loaded-and-enabled
book, if any, before falling through to search for each column's child position — a
book hit costs no node budget at all. An absent, never-loaded, or disabled book is
behaviourally identical to the pre-book `analyse`.

`tactical_fallback(position, max_ply) -> TacticalAnalysis` is SPEC.md §3.1's
2026-07-28 post-gate amendment: a COMPLETE search bounded by ply distance rather than
node count, for the game layer to call on cap expiry instead of choosing among a
partial deep search's unevenly-solved columns. It also consults the loaded-and-enabled
book first, per column child, same as `analyse`. It shares no search state with the
persistent `analyse` `Solver`/transposition table — it is a separate, self-contained,
TT-free search.

`TacticalAnalysis` shape:

```ts
type TacticalEval =
  | { kind: 'score'; score: number }   // exact within the horizon, or an honest horizon-draw (0)
  | { kind: 'full' };                  // column is full, no move exists

interface TacticalAnalysis {
  columns: TacticalEval[];  // length 7, index = 0-based column
  best: number | null;      // 0-based; lowest-column tie-break, same rule as AnalysisResult.best
}
```

Deliberately no `'unknown'` variant: unlike `ColumnEval`, `tactical_fallback` never
leaves a column unresolved — every legal column returns either a `Full` or an exact
`Score`, by construction, since the search is complete within its own horizon (a
result beyond the horizon is reported as an honest `0`, not as `'unknown'`). `best`
follows the same `Option<u32>` → `undefined` → (wrapper-normalised) `null` boundary
mechanics as `AnalysisResult.best`, and is `null` only when every column is `Full`.

**Horizon convention (pin).** `max_ply` plies are searched **from each child
position** — i.e. AFTER the move into the column being evaluated — mirroring exactly
how `analyse` hands each child the same `node_budget` rather than charging it for the
"free" act of playing the move itself. So a caller of `tactical_fallback(pos, max_ply)`
gets `max_ply + 1` total plies of information from `pos` (the analysed root),
including the move actually played into each column. This is not a claim SPEC.md's
§3.1 amendment pins itself; it is this implementation's own documented choice, made to
keep `analyse` and `tactical_fallback` structurally consistent with each other (both
being the two things the game layer's cap-expiry logic must call from the same site).

---

## Book format v1 (Wave 7, generator; Wave 8 implements the loader from this
section alone)

`tools/gen_book.rs` produces the file; `engine/src/book.rs` (Wave 8) reads it.
This section is written so Wave 8 needs no other source of truth for the
format — everything the loader must do is specified precisely below.

### What is in the book

Every reachable, non-terminal `Position` at ply 0 through the generator's
`--depth` (inclusive). "Non-terminal" excludes both a position where a
four-in-a-row was already completed by the move that reached it, and a full
board (a draw). The generator never descends past a terminal position — its
children are not enumerated. Positions are deduplicated two ways before
they reach the file:

1. **Transposition dedup.** Two different move sequences that reach the
   identical `(current, mask)` pair are the same entry.
2. **Mirror dedup** (see below). A position and its left-right mirror are
   the same entry, stored once under whichever of the two has the smaller
   key.

Each entry stores exactly one value: the position's own `solve()` score,
**from the perspective of the player to move in that stored position** —
the same convention `solver.rs` and the live search use everywhere else in
this document. The book does not store per-column scores; a caller wanting
a column's score at the book's root position must look up that column's
*child* position and negate, exactly as `analysis::analyse` already does
for the live solver (`ColumnEval::Score { score: -child_score }`). A child
beyond `--depth`, or a child that is itself terminal, will not be in the
book — terminal children are free to score directly (`can_win_next` /
draw-on-full-board), never require a lookup at all.

### Canonicalisation rule — mirroring, precisely

The board mirrors left-right: column `c` (0-indexed) maps to column
`WIDTH - 1 - c`. This is a genuine symmetry of the game (mirroring a legal
move sequence produces another legal, reachable sequence for the same
player to move, and — proven in
`engine/tests/reference.rs::a_position_and_its_left_right_mirror_score_identically`
— it **scores identically**, not negated).

Every column occupies a fixed-width 7-bit field in both `current` and
`mask` (`Position::key() = current + mask`), starting at bit
`col * (HEIGHT + 1)` — see `docs/ENGINE.md`'s Representation section.
`HEIGHT + 1` happens to equal `WIDTH` (both are `7`) for this board size;
that is a numeric coincidence of 6-tall/7-wide Connect Four, not an
identity — implementations should name the stride `HEIGHT + 1`
(`bottom_mask`/`top_mask`'s own spacing constant), not reuse `WIDTH`, so a
future board-size change (out of scope, but the constant shouldn't lie)
doesn't silently break this.

**Mirroring a raw key directly, without splitting it back into `current`
and `mask` first, is valid.** This matters because at lookup time the
loader typically has only a `Position::key()`, not the separate bitboards.
It works because addition never carries across a column boundary: each
column's playable rows (0..HEIGHT) hold at most 6 discs each for `current`
and `mask` independently, so `current_col + mask_col <= 63 + 63 = 126 <
128 = 2^7` — the sum always fits inside that column's own 7-bit field, with
nothing spilling into the neighbour's. So mirroring the *sum* column-by-column
gives the same result as mirroring `current` and `mask` separately and then
adding.

```rust
const STRIDE: u32 = HEIGHT + 1; // 7: bits per column, per Position's Representation
const COLUMN_FIELD_MASK: u64 = (1 << STRIDE) - 1; // 0x7F

fn mirror_key(key: u64) -> u64 {
    let mut out = 0u64;
    for col in 0..WIDTH {
        let field = (key >> (col * STRIDE)) & COLUMN_FIELD_MASK;
        let mirrored_col = WIDTH - 1 - col;
        out |= field << (mirrored_col * STRIDE);
    }
    out
}
```

`mirror_key` is its own inverse (`mirror_key(mirror_key(k)) == k`).

**Canonical key:** `canonical_key(key) = min(key, mirror_key(key))`. An
entry is stored in the book under `canonical_key(P.key())`. **Lookup must
apply the identical rule**: to find a live position `P` in the book,
compute `canonical_key(P.key())` and binary-search for that value — never
search for `P.key()` directly, since roughly half of all positions are
stored only under their mirror's key.

**No sign-flip, no move remapping, on a mirror hit.** Because mirroring is
a score-preserving symmetry (not a negation), the score found at
`canonical_key(P.key())` is directly `P`'s own score, whether or not `P`
happened to be the smaller-keyed side of its mirror pair. This is the
detail most likely to get silently inverted — every verdict downstream
would be backwards for exactly half the book's entries, and it would look
correct in casual testing because the *other* half would still be right.
There is no per-column consequence to get backwards either, since (as
above) the book stores whole-position scores, not column indices, so there
is no "which column did this move come from" remapping to perform.

### Binary layout

Little-endian throughout.

| Offset | Size | Field | Meaning |
|---|---|---|---|
| 0 | 4 | magic | ASCII `FWBK` |
| 4 | 1 | version | `1` |
| 5 | 1 | depth | the `--depth` this book was generated to (metadata / fast-path hint only; a binary-search miss is authoritative regardless) |
| 6 | 4 | count | `u32`, number of entries |
| 10 | `count * 8` | keys | full `u64` canonical keys, **sorted ascending**, no truncation, no hashing |
| `10 + count * 8` | `count * 1` | scores | `i8`, parallel array — `scores[i]` is the score for `keys[i]` |

Total file size: `10 + count * 9` bytes. At the expected depth-8 scale
(roughly 130k entries after mirror dedup) that is a couple of MB, comfortably
under the 10 MB ceiling above.

**Keys must be strictly ascending — a normative reading of "sorted ascending"
above, pinned for Wave 8's loader.** `keys[i] < keys[i+1]` for every `i`; no
repeats. A canonical key is a deduplication key by construction (see "What
is in the book" above — transposition dedup and mirror dedup both collapse
to one entry per canonical position), so two equal adjacent keys can only
mean the file is corrupt, never a legitimate degenerate case. A loader must
reject a file with a non-strictly-ascending key array as invalid, exactly
like a bad-magic or truncated file (see "Lookup protocol" step 5).

**A file whose length does not exactly equal `10 + count * 9` bytes is
corrupt — trailing bytes are not "extra content to ignore".** The declared
`count` and the file's own length must agree exactly. A file shorter than
this is truncated (see "Lookup protocol" step 5); a file longer than this
is equally invalid, not a forward-compatible extension point — this format
has none. Both cases reject identically, as a corrupt/absent file.

**Implementation note — the section-boundary arithmetic must be
overflow-checked, not wrapping.** Computing the keys/scores section offsets
from a caller-supplied `count` (`10 + count * 8`, `10 + count * 9`) must use
checked arithmetic and reject on overflow, rather than panic or silently
wrap. This is a genuine risk, not a defensive-programming nicety: on the
`wasm32-unknown-unknown` target `usize` is 32 bits, so a corrupt or
adversarially large `count` near `u32::MAX` can overflow a naive `usize`
multiplication well before any real allocation is attempted — a byte blob
that is otherwise short (nowhere near the multi-megabyte real book size)
can still carry a `count` field large enough to trigger this. A 64-bit
native build has enough headroom that the same `count` would instead simply
fail the "file is long enough" length check normally, which is exactly why
this risk is easy to miss testing only on a native target.

Every key is stored in full (64 bits) specifically so the key-collision
failure class the runtime transposition table accepts as a tradeoff
(`tt.rs`'s `partial_key: u32` scheme, fine for a lossy cache, sized against
a fixed table capacity) cannot happen here: the book is ground truth, not a
cache, and must never silently return one position's score for a different
position that merely shares a partial key.

### Lookup protocol (for Wave 8)

1. Compute `key = P.key()`, `canonical = canonical_key(key)` (mirror as above).
2. Binary search `canonical` in the sorted `keys` array.
3. Miss (not found, or `P`'s ply exceeds the book's `depth` field) → fall
   through to live search. This is not an error; positions past the
   generated depth are expected to miss.
4. Hit at index `i` → the score is `scores[i]`, valid for `P` directly, no
   adjustment.
5. Corrupt or absent file (bad magic, truncated, unreadable) → treat as a
   total miss and fall through to live search for every position,
   silently. Per ROADMAP Phase 2 gate criterion 3, this must never surface
   as a user-visible error — only as slower first moves.

### Sample verification artifact (Wave 7 → Wave 8 handoff)

`engine/tests/fixtures/book_sample_v1.json`: a seeded random sample of book
entries, each recording the **move sequence** that reaches the entry's
exact canonical position (not just any position mirror-equivalent to it —
replaying the stored moves through `Position::from_moves` and calling
`.key()` must reproduce the stored key exactly), plus that key and its
score. Shape:

```json
{
  "version": 1,
  "depth": 8,
  "seed": 42,
  "count": 1000,
  "entries": [
    { "moves": "444444", "key": 123456789, "score": -2 }
  ]
}
```

Wave 8's test replays each `moves` string, recomputes the key independently
of anything `gen_book` did internally, and checks it against `key` and
against the real loader's returned score for `score` — this is what catches
write/read boundary drift (serialisation bugs, canonicalisation asymmetry
between writer and loader), which is the actual risk this book format
carries; the solver itself is already fixture-proven and is not what this
sample re-tests.
