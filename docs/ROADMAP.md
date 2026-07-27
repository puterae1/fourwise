# ROADMAP — phases and gates

Four phases. Each ships something usable on its own. **A phase does not begin until
the previous phase passes its gate.** If a later phase looks quick and tempting,
that is the drift this document exists to prevent. Ask the owner.

---

## Phase 1 — Engine and seat model

The whole reason for the project. Ships alone as a genuinely better tool than the
reference site.

**Build**
- Rust bitboard `Position` with full unit tests
- Negamax + alpha-beta + transposition table + centre-out ordering
- WASM bindings, Web Worker wrapper
- React board, seat controls, three modes (Play / Analyse / Setup)
- Per-column analysis in plain language
- Blunder flag after each human move
- Parity ruler, correctly scoped to single threats
- `localStorage` persistence
- GitHub Actions → GitHub Pages

**Gate — all must hold**
1. Every reference test fixture returns its exact expected score.
2. The four-seat-combination test passes **as amended in SPEC §1
   (2026-07-28)**: one engine result, four seats, four different
   presentation outputs, each independently correct against hand-written
   expectations, with engine inputs byte-identical across seats. (The
   original wording — "identical engine evaluation across all four" — is
   structurally guaranteed, cannot fail, and proves nothing; seat is not an
   engine input.)
3. Any reachable mid-game position analyses in under 1s on a mid-range phone.
4. Keyboard-navigable, reduced-motion respected, usable one-handed in portrait.
5. Deployed and loading from the GitHub Pages URL.

Do not proceed until all five hold. Especially 1 and 2.

---

## Phase 2 — Opening book

**Build**
- `tools/gen_book.rs`, depth 8, mirror-deduplicated
- Binary format, static asset, fetched on load
- Book consulted before search; graceful fallback if the fetch fails

**Gate**
1. Opening moves return in under 50 ms.
2. Every book entry matches a full search of the same position. Verified by sampling
   at least 1,000 entries, not by assumption.
3. Book absent or corrupt degrades to plain search with no user-visible error beyond
   slower first moves.

---

## Phase 3 — Game log and opponent model

**Build**
- Record real games: seat, full move sequence, outcome, date, opponent label
- Post-game review: step through with evaluation at every ply, blunders marked
- Heuristic opponent model — see `docs/OPPONENT-MODEL.md`
- Predicted-move display with confidence, alongside the optimal move
- JSON export and import

**Gate**
1. At least 20 real games logged before the model is shown to the user at all.
   Below that the predictions are noise and would actively mislead.
2. Predicted move and optimal move are always visually distinct. Never conflated.
3. Model confidence is displayed honestly, including when it is low.

**Explicit warning for the implementer:** do not reach for machine learning here.
With tens of games, a weighted heuristic with Bayesian count updates is both more
accurate and more interpretable. A neural net trained on this data learns to predict
optimal play, which is precisely the opposite of the goal.

---

## Phase 4 — Camera capture

**Specced in `docs/CAMERA.md`. Not sanctioned. Do not start.**

This phase is roughly the size of Phases 1–3 combined and depends on physical
conditions — lighting, angle, board colour — that cannot be tested from the repo.
It is documented so the idea is not lost, not because it is queued.

Requires explicit written approval from the owner referencing this line before any
work begins, including scaffolding, dependency installation, or camera permissions
in the manifest.

---

## Out of scope, permanently

Listed so they do not get re-litigated:

- Any backend, database, or account system
- Multiplayer or networked play
- Board sizes other than 7×6
- Native mobile apps
- Electron or any desktop wrapper
- Analytics or telemetry of any kind
