# STATUS — source of truth

> Updated by the orchestrator at the end of every wave. If this file and the
> conversation disagree, this file wins. Read `docs/ROADMAP.md` for the phase
> gates and `docs/ORCHESTRATION.md` for who runs on what.
>
> Restructured 2026-07-29 (owner-ordered). Full pre-restructure narratives are
> preserved in git history at and before commit `23a701e`; nothing recorded
> here was retracted — only compressed. Binding rulings and gate records are
> carried in full.

**Last updated:** 2026-07-29 (restructure; Wave 11 deployed + live-verified)

## Now

- **Phase 2 CLOSED** (gate SIGNED 2026-07-29). **Phase 3 wave plan
  APPROVED by owner 2026-07-29** (plan of record below, incl. four pin
  rulings and the split gate). **PIN 1 APPROVED 2026-07-29** with one
  reversal (D6: exploitation threshold fires on WEIGHTED ≥ 6, display
  raw — design-lead was right, the draft was wrong; consequence
  documented in the doc) and one refinement (D3: takes_win exclusivity
  only on a TAKEN win; a missed win observes all applicable rules — the
  most informative move in the game). R4's ≥2 floor and D7's
  prior-strength-2 accepted, with D7 PINNED to the ≥6 threshold (if
  either moves, both move). Definitions amended into OPPONENT-MODEL.md
  as a binding pin section. §19 rulings so far: floor counts whole
  games (agreed); review inherits Analyse's Show-me gate (agreed);
  items 4–6 with orchestrator recommendations in front of the owner.
  **Wave 12 UNBLOCKED and delegated 2026-07-29.** Design-lead one-shot for the three new surfaces: DELIVERED +
  ACCEPTED 2026-07-29 (headless Opus, model-verified via modelUsage both
  rounds). DESIGN-DIRECTION §§15–19 added (shared rules; log list with
  both provenance states labelled; review stepper with open-ring
  not-evaluated marks; prediction display meeting gate #2 structurally —
  the model cannot render without the solver beside it — with a testable
  two-integers-no-percent invariant on exploitation lines; §19: five
  reversible defaults + one directional call, all with reversal terms).
  Scope audit REJECTED round 1 on two real findings — the §15.4 contrast
  table was inflated ~8–10% (n-5-on-n-2 body text actually 4.44:1, BELOW
  the 4.5:1 AA floor the doc claimed it passed) and §19's opener
  overclaimed cheap reversal — correction round fixed both (five failing
  text instances moved to n-7 ink; new rule: on n-2 no text lighter than
  n-7 at any size; §12 untouched both rounds); re-audit ACCEPT with
  independent recomputation. §19's six flagged decisions + the
  raw-vs-weighted firing-threshold question are in front of the owner
  with the PIN 1 review. Phase 4 remains
  unsanctioned.
- **Wave 11 (immediate-win guard) COMPLETE, verifier PASS 7/7, DEPLOYED
  2026-07-29** (deploy run 30411030824 green, owner-ordered). Live-artifact
  verification PASS: the deployed wasm bytes themselves (sha
  `617b88de…`, served with edge-cache MISS) re-ran all 20 harness
  positions — 20/20 exact vs gamesolver ground truth, all `complete:
  true`, the four pre-fix-wrong cells confirmed fixed on the live site;
  deployed book.bin hash-identical to the committed file.
- **Release-fixtures CI on the Wave 11 engine: run 30407701466 —
  SUCCESS, log-verified 2026-07-29** (not just the badge): bare-checkout
  runner, `--include-ignored` full suite — lib 93/0 (417 s), gen_book
  29/0, book_replay 3/0 incl. production replay (1,159 s), position
  20/0, reference 8/8 with all six Pons sets exact (7,336 s). Zero
  failures anywhere. Wave 11's exactness is now execution-verified on
  current code both locally and on CI.

## Standing rules (operational — all still binding)

1. **Model quota:** subagent floor `CLAUDE_CODE_SUBAGENT_MODEL=sonnet` is
   baked at session launch; cannot be lifted mid-session (proven twice).
   Non-Sonnet one-shots run headless `claude -p --model opus` from the
   shell; verify the model from `modelUsage`/transcript, never the label.
   Never `/subtask` on Fable.
