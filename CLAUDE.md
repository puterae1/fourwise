# connect4-lab

A Connect 4 solver and trainer. Rust engine compiled to WebAssembly, React front end,
static deploy to GitHub Pages. No backend, no server, no database.

## Why this exists

`connect4.gamesolver.org` hardcodes "user is red and moves first". Real games do not
work that way — colour and turn order are independent. This tool models them
separately and reports every score from the user's actual seat.

**If any code makes colour imply turn order, or turn order imply colour, that code is
wrong.** This is the single most important invariant in the project.

## Stack

- **Engine:** Rust, bitboard, negamax + alpha-beta, compiled with `wasm-pack`
- **Front end:** React + TypeScript, Vite
- **Styling:** plain CSS with custom properties. No Tailwind, no component library.
- **Deploy:** GitHub Actions → GitHub Pages, static only
- **Tests:** `cargo test` for the engine, `vitest` for the UI

## Layout

```
engine/           Rust crate, wasm-bindgen exports
  src/
    position.rs   bitboard, move gen, legality
    solver.rs     negamax, alpha-beta, iterative deepening
    tt.rs         transposition table
    book.rs       opening book loader
    lib.rs        wasm-bindgen surface
  tests/          correctness suites (see docs/ENGINE.md)
web/              React app
  src/
    engine/       wasm bindings + typed wrapper
    game/         seat model, game state, history
    ui/           board, controls, analysis panel
tools/
  gen_book.rs     offline opening-book generator
docs/             the specs. Read them.
```

## Orchestration

This session runs on Fable. **Fable decides, Sonnet executes.** Read
`docs/ORCHESTRATION.md` before delegating anything.

The short version:

- Fable's job is architecture, delegation, and judging phase gates. Not writing code.
  If you find yourself implementing, delegate instead.
- `rust-engine` and `web-ui` (Sonnet) write the code. `verifier` (Sonnet, read-only)
  checks it. `design-lead` (Opus, one-shot) sets the visual direction.
- Subagents default to `model: inherit`. Every agent file here declares its model
  explicitly, and `.claude/settings.json` sets `CLAUDE_CODE_SUBAGENT_MODEL=sonnet`
  as a hard floor. The floor is baked into the session env at launch and cannot be
  lowered mid-session at all — by design, since that also means it cannot be
  accidentally lifted. The one sanctioned exception, the single `design-lead` run
  (it must reach Opus), runs as a headless `claude -p --model opus` from the
  shell, never as a subagent. See `docs/ORCHESTRATION.md`.
- **Never use `/subtask`.** A fork inherits the main session's model with no
  override, so it always runs on Fable.
- Delegation prompts must carry: governing spec path, exact deliverable, the command
  that defines done, decisions already made, and what not to touch. A subagent sees
  nothing but its prompt.
- Agents return a structured summary, never a transcript. If one returns a wall of
  code, re-delegate with a stricter prompt rather than reading it.

## Working agreement

- **Plan before building.** Use Plan Mode for anything touching the engine or the
  seat model. Show the plan, wait for approval.
- **Phase gates are hard.** See `docs/ROADMAP.md`. Do not begin a later phase because
  it seems easy or convenient. Ask.
- **No scope drift.** Camera capture is Phase 4 and is not sanctioned. Do not add
  OpenCV, do not add camera permissions, do not scaffold "for later".
- **Correctness before speed.** Get the engine passing the reference test sets, then
  optimise. Never the other way round.
- **No placeholder data.** If a value is unknown, the UI says so. Never invent a score.

## Commands

```bash
# engine
cd engine && cargo test
cd engine && wasm-pack build --target web --out-dir ../web/src/engine/pkg

# web
cd web && npm run dev
cd web && npm run build
cd web && npm test

# opening book (Phase 2 only)
cargo run --release --bin gen_book -- --depth 8 --out web/public/book.bin
```

## Owner context

The user is a technical project manager, not a Rust specialist. Explain engine
decisions in plain terms when they affect behaviour. Do not explain React basics.
Be direct about tradeoffs. If a request is a bad idea, say so and propose the
better version before writing anything.
