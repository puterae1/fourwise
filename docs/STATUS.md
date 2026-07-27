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

## In flight

Nothing. No agents running.

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

- **Wave 2** (`rust-engine`): solver — negamax, alpha-beta, immediate-win /
  avoid-loss checks, centre-out ordering, transposition table, iterative
  deepening with null window. Download Pons reference fixtures into
  `engine/tests/fixtures/` and wire `engine/tests/reference.rs`. Also the
  engine-side seat proof: colour-independence (negation) and mirror-score
  tests. Gate contribution: every fixture exact, empty board < 1 s native.
- **Wave 3** (`rust-engine` then `web-ui`): WASM boundary — wasm-bindgen
  exports (`analyse` / `best_move` / `legal_moves`), `wasm-pack` build into
  `web/src/engine/pkg/`, Vite + React scaffold, Web Worker wrapper and typed
  TS wrapper. `sideToMove` stays `'first' | 'second'`, never a colour.
- **Wave 4** (`web-ui`; design-lead already done): board rendering per
  `docs/DESIGN-DIRECTION.md`, seat controls, the three modes (Play / Analyse /
  Setup), game state + history. Includes the four-seat-combination test
  (gate #2): identical evaluation across all four seat combinations,
  differing only in presentation.
- **Wave 5** (`web-ui`): per-column analysis in plain language, blunder flag,
  parity ruler scoped to single threats, `localStorage` persistence.
- **Wave 6** (`web-ui` + `verifier`): accessibility (keyboard, reduced motion,
  one-handed portrait), mobile performance (< 1 s mid-game analysis on a
  mid-range phone), GitHub Actions → Pages deploy. Then a full `verifier`
  audit of all five gate criteria; orchestrator judges the gate.

Phases 2–3 wave breakdowns get written here when Phase 1's gate passes.
Phase 4 remains unsanctioned (`docs/ROADMAP.md`).
