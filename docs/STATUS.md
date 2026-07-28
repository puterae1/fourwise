# STATUS — source of truth

> Updated by the orchestrator at the end of every wave. If this file and the
> conversation disagree, this file wins. Read `docs/ROADMAP.md` for the phase
> gates and `docs/ORCHESTRATION.md` for who runs on what.

**Last updated:** 2026-07-28 (Phase 1 gate SIGNED — PASS)

## Current phase

**Phase 2 — Opening book. Not started.** Phase 1 gate passed and owner-signed
2026-07-28. Phase 2 wave breakdown proposed, awaiting owner approval; no
Phase 2 delegation happens until the breakdown is approved and recorded here.

## Done

- Repo scaffolded: docs + CLAUDE.md + agent roster committed (`2870d6c`).
- Sonnet routing verified: a probe task on `rust-engine` ran entirely on
  `claude-sonnet-5` (checked against transcript metadata, not just the task
  label). Double lock in place: `model: sonnet` frontmatter +
  `CLAUDE_CODE_SUBAGENT_MODEL=sonnet` in `.claude/settings.json`.
- Dev environment: rustup + wasm-pack installed via Homebrew (rustc 1.97.1,
  cargo 1.97.1, wasm-pack 0.15.0), `wasm32-unknown-unknown` target added,
  rustup keg added to PATH in `~/.zshrc`.
- **Wave 1** (`rust-engine`): engine crate scaffold, `engine/src/position.rs`
  bitboard, `engine/tests/position.rs` — 20/20 tests pass, clippy clean
  (incl. `--all-targets`). Decisions on record: copy semantics with no
  `undo()` (Pons-style, play/undo invariant tested via replay-from-prefix);
  `Position` fields fully private — **the solver wave must decide** whether
  `solver.rs` gets `pub(crate)` field access or accessors; `PositionError`
  enum for `from_moves`; `play()` does no legality check (caller checks
  `can_play`, matching Pons).
