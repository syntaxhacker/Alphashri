# Patterns — redesign (web app, visual)

1366×890 measured.

## The rule: web-app shell, adaptive density for data

```
CHROME / PANELS / BUTTONS          DATA GRIDS (>100 rows)
web-app look                        stay dense
  type 13–14px                        row 32px  (not 23 terminal, not 44 airy)
  padding 12–16px                     type 12px, numbers mono
  radius 6px, 1px border              no card wrap per row
  button 32px tall                    own scroll
  gap 8/12/16                         windowed (already)
```

A 44px-row screener shows 12 rows instead of 24 — that is a real cost, so grids keep 32px.
Everything *around* the grid gets the web-app treatment.

## Type & space scale (replaces the terminal one)

```
BEFORE (terminal)          AFTER (web app)
type      11px / 9px       13px body · 12px secondary · 11px micro
row       23px             32px
header    48px             48px (same, but 14px label)
pad       p-0.5 / p-1      p-3 (12px) / p-4 (16px)
gap       2 / 4 / 8        8 / 12 / 16
radius    1–2px            6px
border    every cell       only around groups
shadow    none             none (see perf)
button    20–24px          32px, px-3
```

## Page

```
BEFORE  chrome 132px, 5 hairlines, no grouping
┬ Scan ═╤ Watch ─ SCANNED 50 · PATTERNS 49 · IN VIEW 49 · CONFIRMED 18 · ▲35/▼11 · candle · scan 5h ┬ 31
├ SCOPE (All NSE)(NSE F&O)(Indices)[NIFTY 50](100)(200)(500)(Custom) [CACHED·17M][Force][▶Scan]      ┤ 26
├ ◯ Scanning ████░░░ 53% ─────────────────────────────────────── starting…                            ┤ 34
├ ⌕symbol │ 1D▾ │ Bars▾ ⎯ ▮replay ▮TLS/TLR ⎯ ⌕results │ Matrix│List│Grid │ ⚙Filters │ ⋮              ┤ 30
└ SYMBOL  PATTERN  SCORE BO DIR STATUS Q 52W% … ─────────────────────────────────────────────────────┘ 132

AFTER  chrome 116px, 2 groups, breathing room
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│  Patterns                                                            [Re-scan ▾]  [ ⋯ ]     │ 56
│                                                                                              │
│  ╭─ Scan ─╮ Watch                                                       49 of 50 · 18 conf  │ 44
│  ╰────────╯                    ▲ pill tabs, 6px radius, active = filled surface              │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│  [ All NSE · 2,757 ▾ ]  [ NIFTY 50 ]  [ ▾ 7 more ]        ⓘ stale 17m        [ ⚙ Filters 3 ]│ 48
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│  ⌕ Search symbol           1D ▾        Bars Auto ▾      ▮ Replay   ▮ TLS/TLR                │ 48
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│  SYMBOL          PATTERN            SCORE   BO   DIR   STATUS       52W%    CHG%     TRIGGER │ 36
│  TATASTEEL  F&O  Falling Wedge       93.9         ● CONFIRMED      16.2%  −0.68%       —     │ 32
│  SHRIRAMFIN F&O  Descending Chan.    93.0         ● CONFIRMED      13.0%  −3.37%       —     │ 32
│  KOTAKBANK       Ascending Chan.     90.5         ● CONFIRMED       0.1%  −0.38%     +2.4%   │ 32
│  …                                                                                          │
│  showing 80 of 312                                          [ Load 80 more ]  [ Load all ]   │ 40
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

## ⭐ Chart focus — why it matters more in a web app

```
LEVEL 0  split, chart 45%
┌────────────────────────┬─────────────────────────────────┐
│ TATASTEEL · Wedge   ⛶  │ SYMBOL        PATTERN    SCORE  │
│                        │ TATASTEEL     Falling W.  93.9  │
│      ╱╲   ╱╲          │ SHRIRAMFIN    Desc.      93.0  │
│    ╱    ╲╱  ╲         │ KOTAKBANK     Asc.       90.5  │
│  ▁▂▃▅▇█▇▅▃▂▁ ΔOI       │ …                              │
│  1m 5m 15m  PATTERNS   │                                 │
└────────────────────────┴─────────────────────────────────┘
        click the chart, or [ f ]  ↓