2. **Process hygiene:** every wave verifies `pgrep -fl gen_book` shows
   nothing before reporting done. Never wrap backgrounded probes in
   `/usr/bin/time … &` ($! tracks the wrapper, orphaning the child).
   Shared Mac: check load/CPU-utilisation before trusting perf numbers;
   perf-purposed waves carry a throughput/utilisation floor in their audit
   criteria (pos/s alone failed to expose the Wave 7.2 clamp).
3. **macOS renice:** `sudo renice 0 -p <pid>` — the `-n` form is an
   increment and a SILENT NO-OP for lowering; root required to lower.
   zsh BGNICE nices `&`-jobs +5; `~/fourwise-launch.sh` has `unsetopt
   bgnice` baked in.
4. **Test invocation:** the full release run is `cargo test --release --
   --include-ignored` — `--ignored --include-ignored` together are
   mutually exclusive and rejected. Full local release run ≈ 1h32m under
   typical shared-machine load (reference suite ~75 min of it).
5. **`vite preview` cannot test HTTP-404 asset paths** (SPA-fallbacks to
   200/HTML, ignores the `/fourwise/` base). Real-404 evidence: plain
   static server rooted so `/fourwise/` maps to `dist/`, curl-confirm the
   404 first.
6. **Verifier independence:** verifiers produce their own evidence (own
   runs, own mutations re-applied live, own fixtures where possible);
   implementer mutation lists must be enumerated auditably, not
   summarised as a count. A verifier that can write will fix-and-report-
   success; ours cannot write, keep it that way.
7. **Test-oracle rule (Wave 11 lesson, class now has five closed
   instances):** a test's expected values must come from INDEPENDENT
   ground truth — hand computation, external reference data (Pons
   fixtures, gamesolver.org), an independent oracle implementation, or
   measured behaviour — never derived by the same rule/code path the
   implementation encodes. Doc-pinned rules are implementation, not
   oracle: validating code against the pin it implements proves nothing
   when the pin itself is wrong (that is exactly how the immediate-win
   defect survived three verified waves).
8. **Strong's randomised tie-break** makes empty-board verdicts vary by
   session — a methodology trap in any determinism-assuming test, not a
   defect. Perfect is deterministic (lowest-column tie-break).
9. **`debug_assert!`s compile out under `--release`** — release-mode runs
   trust, not re-check, the canonicalisation/sortedness invariants; they
   are exhaustively covered in debug tests. Any future release-mode
   integrity check must account for this.
10. **Book generation** (if ever re-run): owner's machine, overnight,
    detached (`nohup caffeinate -i`, log file), NEVER inside a Claude
    Code session; checkpoint is flush-per-line, kill-9-safe, resumable;
    generation TT goes well above 64 MB.
11. **No placeholder data anywhere in the UI** — unknown says unknown.
    Terminal display beats analysis display for PRESENT-TENSE claims
    about the current position; backward-looking provenance records
    (partial badge, level qualifier) are exempt (SPEC §3.2 falsity test,
    `d250762`).

## Ownership

| Agent | Model | Owns |
|---|---|---|
| main session (orchestrator) | Fable | architecture, delegation, gate judgement, this file |
| `rust-engine` | Sonnet | everything under `engine/` and `tools/` |
| `web-ui` | Sonnet | everything under `web/` |
| `verifier` | Sonnet, read-only | wave/gate audits; runs before anything is declared done |
| `design-lead` | Opus, one-shot (done) | `docs/DESIGN-DIRECTION.md` only; headless `claude -p --model opus` |

## Findings ledger

- **Phase-1 post-gate defects 1–3** (partial-play tactics at cap, level-label
  honesty, terminal display) — all CLOSED by Phase 2 (Waves 8–10.1), confirmed
  at the Phase 2 gate.
- **Post-Phase-2 defect 4 — immediate-win column scores (2026-07-29):**
  both per-column loops (`analysis.rs::analyse_with_book`,
  `tactical.rs::tactical_analyse_with_book`) scored a four-completing move by
  negating a search of the already-won child — a Pons-precondition violation
  returning fiction. Found by the owner-requested gamesolver cross-check
  harness (4/20 positions wrong, only in immediate-win columns; worst case a
  winning move labelled −3 "losing"); blast radius was analysis-panel scores,
  verdict copy, and move choice at every level (a slower win preferred over an
  immediate one; a position whose only win is immediate could be thrown away —
  fixture "353676321354762" reproduces exactly that). Never caught because the
  Pons fixtures contain no won positions and the Wave 3 POV test was vacuous
  (rule 7 above). **CLOSED by Wave 11** (see wave log), deployed and
  live-verified same day.
