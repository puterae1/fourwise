# DESIGN DIRECTION

Governing brief: `docs/DESIGN-BRIEF.md`. Functional surfaces: `docs/SPEC.md`.
This document is the source of truth for visual decisions. An implementer should be
able to build from it without asking. Where it gives a hex value or a token, use that
value — do not substitute.

---

## 1. Thesis

**Hue belongs to the players. Light belongs to the answer.**

Red and yellow are the two people at the table. They are the only saturated hues on
screen and they mean nothing except *whose disc this is*. No third hue is ever
recruited to say "good move" or "bad move" — the moment green means "win", red is doing
two jobs and the board lies to you at a glance.

Quality is carried by **light and form** instead. The best column is lit from behind,
the way the empty holes of a real Connect 4 frame glow when there's a lamp on the far
side of the table. Verdicts encode win/draw/loss by fill treatment and bar height, never
by colour. Everything the player needs in one second is the brightest thing on screen;
everything else is quiet, matte and cool.

The board is a heavy dark slab sitting on a bright page. The page is the room; the board
is the object. That inversion is the whole look.

---

## 2. Where it comes from

The physical set: a black moulded frame, thick enough to stand on its own, with glossy
injection-moulded discs that catch a hard highlight along the top edge. The empty holes
are not "background" — they are holes, and you see the dark room through them. Plastic
throws short, tight shadows and has a hard bottom ledge, not a soft diffuse drop.

Three things are lifted directly:

| The object | The interface |
|---|---|
| Light through the empty holes | The signature (§9) — the best column's wells go warm |
| Hard ledge under the frame | Elevation is a solid 2–3px step, then a tight shadow |
| Moulded gloss on a disc | `inset` highlight top, `inset` shade bottom — never a gradient fill |

Deliberately **not** lifted: the bar, the gloom, the wood. The owner declined a dark
bar-lit treatment. The set is on a bright table here, not in a dark room.

---

## 3. Palette

Six named colours. Neutrals are one ramp between Kiln and Frame. Nothing else exists.

### 3.1 The six

**Kiln — `#E9ECEF`**
Cool light grey with a faint blue cast: unpainted ABS plastic under daylight, not paper.
It is the page. Chosen cool specifically so that warm lamplight (§9) reads as *light*
against it rather than as another beige.

**Frame — `#232830` frame / `#12161A` well**
The black plastic grid. Two steps, because a real frame and a real hole are not the same
black — the hole is darker, and that difference is what makes the board read as having
depth instead of as a printed grid. `Frame` is also the primary text colour. Nothing on
this page is pure black.

**Red — `#C42B21`**
The red disc. Pulled slightly darker and cooler than the toy's true red so it clears 3:1
against an empty well, which the toy's brighter red does not.

**Yellow — `#F5B301`**
The yellow disc. Deep golden rather than lemon — moulded yellow plastic is dense and
slightly orange, and a lemon yellow would blow out against Kiln.

**Lamp — `#FFE7C2` core / `#FF9F45` rim**
The light behind the board. Core fills the lit column's wells; rim is the bloom on the
frame webbing around them and the caret above the column. The only warm element in the
interface, and it appears in exactly one place at a time.

**Signal — `#0E5C6B`**
Deep teal-blue for focus rings, links, selection and the parity ruler. It is the third
colour of the toy world (the classic frame is blue), it sits far from both disc hues for
every common colour-vision type, and it is desaturated enough that it never competes
with Lamp for attention.

### 3.2 Neutral ramp

Interpolated Kiln → Frame. Use these steps; do not invent others.

| Token | Hex | Use |
|---|---|---|
| `--c-n-0` | `#F6F8F9` | Raised surface: verdict strip, sheets, cards |
| `--c-n-1` | `#E9ECEF` | Kiln — the page |
| `--c-n-2` | `#D6DBE0` | Inactive fill, disabled chip |
| `--c-n-3` | `#C2C9D0` | Separator, hover ring |
| `--c-n-5` | `#5A626B` | Secondary text |
| `--c-n-7` | `#333A43` | Strong secondary text |
| `--c-n-9` | `#232830` | Frame — primary text |

Separate regions with a **surface step and space**, not with rules. At most two 1px
separators may be visible at once. There are no hairline column rules anywhere.

### 3.3 Contrast, checked

| Pair | Ratio | Verdict |
|---|---|---|
| Frame text on Kiln | 12.6:1 | pass |
| `--c-n-5` on Kiln | 4.8:1 | pass — this is the body-text floor |
| Signal on Kiln | 6.1:1 | pass |
| Red disc on empty well | 3.2:1 | pass, large graphic |
| Yellow disc on empty well | 8.8:1 | pass |
| Lamp core on empty well | ~15:1 | the signature — unmissable |
| **Red disc vs yellow disc** | **3.06:1** | **not sufficient alone — see §4** |

---

## 4. Non-colour signals

Colour is never the only carrier. Three mechanisms, all on by default.

**Disc markers — on by default, toggleable off.**
Red and yellow separate at only 3.06:1, and a protanope sees the red disc as a dark mass
barely distinct from an empty well. So every disc carries a debossed mark, and the two
marks differ in *shape and polarity*:

- **Red disc:** a light ring — `rgba(255,255,255,.55)`, 52% of disc diameter, 2px stroke.
- **Yellow disc:** a dark dot — `rgba(0,0,0,.45)`, 28% of disc diameter, filled.

Both read as moulded detail, so leaving them on costs nothing visually. The toggle exists
because the spec requires it, not because the default is a compromise. The light ring also
solves the protan case outright: a red disc always carries something bright, an empty well
never does.

**Verdict is form, never hue.** Win = solid fill. Draw = 45° hatch at 50% coverage. Loss =
2px outline with a transparent interior. All three in `--c-n-9` on `--c-n-0`. Bar *height*
encodes how fast the result arrives. A number sits under every bar.

**The lit column is also the brightest thing, the only caret, and the only inverted verdict
cell.** Four redundant signals for the single most important piece of information on screen.

**Grayscale test.** Print the screen in black and white. The lit column must still be
obvious, the win/draw/loss bars must still be distinguishable, and red must still be
tellable from yellow. If any of those fails, the implementation is wrong.

---

## 5. The seat rule (visual) — non-negotiable

Colour and turn order are independent (`docs/SPEC.md` §1, `CLAUDE.md`). The interface must
never imply otherwise, including by accident of layout.

**Forbidden**

- Any fixed left-to-right or top-to-bottom ordering of red-then-yellow **in a
  sequence-bearing context** — anywhere the two sides are listed as sides, in move records,
  in results and rankings, in exports, or in any sentence naming both. In those places
  ordering is read as who-goes-first or who-matters-more, and it implies sequence.
  Option-enumeration controls are exempt; see the amendment at the end of this section.
- A single combined control that sets both the user's colour and who moves first.
- Red as a default, a first item, a primary colour, or the colour of any UI chrome.
- A turn indicator drawn *inside* a colour swatch.

**Required**

- Two separate controls, visually parallel, equal weight, on one row:
  `You are [ ● Red | ○ Yellow ]` and `[ ● Red | ○ Yellow ] moves first`. Each is an
  independent segmented control. Neither changes the other. Both are always visible in
  every mode.
- Anything that lists the two sides orders them by **role** — You, then Opponent — with
  colour as a property of the row, never the sort key.
- Every verdict sentence is phrased from the user's seat regardless of whose turn it is:
  "You win in 11." / "She wins in 9." Never "Red wins in 9."
- Whose turn it is is shown by a **caret in the frame above the board**, tinted with that
  side's hue. Position carries "this is a turn indicator"; hue carries "whose".
- On seat change the disc colours swap in place, with no re-layout and no animation that
  suggests a reset. The position is unchanged and must look unchanged.

If a component can only be built by assuming red moves first, the component is wrong.

**Amendment — option-enumeration controls are exempt (owner ruling, final).**

As first written, this section contradicted itself. The Forbidden list banned *any* fixed
red-then-yellow ordering, and two bullets later the Required list drew the seat controls as
`You are [ ● Red | ○ Yellow ]` — red first. Both cannot stand. The app's colour pickers
followed the Required depiction and were duly flagged against the Forbidden bullet by audit.
The contradiction was mine, in the original draft; it is resolved here rather than quietly
patched, so that anyone reading the Forbidden bullet's new scoping knows why it is scoped.

**The ruling: pickers are exempt.** A *segmented picker that enumerates the two colours as
the available choices* — the two seat controls, the Setup `PLACING` control, and anything
later built to the same pattern — may present them in a fixed `Red | Yellow` order, and that
order does not violate the bullet above. Three reasons, all of which hold only for
option-enumeration:

- **A picker's order carries no sequence meaning.** Its two segments are the answer set to a
  question, not two sides being listed in an order. Nothing about `[ ● Red | ○ Yellow ]`
  asserts that red goes first — the control immediately beside it is the one that says who
  goes first, and it is independently set. The reading "left segment = first player" is not
  available because the segments are alternatives, not a sequence.
- **Some order is physically unavoidable.** A two-option control has to draw one segment
  before the other. Unlike a list of the two sides — which can be ordered by role, You then
  Opponent, per the Required list — an enumeration of colours has no non-colour key to sort
  by. The bullet as originally written was therefore unsatisfiable here.
- **Per-seat reordering would break a rule that matters more.** Flipping the segments to put
  the user's colour first would re-lay-out the controls on every seat change, which the last
  Required bullet forbids outright: on seat change, nothing re-lays out. A stable order is
  what makes a seat change look like the position-preserving swap it is.

What is *not* exempt, and still forbidden: ordering the two sides red-then-yellow in the
verdict rail, the move list, exports, the parity caption, results, or any sentence naming
both. Those are sequence-bearing and the original bullet governs them unchanged. The
exemption is for controls that offer the colours as choices, and for nothing else.

The rest of §5 stands as written. In particular red is still never a default — the picker's
left segment is a position, not a preselection, and the first-run prompt (§8) ships with
neither colour selected on either control.

---

## 6. Typography

### 6.1 The pairing

**Display — Archivo** (variable, `wght` 400–900, `wdth` 62–125). Set wide and heavy:
`wdth 110`, `wght 700–800`. A grotesque drawn for signage; at expanded widths and heavy
weights it reads like the stubby moulded lettering on a game box, and it holds its shape
at small sizes in low light. Used for: the headline sentence, big numerals, mode labels,
column numbers.

**Body — Instrument Sans** (variable, `wght` 400–700). Humanist grotesque, tall x-height,
naturally compact. Used for everything else.

