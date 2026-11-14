# Patterns — redesign (visual)

1366×890 measured.

## The problem

```
┬ Scan ═╤ Watch ─── SCANNED 50 · PATTERNS 49 · IN VIEW 49 · CONFIRMED 18 · ▲35/▼11 · candle · scan 5h ┬ 31
├ SCOPE (All NSE)(NSE F&O)(Indices)[NIFTY 50](100)(200)(500)(Custom) [CACHED·17M][Force][▶Scan]        ┤ 26
├ ◯ Scanning 1D ████░░░ 53% ─────────────────────────────────────── starting…                         ┤ 34 ← pushes table
├ ⌕ symbol │ 1D ▾ │ Bars ▾ ⎯ ▮replay ▮TLS/TLR ⎯ ⌕results │ Matrix│List│Grid │ ⚙Filters │ ⋮            ┤ 30
└ SYMBOL  PATTERN  SCORE BO DIR STATUS Q 52W% POS% BARS PRICE CHG% TRIGGER ────────────────────────────┘ 132
                                                                                ▲ data starts 132
```

## Band 1 — counters

```
BEFORE  SCANNED 50 · PATTERNS 49 · IN VIEW 49 · CONFIRMED 18▸ · ▲35/▼11▸ · candle · scan 5h
              ▲3 numbers, 1 fact     ▲clickable but looks inert

AFTER   49 of 50 ✕ │ ▲35/▼11 ▸ │ 18 confirmed ▸ ──────── candle 11-12 18:30 · scan 5h
              ▲only when filtered                  ▲▸ = click to filter
```

## Band 2 — scope

```
BEFORE  SCOPE (All NSE 2,757)(NSE F&O 218)(Indices 52)[NIFTY 50 50](100)(200)(500)(Custom)  [Force][▶Scan]
              ▲10 pills · 9px labels · widest = least used

AFTER   SCOPE ┌──────────────┐ ┌────────┐ ┌────────┐        [stale 17m ▾] [Re-scan ▾]
              │ All NSE 2,757▾│ │NIFTY 50│ │▾ 7 more│
              └──────────────┘ └────────┘ └────────┘
                                            ▼
              ┌─────────────────────┐
              │ ✓ NIFTY 50 · 50     │
              │   NIFTY 100 · 100   │
              │   NSE F&O · 218     │
              │   Indices 52  ⓘmode │  ← changes what a row IS
              │   Custom… paste     │
              └─────────────────────┘
```

## Band 3 — tools

```
BEFORE  ⌕symbol │ 1D▾ │ Bars▾ ⎯ ▮replay ▮TLS/TLR ⎯ ⌕results │ Matrix│List│Grid │ Filters │ ⋮

AFTER   ⌕symbol │ 1D▾ │ Bars▾ⓘ ⎯ ▮replay ▮TLS/TLRⓘ ⎯ ⌕results │ Matrix│List│Grid │ Filters 3 │ ⋮
                                                                          ▲count now
```

## ⭐ Chart focus — chart is the payload here

```
LEVEL 0  split, chart 45% (default)
┌──────────────────────┬──────────────────────────────┐
│ TATASTEEL · Wedge ⛶  │ SYMBOL      PATTERN    SCORE │
│                      │ TATASTEEL   Falling W.  93.9 │
│    ╱╲   ╱╲          │ SHRIRAMFIN  Descending  93.0 │
│  ╱    ╲╱  ╲         │ KOTAKBANK   Ascending   90.5 │
│ ▁▂▃▅▇█▇▅▃▂▁ ΔOI     │ …      ↑ own scroll          │
└──────────────────────┴──────────────────────────────┘
        click chart or [f] ↓

LEVEL 1  chart focus, chart 100%
┌─────────────────────────────────────────────────────┐
│ TATASTEEL · Wedge · 93.9 · CONFIRMED   [⤡ exit · Esc]│
│                                                     │
│      ╱╲    ┌───────────────────────────┐            │
│    ╱╲  ╲╱╲ │ CW 25,200 · PW 25,000      │            │
│  ╱    ╲    └───────────────────────────┘            │
│ ▁▂▃▅▇█▇▅▃▂▁  ΔOI underlay                            │
│ 1m 5m 15m PATTERNS S M L XL      248 candles        │
├─────────────────────────────────────────────────────┤
│ ▸ RESULTS 49 rows  [restore]                         │ 20
└─────────────────────────────────────────────────────┘

LEVEL 2  ⛶ fullscreen modal (already exists)
```

