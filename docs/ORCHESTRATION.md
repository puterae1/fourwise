# ORCHESTRATION — Fable on top, Sonnet underneath

## The goal

Max subscription, separate quota buckets per model tier. Fable's bucket is the
scarce one. Every Fable token spent on work Sonnet could have done is a token not
available for the work only Fable should do.

So: **Fable decides, Sonnet executes, Opus reviews when judgement is needed.**

This is not a cost-reduction strategy — the subscription is flat. It is a quota
allocation strategy, and the two have opposite designs. Do not optimise for total
tokens; optimise for which bucket they come from.

## What actually belongs on Fable

Short list, and it should stay short:

- The seat-model architecture and the layer boundaries it depends on
- Deciding *what* to delegate and writing the delegation prompt
- Resolving contradictions between the specs
- Judging whether a phase gate has genuinely passed
- Anything where a wrong decision costs a rewrite

Everything else — writing the bitboard, wiring React state, running tests, chasing a
failing fixture, styling a component — goes to Sonnet. It is not close.

---

## The leak, and how the config closes it

**Subagents default to `model: inherit`.** With the main session on Fable, any
subagent lacking an explicit `model` field runs on Fable. So do the built-in agents:

| Agent | Default | Problem |
|---|---|---|
| `Explore` | inherits main conversation | Every codebase search burns Fable quota |
| `Plan` | inherits main conversation | Plan-mode research burns Fable quota |
| `general-purpose` | inherits main conversation | The catch-all burns Fable quota |
| Forks (`/subtask`) | same model as main session | Always Fable. No override exists. |

Three defences, in order of importance:

1. **Every agent file declares `model:` explicitly.** No exceptions, no `inherit`,
   even where inherit would happen to be right today.
2. **Override the built-ins.** A project subagent named `Explore` replaces the
   built-in and keeps its own `model` field. `.claude/agents/Explore.md` in this
   package pins it to Sonnet. Do the same for `Plan` and `general-purpose`.
3. **Do not use `/subtask` while on Fable.** A fork inherits the main session's
   model with no way to override it. It is the single most expensive operation
   available. Use a named subagent instead.

### The override that beats all of them

`CLAUDE_CODE_SUBAGENT_MODEL` sits at the top of the resolution order — above the
per-invocation parameter and above frontmatter. Set it and every agent file's
`model` field is ignored.

This cuts both ways. As a safety net it is excellent:

```bash
CLAUDE_CODE_SUBAGENT_MODEL=sonnet claude --model fable
```

Now no subagent can reach Fable regardless of what its file says. Use this.

Two facts about the floor, both proven empirically (2026-07-27, at the cost of
two wasted Sonnet runs):

1. **It is baked at session launch.** Editing `settings.json` mid-session does
   nothing, and the per-invocation `model:` parameter loses to it. The floor
   cannot be lowered while a session is running — at all. An earlier version of
   this document said to comment the line out for the design-lead run and
   restore it. That does not work.
2. **That is better than intended.** A guard that cannot be lifted mid-session
   also cannot be accidentally lifted. Leave it set permanently.

The one agent that must beat the floor — `design-lead`, which needs Opus — does
not run as a subagent at all. The sanctioned escape is a headless run from the
shell:

```bash
claude -p "<full delegation prompt>" --model opus \
  --allowedTools "Read,Write,Grep,Glob" --output-format json
```

The headless main loop is not a subagent, so the floor never applies to it.
Afterwards, verify the model from the JSON `modelUsage` keys (or grep the run's
transcript for `"model":`) — never trust the label.

---

## The roster

| Agent | Model | Writes? | Job |
|---|---|---|---|
| *(main session)* | Fable | — | Architecture, delegation, gate judgement |
| `rust-engine` | Sonnet | yes | Bitboard, search, TT, WASM bindings |
| `web-ui` | Sonnet | yes | React, state, WASM glue, styling |
| `verifier` | Sonnet | **no** | Runs tests, reports. Cannot touch code. |
| `design-lead` | Opus | yes (docs only) | One-shot visual direction |
| `Explore` | Sonnet | no | Built-in override. Quota guard. |

`design-lead` is the one deliberate step up from Sonnet. It runs once, produces a
written direction, and stops — a small, bounded spend on a decision that is hard to
undo later. It never runs on Fable because visual judgement is not what Fable's
quota is scarce for.

`verifier` cannot write. That is the point. A verifier that can fix what it finds
will fix what it finds and report success, and you lose the independent signal.

---

## Delegation protocol

A subagent starts with a fresh context window. It does not see the conversation, the
files already read, or the decisions already made. **The delegation prompt is its
entire briefing.** Most multi-agent failures are underspecified delegation prompts,
not model limitations.

Every delegation from the orchestrator must carry:

1. **Which spec governs** — the exact file path, e.g. `docs/ENGINE.md §Search`
2. **The precise deliverable** — file paths to create or modify
3. **The definition of done** — the command that must pass, e.g. `cargo test`
4. **Any decision already made** that the subagent would otherwise re-litigate
5. **What not to touch** — adjacent files, phases, or concerns that are out of scope

Bad: *"Implement the solver."*

Good: *"Implement `engine/src/solver.rs` per `docs/ENGINE.md` §Search. Negamax with
alpha-beta and centre-out ordering `[3,2,4,1,5,0,6]`. Transposition table is a
separate task — leave `tt.rs` alone. Done when `cargo test` passes the position unit
tests. Do not modify `position.rs`; its API is settled."*

The second one costs Fable more tokens to write and saves an entire failed
Sonnet run. That trade is always worth it.

## Return protocol

The orchestrator's context is the scarce resource. Every agent's system prompt
instructs it to return a short structured summary, never a transcript.

Required shape:

```
DONE / BLOCKED / PARTIAL
Files changed: <paths>
Verification: <command run, result>
Decisions I made that you should know about: <or "none">
Blockers: <or "none">
```

If an agent returns a wall of code or narration, the orchestrator should re-delegate
with a stricter prompt rather than reading it. Reading it is the expensive mistake.

---

## Parallelism

Independent work fans out. Dependent work does not.

Safe to parallelise:
- `rust-engine` on the solver while `design-lead` produces the visual direction
- `verifier` on the current build while `web-ui` starts the next component

Never parallelise:
- Two agents writing to the same file
- Anything against the seat model before it is settled and tested

Limits worth knowing: 20 concurrent subagents, 200 per session, nesting three deep
by default. None of these should bind on this project. If you hit them, the task
was decomposed wrongly.

Use `isolation: worktree` when two write-capable agents must run at once. It gives
each an isolated checkout and avoids the merge mess.

## Session hygiene

- Run plan mode with the `Explore` override active, or the research burns Fable.
- `/clear` between phases. A stale context costs Fable tokens on every subsequent turn.
- Check `/tasks` before spawning more. Finished agents linger in the list.
- If the orchestrator starts writing code itself, stop it. That is the failure mode
  this whole arrangement exists to prevent.