- **Vacuous-oracle test class:** five instances found and closed to date —
  Wave 4a decoy stand-in; Wave 2 self-satisfying negation invariant; Wave 7.1
  round-trip doc overclaim; Wave 3 analysis POV test; tactical.rs POV twin
  (which was guarding a live copy of defect 4). Owner-ordered sweep 2026-07-29
  (`verifier`, read-only): **no sixth instance** across engine/src,
  engine/tests, and all web suites; near-misses individually examined and
  cleared (book mirror-key re-derivation, reference negamax self-consistency's
  independent 2D oracle, levels real-engine integration test). Caveats on
  record: book_replay.rs trusted from its prior audit, not re-derived;
  mock-only UI component tests are structurally outside the class.

## PHASE 1 GATE RECORD (SIGNED: owner ruled PASS 2026-07-28)

**Criterion 1 — every reference fixture exact: MET.** Local release run all
six Pons sets 6,000/6,000 exact (1,949 s, verifier-audited); wasm bridged by
identical-source + cross-environment sampling (native/Node/Chrome worker
identical on probe positions). Residual closed 2026-07-28: CI run 30334738699
(240-min re-dispatch) green on current code from a bare checkout —
`test_l1_r3_begin_hard ok`, release suite 8/8 in 5,826 s; all six sets
execution-verified on current code, nothing resting on inference.

**Criterion 2 — four-seat test as amended (SPEC §1): MET.** `seat.test.ts`:
fixed literal engine input, four seats, hand-written per-seat expectations,
cross-grouped independence proofs, byte-identical engine inputs asserted at
the production call site. Live: owner on-device check — wording flips
correctly across all four seats.

**Criterion 3 — mid-game responsiveness as pinned: MET.** Desk worst case
39.1 ms (plies 15–25) with the committed throttle-probe honestly showing CDP
throttling does not constrain Workers; deciding half: owner's iPhone (Safari
+ Chrome), ply-12+ analysis settles under a second.

**Criterion 4 — keyboard / reduced-motion / one-handed portrait: MET.**
Wave 6a bullet-by-bullet audit with fixes (keyboard-guard bug regression-
tested, 44 px targets, reduced-motion hard-disable, grayscale
distinguishability, no horizontal scroll 360–430 px); owner on-device check.

**Criterion 5 — deployed and loading from GitHub Pages: MET.** Full asset
chain curled cold/no-cache under the real `/fourwise/` base; first-visit cold
load; end-to-end play on the deployed artifact; airplane-mode reload works.

Known defects logged at signature, owner-classified post-gate: the three
Phase-1 findings (ledger above), all since closed.

## PHASE 2 GATE RECORD (SIGNED: owner ruled PASS 2026-07-29 "CONFIRMED")

**Criterion 1 — opening moves < 50 ms: MET.** Deployed URL, headless Chrome,
MutationObserver-instrumented: book-served moves 0.3–3 ms end-to-end across
4 seats × 5 plies; engine-first-from-empty 15–16 ms; ply-8/9 boundary
tactical-fallback path 15–29 ms, correctly labelled, under the bar.

**Criterion 2 — sampled entries match a full search: MET.** Replay battery
(1,000 loader replays with independent key recompute + 200 seeded ply≥4
fresh-solver re-solves + count-enforced shallow set incl. empty board,
333.55 s, 0 failures); local book sha256 == deployed sha256; verifier's own
12-entry spot check (own binary, own indices, fresh solver each): 12/12.

**Criterion 3 — absent/corrupt book degrades silently: MET.** Plain-static-
server method (rule 5): absent → boots and plays, one info line, no error UI;
corrupt (TruncatedKeys) → identical silent degrade; valid → silent success.