**Why this pair and not another.** The contrast between them is **width, not
style-category**. Both are grotesques, so the page stays one material — plastic, not a
magazine. Archivo goes wide and heavy where it has to shout; Instrument Sans stays narrow
and even where it has to be read. The default move here would be a high-contrast serif
display over a neutral sans, which imports an editorial voice this tool has no use for.

**No third face.** Data density does not warrant a monospace: raw scores are a secondary
toggle, not a table. Numbers use `font-variant-numeric: tabular-nums` on both faces, which
is enough for a 7-cell strip and a move list. A mono face would also drag the whole thing
toward "research tool", which the brief rules out.

Self-host both as variable `woff2` under `web/public/fonts/`. No CDN — the deploy is
static and must work offline.

### 6.2 Scale

Mobile-portrait values; desktop overrides in brackets where they differ.

| Token | Face / weight / width | Size / line-height | Tracking | Use |
|---|---|---|---|---|
| `--t-display` | Archivo 800 / wdth 110 | 40 / 0.95 [52] | -0.02em | Headline verdict sentence |
| `--t-numeral` | Archivo 800 / wdth 110 | 28 / 1.0 [32] | -0.01em | Moves-to-result numerals |
| `--t-title` | Archivo 700 / wdth 100 | 20 / 1.2 | -0.01em | Sheet and section titles |
| `--t-label` | Archivo 700 / wdth 100 | 13 / 1.2 | 0.06em, upper | Column numbers, mode labels |
| `--t-body-lg` | Instrument Sans 400 | 17 / 1.45 | 0 | Primary prose, blunder text |
| `--t-body` | Instrument Sans 400 | 15 / 1.5 | 0 | Move list, settings, help |
| `--t-body-strong` | Instrument Sans 600 | 15 / 1.5 | 0 | Emphasis inside prose |
| `--t-micro` | Instrument Sans 600 | 11 / 1.3 | 0.08em, upper | Raw-score detail, ruler numbers |

Minimum body size anywhere is 15px. This is read one-handed, standing, in bad light.
Nothing is 12px. `--t-micro` at 11px is only ever a label sitting next to something larger.

---

## 7. Space, shape, depth, motion

**Space** — 4px base: `--sp-1 4, --sp-2 8, --sp-3 12, --sp-4 16, --sp-5 24, --sp-6 32,
--sp-7 48`. Page gutter on phone is 12px so the board gets maximum width.

**Shape** — circles for discs and holes, because the object is circles. Everything else
uses `--r-md 14px`; sheets and the board frame use `--r-lg 22px`; small chips `--r-sm 8px`.
Only the mode switch is a full pill. Zero-radius is used nowhere — it is the broadsheet
look the brief rules out, and it is wrong for moulded plastic.

**Depth** — plastic, not paper. A hard solid step first, a tight soft shadow second. No
diffuse ambient shadows, no blurred glows other than the signature.

```css
--el-board:  0 3px 0 #A9B2BA, 0 14px 28px -14px rgba(18,22,26,.55);
--el-raised: 0 2px 0 #CDD4DA;
--el-disc:   inset 0 3px 0 rgba(255,255,255,.30), inset 0 -3px 0 rgba(0,0,0,.28);
```

**Motion**

| Thing | Duration | Easing |
|---|---|---|
| Disc drop | 220ms + 90ms settle | `cubic-bezier(.4,0,1,.6)`; settle is `scaleY(.94 → 1)` |
| Backlight on | 160ms | `ease-out` |
| Backlight moves column | 120ms | `ease-in-out`, travels horizontally |
| Mode change | 140ms cross-fade | `ease` |
| Everything else | 120ms | `ease` |

`prefers-reduced-motion: reduce` — the disc appears in place with no drop and no settle,
the backlight appears with no fade and does not travel, mode change is instant. Disabled,
not shortened: remove the transform, don't set its duration to zero.

---

## 8. Layout

Phone portrait is the design target. Desktop is a widening of it, not a different product.
Design width 390px; must survive 360px.

The board is the hero and is the widest thing on the page. Above it, **one slot** holding a
single sentence — the answer, the blunder, or the legality error, depending on mode. Below
it, **one slot** that changes per mode — actions in Play, the seven verdicts in Analyse,
placement controls in Setup. The mode switch is pinned to the bottom in thumb reach.
Nothing on the primary view scrolls; the move list is a pull-up sheet, not a column that
pushes the board off screen.

Board sizing on phone: page width − 24px gutter − 22px parity gutter, ÷ 7. At 390px that
is 49px cells and a 294px-tall board. Discs are 82% of a cell.

**Note on the seat bar in every wireframe below (§8.1–8.4).** The wireframes draw
`[●Red|○Yel]` on both seat controls because a wireframe has to draw *some* state. Those are
**post-selection states, not defaults** — read them as "the user has already chosen red",
not as "red is preselected". §5's prohibition on red as a default stands unamended and
outranks the diagrams.

It is honoured by a **first-run seat prompt**: one screen asking both questions — "Who moves
first?" and "Which colour are you?" — as two independent controls of equal weight, with
neither colour preselected on either and neither colour given primary treatment, followed by
`Start`. `Start` is disabled until both are answered, so the app never holds a seat the user
did not pick. The seat then persists, and the seat bar shows the user's own choice from that
point on — which is exactly what the wireframes depict.

### 8.1 Play — phone

**The backlight is on by default in Play.** No tap, no hint control in this mode — the best
column is lit whenever it is the user's turn to move. This is the owner's ruling; §14.1
records what it overrode and why.

```
┌────────────────────────────────────────┐
│ YOU ARE [●Red|○Yel]   [●Red|○Yel] 1ST  │  seat bar — two independent controls
├────────────────────────────────────────┤
│                                        │
│  Your turn.                            │  --t-body-lg, --c-n-5
│  You win in 11 if you play well.       │  --t-display
│                                        │
├────────────────────────────────────────┤
│      1   2   3  [4]  5   6   7         │  --t-label; lit column's number is wght 900
│  ▲               ▼                     │  ▲ turn caret, fixed left slot, tinted to
│ ┌────────────────────────────────────┐ │    side to move.  ▼ lamp caret, over lit col
│6│  ·   ·   ·  ▒▒▒  ·   ·   ·         │ │  ▒  = lit wells, the best column
│5│  ·   ·   ·  ▒▒▒  ·   ·   ·         │ │  ·  = empty well
│4│  ·   ·   ·  ▒▒▒  ·   ·   ·         │ │  left gutter = parity ruler,
│3│  ·   ·   ·  ▒▒▒  ·   ·   ·         │ │  user's rows marked in Signal
│2│  ·   ·   ◍  ▒▒▒  ·   ·   ·         │ │  ◍  = red  (light ring marker)
│1│  ·   ⊙   ◍   ⊙   ·   ·   ·         │ │  ⊙  = yellow (dark dot marker)
│ └────────────────────────────────────┘ │
├────────────────────────────────────────┤
│        Undo              Redo          │  action slot — no hint control in Play
├────────────────────────────────────────┤
│    PLAY    │   ANALYSE   │   SETUP     │  mode switch, pinned
└────────────────────────────────────────┘
```

The lamp travels horizontally as the position changes (§7). It goes out only while it is
not the user's turn — during `Thinking…` or a human opponent's move there is nothing to
point at — and returns the moment the position is the user's again.

After a human move that degrades the verdict, the headline slot is replaced — for as long
as that position stands — by the blunder line on a `--c-n-0` surface with a 3px `Frame`
left edge:

```
│  That threw away a win. Column 4 held it.  │
```

**No button on the blunder line.** The column it names is the one that held the win in the
*previous* position; the backlight is already lit on the best column in the *current* one,
and the two are usually different. Lighting both would break the one-lamp rule (§9) and
would conflate "what you should have played" with "what to play now", so the blunder line
names its column in prose only. It never auto-dismisses and never animates in; the next
headline replaces it.

### 8.2 Analyse — phone

Same board. The action slot becomes the verdict strip, aligned cell-for-cell with the
columns above it, so a verdict is read *spatially* — you look down from a column and find
its answer. It is not a list.

**The backlight is gated in Analyse.** Every verdict is on screen the moment you enter the
mode — nothing is withheld — but the tool does not *point*. Reading the strip means finding
the solid bars and picking the tallest, which is a second of thought; `Show me` replaces
that second with a glance, and it is one tap away. This is the mode where one would
otherwise read off the answer without thinking, which is why the gate lives here and not in
Play (§14.1).

Before the reveal:

```
┌────────────────────────────────────────┐
│ YOU ARE [●Red|○Yel]   [●Red|○Yel] 1ST  │
├────────────────────────────────────────┤
│  Tap a column, or show the best.       │  --t-body-lg, --c-n-5
│  You win in 11 if you play well.       │  --t-display — the position's own
│                                        │  verdict, naming no column
├────────────────────────────────────────┤
│      1   2   3   4   5   6   7         │
│ ┌────────────────────────────────────┐ │
│6│  ·   ·   ·   ·   ·   ·   ·         │ │  no lit column, no lamp caret and
│5│  ·   ·   ·   ·   ·   ·   ·         │ │  no wght-900 number until revealed
│4│  ·   ·   ·   ·   ·   ·   ·         │ │
│3│  ·   ·   ·   ·   ·   ·   ·         │ │
│2│  ·   ·   ◍   ·   ·   ·   ·         │ │
│1│  ·   ⊙   ◍   ⊙   ·   ·   ·         │ │
│ └────────────────────────────────────┘ │
│ ┌───┬───┬───┬───┬───┬───┬───┐          │
│ │▨▨ │░░ │▨▨ │███│   │▨▨ │░░ │          │  ██ solid = win   ▨ hatch = draw
│ │▨▨ │░░ │▨▨ │███│   │▨▨ │░░ │          │  ░░ outline = loss   blank = full
│ │ 13│  9│  7│ 11│  –│  9│  5│          │  --t-numeral, tabular. No cell is
│ └───┴───┴───┴───┴───┴───┴───┘          │  inverted before the reveal
│ [ Show me ]              raw scores ▸  │  --t-micro toggle, off by default
├────────────────────────────────────────┤
│    PLAY    │   ANALYSE   │   SETUP     │
└────────────────────────────────────────┘
```

Pressing `Show me` applies the whole of §9 to the best column — lit wells, lamp caret,
`wght 900` column number, inverted verdict cell — and rewrites the headline to name it
(`Column 4.` / `You win in 11.`), at which point the board looks exactly as it does in Play.
The reveal holds for that position only: any move, undo, jump in the move list or seat
change clears it back to the gated state and `Show me` returns.

