# Patterns — full redesign, BEFORE / AFTER

Measured at **1366×890** on the running app (`/patterns?tab=scan`).

---

## 0. Measured state

```
tab strip + counters    top   2  height 31
patterns-universe-bar   top  33  height 26
scan-progress           top  95  height 34
tools row               top 129  height 30
first table row         top 132  ← data begins 132px down
```

Chrome is **132px** — inside the ≤96 budget only if the counter strip is folded in.
The bigger problems are interaction, listed per component below.

---

# A. Patterns — Scan tab

## A0. Page shell

### BEFORE
```
┬ Scan ═╤═ Watch ─── SCANNED 50 · PATTERNS 49 · IN VIEW 49 · CONFIRMED 18 · BULL/BEAR 35/11 · LAST CANDLE 11-12 18:30 · LAST SCAN 5h ago ┬ 31
├───────────────▲ three numbers for one fact, two clickable but look inert─────────────────────────────────────────────────────────┤
├ SCOPE (All NSE 2,757)(NSE F&O 218)(Indices 52)[NIFTY 50 50](NIFTY 100 100)(NIFTY 200 200)(NIFTY 500 501)(Custom 🔗) [CACHED·17M][Force][▶ Scan] ┤ 26
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
├ ◯ Scanning NIFTY 50 · 1D ███████░░░░ 53% ─────────────────────────────────────────────────────── starting… ────────────────────────┤ 34
├ ⌕ symbol… │ Timeframe 1D ▾ │ Bars Auto ▾ │ ⎯ │ ▮ REPLAY SCAN │ ▮ TLS/TLR ⎯ ⌕ results │ Matrix│List│Grid │ ⚙ Filters │ ⋮ ┤ 30
├ SYMBOL      PATTERN          SCORE  BO  DIR  STATUS     Q  52W%  POS%  BARS  PRICE     CHG%    TO TRIGGER ┤ ← 132
```

### AFTER
```
┬ Scan ═╤═ Watch ─── 49 of 50 ▸ ✕ │ ▲35 / ▼11 ▸ │ 18 confirmed ▸ ──── candle 11-12 18:30 · scan 5h ago ┬ 31
├ SCOPE ┌───────────────┐ ┌──────────┐ ┌─────────┐                      ⟩ ⟩ ⟩  [stale 17m ▾] [Re-scan ▾] ┤ 26
│       │All NSE · 2,757▾│ │NIFTY 50  │ │▾ 7 more │
│       └───────────────┘ └──────────┘ └─────────┘
├ ⏳ Scanning NIFTY 50 · 1D ████░░░ 53% ── starting… ────────────────── [ hide ] ┤  clip, not push (overlay)
├ ⌕ symbol… │ 1D ▾ │ Bars Auto ▾ ⎯ ▮ replay │ ▮ TLS/TLR ⓘ ⎯─ ⌕ results │ Matrix│List│Grid │ Filters 3 │ ⋮ ┤ 30
├ SYMBOL      PATTERN          SCOREⓘ BOⓘ DIR  ●STATUS     Q  52W%  POS%  BARS  PRICE     CHG%    TRIGGER ┤ ← 89
```

| Element | BEFORE | AFTER |
|---|---|---|
| counters | `SCANNED 50 · PATTERNS 49 · IN VIEW 49` | `49 of 50` |
| clickable counters | no affordance | `▸` + hover underline + tooltip |
| active filter | invisible | `✕` chip on the counter strip |
| universes | 10 pills, 9px labels | menu control + `▾ 7 more` |
| progress bar | 34px band pushing the table down | overlay at the band edge, `[hide]` |
| `TLS/TLR`, `Bars` | unlabelled abbreviations | `ⓘ` tooltip |
| Filters button | `Filters` | `Filters 3` (active count) |
| data starts | 132px | **89px** |
| `52W%` meaning | ambiguous | header tooltip "below 52-week high" |

---

## A1. `ScanStats` — the counter strip