Pre-signature owner rulings executed (Wave 10.1): win-line SVG overlay per
DESIGN-DIRECTION §9; parity ruler gated on isGameOver; SPEC §3.2 class-wide
clarification (`1109a30`, `d250762`). Owner-ordered class sweep: ten
analysis-derived surfaces enumerated, only the ruler defective. Verifier
pre-signature pass 6/6 with live screenshots; deployed (run 30398241459).

## Wave log (chronological; outcome + still-binding decisions only)

- **Wave 1** (`rust-engine`): position.rs bitboard, 20/20 tests. Binding:
  copy semantics, no `undo()` (Pons-style); `Position` fields private;
  `play()` does no legality check (caller checks `can_play`).
- **Wave 2** (`rust-engine`, verifier PASS): solver.rs full Pons optimisation
  ladder, tt.rs (prime-sized 8-byte packed), all six Pons fixture sets,
  6,000/6,000 exact in release. Binding: stop condition = fixtures-exact +
  mid-game < 1 s; colour-independence proven via mirror + negamax
  self-consistency with an independent 2D-grid oracle (the negation
  "invariant" was self-satisfying — empty-board counterexample in ENGINE.md).
- **Design direction** (`design-lead`, headless Opus, verified): 
  docs/DESIGN-DIRECTION.md. Owner override on record (§14.1): best-column
  reveal auto in Play, gated behind "Show me" in Analyse. Later §5 amendment:
  fixed Red|Yellow picker ordering exempt from the sequence-implication ban.
- **Wave 3** (engine + web, both verifier-checked): analysis.rs + budgeted
  solver + wasm exports; Vite/React/TS scaffold, typed wrapper, single
  wasm-instance worker, progressive-budget client. Binding (ENGINE.md pins):
  serde-wasm-bindgen JS object shape, `best` undefined→null normalised in the
  wrapper, Uint32Array moves, lowest-column tie-break, immediate-win exempt
  from budget; stale-result discard. (Its POV test was later ruled vacuous —
  ledger.) StrictMode double-mount calibration defect caught and fixed.
- **Wave 4a/4b** (`web-ui`, verifier PASS ×2): seat model + verdict
  translation (colour-free), levels with horizon clamp, setup reconstruction
  (memoized DFS, five verdicts), stale-token discard; designed UI, three
  modes, history/keyboard, single-lamp rule structurally enforced, design
  tokens byte-identical to §12.
- **First-run seat prompt** (verifier PASS, owner ruling): both questions
  mandatory, no default seat; `fourwise:seat` seat-only localStorage,
  validated on read; calibration warmed behind the prompt.
- **Wave 5a/5b** (`web-ui`, verifier PASS): analysis panel with visible
  badges, blunder flag (verdict-only firing), parity ruler (waiting-threats
  only, hides); persistence (legality-gated restore, corrupt → fresh game),
  versioned export envelope `{version, exported, games[]}` with three honest
  import rejections, desktop rail. **Owner rulings binding:** import updates
  the ACTIVE seat only, never the stored preference; the active seat persists
  WITH the game state — `fourwise:seat` is a first-run default only.
- **Wave 6a/6b + deploy** (verifier PASS): quality floor (keyboard-guard bug
  fixed, 44 px targets), role-based control defaults (creation-time only);
  colour-role hunt CLOSED (no occurrence four). CI green from bare checkout —
  wasm-pack's own .gitignore means pkg is never committed, CI must rebuild.
  Repo public (owner-sanctioned), Pages live at
  https://puterae1.github.io/fourwise/ under the `/fourwise/` base.
- **Wave 7 / 7.1 / 7.2** (`rust-engine`, verifier PASS each): gen_book bin +
  Book format v1 (versioned header, sorted full-u64 keys + parallel i8
  scores, binary search — no hashing, no truncated keys), kill-9-safe
  checkpoint; lock-free `SharedTranspositionTable` (packed AtomicU64,
  Relaxed; races waste probes, never corrupt scores), serial-vs-parallel
  byte-identical across 5 runs incl. oversubscribed, MIN_SAFE_CAPACITY clamp
  fix (`ffa999d`); 7.2 was pure diagnosis — no engine fault, contention +
  BGNICE (standing rules 2–3). Fixed cost: the ply 0–4 tier ≈ 100 min at any
  depth.
