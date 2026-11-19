# Index Report — desktop design spec (working document)

A single reference so the layout, alignment and typography lanes do not
diverge. Measured problems are listed with the number that proves them.

## What is wrong today (measured at the real 1920×890 viewport)

### 1. The stat strip is a ragged grid with dead zones
Cells are `120px` wide for the first six, then `142px`, then a `160px` gap
before `PCR (OI)` at x994 — while the strip is 1764px wide and ends at x1916.
So ~300px of the strip is empty and the columns do not line up with anything.

| cell | x | width |
|---|---|---|
| spot / regime / flip / call-wall / put-wall / pin | 153…873 | 120 each |
| *(gap)* | 873…994 | **121px of nothing** |
| PCR (OI) / PCR (VOL) / MAX PAIN | 994 / 1136 / 1278 | 142 each |
| *(gap to the chip group)* | 1420…1621 | **200px** |
| Setup / INTEL / Dealer gamma chips | 1621…1915 | variable |

### 2. Label / value rhythm is inconsistent
Every label is 12px, but the **spot value is 15px** and every other value is
12px — so one number shouts and the rest whisper. Labels sit *above* values in
some cells and *inline* in the chips.

### 3. The side panel's metric toggle overlaps its own header
`nifty-heatmap-metric-oi` renders at y=200 inside a container that starts at
y=206 — a 6px overlap. The heatmap wrap also overflows by 10px.

### 4. Opening the dock halves the chart
Chart 577px → 267px when the drawer opens. The valuable panels (walls, breadth,
erosion) are only reachable by giving up the chart.

### 5. Empty space everywhere
Below the chart (1080 viewport) there is a dead band; the dock is a 26px stub;
the strip has two dead zones. The page reads as "a chart with leftovers".

## The target: a four-zone desk

```
┌──────────────────────────────────────────────────────────────┐
│ TOOLBAR        (38px, unchanged)                             │
├──────────────────────────────────────────────────────────────┤
│ VERDICT ROW    verdict 16px + confidence | evidence chips    │
├───────────────────┬──────────────────────────────────────────┤
│ PRIMARY NUMBERS   │ (grouped: PRICE | WALLS | VOL | FLOW)    │
├───────────────────┴──────────────────────────────────────────┤
│ CHART (≥420px)                    │ SIDE: heatmap + walls    │
├───────────────────────────────────┴──────────────────────────┤
│ LOWER PANEL: breadth / tape / analytics — visible, not tabs   │
└──────────────────────────────────────────────────────────────┘
```

### Alignment contract (every lane must honour this)
- **One gutter**: `16px` outer, `8px` inner, `4px` between inline items.
  Nothing may use 6px. Panel edges must line up on a single left edge.
- **Numbers right-align, labels left-align, badges centre.** This is the repo's
  `TABLE_CHECKLIST.md` rule applied to the stat cells too.
- **One value size**: `15px` for a primary value, `12px` for a secondary value,
  12px labels. A cell must not mix 15px and 12px values in the same group.
- **One row height per group.** A 56px cell with a 13px value leaves 43px of
  dead space — either the cell is 40px or it carries a third line (a delta or
  a hint).
- **No dead zones.** If a group ends at x873, the next starts at x881. Gaps are
  `8px`, never 121px or 200px.

### Grouping (the thing that makes it readable)
Four labelled groups, in reading order, separated by a hairline:

| group | contents | question it answers |
|---|---|---|
| **PRICE** | SPOT, regime, trend, flip | where are we |
| **WALLS** | call wall, put wall, pin, max pain | where is the battle |
| **VOLATILITY** | VIX, squeeze fuel, PCR (OI), PCR (VALUE) | how much energy |
| **FLOW / ACTION** | session verdict, setup checks, FII/DII, dealer gamma | what do I do |

The verdict row sits **above** all groups and is the largest text on the page.

## Rules that already bind us
- `src/ui/palette.ts` is the only colour source; `alpha()` for tints.
- Type floor 11px. Nothing smaller to make something fit.
- `flex-1 min-h-0` for anything that fills; never a fixed height in a flex panel.
- No nested bordered cards — one border per section, dividers inside.
- Every `data-testid` a test asserts must survive.

## Verification
- Measure with `getBoundingClientRect()` at the **real** window size. Do not
  call `resize_page`/`emulate` — it fails on a maximised window and yields fake
  numbers. State the viewport you measured at.
- A layout claim without a before/after rect table is rejected.