Strip cell: a 28px bar track plus the numeral, ~64px total. Bar height is proportional to
how fast the result arrives — a mate in 5 fills the track, a win in 13 is a short bar — so
the tallest solid bar is the best move and **form alone ranks the columns**. A full column
shows an empty cell and an em-dash, never a zero. After the reveal the best column's cell
inverts: `Frame` ground, `--c-n-0` bar and numeral. Before it, no cell is inverted — the
inversion is part of the answer, not part of the data.

"Moves that throw away a win" (spec §3.2) are outline bars standing next to at least one
solid bar. That adjacency *is* the flag — no extra badge, no colour.

Tapping a column cell selects it and rewrites the headline sentence. Selection is a 2px
`Signal` underline on the strip cell, never a glow, and it does **not** trigger the reveal —
choosing a column to read about is exactly the thinking the gate exists to protect. Once
revealed, the lamp stays on the **best** column whatever is selected.

### 8.3 Setup — phone

```
┌────────────────────────────────────────┐
│ YOU ARE [●Red|○Yel]   [●Red|○Yel] 1ST  │
├────────────────────────────────────────┤
│  Yellow has 3 discs, red has 5 —       │  --t-display, on --c-n-0 surface
│  impossible.                           │  with a 3px Frame left edge
├────────────────────────────────────────┤
│      1   2   3   4   5   6   7         │
│ ┌────────────────────────────────────┐ │  the board is an editing surface:
│6│  ·   ·   ·   ·   ·   ·   ·         │ │  a column shows a dashed landing
│5│  ·   ·   ·   ·   ·   ·   ·         │ │  ring on hover or focus
│ …                                      │
│ └────────────────────────────────────┘ │
├────────────────────────────────────────┤
│  PLACING    [  ● Red  |  ○ Yellow  ]   │  large, bottom, thumb reach
│    Undo        Clear        Done       │
├────────────────────────────────────────┤
│    PLAY    │   ANALYSE   │   SETUP     │
└────────────────────────────────────────┘
```

The `PLACING` control is deliberately a different shape from the seat controls — full
width, tall, at the bottom — so it can never be mistaken for "which colour I am". Seat
controls stay small and at the top in every mode.

Illegal positions: the headline slot states the actual problem in the brief's voice, and
the offending discs get a 2px dashed `Frame` outline. `Done` is disabled while the position
is illegal, with the reason still on screen — never a dead button with no explanation.

### 8.4 Desktop (≥900px)

Board left and large; one rail right. Nothing new appears — the rail is the phone's verdict
strip unrolled into full sentences, plus the move list that was a pull-up sheet. Max content
width 1180px, centred.

```
┌───────────────────────────────────────────────────────────────────────┐
│  fourwise          YOU ARE [●Red|○Yel]   [●Red|○Yel] MOVES FIRST      │
├──────────────────────────────────────┬────────────────────────────────┤
│                                      │  PLAY  │ ANALYSE │ SETUP       │
│     1    2    3    4    5    6    7  ├────────────────────────────────┤
│  ▲                                   │  Column 4.                     │
│ ┌──────────────────────────────────┐ │  You win in 11.                │
│6│  ·    ·    ·   ▒▒   ·    ·    ·  │ ├────────────────────────────────┤
│5│  ·    ·    ·   ▒▒   ·    ·    ·  │ │ ███   4   you win in 11        │
│4│  ·    ·    ·   ▒▒   ·    ·    ·  │ │ ▨▨    3   draw in 7            │
│3│  ·    ·    ·   ▒▒   ·    ·    ·  │ │ ▨▨    6   draw in 9            │
│2│  ·    ·    ◍   ▒▒   ·    ·    ·  │ │ ▨▨    1   draw in 13           │
│1│  ·    ⊙    ◍   ⊙    ·    ·    ·  │ │ ░░    7   she wins in 5        │
│ └──────────────────────────────────┘ │ │ ░░    2   she wins in 9       │
│                                      │ │        5   column is full     │
│   Undo    Redo    Export             ├────────────────────────────────┤
│                                      │  MOVES            raw scores ▸ │
│                                      │  1 ⊙ 4   2 ◍ 4   3 ⊙ 3         │
│                                      │  4 ◍ 5   5 ⊙ 3   …             │
└──────────────────────────────────────┴────────────────────────────────┘
```

Desktop rail rows are sorted best-first — a genuine ranking, which the phone strip cannot
show because it is positionally locked to the columns. The column number is always present
in both, so the two views never disagree about identity.

The rail obeys the same reveal rule as the phone. In **Play** it is lit and ranked
best-first from the start. In **Analyse** it lists rows in column order 1–7 until `Show me`
is pressed — a ranking is itself a reveal — and re-orders to best-first, without animation,
at the moment the lamp comes on. The `Show me` control sits at the head of the rail in
Analyse; in Play there is no such control anywhere.

---

## 9. Signature — The Backlight

**One element. The empty wells of the best column fill with warm lamplight.**

Everything else is grey, matte and cool. This is the only warm thing, the only bright
thing, the only bloom. You can find it across a bar table at arm's length in under a
second — which is the entire job of the product.

Specification:

- Wells in the lit column: `--c-lamp-core` `#FFE7C2` fill, replacing `--c-well`.
- Frame webbing bordering those wells warms to `#3A3128`, with a 2px inner bloom of
  `--c-lamp-rim` at 45% opacity on the well edges.
- A solid `--c-lamp-rim` caret, 14px wide, sits in the frame's top edge above the column.
  This is the non-colour carrier: it is the only triangle sitting over a column. The turn
  caret (§5) keeps its own fixed slot at the frame's left and never shares a slot with it.
  In Play the two are now on screen together permanently, so the slots must stay separate.
- The column's verdict cell below inverts to `Frame` ground.
- The column's number label goes to `wght 900`.
- Occupied cells in the lit column are **not** touched. Discs never glow. Light passes
  through holes, not through plastic — and a glowing disc would put warmth on top of a
  player hue, which §1 forbids.

States:

| Mode / situation | Behaviour |
|---|---|
| Play | **On by default**, on the best column, whenever it is the user's turn. Travels horizontally when the position changes. Out only while it is not the user's turn. |
| Analyse | **Off until `Show me` is pressed.** On for that position only; clears on any change of position or seat, and `Show me` returns. |
| Setup | Never. |
| Lost or drawn whatever you play | Lights the column that resists longest; the headline says so. |
| Game over | Off. The winning four is drawn instead: a 5px `Frame` line through the disc centres with a 2px `--c-n-0` outer stroke, and those four discs lift onto `--el-raised`. |

Play and Analyse are deliberately opposite here, on the owner's ruling — see §14.1. In
short: Play is a practice loop run many times an evening and the blunder flag already does
the teaching, so the lamp should cost nothing; Analyse is the mode where the answer would
otherwise be read off without thinking, so it costs one tap.

**The quiet rule.** No other element may use a warm hue, a glow, a blur, a bloom, a
gradient, or elevation above `--el-raised`. Hover is a 1px `--c-n-3` ring. Selection is a
2px `Signal` underline. Focus is §10. If a second thing starts glowing, the signature is
dead and so is the one-second glance.

---

## 10. Components

**Board.** `--c-frame` slab, `--r-lg` corners, `--el-board`. Wells are `--c-well` circles
at 82% of cell, inset. Webbing between wells is 18% of cell width. A 1px `#000` inner
border at 40% opacity sells the moulded edge.

**Disc.** Circle at 82% of cell. Flat fill in `--c-red` / `--c-yellow` plus `--el-disc` for
the moulded gloss — no radial gradients, no CSS `filter`. Marker per §4. The disc just
played is marked by a small `--c-n-9` wedge in the frame's top edge above its column,
offset from the turn caret's slot so the two never collide.

**Column hit target.** The whole column is one target — 49px × 294px on phone. One-handed
use in poor light means you aim at a column, not at a cell. Hover/focus draws a 2px dashed
`--c-n-3` ring on the landing well.

**Parity ruler.** 22px left gutter, row numbers 1 (bottom) to 6 (top) in `--t-micro`. The
user's parity rows get a filled 3px `Signal` bar in the gutter and their numbers go
`--c-n-9`; other rows are `--c-n-5` with no bar. Computed from `userMovesFirst`; updates on
seat change. A `--t-micro` caption sits under the board in Analyse: "Your waiting threats
land on rows 2, 4, 6." Tapping the ruler opens a sheet that says in one sentence that this
governs *single* threats only, and that a double threat wins whoever's turn it is — spec §2,
one of the misunderstandings the tool exists to correct.

**Headline slot.** Fixed 96px min-height on phone so the board never jumps when the sentence
changes length. Two lines max: a `--t-body-lg` `--c-n-5` context line, then the `--t-display`
sentence.

**Mode switch.** Full-width pill, three equal 52px-tall segments, `--t-label`. The selected
segment is `Frame` ground with `--c-n-0` text. It never moves and never collapses to icons.

**Move list.** Pull-up sheet on phone (`--c-n-0`, `--r-lg` top corners), right rail on
desktop. Row: ply number in `--t-micro` `--c-n-5`, a 14px disc glyph with its marker, column
number in `--t-body-strong`. The current ply's row has `Frame` ground. Tap to jump.

**Raw scores.** Off by default. A `--t-micro` `Signal` text toggle at the bottom-right of the
verdict strip. On, it adds one `--t-micro` `--c-n-5` line under each numeral. It must not
change layout height — reserve the row.

**Focus.** Every interactive element: 3px `Signal` outline at 2px offset, radius matching the
element. On the board it outlines the full column. Never removed. Use `:focus-visible` with a
`:focus` fallback on the board columns, since keys 1–7 drive them directly.

---

## 11. Copy

Voice per the brief: plain, from the user's side, verbs describe, labels label.

| Situation | String |
|---|---|
| Context line, Play | `Your turn.` / `Thinking…` / `Her turn.` |
| Headline, winning | `You win in 11.` |
| Headline, losing | `She wins in 9.` |
| Headline, drawn | `Drawn with best play.` |
| Play, position summary | `You win in 11 if you play well.` |
| Blunder | `That threw away a win. Column 4 held it.` |
| Blunder, already losing | `Column 4 lasted four moves longer.` |
| Hint button (Analyse only) | `Show me` |
| Analyse, before reveal | `Tap a column, or show the best.` |
| Analyse, column named | `Column 4.` |
| Column full | `Column is full.` |
| Setup, count clash | `Yellow has 3 discs, red has 5 — impossible.` |
| Setup, first-mover clash | `Red moves first, so red cannot have fewer discs than yellow.` |
| Setup, four already there | `Yellow already has four in a row. That game is over.` |
| Setup, floating disc | `There is a disc with nothing under it in column 3.` |
| Game over | `You win.` / `She wins.` / `Drawn.` |
| Engine levels | `Perfect` `Strong` `Fair` `Weak` |