### BEFORE
```
SCANNED 50 · PATTERNS 49 · IN VIEW 49 · CONFIRMED 18 · BULL/BEAR 35/11 · LAST CANDLE 11-12 18:30 · LAST SCAN 5h ago
 9px        11px       9px         9px  ▸       9px  ▸   9px 11px           9px  11px
                                  ▲clickable    ▲clickable  (neither looks it)
```

### AFTER
```
unfiltered    50 scanned · ▸18 confirmed · ▸▲35 / ▼11 · candle 11-12 18:30 · scan 5h ago
filtered      49 of 50 ▸ ✕clear · ▸18 confirmed · ▸▲35 / ▼11 · candle 11-12 18:30 · scan 5h ago
                                    ▲ appears only when a filter is on
1366 overflow →  tail becomes ▾ (LAST SCAN etc. move to the scope row)
```

---

## A2. `UniverseBar`

### BEFORE
```
SCOPE (All NSE 2,757)(NSE F&O 218)(Indices 52)[NIFTY 50 50](NIFTY 100 100)(NIFTY 200 200)(NIFTY 500 501)(Custom 🔗)   [CACHED·17 MIN AGO][Force re-run][▶ Scan again]
      ▲ 10 pills · 9px labels at 1366 · widest pill = least used · no grouping
```

### AFTER
```
SCOPE ┌─────────────────────┐ ┌──────────┐ ┌─────────┐                     [stale 17m ▾] [Re-scan ▾]
      │ All NSE · 2,757   ▾ │ │ NIFTY 50 │ │ ▾ 7 more│
      └─────────────────────┘ └──────────┘ └─────────┘
                                     ▼ open
      ┌───────────────────────────────┐
      │ ✓ NIFTY 50 · 50               │
      │   NIFTY 100 · 100             │
      │   NIFTY 200 · 200             │
      │   NIFTY 500 · 501             │
      │ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │
      │   NSE F&O · 218               │
      │   Indices · 52      ⓘ mode     │  ← changes what a row IS
      │ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │
      │   Custom… (paste symbols)     │
      └───────────────────────────────┘
```

---

## A3. `PatternListView` — the table

### BEFORE
```
SYMBOL           PATTERN            SCORE  BO  DIR  STATUS     Q  52W%   POS%  BARS  PRICE     CHG%    TO TRIGGER
TATASTEEL  F&O ▾ Falling Wedge       93.9  ▲    CONFIRMED  T  16.2%    0%     4  ₹188.00  -0.68%   —
SHRIRAMFIN F&O ▾ Descending Channel  93.0  ▼    CONFIRMED  T  13.0%    0%    29  ₹970.00  -3.37%   —
…
… row 80 ────────────────── 232 more rows exist, unreachable, no indication ──────────────────
      ▲ F&O ▾ = external TradingView · row click = in-app chart · same visual weight
```

### AFTER
```
SYMBOL           PATTERN            SCOREⓘ BOⓘ DIR  ●STATUS     Q▰  52W%ⓘ  POS%  BARS  PRICE     CHG%    TRIGGER
TATASTEEL  F&O↗  Falling Wedge       93.9  ▲    ●CONFIRMED  ▰▰▰ 16.2%    0%     4  ₹188.00  -0.68%   —
SHRIRAMFIN F&O↗  Descending Channel  93.0  ▼    ●CONFIRMED  ▰▰▱ 13.0%    0%    29  ₹970.00  -3.37%   —
…
… row 80 …
├ showing 80 of 312 · 232 not rendered  ─────────────  [ load 80 more ▾ ]  [ load all ] ┤ 18
     ▲ F&O↗ appears on hover only, and ↗ = external. Card body = in-app chart.
```