- **Wave 8** (`rust-engine`, verifier PASS 8/8): book.rs strict loader
  (duplicates rejected, trailing bytes corrupt, checked arithmetic),
  tactical.rs separate fixed-depth search, wasm exports
  `load_book`/`set_book_enabled` (permanent flag)/`tactical_fallback`,
  corrupt-book matrix + fuzz, book-absent ≡ book-agnostic equivalence.
  Production replay design: 200 seeded ply≥4 FRESH-solver re-solves + shallow
  set, count-enforced.
- **Wave 9** (`web-ui`, verifier PASS 9/9): BASE_URL-aware non-blocking book
  fetch with silent degrade; tactical fallback at cap expiry (horizons
  perfect 10 / strong 8 / fair 7 / weak 3, `max_ply`+1 convention);
  level-label qualifier as real rendered text (role=status); terminal display
  through copy.ts's single seat-translation point; `Move.origin` additive.
- **Book production** (owner's machine, detached): depth-8, 129,498 entries,
  1.14 MB, committed `938f6d3`; replay + re-solve battery passed (333.55 s);
  deployed, served byte-identical.
- **Wave 10 / 10.1 — Phase 2 gate** (verifier PASS 6/6, owner-signed): gate
  record above; win-line overlay + ruler gate + SPEC §3.2 clarification.
- **Wave 11** (`rust-engine`, verifier PASS 7/7, committed `e7253c8`,
  DEPLOYED + live-verified 2026-07-29): immediate-win guard at BOTH
  per-column call sites — `Position::is_winning_move(col)` shared primitive;
  a four-completing column scores `22 − (floor(moves/2)+1)` directly, BEFORE
  book lookup; won children never searched or book-consulted;
  formula-agreement tests pin both copies to the solver's own expression.
  ENGINE.md "score point of view" pin amended: negated-child rule is
  NON-TERMINAL children only; both old POV tests recorded there as vacuous.
  Regression fixtures: four gamesolver-verified full column arrays
  ("1264234", "353676321354762", "612375344567673432",
  "1451336251725537574"), only-winning-move-is-immediate,
  immediate-beats-slower-win. One send-back en route (4b fixture had three
  winning columns; re-pointed at the unique-win position). Permanent assets
  committed: `tools/compare_gamesolver.rs` (20 seeded positions, plies 4–20,
  gamesolver-format output — the tool that found the defect) and
  `web/src/game/selfplay.perfect.test.ts` (four-seat Perfect-vs-Perfect on
  real wasm + real book: centre open, first mover wins, 41 plies, four games
  move-identical — the live seat-independence proof). Verifier evidence all
  its own: 20/20 gamesolver re-curl, four mutation classes caught by named
  tests, debug 147/0 + clippy clean, FULL release run 0 failures (six Pons
  sets exact), web 310/310 on a rebuilt pkg it caught stale itself.

## Phase plans

- **Phase 1 wave plan:** complete, gate signed (record above).
- **Phase 2 plan of record:** complete, gate signed (record above). The three
  owner rulings that shaped it (detached generation; write/read-boundary
  verification split across waves; tactical fallback tested book-absent with
  a permanent disable flag) are preserved in the wave log and ENGINE.md.
- **Phase 4:** unsanctioned (`docs/ROADMAP.md`).

## Phase 3 wave plan (PLAN OF RECORD — owner-approved 2026-07-29, with
four pin rulings and one gate amendment folded in)