LEVEL 1  chart focus, 100%
┌──────────────────────────────────────────────────────────┐
│ TATASTEEL · Falling Wedge · 93.9 · CONFIRMED             │
│                                        [ ⤡ Exit · Esc ] │ 44
│                                                          │
│        ╱╲      ┌──────────────────────────────┐          │
│      ╱╲  ╲╱╲  │  CW 25,200  ·  PW 25,000      │          │
│    ╱    ╲     └──────────────────────────────┘          │
│  ▁▂▃▅▇█▇▅▃▂▁  ΔOI underlay                                │
│                                                          │
│  1m 5m 15m   PATTERNS   S M L XL       248 candles       │
├──────────────────────────────────────────────────────────┤
│  ▸ Results · 49 rows                              [ open ]│ 36
└──────────────────────────────────────────────────────────┘

LEVEL 2  ⛶ fullscreen modal (exists)
```

| | before | after |
|---|---|---|
| dock | fixed 620px | 45% → 100% on click |
| table when focused | stays 55% | 36px strip + `[open]` |
| exit | close chart, lose selection | `Esc`, selection kept |

## Cards — 3-up, not 4-up

```
BEFORE 4-up                                AFTER 3-up
┌────────────┐                            ┌──────────────────────────────┐
│ TATA  4 1D │                            │ TATASTEEL  ⛶   4 bars  ● CONF │
│ Wedge ●C T │                            │ Falling Wedge                 │
│┌──────────┐│ 90px                       │ ┌──────────────────────────┐ │
││ unread.  ││                            │ │   wedge legible  160px   │ │
│└──────────┘│                            │ │   248 candles · 1D       │ │
│93.9    0%  │                            │ └──────────────────────────┘ │
└────────────┘                            │ 93.9   16.2%   0%      —     │
                                            └──────────────────────────────┘
                                              radius 6 · p-3 · hover lifts border
```

## Tabs — pill, not underline

```
BEFORE  Scan ═╤ Watch            AFTER   ╭─ Scan ─╮ Watch
        flat, accent underline           ╰────────╯  filled active pill, 6px radius
```

## Filters — one sheet, one commit

```
BEFORE                             AFTER
rail stages ─[Filter]─► applied     ╭─ Filters ────────── 3 changes ─╮
chips ✕ ────► applied NOW           │ Symbols    [ ▾ ]               │
two models, no count                │ Direction  ● Bull  ○ Bear      │
                                    │ Min score  [────●──] 40        │
                                    │                       41 rows │
                                    │      [ Discard ]  [ Apply ]    │
                                    ╰────────────────────────────────╯
                                    chips also stage → one commit point
```

## Loading

```
BEFORE  ◯ spinner black page        AFTER  ┬ Pattern skeleton ──────────┐
                                           ├ ▭▭▭  ▭▭▭  (bands, 56/48)  │
                                           ├ ┌────┐ ┌────┐ ┌────┐      │
                                           └ └────┘ └────┘ └────┘      │
                                             no layout shift on arrival │
empty   "No results"                        "No patterns match 3 filters"
                                                     [ Clear filters ]
```

## Perf guardrails (non-negotiable)

```
KEEP                          FORBID
<For> over .map()             backdrop-filter / blur     ← compositing cost
windowed long lists           box-shadow on scrolling rows ← repaint per frame
canvas charts (heatmap)       animating height/width      ← layout thrash
lazy route chunks             large shadows on panels      ← paint on scroll
transform/opacity transitions nested bordered cards
container-visibility on cards (>200 rows)
32px grid rows (not 44)
```

Rule: **spacing and type grow, paint cost does not.** Air comes from gaps and padding,
which are free; never from blur, shadow or animation on a scroll path.

## Do first

```
1 ⭐ chart focus 45%→100%      M med   the chart is the payload
2 13px type + 32px rows       M med   web-app feel, grid stays scannable
3 pill tabs + 56px header     S low   reads as an app, not a sheet
4 unify buttons to 32px       S low   currently 20/24/28/32 mixed
5 group into cards (p-3)      M low   replaces hairline-per-row
6 filter sheet, one commit    M med   two models → one
7 load more in footer         M low   232 rows unreachable
8 ⓘ on 7 terms                S low   SCORE BO Q 52W% TLS/TLR Indices Bars
```

## Never change
`<For>` rows · memoised cards (0.18ms) · canvas heatmap · lazy chunks

## Ask
1 Watch = tab or route? 2 Matrix = view or List grouping? 3 32px rows or 28?