Never: "Score", "eval", "optimal", "suboptimal", "invalid", "error", "+6", "-4". Raw scores
are the one exception and they live behind the toggle, labelled `raw score`.

The opponent is `she` when a person is playing that side and no name is set, and `the engine`
when the engine is. Do not write "he/she". Offer a name field in settings that replaces the
pronoun entirely.

---

## 12. Tokens

```css
:root {
  /* ── palette ──────────────────────────────────────────── */
  --c-kiln:        #E9ECEF;
  --c-frame:       #232830;
  --c-well:        #12161A;
  --c-red:         #C42B21;
  --c-yellow:      #F5B301;
  --c-lamp-core:   #FFE7C2;
  --c-lamp-rim:    #FF9F45;
  --c-lamp-frame:  #3A3128;
  --c-signal:      #0E5C6B;

  /* neutrals — one ramp, no other steps */
  --c-n-0: #F6F8F9;
  --c-n-1: #E9ECEF;
  --c-n-2: #D6DBE0;
  --c-n-3: #C2C9D0;
  --c-n-5: #5A626B;
  --c-n-7: #333A43;
  --c-n-9: #232830;

  /* semantic */
  --c-page:          var(--c-kiln);
  --c-surface:       var(--c-n-0);
  --c-ink:           var(--c-n-9);
  --c-ink-muted:     var(--c-n-5);
  --c-focus:         var(--c-signal);
  --c-marker-red:    rgba(255,255,255,.55);
  --c-marker-yellow: rgba(0,0,0,.45);

  /* ── type ─────────────────────────────────────────────── */
  --f-display: "Archivo", system-ui, sans-serif;
  --f-body:    "Instrument Sans", system-ui, -apple-system, sans-serif;

  --t-display-size: 2.5rem;    --t-display-lh: 0.95;
  --t-numeral-size: 1.75rem;   --t-numeral-lh: 1;
  --t-title-size:   1.25rem;   --t-title-lh:   1.2;
  --t-label-size:   0.8125rem; --t-label-lh:   1.2;
  --t-body-lg-size: 1.0625rem; --t-body-lg-lh: 1.45;
  --t-body-size:    0.9375rem; --t-body-lh:    1.5;
  --t-micro-size:   0.6875rem; --t-micro-lh:   1.3;

  --w-display: 800;  --w-title: 700;  --w-label: 700;
  --w-body: 400;     --w-body-strong: 600;
  --wdth-display: 110;  --wdth-ui: 100;

  /* ── space ────────────────────────────────────────────── */
  --sp-1: 4px;  --sp-2: 8px;  --sp-3: 12px; --sp-4: 16px;
  --sp-5: 24px; --sp-6: 32px; --sp-7: 48px;
  --gutter: var(--sp-3);
  --parity-gutter: 22px;

  /* ── shape ────────────────────────────────────────────── */
  --r-sm: 8px; --r-md: 14px; --r-lg: 22px; --r-full: 999px;

  /* ── depth ────────────────────────────────────────────── */
  --el-board:  0 3px 0 #A9B2BA, 0 14px 28px -14px rgba(18,22,26,.55);
  --el-raised: 0 2px 0 #CDD4DA;
  --el-disc:   inset 0 3px 0 rgba(255,255,255,.30),
               inset 0 -3px 0 rgba(0,0,0,.28);

  /* ── board metrics ────────────────────────────────────── */
  --cell:        clamp(42px, calc((100vw - 24px - 22px) / 7), 76px);
  --disc-size:   calc(var(--cell) * 0.82);
  --web:         calc(var(--cell) * 0.18);
  --marker-ring: calc(var(--disc-size) * 0.52);
  --marker-dot:  calc(var(--disc-size) * 0.28);

  /* ── motion ───────────────────────────────────────────── */
  --dur-drop: 220ms;   --ease-drop: cubic-bezier(.4,0,1,.6);
  --dur-settle: 90ms;
  --dur-lamp: 160ms;   --dur-lamp-move: 120ms;
  --dur-ui: 120ms;     --ease-ui: ease;
}

@media (prefers-reduced-motion: reduce) {
  :root { --dur-drop: 0ms; --dur-settle: 0ms; --dur-lamp: 0ms;
          --dur-lamp-move: 0ms; --dur-ui: 0ms; }
  /* Also remove the settle transform and the lamp's horizontal travel
     outright — do not merely zero the duration of a transform that still runs. */
}

@media (min-width: 900px) {
  :root { --t-display-size: 3.25rem; --t-numeral-size: 2rem;
          --gutter: var(--sp-6); }
}

/* Markers are on by default; the toggle sets data-markers="off" on <html>. */
[data-markers="off"] .disc-marker { display: none; }
```

**One theme only: light.** No dark mode in Phase 1; do not implement
`prefers-color-scheme`. The screen is the light source in the room this gets used in. A
dark theme would sink the red disc — already the weakest contrast on the board — and kill
the backlight, which needs a dark board on a bright page in order to exist at all.

---

## 13. Self-critique

**What I would produce for a generic game-analysis tool:** near-black or deep-navy canvas;
one acid accent; Inter or Space Grotesk; a monospace for numerals; a green→amber→red
evaluation bar per column; an evaluation curve across the game's plies; hairline dividers; a
dense right rail of statistics; the engine's raw score shown prominently because it is the
"real" data.

**What this direction shares with that, and what I did about it:**

| Shared default | Kept or changed |
|---|---|
| A per-column bar strip | **Kept, re-grounded.** It is the only way to show 7 verdicts on a 390px screen. Changed so it is positionally locked under the columns as a physical shelf — read spatially, not as a chart — and so it carries zero hue. |
| Tabular numerals | Kept. Nothing else aligns seven numbers. |
| A move list | Kept — unavoidable — but demoted to a pull-up sheet on phone so it never competes with the board. |
| Green/amber/red quality coding | **Cut.** Red already means "the red player"; any hue-coded quality scale makes the board ambiguous at a glance. Verdict became fill treatment plus bar height. This is the biggest departure and it is forced by the subject, not by taste. |
| An evaluation curve over plies | **Cut entirely.** The most "research tool" artifact there is. It answers a question nobody standing at a bar table is asking, and it would take vertical space the board should have. |
| Dark canvas plus one accent | **Inverted.** Bright cool page, dark object sitting on it. The brief warns this is the tempting move; it is also concretely wrong here — red at 3.2:1 gets worse on dark, and the signature needs dark holes on a bright page to read as light coming through. |
| A monospace for data | **Cut.** No third face. The density doesn't justify it and it imports the wrong voice. |
| Prominent raw score | **Cut to a toggle, off by default** — per spec §3.2 it is the main thing that makes the reference tool feel like a lab. |

**Where I am still exposed.** The verdict strip is the least distinctive part of this
design. It is form-only and honest, but it is a bar chart wearing a costume. If it has to be
revisited, the direction to push is making the bars read as *stacked discs* — the height of
a column of discs rather than a chart bar — which would tie it back to the object. I did not
specify that now because it risks being confused with the actual board directly above it,
and clarity in one second beats cleverness.

**The risk I took.** Light. A bright grey page for a tool used in a dim bar is the opposite
of what the room suggests, and it is the choice most likely to be questioned. It is
justified because the phone is the light source, not a window onto a dark room: brightness
is what makes the board legible at arm's length, what keeps the red disc above 3:1, and what
makes lamplight through the holes usable as a signal at all. A dark UI would have made the
signature impossible and the weakest colour weaker.

---

## 14. Decisions the brief left open, and how I called them

1. **Does Play mode reveal the best column automatically?**
   **Called: on demand — OVERRULED BY THE OWNER.** Play auto-reveals; the gate moves to
   Analyse. Both the recommendation and the ruling are recorded below. The ruling is what
   the document now specifies and it is not to be re-argued.

   *What I recommended, unaltered:* The brief's job statement ("glance at the phone and know
   which column to play") argues yes; the product being a *trainer* argues no. **Called: on
   demand.** One tap on `Show me`, one column, cleared on the next move. Auto-reveal in Play
   removes every opportunity to learn and makes the blunder flag — the feature that actually
   improves play — meaningless. Analyse is one tap away for anyone who wants the answer
   without asking. Reversing this is a one-line default change; nothing else in the direction
   depends on it.

   *The owner's ruling, final:* **Play auto-reveals the best column.** Play is where the user
   practises against the engine, and the blunder flag already does the pedagogical work — you
   move, it tells you what you gave up. Gating the answer behind a second tap adds friction to
   a loop run thirty times an evening. The instinct behind the recommendation — don't let the
   tool answer for you — is sound, but it solves a problem the blunder flag already solves.
   **Analyse keeps the `Show me` gate:** that is the mode where one would otherwise read off
   the answer without thinking, and the recommendation was right about it.

   *What the ruling changed in this document:* §8.1 — backlight on by default in Play, hint
   control gone from the action slot, button gone from the blunder line. §8.2 — backlight
   gated in Analyse, `Show me` lives there, headline names no column and no verdict cell is
   inverted until revealed. §8.4 — the desktop rail ranks best-first only after the reveal in
   Analyse. §9 — states table and the caret note. §11 — copy for the pre-reveal headline. The
   last sentence of the recommendation held: it was a default plus the placement of one
   button, and nothing structural moved.

2. **Are colour-blind markers on or off by default?** The spec says "toggleable" but not
   which way. **Called: on.** Red and yellow separate at only 3.06:1, and the markers read
   as moulded plastic detail rather than as an accessibility overlay, so the default costs
   nothing.

3. **What is the opponent called?** The brief's copy uses "she". **Called: `she` for a human
   opponent with no name, `the engine` when the engine plays that side, plus a name field in
   settings that replaces the pronoun.** Flagged because it is a real product decision
   hiding inside a copy example.

4. **No dark theme in Phase 1.** Recorded as a decision, not an omission — see §12. If the
   owner wants one later it is not a token swap: the signature has to be redesigned, so it
   should be treated as a change of direction rather than a setting.

---

# AMENDMENT — PHASE 3 SURFACES (2026-07-29)

Bounded, additive amendment covering the three surfaces Phase 3 introduces: the game log
list (§16), the post-game review stepper (§17), and the opponent-model prediction display
(§18). §§1–14 are unchanged and still govern. Nothing above this line was restyled,
renumbered, or reworded. Governing specs for this amendment: `docs/OPPONENT-MODEL.md`,
`docs/ROADMAP.md` Phase 3, and the Phase 3 wave plan in `docs/STATUS.md` (pin rulings 1–4).

## 15. Phase 3 — scope, and the rules all three surfaces obey

### 15.1 What Phase 3 adds to the visual system: nothing