| | before | after |
|---|---|---|
| dock width | fixed 620px | 45% → 100% on click |
| table when focused | still 55% | 20px strip + restore |
| exit | close chart, lose selection | Esc, selection kept |

## List rows

```
BEFORE  TATASTEEL F&O▾ Falling Wedge 93.9 ▲ CONFIRMED T 16.2% 0% 4 ₹188 -0.68% —
        ▲ F&O▾ = external · row = in-app · same look
        …80 rows… 232 more exist, unreachable, no hint

AFTER   TATASTEEL F&O↗ Falling Wedge 93.9ⓘ ▲ ●CONFIRMED ▰▰▰ 16.2%ⓘ 0% 4 ₹188 -0.68% —
        ▲ ↗ hover only, external · body = in-app
        └ showing 80 of 312 · 232 not rendered ──── [load 80 more]
```

## Cards

```
BEFORE 4-up, chart 90px              AFTER 3-up, chart 160px
┌───────────────┐                    ┌─────────────────────────────┐
│ TATA 4 1D     │                    │ TATASTEEL ⛶   4 1D ●CONF    │
│ Wedge ●CONF T │                    │ Falling Wedge      ▰▰▰ strong│
│ ┌───────────┐ │                    │ ┌─────────────────────────┐ │
│ │ unreadable│ │ 90px               │ │   wedge legible  160px  │ │
│ └───────────┘ │                    │ │ 248 candles · 1D        │ │
│ 93.9     0%   │                    │ └─────────────────────────┘ │
└───────────────┘                    │ 93.9  16.2%  0%  —          │
   no focus, 2 stats                 └─────────────────────────────┘
                                        focusable, 4 stats = List
```

## Filters — one model

```
BEFORE                              AFTER
rail stages ─[Filter]─► applied     rail stages ─[Filter·41]─► applied
chips  ✕ ───────────► applied NOW   chips  ✕ ─► staged too
      ▲ two mental models                  ▲ one commit point
no count, no dirty state            "3 changes" + "41 rows" preview
```

## Loading / empty

```
BEFORE  ◯ spinner, black page, ~4s     AFTER  ┬ Scan ═╤ Watch ░░ ░░ ░░ ┬
                                              ├ SCOPE ░░░░ ░░░░ ─────┤
                                              ├ ░░░ ░░░ ░░░ ─────────┤
                                              └ ┌───┐ ┌───┐ ┌───┐   │
empty   "No results"                          empty  "No match 3 filters"
                                                     [clear] [widen]
```

## Do first

```
1 49 of 50 + ▸ affordance      S low   3 numbers→1, filter stops hiding
2 universes → ▾ menu           S low   ends 9px labels
3 load more in footer          M low   232 rows reachable
4 symbol body/↗ split          S low   click inversion
5 grid 3-up ≤1440              S low   90px→160px chart
6 ⭐ chart focus               M med   45%→100%, table→strip
7 one filter model             M med   two models→one
8 progress = overlay           S low   stops pushing table
9 ⓘ on 7 terms                 S low   SCORE BO Q 52W% TLS/TLR Indices Bars
```

## Never change
`<For>` rows · memoised cards (0.18ms) · flat tabs · 3 bands

## Ask
1 `Scan again` + `Force` merge? 2 Watch = tab or route? 3 Matrix = view or List group?