Scope: ROADMAP Phase 3 (game log, post-game review, opponent model,
prediction display, JSON export/import), governed by
`docs/OPPONENT-MODEL.md`. Web-only; zero engine changes expected — any
wave that discovers it genuinely needs engine support STOPS and reports.
No machine learning (ROADMAP's explicit warning stands).

**Owner pin rulings (2026-07-29), to be amended into OPPONENT-MODEL.md
before Wave 14 delegation:**

- **PIN 1 — rule-satisfaction definitions:** drafted by the orchestrator,
  OWNER REVIEW PENDING — Wave 12 held until approved. Owner addition:
  `blocks_diagonal` is the point of the whole model; its fixtures get the
  most adversarial treatment, INCLUDING a threat cell that is BOTH
  diagonal and horizontal (where a naive classifier double-counts or
  misattributes), and that case is mutation-tested specifically.
- **PIN 2 (owner-corrected):** an exploitation line surfaces when a rule
  has ≥ 6 observations AND posterior mean < 0.4 (weakness) or > 0.75
  (strength) — six is roughly where Beta-Bernoulli with the doc's priors
  stops being prior-dominated. **DISPLAY RAW COUNTS, never the
  posterior** — "missed a diagonal in 7 of 9 chances" is the product; the
  mean is internal machinery only. Both the threshold and the display
  rule are pinned.
- **PIN 3 — live vs reconstructed weight: 1.0 / 0.5.** Halve
  reconstructed. A real discount, defensible, reasonable to explain.
- **PIN 4 — counts keyed by opponent label; single-opponent UI first.**
  Pooling would average the primary opponent with anyone else, which
  destroys the only thing the model is for.

**Waves:**

- **Wave 12 — game-log data layer: COMPLETE, verifier PASS 8/8
  2026-07-29 (one FAIL round: missing regression test for the Wave 5b
  seat-preference invariant on the import-with-logged-games path — code
  correct by trace, gap closed with a non-vacuous test, re-verified by
  live mutation).** Delivered: LoggedGame per the pinned interface;
  export envelope v2 (one optional additive field; literal-v1 migration
  tested; 3+ hostile rejections); `fourwise:log` day-to-day store
  (corrupt/newer/quota → empty log, never a crash); record-from-live-play
  per §16.4; add-from-memory reusing Setup's real backtracking via one
  additive export (finished games accepted there, still rejected by
  Setup's check 4 — both run by the verifier on the same grid);
  idempotent import merge de-duplicated by id; §16 sheet with BOTH
  provenance labels on independent carriers (text + edge treatment,
  screenshot-verified at 390px through a real static server, not vite
  preview); `Games ▸` door in the Play action slot per §15.2. Four-seat
  expectations hand-derived by the verifier before reading the tests;
  four mutations caught by named tests. Web tests 310→396. Deferred by
  documented scope (not defects): the "N more before predictions"
  header clause (Wave 15), tappable rows/review entry (Wave 13).
  Original scope line: `LoggedGame` per OPPONENT-MODEL.md; storage as envelope v2
  with a tested v1→v2 migration; record-from-live-play at game end (seat +
  moves + result + date + opponent label); reconstructed entry via the
  existing Setup/replay path (`source: 'reconstructed'`); export/import
  round-trip with the house hostile-input rejection pattern. Minimal
  log-list UI only.
- **Wave 13 — post-game review** (`web-ui`): step through a logged game
  with evaluation at every ply (existing analysis client; book covers
  openings; §3.1 partial-honesty conventions apply), blunders marked with
  the existing verdict-only semantics, all wording through the single
  seat-translation point. Preceded by the SANCTIONED design-lead one-shot
  (headless Opus, bounded amendment for the three new surfaces: log list,
  review stepper, prediction display).
- **Wave 14 — opponent model core, logic only** (`web-ui`, test-first):
  seven-rule classifier per the approved PIN 1 definitions (adversarial
  `blocks_diagonal` fixtures per the owner addition), Beta-Bernoulli
  updates with the doc's priors as pseudo-counts, prediction scoring +
  normalisation, top-3 with confidence, exploitation summaries per PIN 2,
  PIN 3 weighting, 20-game floor as pure logic. No UI.
- **Wave 15 — model UI + code gate** (`web-ui`, then `verifier` + owner):
  prediction display visually distinct from optimal (ROADMAP gate #2),
  honest confidence including low (gate #3), below-20 count-and-needed
  display, four-seat wording sweep over every new surface, gate audit on
  the deployed artifact.

**Gate split (owner amendment 2026-07-29):** the Phase 3 gate has two
distinct halves, recorded separately —
1. **Code gate** (blocks Phase 3 closure of the build): logging, review,
   model correct on synthetic data, 20-game floor enforced, prediction
   visually distinct, honest confidence. Passes on delivery + verifier +
   owner signature.
2. **20-real-games criterion: OWNER-PENDING, non-blocking** — waiting on
   the owner to play and log real games. Phase 3 is not "stalled" while
   this accumulates; the floor mechanism ships enforced from day one.