| Element | BEFORE | AFTER |
|---|---|---|
| symbol cell | TV link + chart icon, identical weight | body → in-app; `↗` on hover → external |
| rows 81-312 | unreachable | footer + `load more` (client slice) |
| `SCORE` / `BO` | two unexplained numbers | `ⓘ` on each header |
| `52W%` | ambiguous sign | `ⓘ` "gap to 52w high" + the sign stated |
| `Q` glyph | `T` / `S` / `F` | `▰▰▰` meter |
| keyboard | Tab only | `/` `f` `↑↓` `Enter` `Esc` |
| empty w/ filter | "No results" | "No patterns match 3 filters — [clear]" |

---

## A4. `PatternGrid` + `PatternCard`

### BEFORE — 4-up at 1366, chart ≈ 250×90
```
┌───────────────────────────────────┐ ┌───────────────────────────────────┐ ┌───────────────────────┐ ┌───────────────────────┐
│ TATASTEEL            4 1D ago     │ │ SHRIRAMFIN          29 1D ago     │ │ KOTAKBANK   25 1D     │ │ COALINDIA   8 1D      │
│ Falling Wedge  ●CONFIRMED   T     │ │ Descending Ch. ●CONFIRMED  T      │ │ Ascending   ●CONF  T  │ │ Falling Wedge ●FAIL T │
│ ┌───────────────────────────────┐ │ │ ┌───────────────────────────────┐ │ │ ┌───────────────────┐ │ │ ┌───────────────────┐ │
│ │ ∿∿ wedge unreadable at 90px ∿ │ │ │ │ ∿∿ channel unreadable ∿∿∿∿∿∿∿ │ │ │ │ ∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿ │ │ │ │ ∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿ │ │
│ └───────────────────────────────┘ │ │ └───────────────────────────────┘ │ └───────────────────┘ │ └───────────────────┘ │
│ SCORE 93.9            POS 0%      │ │ SCORE 93.0            POS 0%      │ │ 90.5      0%          │ │ 89.8       0%         │
└───────────────────────────────────┘ └───────────────────────────────────┘ └───────────────────────┘ └───────────────────────┘
   ▲ no Tab focus · no hover state · only 2 stats vs 12 columns in List
```

### AFTER — 3-up at ≤1440, chart ≈ 420×160
```
┌──────────────────────────────────────────────────────┐ ┌────────────────────────────────────┐ ┌──────────────────────────┐
│ TATASTEEL   ⛶             4 1D ago   ● CONFIRMED     │ │ SHRIRAMFIN ⛶  29 1D  ● CONFIRMED   │ │ KOTAKBANK ⛶  25 1D ●CONF │
│ Falling Wedge                          ▰▰▰ strong     │ │ Descending Channel      ▰▰▱ medium │ │ Ascending Ch.   ▰▰▰      │
│ ┌──────────────────────────────────────────────────┐ │ │ ┌────────────────────────────────┐ │ │ ┌──────────────────────┐ │
│ │        ∿∿∿∿  wedge legible at 160px  ∿∿∿∿         │ │ │ │      ∿∿ channel ∿∿∿∿           │ │ │ │    ∿∿ channel ∿∿     │ │
│ │                                                   │ │ │ │                                │ │ │ │                      │ │
│ │  248 candles · 1D · through 11-12 18:30           │ │ │ │                                │ │ │ │                      │ │
│ └──────────────────────────────────────────────────┘ │ │ └────────────────────────────────┘ │ │ └──────────────────────┘ │
│ SCORE 93.9   52W% 16.2%   POS 0%      TRIGGER —      │ │ 93.0  13.0%  0%  —                 │ │ 90.5  0.1%  0%  −        │
└──────────────────────────────────────────────────────┘ └────────────────────────────────────┘ └──────────────────────────┘
    ▲ focus ring · Enter = chart · ⛶ = fullscreen · strip vocabulary matches List
```

| Element | BEFORE | AFTER |
|---|---|---|
| columns at 1366 | 4-up, chart 90px | 3-up, chart 160px |
| stat strip | SCORE, POS (2) | SCORE, 52W%, POS, TRIGGER (4) — same as List |
| quality | glyph `T` | `▰▰▰ strong` |
| focus | none | focusable card + ring; `Enter` opens |
| chart floor | `flex-1`, can collapse | `min-height: 140px` |

