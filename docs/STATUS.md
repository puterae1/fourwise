# STATUS — source of truth

> Updated by the orchestrator at the end of every wave. If this file and the
> conversation disagree, this file wins. Read `docs/ROADMAP.md` for the phase
> gates and `docs/ORCHESTRATION.md` for who runs on what.

**Last updated:** 2026-07-27 (Wave 1 complete; design direction done)

## Current phase

**Phase 1 — Engine and seat model.** No gate criteria met yet.

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

## In flight

Next: **Wave 5b — plumbing**: game-state persistence, versioned JSON
export/import (envelope `{version, exported, games[]}`, three distinct
import rejections), desktop rail per §8.4 (re-sorts on REVEAL, whenever
reveal happens, not on mode), lamp-reveal DOM test, corrupt-stored-seat
test, stale calibration comment.

## Ownership

| Agent | Model | Owns |
|---|---|---|
| main session (orchestrator) | Fable | architecture, delegation, gate judgement, this file |
| `rust-engine` | Sonnet | everything under `engine/` and `tools/` |
| `web-ui` | Sonnet | everything under `web/` |
| `verifier` | Sonnet, read-only | gate audits; runs before any wave or phase is declared done |
| `design-lead` | Opus, one-shot (done) | `docs/DESIGN-DIRECTION.md` only; runs headless via `claude -p --model opus` — the subagent model floor cannot be lifted mid-session |

## Remaining waves — Phase 1

Reconstructed from `docs/ROADMAP.md` + `docs/ENGINE.md` after the original plan
text was lost in a context handover. Owner may re-cut these.

Waves 3 and 4 are complete (see Done). Remaining:

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
- **Wave 6** (`web-ui` + `verifier`): accessibility (keyboard, reduced motion,
  one-handed portrait), mobile performance (< 1 s mid-game analysis on a
  mid-range phone), GitHub Actions → Pages deploy. Then a full `verifier`
  audit of all five gate criteria; orchestrator judges the gate.

Phases 2–3 wave breakdowns get written here when Phase 1's gate passes.
Phase 4 remains unsanctioned (`docs/ROADMAP.md`).
