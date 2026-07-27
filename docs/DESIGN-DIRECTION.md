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

- Any fixed left-to-right or top-to-bottom ordering of red-then-yellow. Ordering implies
  sequence.
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
│  connect4-lab      YOU ARE [●Red|○Yel]   [●Red|○Yel] MOVES FIRST      │
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