**No new tokens. §12 is byte-identical and stays byte-identical.** Every value below is an
existing token used in an existing way. I checked each of the three surfaces for a value it
could not express — a recessed ground, a provenance mark, a confidence bar, a twenty-step
counter — and in every case the existing ramp, the existing shapes and the existing type
scale carried it. Where I was tempted to add a semantic alias (`--c-surface-recessed`) I
declined: an alias is a new name for `--c-n-2`, and one new name in §12 invites the next
one. Implementers write `--c-n-2`.

No new hue enters the interface. §1 still holds: hue belongs to the players. The opponent
model is not a third player and gets no colour of its own.

### 15.2 The one touch-point in §8

The three surfaces need a door. Rather than add a fourth segment to the mode switch — which
would restyle §10's three-equal-segments rule and demote the board's three modes to a menu —
Phase 3 adds **one `--t-micro` `Signal` text control, `Games ▸`,** at the right end of the
action slot: `Undo   Redo   Games ▸` on phone, appended after `Export` on desktop. It matches
`raw scores ▸` exactly in vocabulary, weight and behaviour. It opens the games sheet (§16).

The §8.1–§8.4 wireframes are **not redrawn**. They predate this amendment and are correct
about everything they show. Read them as unamended except for that one control, which is
drawn in §16.1.

### 15.3 Rules that bind all three surfaces

These are not style notes. Each one is checkable, and each exists because a specific way of
getting Phase 3 wrong is easy.

**R1 — Solver light, model ink.** The backlight (§9) and every one of its carriers — lit
wells, warmed webbing, the lamp caret, the inverted verdict cell, the `wght 900` column
number — belong to the **solver alone**, in every Phase 3 surface, permanently. The opponent
model may never light a column, place a caret, invert a cell, or bold a column number. It is
drawn in `--c-n-7` ink on a matte recessed ground and it does not glow, bloom, or warm.
§9's quiet rule already forbids a second glowing thing; R1 says which of the two owns the
only one.

**R2 — The model never enters the board's coordinate space.** No ghost discs, no shaded
columns, no marks in the wells, no cells in the verdict strip. The model's output is drawn
in its own block, outside the board and outside the strip. This is a containment rule an
implementer can test structurally: no model-derived value may render inside the board
component or the verdict-strip component.

**R3 — Different axis, different shape.** Solver quantities are **vertical** bars locked
under their columns. Model quantities are **horizontal** bars in a stack of at most three
rows, ordered by likelihood, never seven, never column-aligned. A reader who has learned
"vertical under the column = what wins" cannot mistake a horizontal row for it.

**R4 — Different surface plane.** Solver surfaces are raised: `--c-n-0` ground, `--el-raised`.
Model surfaces are recessed: `--c-n-2` ground, no elevation, a 1px `--c-n-3` line along the
top edge only. Nothing in the interface is both. The metaphor is physical and consistent with
§2 — the solver's answers are objects sitting on the table; the model's are notes pressed
into it.

**R5 — Every model number carries its denominator; no solver number ever does.** `7 of 9`,
`22 of her moves`, `14 of 20 games`. The verdict strip's numerals are bare (`11`, `9`, `–`).
A number with a denominator is the model, always. A bare numeral is the solver, always.

**R6 — The model never appears alone.** The prediction block does not render unless the
solver's answer for the same position is rendered on the same screen. If analysis for that
position is unavailable, still running, or terminal-superseded, the prediction block does not
render either. This is the structural half of ROADMAP gate #2: a user can never be looking at
a recommended column that came from the model with nothing from the solver beside it, because
that state does not exist. Conflation needs the two to be alone together or fused; R2/R4
prevent fusion and R6 prevents solitude.

**R7 — Different grammar.** Model strings are about a person and are never verdicts. The
words `win`, `wins`, `won`, `lose`, `loses`, `lost`, `draw`, `drawn`, `best`, `held` may not
appear in any model string — including the exploitation lines, which describe *chances taken
or missed*, not results. (`She took the immediate win in 9 of 9 chances` would violate this;
the sanctioned phrasing is in §18.6.) Solver strings keep §11's verdict vocabulary unchanged.

**R8 — Seat model, unchanged and explicit.** Colour never implies turn order in any new
surface, and turn order never implies colour. Every logged game carries both
`seat.firstMover` and `seat.userColour`; both are displayed, separately, as two facts. No
combined chip, no `R/1st`, no inference of one from the other anywhere. A ply track that
draws red first for every game is the bug — first tick hue comes from `seat.firstMover`. All
results and all sentences are phrased from the user's seat (§5), never "Red won".

**R9 — No invented data, restated for a surface that will be tempted.** These surfaces show
counts, and a count that is not yet known must say so rather than show `0` or a dash that
reads as zero. `Not evaluated` and `none yet` are the honest strings; §18.5's floor state is
the fully designed case.

**R10 — Reduced motion.** Nothing in these three surfaces animates under
`prefers-reduced-motion: reduce`: no disc drop while stepping, no scrub easing, no sheet
slide, no bar fill. Per §7 these are **removed**, not zero-durationed. Confidence bars and the
twenty-tick counter do not animate under *any* motion setting — they are static by design,
because §9's quiet rule allows exactly one moving bright thing and it is the lamp.

### 15.4 Contrast on the recessed ground

New pairings introduced by R4, recomputed from §12's hex values with the WCAG 2.x relative-
luminance formula (sRGB linearised, `(L1+0.05)/(L2+0.05)`; method validated against the
published reference pairs black-on-white 21.0 and `#767676`-on-white 4.54):

| Pair | Ratio | Verdict |
|---|---|---|
| `--c-n-9` on `--c-n-2` | 10.63:1 | pass — headings, counts |
| `--c-n-7` on `--c-n-2` | 8.25:1 | pass — confidence bar fill, **and all body and micro text on this ground** |
| `--c-n-5` on `--c-n-2` | 4.44:1 | **fails AA for text** (4.5:1) — permitted only as a non-text graphical mark, where the threshold is 3:1 |
| `--c-n-3` on `--c-n-2` | 1.20:1 | **decorative only** — the 1px top edge, never a mark carrying meaning |

**Correction, 2026-07-29.** The first cut of this table was wrong: every figure was inflated
by roughly 8–10% (11.6 / 9.0 / 4.85 / 1.3), which turned a fail into a pass. `--c-n-5` on
`--c-n-2` is 4.44:1 and does **not** clear the 4.5:1 AA threshold for normal-size text. The
figures above are the recomputed ones.

**The rule that replaces the old floor: on `--c-n-2`, no text is lighter than `--c-n-7`.**
Text ink on the recessed ground is `--c-n-9` or `--c-n-7`, and nothing else, at every size —
`--t-micro` included, since 11px is nowhere near the 18.66pt-bold / 24pt large-text threshold
and so takes the same 4.5:1 bar as body text. `--c-n-5` keeps exactly one job on this ground:
non-text marks, which need 3:1, which 4.44:1 clears.

I chose **moving the ink to `--c-n-7`** over demoting the affected text to a large-text size
or weight. Two reasons. The demotion is not available in the first place — the text at issue
is `--t-body` (15px/400) and `--t-micro` (11px/400), and reaching 18.66pt bold would mean
enlarging a hedge sentence and a provenance line until they outweighed the numbers they
qualify, which inverts the hierarchy to satisfy a checker. And `--c-n-7` is already the
model's declared ink: R1 says the model "is drawn in `--c-n-7` ink on a matte recessed
ground", so the fix makes §§18.2/18.5/18.6 consistent with R1 rather than adding anything.

**What this costs, stated plainly.** `--c-n-5` was carrying "secondary rank" on the recessed
ground, and the ramp has no other step between `--c-n-7` and a failing value. On `--c-n-2`,
secondary rank is therefore carried by **size and weight only** — `--t-micro` against
`--t-body-lg` — not by a lighter ink. This is a real reduction in tonal range inside the model
block, and it is the correct trade: §12 stays byte-identical (§15.1), and the alternative was
body text a user cannot read.

The empty ticks of the twenty-step counter (§18.5) stay a 1px `--c-n-5` outline, not
`--c-n-3`. They carry meaning ("games still needed"), they are non-text marks, and 4.44:1
clears the 3:1 they must meet — whereas `--c-n-3`'s 1.20:1 does not.

**Sweep result.** Every `--c-n-5` text specification in §§15–18 was checked against its actual
ground. On `--c-n-0` (raised: the games sheet §16, the review stepper §17) `--c-n-5` is
5.81:1 and passes — those are unchanged. Five instances sat on `--c-n-2` and are now
`--c-n-7`: §18.2's remainder line and evidence line, §18.5's split line and floor-reason
sentence, and §18.6's evidence-mix line.

**Grayscale test, extended.** Print all three surfaces in black and white. Live must still be
tellable from reconstructed, a blunder ply from a clean one, a logged game from a needed one,
and the model's block from the solver's. All four are carried by form and words, so all four
survive.

---

## 16. Game log list

### 16.1 The sheet

The games sheet is a full-height sheet in §10's existing vocabulary — `--c-n-0` ground,
`--r-lg` top corners — presented over whatever mode is active. It is not a mode. `Close`
returns to exactly the position and mode the user left.

```
┌────────────────────────────────────────┐
│ GAMES                            Close │  --t-title  /  --t-micro Signal
│ 14 logged · 6 more before predictions  │  --t-body, --c-n-5
├────────────────────────────────────────┤
│ WHERE ANNA IS WEAK                     │  exploitation summary, §18.6,
│ Anna missed a diagonal block in 7 of 9 │  on --c-n-2 recessed ground.
│ chances. Build diagonals.              │  Absent entirely until it has
├────────────────────────────────────────┤  something to say.
│ ▌ 29 Jul   Anna                        │  ▌ solid 3px Frame left edge,
│   You were yellow · she moved first    │    full row height = LIVE
│   You won · 27 moves                   │
│   LIVE                                 │  --t-micro, --c-n-5
├────────────────────────────────────────┤
│ ╎ 27 Jul   Anna                        │  ╎ 3px dashed --c-n-5 left edge,
│   You were red · you moved first       │    half row height = RECONSTRUCTED
│   She won · 19 moves                   │
│   RECONSTRUCTED · COUNTS HALF          │  --t-micro, --c-n-5
├────────────────────────────────────────┤
│ ▌ 26 Jul   Anna                        │
│   You were red · she moved first       │
│   Drawn · 42 moves                     │
│   LIVE                                 │
├────────────────────────────────────────┤
│  Add a game from memory                │  --t-body-strong, Signal
│  Export ▸        Import ▸              │  --t-micro Signal
└────────────────────────────────────────┘
```

Newest first. The sort key is date and only date — never result, never provenance, never
colour.

### 16.2 The row

Four lines, fixed order, every line present on every row:

1. **Date and label.** `29 Jul` within the current year, `29 Jul 2025` otherwise. Date in
   `--t-micro` `--c-n-5`, label in `--t-body-strong` `--c-n-9`. A game whose `opponent` field
   is empty reads `Unlabelled` — never a substituted pronoun, never a guessed name (R9).
2. **Seat, as two facts.** `You were yellow · she moved first`. Two independent clauses, You
   first by role (§5), colour a property of the clause and never the sort key. The second
   clause names whoever actually moved first — `you moved first` or `she moved first` / the
   label. There is no arrangement of this line that lets colour imply order, because order is
   stated in words (R8).
3. **Result, from the user's seat.** `You won` / `She won` / `Drawn`, then `· N moves`. Never
   "Red won". The `· N moves` is a length, not a verdict — it is deliberately *not* phrased
   `in N` (§11's `You win in 11.` means moves-to-result from now, and reusing that shape here
   would collide with it).
4. **Provenance, always labelled.** `LIVE` or `RECONSTRUCTED · COUNTS HALF` in `--t-micro`
   `--c-n-5`.

**Both provenance states are labelled — this is the point.** The tempting design labels only
the reconstructed rows and leaves live rows clean. That reads as "flagged" versus "normal",
and it hides the discount at exactly the moment it matters: when the log is mostly
reconstructed and the model is quietly running on half-weight evidence.
`docs/OPPONENT-MODEL.md` says *weight live games higher and say so*; a row that says nothing
is not saying so. Two labels, always.

