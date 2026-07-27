# fourwise — handover package

Build a Connect 4 analysis tool that fixes what `connect4.gamesolver.org` gets wrong.

## The problem being solved

gamesolver.org is an excellent engine wrapped in a UI that hardcodes one assumption:
**you are red and you move first.** In a real game across a table, colour and turn
order are independent — you might be yellow moving first, or red moving second.
The existing tool cannot express that, so its scores are silently wrong for half of
all real games.

That is the entire reason this project exists. Everything else is secondary.

## What is in this package

| File | Purpose |
|---|---|
| `CLAUDE.md` | Drop into repo root. Persistent context for Claude Code. |
| `docs/SPEC.md` | Functional spec. The seat model, modes, score display. |
| `docs/ENGINE.md` | Rust bitboard solver — representation, search, TT, book. |
| `docs/DESIGN-BRIEF.md` | Visual brief. Deliberately does not prescribe a look. |
| `docs/ROADMAP.md` | Four phases with gates. **Read before starting any work.** |
| `docs/OPPONENT-MODEL.md` | Phase 3. Logging real games, modelling her play. |
| `docs/CAMERA.md` | Phase 4. Specced, not sanctioned. |
| `docs/ORCHESTRATION.md` | Model routing, quota strategy, delegation protocol. |
| `.claude/agents/*.md` | The seven subagent definitions. |
| `.claude/settings.json` | Subagent model floor and nesting cap. |

## How to start

Copy everything to the repo root, keeping the `.claude/` and `docs/` structure:

```bash
mkdir fourwise && cd fourwise
git init
# copy CLAUDE.md, README.md, docs/, and .claude/ into place
claude --model fable
```

Then enter Plan Mode and say:

> Read CLAUDE.md, docs/ROADMAP.md, and docs/ORCHESTRATION.md. Propose a Phase 1
> implementation plan and say which agent gets each task. Do not write code
> until I approve the plan.

Verify the routing is live before doing real work — ask for a trivial task and
confirm in `/tasks` that it ran on Sonnet, not Fable.

## Model routing

The main session runs on Fable and does architecture, delegation, and gate
judgement. Everything else runs on Sonnet. `design-lead` runs once on Opus.

`.claude/settings.json` sets `CLAUDE_CODE_SUBAGENT_MODEL=sonnet`, which overrides
every agent file and guarantees no subagent reaches Fable. It is baked into the
session env at launch and cannot be lowered mid-session — which also means it
cannot be accidentally lifted. It overrides `design-lead`'s `model: opus` too;
the sanctioned escape for that one run is a headless `claude -p --model opus`
from the shell, never a settings edit. See `docs/ORCHESTRATION.md`.

## Non-negotiables

1. Phase gates are real. Do not start Phase N+1 before Phase N passes its gate.
2. The seat model in `docs/SPEC.md` is the spec. If an implementation makes
   colour and turn order interdependent anywhere, it is wrong.
3. The engine must be exactly correct. A solver that is fast and wrong is worthless.
   Correctness is proven against the reference test sets, not by eyeballing.