---

## A5. `PatternFilterRail` + `AppliedFilters` — two mental models

### BEFORE
```
FILTER RAIL (staged)                          APPLIED CHIPS (instant)
┌ Filters ─────────────────────── ✕ ┐        ┌──────────────────────────────────┐
│ SYMBOLS      [multi ▾]            │        │ [Family: Reversal ✕] [Bullish ✕] │ ← removes NOW
│ PATTERN      [multi ▾]            │        │  +2                              │
│ DIRECTION    ● Bull  ○ Bear       │        └──────────────────────────────────┘
│ QUALITY      ☑ strong ☑ medium    │
│ MIN SCORE    [──●──────] 40       │         ▲ rail edits change nothing
│                        [Reset][Filter] │     ▲ chips change everything
└───────────────────────────────────┘
        ▲ Filter shows no count, no dirty state, Esc is undiscoverable
```

### AFTER
```
FILTER RAIL (staged)                          THE BAR (one commit point)
┌ Filters ─────────────── 3 changes ┐        ┌──────────────────────────────────────────────┐
│ SYMBOLS      [multi ▾]            │        │ ● 3 unapplied   [ Discard ]  [ Filter · 41 ] │
│ PATTERN      [multi ▾]            │        ├──────────────────────────────────────────────┤
│ DIRECTION    ● Bull  ○ Bear       │        │ [Family: Reversal ✕] [Bullish ✕]  +2          │
│ QUALITY      ☑ strong ☑ medium    │        └──────────────────────────────────────────────┘
│ MIN SCORE    [──●──────] 40  41 rows │              ▲ count = live result preview
│                    [Reset] [Filter·41]│              ▲ the ONLY place filters commit
└─────────────────────────────────────┘
Esc / [Discard] → revert · Enter / [Filter] → apply
```

| Element | BEFORE | AFTER |
|---|---|---|
| rail control | silent stage | `3 changes` in the header, `41 rows` preview |
| chip `✕` | instant | staged, same as the rail |
| commit | rail **and** chips | one button / `Enter` |
| Escape | undiscoverable | a `[Discard]` button with the same action |

---

## A6. `PatternSymbolMatrix`

### BEFORE
```
          │ 1D        │ 1W      │ 1M      │ 3M
NIFTY 50  │ ●●        │ ●       │         │ ●●●
          ▲  weight and colour unexplained; blank could mean "none" or "not scanned"
```

### AFTER
```
          │ 1D              │ 1W          │ 1M          │ 3M
NIFTY 50  │ ▰▰ 2 patterns   │ ▰ 1         │ —           │ ▰▰▰ 3
          ▲ width = count · colour = direction · hover lists names · — = scanned, none
          ▲ header click sorts symbols by that timeframe's count
```

---

## A7. Watch tab

### BEFORE
```
┌ Long-base breakout ▾ │ Vol (adj) ≥ [0.7] │ Refresh ───────────── updated 12:04 · 2m · ● live ┐ 36
│ Long tight base; trigger = box high, invalidate = box low · Long-base breakout · Vol ≥ 0.7    │ 24
│ ⌕ symbol │ All states ▾ │ ≤ % of trigger [5] │ ▣ hide inval │ ▣ hide ETFs │ 2/2 │ CSV │ Symbols │ 32
        ▲ "Vol (adj) ≥ 0.7" looks like a filter but only applies on the NEXT scan
```

### AFTER
```
┌ Long-base breakout ▾ │ Vol (adj) ≥ [0.7] ⓘ next scan ▸ │ Refresh ────── updated 12:04 · 2m · ● live ┐
│ Long tight base; trigger = box high, invalidate = box low · gate applies on re-scan               │
│ ⌕ symbol │ All states ● ARM ● FRESH ● CONF ▾ │ ≤ % of trigger [5] ⓘ │ ▣ hide inval ⓘ │ ▣ hide ETFs ⓘ │
        ▲ state filter shows its legend inline · ⓘ marks instant vs scan-time controls
```

