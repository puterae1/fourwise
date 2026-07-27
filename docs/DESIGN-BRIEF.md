# DESIGN BRIEF

The owner chose not to prescribe a look. Make a real decision and justify it. Present
the direction before building it.

## The subject

A physical Connect 4 set on a bar table. Plastic discs, a black plastic frame, warm
light coming through the empty holes from behind. Two people playing while drinking.
That is the actual context in which this problem arose and it is where the visual
language should come from — not from generic "chess engine" or "analytics dashboard"
territory.

## The job of the interface

One job: **the user glances at their phone between moves and instantly knows which
column to play and why.**

Everything follows from that. It is used standing up, one-handed, in poor light,
under mild time pressure, possibly after a drink. It is not a research tool and must
not read as one.

## Constraints

Real constraints, not stylistic preference:

- The board is the hero. It should occupy most of a phone viewport at a glance.
- Seven column verdicts must be readable without zooming or scrolling.
- Red and yellow are fixed by the physical game. They are the palette's spine.
  Everything else must coexist with them without competing.
- The best move must be identifiable in under a second.
- Colour is never the sole carrier of meaning.

## What to avoid

Do not produce the default AI-design look. Specifically not:

- Cream background, high-contrast serif display, terracotta accent
- Near-black background with a single acid-green or vermilion accent
- Broadsheet layout with hairline rules and zero border-radius

The last two are especially tempting here — a dark board and a bright accent is the
obvious move for a game analysis tool, which is exactly why it is worth resisting.
Note that the reference artifacts the owner has already seen used a dark bar-lit
treatment. Do not simply copy it; the owner declined to pick it.

## Deliverable before code

A short written direction covering:

- **Palette** — 4 to 6 named hex values, and how each relates to the subject
- **Type** — a display face and a body face, plus a utility face if data density
  needs one. Pair them deliberately.
- **Layout** — one paragraph plus an ASCII wireframe for the phone view and the
  desktop view
- **Signature** — the one element this tool will be remembered by

Then critique your own direction against this brief. If any part of it is what you
would produce for any game-analysis tool rather than for this one specifically,
revise it and say what changed.

## Copy

Plain language, from the user's side of the screen.

- "You win in 11 moves" — not "Score: +6"
- "That threw away a win. Column 4 held it." — not "Suboptimal move detected"
- "Yellow has 3 discs, red has 5 — impossible." — not "Invalid position"

Verbs describe what happens. A label labels. Nothing does double duty.