- **Design direction** (`docs/DESIGN-DIRECTION.md`), Opus-authored, verified
  via transcript. Operational lesson learned the hard way:
  `CLAUDE_CODE_SUBAGENT_MODEL` is baked into the session env at launch —
  editing settings.json mid-session does NOT lift it, and it beats the
  per-invocation `model:` parameter (two runs both landed on Sonnet before
  this was proven). Working procedure for any future non-Sonnet one-shot:
  headless `claude -p --model opus` from the shell; its main loop is not a
  subagent so the floor never applies. settings.json floor is restored and
  was never effectively down. ORCHESTRATION.md, CLAUDE.md, and the
  settings.json comment are corrected accordingly (the old "comment the line
  out mid-session" instruction was wrong).
- **Owner override recorded in `docs/DESIGN-DIRECTION.md`** (by design-lead,
  headless Opus, verified): best-column reveal is auto in Play, gated behind
  "Show me" in Analyse — a swap of the doc's original assignment. Original
  recommendation preserved in §14.1 marked OVERRULED, with rationale.

- **Wave 2 — COMPLETE, verifier PASS 2026-07-28.** Delivered:
  solver.rs (full Pons optimisation ladder), tt.rs (prime-sized, 8-byte
  packed entries; one real TT sizing bug found and fixed en route), all six
  Pons fixture sets in `tests/fixtures/`, `tests/reference.rs`, mirror
  seat-model proof. Verified: debug tests clean (39), clippy clean; release
  run exact on L3_R1, L2_R1, L2_R2, L1_R1, L1_R2 (5000 positions).
  Resolved since: `test_l1_r3` completed OK — full release run 7/7 in
  1949 s, all 6000 fixture positions exact. Owner approved both ENGINE.md
  amendments (stop condition re-based to fixtures-exact + mid-game < 1 s;
  colour-independence negation invariant replaced by mirror + negamax
  self-consistency, empty-board counterexample recorded in the doc).
  Negamax self-consistency test added (45 sampled positions, independent
  2D-grid oracle for terminal detection). Independent `verifier` audit:
  PASS on all 7 criteria — full suites clean, 6000/6000 fixture positions
  exact (direct re-runs + completed-run log), mid-game solves ≤ 26 ms in
  release, colour-blindness/sentinel/no-unsafe invariants confirmed,
  fixtures integrity and score convention hand-verified.

- **Wave 3, engine half** (`rust-engine`): delivered 2026-07-28 — analysis.rs
  core + budgeted solver + wasm exports + pkg built. Owner gate review:
  POV test confirmed independent (negated direct child solve); boundary
  mechanics smoke-tested by running the built module in a worker context
  (init OK, budget semantics correct at runtime, invalid input throws);
  mechanics pinned into ENGINE.md (serde-wasm-bindgen JS object, `best`
  arrives `undefined` → wrapper must normalise to `null`, Uint32Array,
  lowest-column tie-break, immediate-win exempt from budget). Send-back
  resolved: empty-board tiny-budget and A→B→A TT-pollution tests added,
  27 analysis tests green, clippy clean. Engine half ACCEPTED.
- **Wave 3, web half — COMPLETE 2026-07-28.** Vite + React + TS scaffold,
  typed wrapper (undefined→null, Uint32Array→number[], EngineError), single
  wasm-instance worker, progressive-budget client (lazy retryable
  calibration after a StrictMode double-mount defect was caught in-browser
  and sent back), honest smoke page. 24 vitest tests against real wasm.
  Full-wave verifier audit: PASS on all six criteria with line citations.
  In-browser check (real Web Worker, Chrome): empty board renders honest
  all-unknown progressive state; endgame position completes with best/
  scores/threats identical to native and Node results; no console errors.
  Wave 3 committed as a whole after both checks.

- **First-run seat prompt — COMPLETE, verifier PASS 2026-07-28** (owner
  ruling on the default-seat question): one screen, both questions
  unselected, Start gated until both answered, calibration warmed behind
  the prompt (engine's first move landed instantly in the browser check),
  seat-only localStorage (`fourwise:seat`, validated on read), DEFAULT_SEAT
  removed. Five browser checks green incl. returning-user reload (no
  re-ask, seat preserved; in-app change persists). 112 web tests. Minor
  notes carried to Wave 5: stale calibration comment in useEngineClient.ts;
  add a corrupt-stored-seat unit test.
- **Design-doc amendment — COMPLETE** (design-lead, headless Opus, verified
  11/11 calls on claude-opus-5): mockup captions marked post-selection
  states, final connect4-lab → fourwise rename, §8.4 confirmed consistent
  with the §14.1 override. Diff scope-audited by verifier: two hunks, no
  restyling.

## In flight

- **Wave 7 — code COMPLETE, verifier PASS 2026-07-28 (10/10), committed
  `1a54f72`. Depth-8 production run CLEARED for launch (owner's shell).**
  Verifier highlights: suites clean (77 tests, clippy `-D warnings` no
  suppressions), scope strictly the three files with zero dependency
  changes (Cargo.lock diff empty; hand-rolled JSON/PRNG/CLI on purpose),
  ENGINE.md Book-format-v1 judged self-sufficient for a cold Wave 8
  implementation — including the mirror bit-arithmetic derivation and the
  "no sign flip on mirror hit" trap called out explicitly; doc/code byte
  layout agree; kill-safety verified incl. truncated-line tolerance; all
  three mutation classes judged genuinely test-sensitive (read-only
  judgement, per 5b precedent); honesty scan clean — the one shared-
  algorithm test discloses its own limits, sample clamping is documented
  AND tested. Carry-forward (not a blocker): the canonicalisation and
  sortedness `debug_assert!`s compile out under `--release`, so the
  production run trusts those invariants rather than re-checking them
  live — they are exhaustively covered in debug tests. Wave 8 should keep
  this in mind if it ever adds a release-mode integrity check. Caught mid-wave executing the depth-4 rehearsal in-session
  (1h49m in); owner ordered it killed — the rehearsal itself is a ~100-min
  job because the ply 0–4 tier (719 canonical positions) costs ~100 min of
  solve time on the M-series machine AT ANY DEPTH; this fixed cost does not
  amortize away as depth grows. Budget it into the production run. Killed
  at 676/719; checkpoint `/tmp/book_d4.bin.checkpoint` holds 676 verified
  `key score` lines — depth-agnostic (exact solves keyed by canonical
  position key), reusable for the depth-8 run by copying it to
  `<out>.checkpoint` and passing `--resume`. NOTE: /tmp does not survive
  reboot; copy it before restarting the machine or accept re-solving.
  Delivered: generator (21 new tests, 56→77 total, clippy clean),
  ENGINE.md "Book format v1" section, mutation-tested (endianness /
  canonicalisation / depth off-by-one all caught by named tests).
  NOT yet produced (sanctioned): book_d4.bin, book_sample_v1.json — both
  are written only at run completion, which happens detached.
- **PROBE RESULTS 2026-07-28 (5-min depth-8 probe + kill-9/resume probe,
  scratch path, production settings):** resume VERIFIED live — restart
  reported "76 already checkpointed, 129422 left", first 76 checkpoint
  lines byte-identical across the kill, zero duplicate keys. Checkpoint
  interval: every position, flushed. Depth-8 totals from the real run:
  129,498 canonical positions (258,614 raw). **Measured cold solve rate:
  ~0.25–0.4 positions/s → 4–6 DAYS single-threaded if the rate holds.**
  TT warming will improve it by an unknown factor, but "overnight" was
  never realistic as built. Also: progress lines are count-based
  (total/100 ≈ every 1,295 positions ≈ >1 h between lines at this rate)
  — no early ETA visible in the log. **OWNER RULED 2026-07-28:
  parallelise (Wave 7.1, delegated, in flight).** Three pinned
  requirements: shared LOCK-FREE TT tolerating racy reads (per-thread
  tables kill cross-position warming, a mutex kills parallelism; scheme
  + safety argument must be stated); serial-vs-parallel BYTE-IDENTICAL
  book on a deterministic subset (via --max-positions; concurrency
  corruption is invisible to downstream checks, which test the book
  against itself — **owner amendment 2026-07-28: the parallel side runs
  3–5 times against the one deterministic serial baseline, every run
  byte-identical (a 1-in-20 race passes a single run), and at least one
  run oversubscribed at --threads 2–3× cores, where lock-free flaws
  actually surface; any single differing byte = stop, keep both files,
  report diff offsets**); throughput re-measured with a real
  positions/sec probe before done. Also: time-based progress/ETA lines every ≤60 s;
  --threads flag; zero new dependencies; checkpoint stays flush-per-line
  and line-atomic under concurrent writers. engine/src will change for
  the shared table (first change since gate state) → after verifier
  PASS, re-dispatch engine-release-fixtures CI to reconfirm exactness.
  Verifier re-audit must include a FRESH kill-9/resume probe on the
  parallel build. Production launch stays ON HOLD until all that lands.
- **Depth-8 production run: OWNER runs `~/fourwise-launch.sh` from a
  plain Terminal** (per ruling 1 — never inside a Claude Code session).
  The script replaces the earlier inline command (which had a re-run
  hazard: its unconditional checkpoint `cp` would clobber accumulated
  progress on a second launch — the script guards this). It seeds the
  checkpoint from /tmp (789 solved positions: 676 d4-rehearsal + probe
  solves, merged 2026-07-28), launches under `nohup caffeinate -i`,
  logs to `~/fourwise-genbook-d8.log`, and is safe to re-run after any
  interruption. **HOLD: do not launch until the throughput decision
  above is ruled — as built the run is 4–6 days single-threaded.**
  Progress: `grep gen_book ~/fourwise-genbook-d8.log | tail`. Kill-safe;
  re-run the same command to resume after any interruption. Writes the
  book atomically and `engine/tests/fixtures/book_sample_v1.json`
  (1,000 seeded entries with move sequences) at completion — commit both.

## Done (continued — misfiled under "In flight" until 2026-07-28; every wave
below is complete)

- **Wave 5a — product: COMPLETE, verifier PASS 2026-07-28** (after one
  FAIL round). Analysis panel with visible throws-away-win badge (initially
  attribute-only with no CSS — invisible to sighted users; caught by
  verifier, fixed, confirmed via headless-Chrome screenshot of the real
  CSS), blunder flag UI (verdict-only firing per amended §3.2, end-to-end
  async suite against a responding fake client incl. stale-race tests,
  mutation-tested by the implementer), parity ruler (labelled
  waiting-threats-only per amended §2, hides-not-degrades, absent in
  Setup). 156 web tests. Class-wide sweep: attribute-set-but-never-styled
  has no other instances; the dead FakeWorker (4b-era) hollowed nothing
  claimed, but analysis-dependent DOM rendering had no coverage — the
  responding-fake pattern now exists; lamp DOM test assigned to 5b.

- **Wave 5b — plumbing: COMPLETE, verifier PASS 2026-07-28 (8/8).**
  Game-state persistence (legality-gated restore replaying through the
  real dropDisc; corrupt anything → fresh game, never a crash; partial
  badges survive the round-trip — browser-verified), versioned export
  envelope `{version, exported, games[]}` with three distinct honest
  import rejections (mutation-tested by implementer; verifier independently
  judged assertions mutation-sensitive), desktop rail driven by the
  litColumn signal with zero mode inspection, lamp-reveal DOM test closing
  the 4b coverage hole, seatStorage corrupt tests, comment cleanup.
  **OWNER RULED 2026-07-28:** import updates the ACTIVE seat only, never
  the stored preference (test pinning it required); the active seat
  persists WITH the game state, `fourwise:seat` is the first-run default
  only (reconcileGameSeat inverted — a restored game keeps its own
  embedded seat, killing the mid-imported-game reload disagreement).
  Being implemented in 6a.
  Also carried to 6a: default side controls are per-colour (yellow=engine)
  — a first-run user choosing yellow watches the engine play their colour;
  fix to by-role defaults (user=human).

- **Wave 6a — COMPLETE, verifier PASS 2026-07-28** (one FAIL round).
  Quality floor: 5 PASS / 2 FIXED (keyboard guard was swallowing 1-7/u/r
  whenever a radio had focus — real bug, fixed with regression test; four
  controls bumped to 44 px). Role-based controls default (creation-time
  only; per-colour stability mid-game tested). Seat-persistence ruling
  implemented in full and verifier-confirmed point by point. Perf: worst
  case 39.1 ms across plies 15–25 (fixtures have no ply-12–14 lines) —
  BUT the committed throttle-probe artifact proves CDP throttling does not
  slow dedicated Workers (main thread 3.93×/5.92×, Worker flat 1.00×), so
  desk numbers are effectively unthrottled; gate #3 evidence remains the
  phone in 6c, per the ROADMAP pin.
  **Colour-role hunt: CLOSED.** The verifier's sweep of all of web/src
  examined every candidate. Occurrence three (Setup placing colour
  defaulting red for first-run yellow users — a useState reading its arg
  once pre-controller) was found, fixed with the re-sync/latch pattern,
  and re-verified. The only other flag — fixed Red|Yellow picker ordering —
  was a §5 internal contradiction (its Forbidden bullet vs its own
  Required example), owner-ruled 2026-07-28: pickers exempt, Forbidden
  bullet scoped to sequence-bearing contexts; design-lead amended §5 on
  the record (headless Opus, verified). Every remaining candidate in the
  sweep table is inert or correct. **There is no known occurrence four.**

- **Wave 6b — CI/deploy workflows: COMPLETE 2026-07-28.** ci.yml green on
  its first live run (both jobs, bare-checkout proof of the pkg rebuild —
  wasm-pack's own .gitignore meant pkg was never committed; fresh clones
  could not build until this fix). deploy.yml dispatch-only until Pages
  exists; engine-release-fixtures.yml on demand. /fourwise/ base proven
  under a local prefix server (all asset classes 200 with the prefix, 404
  without).

- **DEPLOYED 2026-07-28: https://puterae1.github.io/fourwise/** — repo
  public (owner-sanctioned after inventory review), Pages enabled (Actions
  source), deploy dispatched and green. Live verification: full asset
  chain curled cold with no-cache (index/js/css/worker/wasm/fonts all 200,
  wasm as application/wasm) under the real /fourwise/ base; first-ever-
  visit cold load renders correctly; end-to-end wasm proof on the deployed
  artifact — human move played, engine replied with the honest partial
  badge, role-based control defaults live.

## PHASE 1 GATE RECORD (assembled 2026-07-28 — **SIGNED: owner ruled PASS
2026-07-28. Phase 1 is closed.**)

**Criterion 1 — every reference fixture returns its exact score: MET, on
native evidence, bridged — not re-measured — in wasm.** Evidence: the
completed local release run — all six Pons sets, 6,000/6,000 exact,
1,949 s, log preserved — verifier-audited in Wave 2 (four sets re-run
directly, two via the completed-run log); `engine/` byte-identical to that
verified state in every subsequent audit (git-diff-confirmed repeatedly);
debug suites + clippy green locally and on CI from a bare checkout.
**Stated plainly: this is a NATIVE binary measurement. The shipped
artifact is wasm compiled from the same source, and no 6,000-position run
has ever been executed in the wasm build.** What bridges the gap:
(a) the wasm surface is a thin wrapper over the identical solver source
with no conditional compilation of search logic; (b) Wave 3's
cross-environment check — one endgame position returning identical
best/scores/threats in native Rust, Node-loaded wasm, and a real Chrome
Web Worker; (c) live-deployed and on-device play behaving correctly.
That bridge is consistency sampling, not exhaustive re-verification.
CI evidence (verifier read the cancelled run's full log, not just its
status): before the 90-min timeout killed it, the bare-checkout runner
had confirmed on CURRENT code — 28/28 lib tests incl. the full
empty-board solve (365 s), 20/20 position tests, mirror + negamax
self-consistency, and FIVE of six fixture sets exact (5,000/6,000
positions: L3_R1, L2_R1, L2_R2, L1_R1, L1_R2). Zero failures anywhere;
Begin-Hard was mid-flight when cancelled. Precise residual: L1_R3's
1,000 positions are confirmed exact only on the Wave 2 build; on current
code they rest on position.rs/tt.rs being byte-identical since, plus the
verifier's full read of solver.rs's Wave 3 diff (budget wrapper provably
a no-op on the unbudgeted path every fixture uses) — inference, not
execution. A 240-min re-dispatch (run 30334738699) is executing; its
result is appended here when it lands, closing criterion 1's letter.

**Criterion 2 — four-seat combination test as amended (SPEC §1): MET.**
`seat.test.ts`: fixed literal engine input including a whole
AnalysisResult, four seats, hand-written per-seat expectations,
cross-grouped independence proofs (verdicts split A+D/B+C while colour
splits A+B/C+D), byte-identical engine inputs asserted against the
production call site (rebuilt after the verifier killed the decoy
stand-in). Verifier-confirmed in three separate audits. Live: owner's
on-device check #5 — wording flips correctly across all four seats.

**Criterion 3 — mid-game responsiveness as pinned: MET.** Definition
pinned in ROADMAP before any measurement existed. Desk half: worst case
39.1 ms across plies 15–25, with the committed throttle-probe honestly
establishing that CDP throttling does not constrain Workers (weakness on
the record). Deciding half: owner evidence, iPhone, Safari then Chrome —
ply-12+ analysis settles under a second on-device.

**Criterion 4 — keyboard-navigable, reduced-motion, one-handed portrait:
MET.** Wave 6a bullet-by-bullet audit with fixes (keyboard guard bug
found, fixed, regression-tested; 44 px targets; reduced-motion
hard-disable verified via emulated media; grayscale distinguishability;
no horizontal scroll 360–430 px), verifier PASS; owner on-device check
#3 — one-handed portrait usable, columns 1 and 7 reachable.

**Criterion 5 — deployed and loading from the GitHub Pages URL: MET.**
Full asset chain curled cold/no-cache (all classes 200, wasm served
`application/wasm`, /fourwise/ prefix load-bearing); first-ever-visit
cold load renders; end-to-end play on the deployed artifact (engine
reply, honest partial badge); owner: cold open clean on both mobile
browsers, and airplane-mode reload works offline.

**Known defects logged, owner-classified as post-gate (Phase 2):** engine
partial-play tactics at "Perfect" (SPEC §3.1 amended to
complete-shallow-at-cap), level-label honesty (§3.1), terminal-display
(§3.2).

**Orchestrator judgement: all five criteria MET. Gate recommendation:
PASS.** **Owner signature given 2026-07-28: PASS.**
**Criterion 1 residual CLOSED 2026-07-28 08:08 UTC: CI run 30334738699
(240-min re-dispatch) completed green — log read, not just status:
`test_l1_r3_begin_hard ... ok`, release suite 8/8 in 5,826 s, lib 28/28,
position 20/20, on current code from a bare checkout. All six fixture
sets are now execution-verified on current code; nothing in criterion 1
rests on inference any more.**
- **On-device evidence IN (owner, 2026-07-28, iPhone — Safari then
  Chrome, both clean): all six checks pass on the live URL.** Cold open →
  live board with engine move; ply-12+ analysis settles under a second
  (gate #3's on-device half SATISFIED); one-handed portrait usable,
  columns 1 and 7 reachable; mid-game relaunch restores board+seat in
  agreement, no re-ask; four seats flip wording correctly (gate #2 live);
  airplane-mode reload works offline.

## Post-gate findings (logged 2026-07-28 — NOT gate blockers, Phase 2 work)

1. **Engine plays into trivial double threats early-game at "Perfect"**
   (owner repro at move 8: ignored an open-ended three-across; screenshots
   on record). Root cause: SPEC §3.1's solved-subset-at-cap rule — a
   partial deep search misses tactics a complete shallow one cannot.
   SPEC amended: on cap expiry, play from a complete fixed-depth tactical
   search (no heuristic; horizon-as-draw). KNOWN DEFECT until Phase 2
   implements it (the opening book removes most of the exposure).
2. **Level label lies under partial play** — "Perfect" shown while moves
   are partial. SPEC §3.1 amended: the label must be qualified at its own
   surface when the level's defining computation didn't run.
3. **Finished games show "Still solving this column" ×7** under a win
   headline. SPEC §3.2 amended: terminal display beats analysis display.

## Ownership

| Agent | Model | Owns |
|---|---|---|
| main session (orchestrator) | Fable | architecture, delegation, gate judgement, this file |
| `rust-engine` | Sonnet | everything under `engine/` and `tools/` |
| `web-ui` | Sonnet | everything under `web/` |
| `verifier` | Sonnet, read-only | gate audits; runs before any wave or phase is declared done |
| `design-lead` | Opus, one-shot (done) | `docs/DESIGN-DIRECTION.md` only; runs headless via `claude -p --model opus` — the subagent model floor cannot be lifted mid-session |

## Phase 1 wave plan (HISTORICAL — all waves complete, gate signed)

Reconstructed from `docs/ROADMAP.md` + `docs/ENGINE.md` after the original plan
text was lost in a context handover. Kept as record of what each wave covered:

- **Wave 4 (complete — record)** (`web-ui`; design-lead already done), split in two, governed by
  the 2026-07-28 owner pins (SPEC §1 amended acceptance test, §3.1 level
  mechanics + engine-move-under-partial, §3.3 setup reconstruction in TS
  with fifth verdict, ENGINE.md stale-result discard):
  - **4a — game layer, test-first: COMPLETE, verifier PASS 2026-07-28.**
    Four-seat gate test written first (fail-first confirmed) against the
    amended assertion, extended to whole-AnalysisResult translation after
    owner review; seat model, verdict translation (colour-free by design),
    parity, levels (horizon clamp incl. boundary test), engine-move-under-
    partial, blunder "not evaluated" semantics, setup reconstruction
    (genuine memoized DFS; greedy counterexample tested) with all five
    verdicts incl. no-hint branch + round-trip property tests, stale-token
    discard with forced-race test. Two verifier rounds: three test-coverage
    findings (incl. a decoy-stand-in vacuous assertion) found, fixed,
    independently re-verified. 95 web tests + engine baseline green.
  - **4b — designed UI: COMPLETE, verifier PASS 2026-07-28.** Board, seat
    controls, three modes, history/keyboard, wired to 4a; 103 tests;
    in-browser check green (Play loop, both seat axes incl. engine
    auto-move on control handover, mode-switch preservation, Analyse gate,
    honest still-solving states, Setup editor). Verifier: owner override
    conformance verified, single-lamp rule structurally impossible to
    violate, design tokens byte-identical to §12, honesty paths verified to
    the DOM. Two items carried forward: (1) OWNER RULING NEEDED — default
    seat is red/red on first load, textually matching DESIGN-DIRECTION §5's
    forbidden "Red as a default" though the doc's own mockups depict
    exactly that state; moot after Wave 5 persistence except on first run.
    (2) Desktop rail (§8.4 best-first-after-reveal) not implemented —
    assigned to Wave 5 polish.
- **Wave 5** (`web-ui`): per-column analysis in plain language (the deeper
  panel beyond 4b's verdict strip), blunder flag UI (logic exists in
  blunder.ts), parity ruler scoped to single threats (logic in parity.ts),
  remaining `localStorage` persistence (game state + JSON export/import;
  seat slice landed early with the first-run prompt), desktop rail per
  DESIGN-DIRECTION §8.4 (Play ranked from start, Analyse re-sorts only
  after Show me — wording pre-verified against the §14.1 override).
- **Wave 6** (`web-ui` + `verifier` + owner), three parts, sharpened
  2026-07-28:
  - **6a — quality floor + perf smoke:** keyboard/a11y audit per SPEC §4/§6;
    mobile perf measured against gate #3 AS PINNED in ROADMAP (ply ≥ 12
    under 1 s on-device; below ply 12 "still thinking" is correct
    behaviour). Desk numbers via CPU-throttled headless Chrome are a smoke
    test only, bar deliberately tightened to 400 ms (throttling is a poor
    WASM proxy — bandwidth-sensitive 64 MB TT).
  - **6b — deploy:** Actions workflow (wasm-pack + vite + Pages, debug
    engine tests per push, 30-min release fixture run as manual dispatch);
    repo-public decision is DELIBERATE, not a switch-flip: history scanned
    clean 2026-07-28 (no secrets); going public exposes .claude/ (agents,
    settings), ORCHESTRATION.md (quota strategy), STATUS.md (decision
    history), CAMERA.md, OPPONENT-MODEL.md — owner reviews the inventory
    before the flip.
  - **6c — the gate:** verifier audits all five ROADMAP criteria with
    evidence on the DEPLOYED artifact; real-phone check including mobile
    Safari (Workers/wasm-init/localStorage quirks — everything so far is
    Chrome-only); then orchestrator judgement, then owner sign-off.

## Phase 2 wave plan (PLAN OF RECORD — owner-approved 2026-07-28, with
three rulings folded in)

Scope: ROADMAP Phase 2 (opening book) + the three post-gate defects
(SPEC §3.1 tactical fallback, §3.1 level-label honesty, §3.2 terminal
display). Owner rulings shaping this plan:

1. **Generation runs on the owner's machine, overnight, DETACHED** —
   `nohup`, progress to a log file, never inside a Claude Code session
   that can die and take hours of compute with it. (The 2-core GitHub
   runner took 90+ min on fixtures the M-series did in 32, and a
   multi-hour job risks the 6-hour job ceiling.) TT for the generation
   run goes WELL above 64 MB (one-off run, 24 GB machine; TT hit rate is
   the whole ballgame across tens of thousands of overlapping openings).
2. **Verification targets the write/read boundary, not the solver.**
   A cold-TT re-solve inside the generator only proves the solver agrees
   with itself — already fixture-proven. The bite risks are binary
   serialisation, mirror normalisation asymmetry between write and read,
   and key collisions. So: sampling must read the serialised file through
   `book.rs`'s REAL loader. Split across waves — Wave 7 generates and
   logs the sample set (≥1,000, seeded) with expected scores; Wave 8
   replays that sample through the loader and asserts agreement. Gate
   criterion 2's evidence spans both waves by design.
3. **The tactical fallback must be tested in its own use case.** Once the
   book lands it almost never fires in the opening — precisely where it
   was built for. Wave 8 requires explicit tests with the book ABSENT,
   plus a book-disabled flag kept permanently so the path can be
   exercised deliberately.

- **Wave 7 — book generator** (`rust-engine`): `tools/gen_book.rs` wired
  as a bin of the engine crate. Depth-8 enumeration (all reachable
  non-terminal positions, ply 0–8), exact solve each, mirror dedup
  (canonical = min(key, mirror-key), rule documented in ENGINE.md for
  Wave 8 to implement from the doc). Format decision (orchestrator):
  versioned header + sorted full-u64-key array + parallel i8 scores,
  binary-search lookup — no hashing, no truncated keys, killing the
  collision class outright. CLI: --depth/--out/--tt-mb/--verify-sample/
  --seed/--resume; resumable via checkpoint, kill-9-safe. Sample artifact
  (moves + key + score, JSON in engine/tests/fixtures/) records MOVE
  SEQUENCES so Wave 8 recomputes keys independently. Done = tests +
  clippy clean + depth-4 end-to-end rehearsal + independent brute-force
  enumerator cross-check at small depth. Then, post-verifier: the
  detached depth-8 overnight run per ruling 1.
- **Wave 8 — engine integration + tactical fallback** (`rust-engine`):
  `engine/src/book.rs` loader (validate, mirror-normalised lookup),
  consulted before search; wasm export to inject book bytes; corrupt or
  absent book → plain search, never a panic or user-visible error; replay
  Wave 7's sample file through the real loader (gate #2 evidence);
  amended §3.1 tactical fallback (complete fixed-depth search on cap
  expiry) with book-absent tests + permanent book-disabled flag.
- **Wave 9 — web integration + honesty fixes** (`web-ui`): fetch book on
  load without blocking first paint, hand bytes to the worker,
  fetch-failure degrades silently to plain search (tested); level-label
  qualification at its own surface (§3.1); terminal-display-beats-
  analysis-display (§3.2).
- **Wave 10 — gate** (`verifier` + owner): ROADMAP Phase 2 criteria on
  the deployed artifact — openings < 50 ms, sample verification evidence
  (Waves 7+8), graceful degradation — plus the three known defects
  confirmed closed.

Phase 3's wave breakdown gets written here when Phase 2's gate passes.
Phase 4 remains unsanctioned (`docs/ROADMAP.md`).