---

## A8. Loading, empty, error

### BEFORE
```
loading   ◯  (centred spinner, whole page black, ~4s on cold load)
empty     ┌──────────────┐
          │ No results   │
          └──────────────┘
error     ⚠ alert above the table, content still blank
```

### AFTER
```
loading   ┬ Scan ═╤═ Watch ── ░░ ░░ ░░ ┬   ← bands paint instantly
          ├ SCOPE ░░░░ ░░░░ ░░░░ ──────┤
          ├ ░░░ ░░░ ░░░ ░░░ ────────────┤
          ├ ┌─────┐ ┌─────┐ ┌─────┐     │   ← card skeleton, no shift
          │ └─────┘ └─────┘ └─────┘     │
empty     │  No patterns match 3 filters │
          │  [ clear filters ]  [ widen scope ] │   ← the way out
error     │  Scan failed: rate limited     │
          │  [ retry ]  [ force re-run ]   │
```

---

# B. Interaction map

## BEFORE
```
counter CONFIRMED ──► filters (looks inert, nobody finds it)
Filters ────────────► rail stages ──[Filter]──► applied
chip ✕ ─────────────► applies IMMEDIATELY  (second model)
row click ──────────► in-app chart
symbol cell ────────► TradingView (external)  ← same look, different place
rows 81-312 ────────► unreachable, no mention
progress bar ───────► pushes the table down as it animates
```

## AFTER
```
counter ▸ ──────────► filters (arrow + hover + tooltip say so)
Filters 3 ──────────► rail stages ──[Filter · 41]──► applied
                              └─[Discard]/Esc──► reverted
chip ✕ ─────────────► stages too, then [Filter · 41]   (one model)
row click ──────────► in-app chart
symbol ↗ ───────────► external, hover-only, marked
footer [load more] ─► rows 81-312 appear (client slice, no refetch)
progress ───────────► overlay at the band edge, [hide], never pushes
/ ─► search   f ─► filters   ↑↓ ─► rows   Enter ─► chart   Esc ─► clear
```

---

# C. Ranked backlog

| # | Change | Gain | Effort | Risk |
|---|---|---|---|---|
| 1 | `49 of 50` + clickable-counter affordance | 3 numbers → 1; a filter stops hiding | S | low |
| 2 | Universe pills → control + `▾ more` | ends 9px labels at 1366 | S | low |
| 3 | `load more` in the footer | 232 of 312 rows become reachable | M | low |
| 4 | Symbol cell: body = in-app, `↗` = external | the click inversion | S | low |
| 5 | Grid 3-up ≤1440 | 90px chart cannot show a wedge | S | low |
| 6 | One filter model (chips stage) | two models, one dataset | M | med |
| 7 | Rail `3 changes` + `Filter · 41` | staging is invisible | M | med |
| 8 | Progress bar as an overlay | it currently pushes the table | S | low |
| 9 | `ⓘ` on SCORE/BO/Q/52W%/TLS-TLR/Indices/Bars | seven unlabelled terms | S | low |
| 10 | Card keyboard focus + `Enter` | 312 rows, Tab-only | M | low |
| 11 | Matrix cell meter + legend | dense grid, no legend | S | med |
| 12 | Watch: `ⓘ next scan ▸` | silently does nothing today | S | low |
| 13 | Empty state offers the way out | "No results" is a dead end | S | low |

## D. Do not change

- 3-band composition (132px → 89px once progress is an overlay).
- `<For>` rows, memoised card derivation (~0.18ms identical update).
- Flat tab strip with accent underline.
- Rail staging as a concept — only the feedback is missing.

## E. Open questions

1. `Scan again` + `Force re-run` merge, or keep both with a modifier?
2. Watch: tab or its own route?
3. Matrix: third view, or a List grouping?
4. Counters: chrome, or the table's own header?