The discount is stated numerically (`COUNTS HALF`, per PIN 3's 1.0 / 0.5) rather than
implied by the edge treatment, so the fact survives the grayscale test, screen readers, and
a user who has never been told what a dashed edge means. The solid-vs-dashed edge and the
full-vs-half height are redundant carriers of the same fact, in the manner of §4.

Row hit target is the full row, minimum 44px tall in practice at four lines. Tap opens the
review stepper (§17). Hover is a 1px `--c-n-3` ring; focus is §10's 3px `Signal` outline. No
row is ever colour-coded by result.

### 16.3 Empty and near-empty

The log with nothing in it is not an error and is not a blank page:

```
│ GAMES                            Close │
│ No games logged yet.                   │  --t-body-lg, --c-n-9
│ Finish a game in Play and it is saved  │  --t-body, --c-n-5
│ here. Or add one from memory.          │
│                                        │
│  Add a game from memory                │
```

`Export ▸` is absent — not disabled — while there is nothing to export. A dead control with
nothing behind it is the pattern §8.3 already rejects.

### 16.4 Adding a game from memory

Reuses Setup's existing reconstruction path (§8.3) with its existing legality copy. One
addition at the end of that flow: the opponent label field, the date, and a plain statement
of what is about to be recorded —

```
│ This will be saved as reconstructed,   │  --t-body, --c-n-5
│ and counts half as much as a game      │
│ recorded live.                         │
```

Said before the save, not discovered afterwards in a row label. A game recorded live is never
offered a provenance choice: `source` is a fact about how the game reached the log, not a
setting.

---

## 17. Post-game review stepper

### 17.1 What it is

The logged game, replayed one ply at a time, with the board and the verdict strip doing
exactly what they already do in Analyse. **Nothing new is invented here.** The review stepper
is §8.2 with a game log driving the position and a ply track added below. Everything the
analysis panel already promises about honesty it keeps.

```
┌────────────────────────────────────────┐
│ ‹ Games          29 Jul · Anna         │  --t-micro Signal / --t-body-strong
│ You were yellow. She moved first.      │  --t-body, --c-n-5 — two facts, R8
├────────────────────────────────────────┤
│  Ply 14 of 31 — her move.              │  --t-body-lg, --c-n-5
│  That threw away a win. Column 4 held  │  --t-display, on --c-n-0 with a
│  it.                                   │  3px Frame left edge (§8.1 blunder)
├────────────────────────────────────────┤
│      1   2   3   4   5   6   7         │
│  ▲                                     │  turn caret, §5, its own slot
│ ┌────────────────────────────────────┐ │
│6│  ·   ·   ·   ·   ·   ·   ·         │ │  the board, unchanged
│ …                                      │
│ └────────────────────────────────────┘ │
│ ┌───┬───┬───┬───┬───┬───┬───┐          │
│ │▨▨ │░░ │▨▨ │███│   │▨▨ │░░ │          │  the verdict strip, unchanged:
│ │ 13│  9│  7│ 11│  –│  9│  5│          │  §8.2 in full
│ └───┴───┴───┴───┴───┴───┴───┘          │
│ [ Show me ]              raw scores ▸  │
├────────────────────────────────────────┤
│ ⊙◍⊙◍⊙◍⊙◍⊙◍⊙◍⊙▌◍⊙◍⊙◍⊙◍⊙◍⊙◍⊙◍⊙◍⊙        │  ply track: one tick per ply,
│ ·▾·  ·  · ·  ·▾ ○ ○ ○ ○ ○ ○ ○ ○        │  hue = whose. ▌ = current ply
│ 8 plies not evaluated yet.             │  --t-micro, --c-n-5
│  ‹ Back          14 / 31        Next › │  44px targets, ← → keys
├────────────────────────────────────────┤
│ WHAT ANNA MAY PLAY                     │  §18, recessed --c-n-2 block,
│  4  ████████████░░░░░░░░  40%          │  present only when it is her ply
│ …                                      │
└────────────────────────────────────────┘
```

### 17.2 The ply track

One tick per ply, in play order, 6px wide, 14px tall, tinted to the hue of the side that
played it. Play order is real sequence data taken from the game, not an implied ordering, so
§5's prohibition does not apply — but the first tick's hue is derived from `seat.firstMover`
and never assumed (R8).

Below each tick, one **evaluation mark**, and this is where the stepper earns its honesty:

| Mark | Meaning |
|---|---|
| `·` 3px `--c-n-5` dot | evaluated; no blunder |
| `▾` 7px filled `--c-n-9` wedge | evaluated; this move threw away a result |
| `○` 1px `--c-n-5` open ring | **not evaluated yet** |

The open ring is not a placeholder for a mark that is coming — it is the honest statement
that this ply has not been analysed, and it is accompanied by the running count
(`8 plies not evaluated yet.`) which disappears when it reaches zero. A review opened on a
long game will show mostly open rings for a few seconds. That is correct, and it is far
better than a track that fills in silently and lets the user believe the marks were there all
along.

**The wedge never appears from a partial comparison.** SPEC §3.1: the blunder flag never fires
when either side of the before/after comparison is incomplete. In the track that means an open
ring, never an optimistic dot and never a speculative wedge — a dot asserts "evaluated, clean",
which is a claim, and an unevaluated ply has no business making it.

Current ply: the tick becomes a full-height 3px `Frame` bar. That is the only current-ply
marker; the track never scrolls under a fixed cursor, because a moving background is a second
moving thing (§9).

### 17.3 Honesty conventions inherited whole

The review stepper is an analysis-derived surface and inherits every rule already governing
one. Restated because a new surface that "survives a terminal position unchanged is a §3.2
violation by definition, not a new discovery" (SPEC §3.2, 2026-07-29):

- **Partial results are labelled.** A column whose analysis did not complete says
  `Still solving this column.` — the existing string, the existing behaviour. It never shows a
  stale number from an adjacent ply and never a guess.
- **Terminal beats analysis.** At the final ply of a finished game the strip shows the outcome
  in every cell (`Game over — you won.` / `— drawn.` / `— she won.`), the lamp is off, and the
  winning four is drawn per §9's game-over row. The ply track's marks are backward-looking
  provenance about specific past moves and are **exempt** — they remain true and remain
  visible (SPEC §3.2 scope precision, 2026-07-29).
- **The prediction block hides at a terminal position** — it makes a present-tense claim about
  a move that is not going to happen. See §18.4.
- **The blunder line uses §11's existing strings verbatim**, including
  `Column 4 lasted four moves longer.` when the game was already lost. No new blunder copy.
- **All wording passes through the single seat-translation point.** Four seats, four correct
  outputs, on every string this surface produces.

### 17.4 The lamp in review

§9's states table gains one row. It is an extension, not an alteration — Play, Analyse and
Setup behave exactly as §9 already specifies:

| Mode / situation | Behaviour |
|---|---|
| Review (§17) | **Off until `Show me` is pressed**, as in Analyse. On for that ply only; stepping to any other ply clears it and `Show me` returns. |

Review inherits Analyse's gate rather than Play's auto-reveal because review is the drill
surface: the whole value of stepping through a lost game is the half-second of "what should I
have played here?" before the answer arrives, and the ply track's wedges already do the
teaching that §14.1's ruling credited the blunder flag with in Play. This is a default and one
control's presence, nothing structural depends on it, and it is a one-line change if the owner
rules the other way — the same terms on which §14.1's recommendation was made and overruled.

### 17.5 Stepping and motion

Single step forward plays the disc drop at §7's timing. Stepping back, jumping more than one
ply, tapping the track, or scrubbing places discs instantly — a rewind animation would assert
a physical event that never happened. Under `prefers-reduced-motion: reduce`, every step is
instant and the lamp does not travel (§7, R10).

Keyboard: `←` / `→` step, `Home` / `End` jump to first and last ply, `Escape` returns to the
games sheet. The track itself is one focusable control with an accessible name naming the
current ply and its evaluation state.

---

## 18. Opponent-model prediction display

### 18.1 The two questions, made structural

`docs/OPPONENT-MODEL.md` opens with the distinction this surface exists to protect: the solver
answers *what is the best move*, the model answers *what will she actually play*. ROADMAP
Phase 3 gate #2 requires the two to be **never conflated**. A gate criterion cannot rest on
restraint, so conflation is prevented by construction, by five independent mechanisms — any
one of which failing still leaves four standing:

| # | Mechanism | Test |
|---|---|---|
| 1 | The lamp is the solver's, exclusively (R1) | Nothing model-derived sets a lit column, caret, inverted cell, or `wght 900` number |
| 2 | The model never enters the board or the strip (R2) | DOM containment: no model value inside the board or verdict-strip components |
| 3 | Vertical bars are the solver's; horizontal, at most three, are the model's (R3) | Axis and count |
| 4 | The solver is raised `--c-n-0`, the model recessed `--c-n-2` (R4) | Ground colour and elevation |
| 5 | The model never renders without the solver's answer beside it (R6) | The state "model alone on screen" does not exist |

Mechanism 5 is the one that makes the gate hold rather than merely discourage. Conflation
requires either fusion or solitude: 1–4 prevent fusion, 5 prevents solitude. A user reading
the prediction block is always simultaneously looking at the verdict strip, on a different
plane, on a different axis, in a different ink.

And one more, in copy: **the two blocks are always headed by the questions they answer.**
Whenever the prediction block is on screen, the strip above it carries a `--t-label` heading
too. The pair reads:

```
THE POSITION            ← solver, raised, vertical, bare numerals
WHAT ANNA MAY PLAY      ← model, recessed, horizontal, counts with denominators
```

The heading uses the opponent label (PIN 4: counts are keyed by label; the UI is
single-opponent first). With no label it reads `WHAT SHE MAY PLAY`, per §11's pronoun rule.

### 18.2 The prediction block — ready state

```
┌────────────────────────────────────────┐  --c-n-2 ground, no elevation,
│ WHAT ANNA MAY PLAY                     │  1px --c-n-3 top edge, --r-md
│                                        │
│  4  ████████████░░░░░░░░░░░░  40%      │  --t-label column number,
│  3  ███████░░░░░░░░░░░░░░░░░  25%      │  --c-n-7 fill on --c-n-3 track,
│  6  ██████░░░░░░░░░░░░░░░░░░  20%      │  --t-micro figure, tabular
│                                        │
│  The other four columns share 15%.     │  --t-micro, --c-n-7
│  From 22 of Anna's moves in positions  │  --t-micro, --c-n-7
│  like this one.                        │
└────────────────────────────────────────┘
```

Both trailing lines are `--c-n-7`, not `--c-n-5`: they sit on the recessed ground, where
§15.4's rule puts the lightest permitted text ink at `--c-n-7`. They stay `--t-micro`, so they
still read as subordinate to the figures above them — the demotion is carried by size, not by
a lighter ink.

- **Exactly three rows, always horizontal, never seven, never column-aligned** (R3).
- Bars are static — no fill animation at any motion setting (R10).
- Figures are **rounded to the nearest 5%**. The model's inputs are tens of games; a figure
  reading `37%` claims a precision that does not exist. Rounding to 5 is a statement about
  the evidence, not a rendering convenience.
- **The remainder line is mandatory.** Three normalised shares out of seven legal moves do
  not sum to 100, and a block that shows three bars adding to 85% with no explanation looks
  broken or looks like the top three are the only candidates. The line says which.
- **The evidence line is mandatory.** No block renders without the observation count the
  model layer supplies. If that count is unavailable, the block does not render (R9).

**Scope note on PIN 2.** PIN 2 bans displaying the posterior for *exploitation lines* and
requires raw counts there. These share figures are a different quantity — a normalised share
of the model's own scores across the legal moves in this position, not a rule's posterior mean
— and are permitted here, labelled as what they are, and always paired with the raw evidence
count beneath. The exploitation block (§18.6) shows no percentage at all.

### 18.3 Honest confidence, including when it is low

ROADMAP gate #3 requires confidence displayed honestly *including when it is low*. Low
confidence is not a smaller bar. Three cases, each with its own designed state:

**Close call** — the top three are within 10 points of each other:

```
│  4  ██████████░░░░░░░░░░░░░░  30%      │
│  3  █████████░░░░░░░░░░░░░░░  25%      │
│  6  ████████░░░░░░░░░░░░░░░░  25%      │
│                                        │
│  These three are close. Anna has no    │  --t-body, --c-n-9 — full body
│  clear habit in positions like this.   │  weight, not a footnote
```

The sentence is `--t-body` in `--c-n-9`, larger and darker than the figures it qualifies,
because the honest reading of this block is the sentence and not the ranking.

**Thin evidence** — past the floor overall, but few observations at this position. The bars
render and the evidence line is promoted to `--t-body` `--c-n-9`:
`Only 4 of Anna's moves reached a position like this.`

**No evidence here** — past the floor, nothing matching this position:

```
│ WHAT ANNA MAY PLAY                     │
│ Nothing to go on here. None of Anna's  │  --t-body, --c-n-9
│ 24 logged games reached a position     │
│ like this one.                         │
```

No bars, no zero rows, no dashes. Three bars at 0% would be a fabricated ranking of nothing
(R9).

### 18.4 When the block does not render at all

- The solver's answer for this position is unavailable or still running (R6).
- The position is terminal — there is no move to predict. The prediction is a present-tense
  claim and SPEC §3.2's class-wide rule applies to it in full.
- It is the user's move, not the opponent's. The model predicts one person, the one it has
  counts for. It never predicts the user.
- Play mode and Analyse mode, always. Phase 3's shape is *log the game, review it afterwards,
  drill the position where it was lost* — the trainer, not the oracle
  (`docs/OPPONENT-MODEL.md`, "Reality check"). Keeping the model out of the two modes where
  the lamp lives by default also means the highest-risk conflation surface never exists.

### 18.5 The floor state — below 20 games

**This is a first-class state, not an error state, and it is designed as one.** It occupies the
same block, in the same place, on the same recessed ground, under the same heading as a ready
prediction. Same shape, different content — because "the model is not ready" is a real answer
to "what may she play", and dressing it as a failure teaches the user to dismiss it.

```
┌────────────────────────────────────────┐
│ WHAT ANNA MAY PLAY                     │  --t-label — identical heading
│                                        │
│ Not yet. 14 games logged, 6 more       │  --t-body-lg, --c-n-9
│ needed.                                │
│                                        │
│ ▪▪▪▪▪▪▪▪▪▪▪▪▪▪○○○○○○                   │  20 ticks: 14 filled --c-n-7,
│                                        │  6 empty 1px --c-n-5 outline
│ 11 live · 3 reconstructed              │  --t-micro, --c-n-7
│                                        │
│ Below 20 games the model would be      │  --t-body, --c-n-7
│ guessing, and a guess shown            │
│ confidently is worse than none.        │
└────────────────────────────────────────┘
```

Design notes, each load-bearing:

- **The reason sentence and the split line are `--c-n-7`, not `--c-n-5`** (§15.4). This block
  sits on `--c-n-2`, and `--c-n-5` there is 4.44:1 — below AA for text of this size. The
  reason sentence is the one thing in the floor state a user who wants predictions *now*
  actually has to read, so it was the worst possible place in the amendment to have put
  unreadable ink; it is also `--t-body` at 15px/400 and cannot be demoted into the large-text
  exemption without making a hedge louder than the headline. It moves to `--c-n-7`.

- **Twenty discrete ticks, not a progress bar.** The requirement is twenty countable games.
  A percentage bar would turn a countable thing into an estimate and would invite the reader
  to eyeball "nearly there" at 17. The ticks can be counted, and the count is the point.
- **Both numbers are shown** — logged and needed — per `docs/OPPONENT-MODEL.md`: *show the
  count and how many more are needed*. `needed` is rendered from what the model layer reports;
  the design never computes it (§19.1).
- **The live / reconstructed split is stated** even though the floor counts whole games
  (§19.1). A user at 19 games of which 15 are reconstructed should be able to see that, since
  it governs how good the model will be the moment it switches on.
- **No warning voice, no dashed outline, no amber, no disabled styling.** §11's bans hold:
  the string is not an error, is not phrased as one, and does not use the word.
- **The reason is given in one sentence** — this is the tool's own thesis about itself, and
  it is exactly the thing a user who wants predictions *now* needs to read.
- **No prediction is shown anywhere while this state holds.** Not greyed out, not blurred, not
  behind a "show anyway". The floor is a floor.

### 18.6 Exploitation lines — raw counts, never posteriors

The exploitable-weakness summary is *the actual product of Phase 3*
(`docs/OPPONENT-MODEL.md`). It gets the largest type in this amendment.

Appears at the head of the games sheet (§16.1) and at the foot of the review stepper. Grouped
under two `--t-label` headings; a group with nothing to say is absent, not empty.

```
┌────────────────────────────────────────┐  --c-n-2 recessed ground
│ WHERE ANNA IS WEAK                     │  --t-label
│                                        │
│ Anna missed a diagonal block in 7 of 9 │  --t-body-lg, --c-n-9
│ chances.                               │
│ Build diagonals.                       │  --t-body-strong, --c-n-9
│ 6 live games · 3 reconstructed         │  --t-micro, --c-n-7
│                                        │
│ Anna answered a straight three in 8 of │
│ 8 chances.                             │
│ Threaten sideways only as a decoy.     │
│ 8 live games                           │
├────────────────────────────────────────┤
│ WHERE ANNA IS STRONG                   │  --t-label
│                                        │
│ Anna answered an immediate four in 9   │
│ of 9 chances.                          │
│ Leaving one open will not work.        │
│ 7 live games · 2 reconstructed         │
└────────────────────────────────────────┘
```

**The display invariant, stated so it can be tested:** an exploitation line contains **exactly
two integers, and they are the observation pair**. No third number, no `%` character, no
decimal point anywhere in the block. That single rule makes PIN 2's ban structural — a
posterior mean cannot be rendered as an integer pair, so a slip that reaches for the model's
internal number cannot pass the check. `0.31` and `31%` both fail it on sight and in a test.

**Fractional counts are forbidden.** PIN 3 halves reconstructed games in the *machinery*; the
*display* is the raw observation pair, whole numbers, exactly as observed. `missed a diagonal
in 7.5 of 9 chances` is not a sentence a person can act on. The weighting is disclosed instead
by the mix line beneath (`6 live games · 3 reconstructed`), which states the composition of
the same evidence honestly without pushing arithmetic into the reader's head. §19.2 records
this as a called decision.

The evidence-mix line under every one of these lines is `--t-micro` `--c-n-7` — this block is
on the recessed ground and §15.4's rule applies to it as it does to §18.2 and §18.5.

**Weakness and strength are separated by heading and words, never by hue or ornament.** No
red for weak, no green for strong — §1 forbids it and §4's grayscale test would fail. The two
groups are one heading apart.

**Every line is three parts, always in this order:** the observation with its counts, the
tactical consequence as an instruction, then the evidence mix. A line missing its consequence
is not shown — an observation with no action attached is a statistic, and this tool does not
show statistics.

**R7 applies here too.** These lines describe chances taken and missed, not results. `answered
an immediate four` rather than `took the win`; `Leaving one open will not work` rather than
`she will win`. The model has no standing to make verdict claims — that is the solver's
vocabulary and it stays with the solver.

Exploitation lines are **backward-looking provenance** — they describe what happened in
specific past games and remain true however any current game ends. Per SPEC §3.2's 2026-07-29
scope precision they are exempt from terminal-beats-analysis and do not hide when the board's
position is terminal.

### 18.7 Copy — new strings

All strings below pass §11's bans (`Score`, `eval`, `optimal`, `suboptimal`, `invalid`,
`error`, `+6`, `-4`) and R7's verdict-word ban for model strings. `Anna` stands for the
opponent label; with no label the pronoun rule in §11 applies and the label becomes `she`
mid-sentence, `SHE` in headings.

| Situation | String |
|---|---|
| Games sheet title | `GAMES` |
| Games sheet subtitle, below floor | `14 logged · 6 more before predictions` |
| Games sheet subtitle, above floor | `24 games logged` |
| Log row, seat | `You were yellow · she moved first` |
| Log row, result | `You won · 27 moves` / `She won · 19 moves` / `Drawn · 42 moves` |
| Log row, provenance | `LIVE` / `RECONSTRUCTED · COUNTS HALF` |
| Log row, no label | `Unlabelled` |
| Log empty | `No games logged yet.` |
| Log empty, second line | `Finish a game in Play and it is saved here. Or add one from memory.` |
| Reconstruction, before saving | `This will be saved as reconstructed, and counts half as much as a game recorded live.` |
| Review header, seat | `You were yellow. She moved first.` |
| Review, ply context | `Ply 14 of 31 — her move.` / `— your move.` |
| Review, unevaluated count | `8 plies not evaluated yet.` |
| Prediction heading | `WHAT ANNA MAY PLAY` / `WHAT SHE MAY PLAY` |
| Prediction, remainder | `The other four columns share 15%.` |
| Prediction, evidence | `From 22 of Anna's moves in positions like this one.` |
| Prediction, close call | `These three are close. Anna has no clear habit in positions like this.` |
| Prediction, thin evidence | `Only 4 of Anna's moves reached a position like this.` |
| Prediction, nothing matching | `Nothing to go on here. None of Anna's 24 logged games reached a position like this one.` |
| Floor, headline | `Not yet. 14 games logged, 6 more needed.` |
| Floor, split | `11 live · 3 reconstructed` |
| Floor, reason | `Below 20 games the model would be guessing, and a guess shown confidently is worse than none.` |
| Exploitation headings | `WHERE ANNA IS WEAK` / `WHERE ANNA IS STRONG` |
| Exploitation, observation | `Anna missed a diagonal block in 7 of 9 chances.` |
| Exploitation, consequence | `Build diagonals.` |
| Exploitation, evidence mix | `6 live games · 3 reconstructed` |

Never, in any model string: a percentage inside an exploitation line, a decimal, the word
`probability`, `confidence` as a bare number without its evidence, or any of R7's verdict
words.

### 18.8 Accessibility

- The prediction block is a labelled list; each row's accessible name is
  `Column 4, 40 percent, from 22 of Anna's moves in positions like this one` — the evidence
  travels with the figure, never separated from it.
- The floor state's tick row is decorative and `aria-hidden`; its content is already in the
  headline sentence, which is the accessible source of truth. A screen reader hears
  `Not yet. 14 games logged, 6 more needed.` and never twenty list items.
- Ply track ticks: the track is one control, its accessible name naming the current ply, whose
  move it was, and its evaluation state including `not evaluated`.
- Focus, hover and selection follow §10 and §9's quiet rule unchanged: 3px `Signal` outline,
  1px `--c-n-3` ring, 2px `Signal` underline. Nothing in Phase 3 introduces a new interaction
  treatment.

---

## 19. Decisions Phase 3 forced, and how I called them

Same form as §14, which is unchanged. **There are six of them**, all recorded below; each is
flagged because each is a real product decision the brief did not settle for me.

**They are not equally cheap to reverse, and the earlier claim that they were was wrong.**
Five — items 1, 2, 3, 4 and 6 — are genuinely cheap: each is a default, a string, or one
control, and the reversal terms under each say exactly what changes. **Item 5 is not.** Putting
the model into Play or Analyse would require R1–R6 to be re-derived for a screen where the
solver's answer is already lit, which is a change of direction and a fresh anti-conflation
argument, not a placement tweak. Item 5 states its own terms below and they are the expensive
ones. Read the opener as: five reversible defaults and one directional call.

1. **Does the 20-game floor count whole games or weighted games?** PIN 3 halves reconstructed
   games in the model's counts; `docs/OPPONENT-MODEL.md` says *below 20 logged games*.
   **Called: whole games — 20 rows in the log, whatever their provenance.** "How many more
   games do I need to play?" must have a countable, checkable answer, and `you need 6 more, or
   12 if you reconstruct them` is not one. The weighting stays where PIN 3 put it: inside the
   rule counts, where it changes prediction quality rather than a target the user is working
   toward. The floor's live/reconstructed split line (§18.5) discloses the composition either
   way, so the surface does not lie under either ruling. **The design never computes `needed`
   — it renders what the model layer reports**, so if Wave 14 is told to weight the floor, the
   only change is that the split line's label must say so.

2. **Fractional counts in exploitation lines.** PIN 2 requires raw counts; PIN 3's weighting
   would produce `7.5 of 9`. **Called: display the whole-number observation pair, disclose the
   mix beneath.** A count is evidence a person can check against their memory of the evening;
   a weighted count is machinery wearing a count's clothes, and PIN 2 already ruled the
   machinery internal. Flagged because it means the threshold that *fires* a line (PIN 2's
   ≥ 6 observations) and the numbers *shown* may be computed on different scales — Wave 14
   should pin the threshold to weighted observations for consistency with PIN 3, and the
   display stays raw regardless.

3. **The lamp in review: gated, as in Analyse.** §17.4 gives the reasoning. This is a default
   and one control, nothing structural depends on it, and §14.1's precedent applies — if the
   owner rules that review should auto-reveal like Play, that is a one-line change and this
   document should record the ruling rather than be quietly patched.

4. **The door is a text control, not a fourth mode.** §15.2. A fourth mode segment would
   restyle §10 and would put a log of past games at the same level as the three things the
   board does. `Games ▸` in the action slot costs one `--t-micro` control and no structural
   change. **If the owner rules otherwise:** §10's three-equal-segments rule is rewritten to
   four, §8.1–§8.4's wireframes are redrawn (§15.2 currently exempts them), §15.2 is replaced,
   and the `Games ▸` control is deleted from the action slot. Nothing in §16, §17 or §18
   changes — the sheet's content does not depend on its door — so the cost is confined to §10
   and the four wireframes, and it is a redraw rather than a re-derivation.

5. **The model does not appear in Play or Analyse.** §18.4. This follows the spec's own
   "build the trainer, not the oracle", and it has the useful side effect of keeping the model
   out of every screen where the lamp is on by default. If live prediction is ever sanctioned,
   it is a change of direction for this surface — R1–R6 would need re-deriving for a screen
   where the solver's answer is already lit — not a placement tweak.

6. **Percentages rounded to the nearest 5, with the remainder stated.** §18.2. Both choices
   are honesty about sample size rather than rendering taste, and both are the kind of thing
   an implementer optimises away without a note. This is the note. **If the owner rules
   otherwise:** the two halves reverse independently and at different prices. Unrounded
   figures are a one-line change at the render point plus the strike of §18.2's rounding
   bullet — no layout moves, because the figures are already tabular and two digits wide.
   Dropping the remainder line is the more expensive half: §18.2's mandatory-remainder bullet
   goes, and the block then shows three bars summing to 85% with nothing accounting for the
   other 15%, which reads as broken or as "these are the only candidates". I would argue
   against that half specifically; the rounding half I have no strong stake in.

**Where I am exposed.** The prediction block is the least distinctive surface in this
amendment — three horizontal bars is the most ordinary thing in the document, and §13 already
confessed to the same weakness in the verdict strip. I chose ordinary deliberately here: the
block's entire job is to be recognisably *not* the solver's answer, and an inventive treatment
would compete with the strip above it for the reader's sense of "this is the important one".
If it has to be revisited, the direction to push is making the model's block read as
handwriting on the table — a written note about a person — rather than as a chart. I did not
specify that now because it risks illegibility at `--t-micro` and because a second visual
idiom is a second thing to get wrong at a gate that is about not conflating idioms.

---

**Changelog**

- **2026-07-29 — Phase 3 amendment (design-lead, third and final bounded amendment).** Added
  §15 (Phase 3 shared rules R1–R10, no new tokens, recessed-ground contrast), §16 (game log
  list, with both provenance states labelled and the reconstructed discount stated in words),
  §17 (post-game review stepper, ply track with an explicit not-evaluated state, honesty
  conventions inherited whole from SPEC §3.1/§3.2), §18 (opponent-model prediction display:
  five structural anti-conflation mechanisms per ROADMAP gate #2, honest-confidence states per
  gate #3, the below-20 floor as a first-class designed state per gate #1, exploitation lines
  as whole-number raw counts per PIN 2 with fractional counts forbidden per §19.2), and §19
  (six decisions called, with reversal terms). §§1–14 unchanged; §12 tokens byte-identical.
- **2026-07-29 — correction round on the Phase 3 amendment (design-lead), after a scope audit
  rejected it on two findings.** *(1) §15.4's contrast table was wrong.* All four ratios were
  inflated by roughly 8–10% — claimed 11.6 / 9.0 / 4.85 / 1.3, actually **10.63 / 8.25 / 4.44
  / 1.20** on recompute with the standard WCAG relative-luminance formula (method checked
  against black-on-white 21.0 and `#767676`-on-white 4.54). The table is corrected. The
  material consequence was a real accessibility failure, not a rounding quibble: `--c-n-5` on
  `--c-n-2` is 4.44:1, below the 4.5:1 AA threshold for normal-size text, and §15.4 had
  labelled that exact pairing "the floor… pass" while §18.5 used it for the floor-reason body
  sentence. Resolved without touching §12: **on `--c-n-2` no text is lighter than `--c-n-7`**,
  at any size (`--t-micro` included — 11px is not large text). A sweep of §§15–18 found five
  affected instances, all now `--c-n-7` — §18.2's remainder and evidence lines, §18.5's split
  line and floor-reason sentence, §18.6's evidence-mix line. `--c-n-5` text on `--c-n-0` is
  5.81:1 and was left alone. `--c-n-5` keeps the empty ticks, a non-text mark needing 3:1. The
  cost — no lighter ink available for secondary rank on the recessed ground, so size and
  weight carry it alone — is stated in §15.4 rather than hidden. *(2) §19's integrity.* The
  run summary said "three things I had to call" while §19 recorded six; the six are correct
  and all are kept, and §19 now says six in its opening line. The opener's blanket claim that
  every decision was "cheap to reverse" was false and is corrected — item 5 says in its own
  text that reversing it is a change of direction, so the opener now separates five reversible
  defaults from one directional call. Items 4 and 6 had rationale but no reversal mechanic;
  both now carry explicit "if the owner rules otherwise" terms in the form of items 1–3.
  §§1–14 still unchanged; §12 tokens still byte-identical; no section renumbered.
