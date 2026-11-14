# Patterns — redesign spec

Scope: `/patterns` (Scan + Watch), `src/components/patterns/**` (37 components), `src/pages/patterns/PatternsPage.tsx`.
Analysis only; no code changed.

Every section below is an **old → new** pair. `BEFORE` is what ships today, `AFTER` is the proposal.

---

## 0. Page shell — the whole page

### BEFORE (measured: chrome 97px, 3 bands)

```
┌ Scan ══╤═ Watch ────────────── SCANNED 50 · PATTERNS 49 · IN VIEW 49 · CONFIRMED 18 · BULL/BEAR 35/11 · LAST CANDLE 11-12 18:30 · LAST SCAN 5h ago ┐ 31
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ SCOPE (All NSE 2,757)(NSE F&O 218)(Indices 52)[NIFTY 50 50](NIFTY 100 100)(NIFTY 200 200)(NIFTY 500 501)(Custom 🔗)  [CACHED · 17 MIN AGO][Force re-run][▶ Scan again] │ 26
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ ⌕ symbol… │ Timeframe 1D ▾ │ Bars Auto ▾ │ ⎯ │ ▮ REPLAY SCAN │ ▮ TLS/TLR ⎯ ⌕ Search results… │ Matrix│List│Grid │ ⚙ Filters │ ⋮ │ 30
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ SYMBOL        PATTERN          SCORE  BO  DIR  STATUS     Q  52W%   POS%  BARS  PRICE    CHG%    TO TRIGGER                                │  ← data 97px
```

### AFTER (chrome 88px, counters folded into the tab row, one filter model)

```
┌ Scan ══╤═ Watch ──── 49 of 50 ▸ ✕filter ──────── CONFIRMED 18 ▸  BULL/BEAR 35/11 ▸ ─────── 5h ago ┐ 31
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ SCOPE [All NSE 2,757] │ [NIFTY 50 50] │ ▾ 7 more │ ⓘ Indices = sector-mode  ⟩ ⟩ ⟩  [stale 17m ▾]  [Re-scan ▾] │ 26
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ ⌕ symbol… │ 1D ▾ │ Bars Auto ▾ ⎯ ▮ replay │ ▮ TLS/TLR ⓘ ⎯──── ⌕ results │ Matrix│List│Grid │ Filters 3 │ ⋮ │ 30
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ SYMBOL        PATTERN          SCORE  BO  DIR  STATUS     Q  52W%   POS%  BARS  PRICE    CHG%    TO TRIGGER                                │
```

What changed, and why:

| Change | Why |
|---|---|
| `49 of 50` replaces SCANNED/PATTERNS/IN VIEW | three numbers stated one fact; frees ~200px |
| `CONFIRMED 18 ▸` / `BULL/BEAR 35/11 ▸` | `▸` = clickable filter. Today they look inert but **are** clickable |
| `✕filter` appears only when a filter is on | there is no way to see that a filter is active today |
| `▾ 7 more` for universes | 10 pills forced 9px labels at 1366 |
| `ⓘ Indices = sector-mode` | `Indices` is a *mode*, not a universe, and sits in the same grammar |
| `TLS/TLR ⓘ` | unexplained abbreviation, no tooltip on the label |
| `Re-scan ▾` merges Scan again + Force re-run | two buttons, one intent, no visible difference |
| `Filters 3` | shows the active count on the button, not only inside the modal |

---

## 1. `ScanStats` — counters

### BEFORE

```
SCANNED 50 · PATTERNS 49 · IN VIEW 49 · CONFIRMED 18 · BULL/BEAR 35/11 · LAST CANDLE 11-12 18:30 · LAST SCAN 5h ago
 9px      11px        9px         9px        9px  9px   11px     9px   9px   11px      9px
```

### AFTER (two states)

```
no filter:    50 scanned · 18 confirmed ▸ · ▲35 / ▼11 ▸ · candle 11-12 18:30 · scan 5h ago
filtered:     49 of 50 ▸ ✕ clear · 18 confirmed ▸ · ▲35 / ▼11 ▸ · candle 11-12 18:30 · scan 5h ago
                      ▲ only when a filter is active
```

| Element | BEFORE | AFTER |
|---|---|---|
| count | `SCANNED 50` + `PATTERNS 49` + `IN VIEW 49` | `49 of 50` |
| clickable | CONFIRMED, BULL/BEAR (no affordance) | `▸` suffix + hover underline + tooltip "filter by …" |
| age | `LAST SCAN 5h ago` inside the strip | `scan 5h ago`, and the cache age moves to the scope row |
| overflow | truncates silently at 1366 | tail is a `▾` menu |

---

## 2. `UniverseBar` — scope pills

### BEFORE

```
SCOPE (All NSE 2,757)(NSE F&O 218)(Indices 52)[NIFTY 50 50](NIFTY 100 100)(NIFTY 200 200)(NIFTY 500 501)(Custom 🔗)   [CACHED · 17 MIN AGO][Force re-run][▶ Scan again]
       └─ 10 pills, 9px labels at 1366, the widest is the least used
```

### AFTER

```
SCOPE ┌───────────────────┐ ┌──────────┐ ┌─────────┐                          [stale 17m ▾] [Re-scan ▾]
      │ All NSE · 2,757 ▾ │ │ NIFTY 50 │ │ ▾ 7 more│
      └───────────────────┘ └──────────┘ └─────────┘
            ▲ active in a menu-shaped control, count inside
```

```
▾ 7 more (open)
┌────────────────────────────┐
│ ✓ NIFTY 50 · 50            │
│   NIFTY 100 · 100          │
│   NIFTY 200 · 200          │
│   NIFTY 500 · 501          │
│ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │
│   NSE F&O · 218            │
│   Indices · 52   ⓘ mode    │
│ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │
│   Custom… (paste symbols)  │
└────────────────────────────┘
```

| Element | Interaction |
|---|---|
| active universe | click → nothing (already active); the menu keeps ✓ |
| `▾ 7 more` | opens the menu; last-used items float to the top |
| `Indices` | marked `ⓘ mode` — selecting it changes what a row *is* |
| `Custom…` | opens the paste-symbols modal |
| `stale 17m ▾` | hover → scan-session timestamp; click → force re-run |

---

## 3. `PatternListView` — the table

### BEFORE

```
SYMBOL             PATTERN           SCORE  BO   DIR  STATUS      Q  52W%    POS%  BARS  PRICE      CHG%    TO TRIGGER
TATASTEEL   F&O ▾  Falling Wedge      93.9  ▲     CONFIRMED   T  16.2%     0%     4  ₹188.00   -0.68%   —
SHIRAMFIN   F&O ▾  Descending Channel 93.0  ▼     CONFIRMED   T  13.0%     0%    29  ₹970.00   -3.37%   —
…
… 80 rows …                          ── rows 81-312 are unreachable, no indication ──
```

### AFTER

```
SYMBOL             PATTERN           SCOREⓘ BOⓘ  DIR  STATUS      Qⓘ 52W%    POS%  BARS  PRICE      CHG%    TO TRIGGER
TATASTEEL   F&O ⌗  Falling Wedge      93.9  ▲     ●CONFIRMED  ▰  16.2%     0%     4  ₹188.00   -0.68%   —
SHIRAMFIN   F&O ⌗  Descending Channel 93.0  ▼     ●CONFIRMED  ▰  13.0%     0%    29  ₹970.00   -3.37%   —
…
… 80 rows …
├──────────────────────────────────────────────────────────────────────────────────────┤
│ showing 80 of 312 · 232 not rendered          [ load 80 more ▾ ]  [ load all ]      │ 18px
└──────────────────────────────────────────────────────────────────────────────────────┘
```

| Element | BEFORE | AFTER |
|---|---|---|
| symbol cell | TV link + chart icon, **two different destinations**, identical look | `TATASTEEL` → in-app chart; TV glyph only on hover → external, with `↗` |
| padded rows | `rowWindowSize` slice, nothing after row 80 | footer + `load more` (client slice, no refetch) |
| `SCORE` / `BO` | two scores, no explanation | `ⓘ` on hover: "fit confidence (geometry, R², volume)" / "breakout conviction" |
| `Q` column | single glyph `T`/`S`/`F` | `▰▰▰`/`▰▰▱`/`▰▱▱` — reads without a legend |
| sort | header click only | header click + `ⓘ` states the direction meaning for `52W%` (gap, not gain) |
| keyboard | Tab only | `/` search · `f` filters · `↑↓` rows · `Enter` chart · `Esc` clear |

---

## 4. `PatternGrid` + `PatternCard`

### BEFORE — 4-up at 1366, chart ≈ 250×90

```
┌───────────────────────────────────┐ ┌───────────────────────────────────┐
│ TATASTEEL            4 1D ago     │ │ SHIRAMFIN           29 1D ago     │
│ Falling Wedge   ●CONFIRMED  T     │ │ Descending Channel  ●CONFIRMED T  │
│ ┌───────────────────────────────┐ │ │ ┌───────────────────────────────┐ │
│ │ ∿∿∿∿∿ sparkline + wedge ∿∿∿∿∿ │ │ │ │ ∿∿∿∿∿ wedge unreadable ∿∿∿∿∿∿ │ │  ← 90px
│ └───────────────────────────────┘ │ │ └───────────────────────────────┘ │
│ SCORE 93.9              POS 0%    │ │ SCORE 93.0              POS 0%    │
└───────────────────────────────────┘ └───────────────────────────────────┘
                ▲ cannot Tab to a card · no hover state on the tile
```

### AFTER — 3-up at ≤1440, chart ≈ 420×160, keyboard reachable

```
┌──────────────────────────────────────────────────┐ ┌──────────────────────────────┐ ┌──────────────────────────┐
│ TATASTEEL   ⌗            4 1D ago   ● CONFIRMED  │ │ SHIRAMFIN  ⌗  29 1D  ● CONF  │ │ KOTAKBANK ⌗  25 1D ● CONF│
│ Falling Wedge                        ▰▰▰ strong  │ │ Descending Channel     ▰▰▱  │ │ Ascending Channel  ▰▰▰  │
│ ┌──────────────────────────────────────────────┐ │ │ ┌──────────────────────────┐ │ │ ┌──────────────────────┐ │
│ │         ∿∿∿∿∿  wedge legible  ∿∿∿∿∿          │ │ │ │  ∿∿∿∿ channel ∿∿∿∿       │ │ │ │  ∿∿ channel ∿∿        │ │
│ │                                              │ │ │ │                          │ │ │ │                      │ │
│ │ 248 candles · 1D · through 11-12 18:30       │ │ │ │                          │ │ │ │                      │ │
│ └──────────────────────────────────────────────┘ │ │ └──────────────────────────┘ │ │ └──────────────────────┘ │
│ SCORE 93.9    52W% 16.2%    POS 0%    TRIGGER —  │ │ 93.0  13.0%  0%  —           │ │ 90.5  0.1%  0%  −        │
└──────────────────────────────────────────────────┘ └──────────────────────────────┘ └──────────────────────────┘
   ▲ focus ring on Tab · Enter opens chart · ⌗ = open fullscreen
```

| Element | BEFORE | AFTER |
|---|---|---|
| columns at 1366 | 4-up, chart 90px tall | 3-up, chart 160px |
| stat strip | 2 numbers (SCORE, POS) | 4 (SCORE, 52W%, POS, TRIGGER) — same vocabulary as List |
| quality | one glyph `T` | `▰▰▰ strong` (word + meter) |
| focus | none | whole card is a focus target with a visible ring |
| expand | icon only | icon + `Enter` when focused |
| chart | `flex-1` with no floor | `min-height: 140px` so it never collapses |

---

## 5. `PatternFilterRail` + `AppliedFilters` — the two mental models

### BEFORE — rail stages, chips apply instantly

```
rail (staged)                                   chips (instant)
┌ Filters ────────────────────── ✕ ┐           ┌──────────────────────────────────────┐
│ SYMBOLS     [multi-select]        │           │ [Family: Reversal ✕] [Bullish ✕] +2 │ ← applies now
│ PATTERN     [multi-select]        │           └──────────────────────────────────────┘
│ DIRECTION   ● Bull ● Bear         │
│ QUALITY     ☑ strong ☑ medium     │            ▲ rail edits do NOT change rows
│ MIN SCORE   [────●────] 40        │            ▲ chips DO. Two models, one dataset.
│                        [Reset][Filter] │
└───────────────────────────────────┘
      ▲ Filter shows no count and no dirty state
```

### AFTER — one model: everything stages, the bar is the commit point

```
rail (staged)                                   bar (shows pending + committed)
┌ Filters ──────────────── 3 changes ┐          ┌────────────────────────────────────────────┐
│ SYMBOLS     [multi-select]          │          │ [Family: Reversal ✕] [Bullish ✕]  +2       │
│ PATTERN     [multi-select]          │          │  ─── committed ───────────────────────────  │
│ DIRECTION   ● Bull ○ Bear           │          │ ● 3 unapplied   [ Discard ]  [ Filter · 41 ]│
│ QUALITY     ☑ strong ☑ medium       │          └────────────────────────────────────────────┘
│ MIN SCORE   [──●──────] 40  41 rows │                        ▲ count = result preview
│                    [Reset] [Filter·41]│                      ▲ Filter is the only commit
└─────────────────────────────────────┘
Esc / backdrop → Discard · Enter → Filter
```

| Element | BEFORE | AFTER |
|---|---|---|
| rail control | stages silently | stages, header shows `3 changes`, footer previews `41 rows` |
| chip `✕` | removes immediately | stages like everything else |
| Filter button | no count, no dirty state | `Filter · 41` + disabled when nothing pending |
| Escape | discards (undiscoverable) | `[ Discard ]` button, same action |
| Commit point | two (rail + chips) | one (the Filter button / Enter) |

---

## 6. `PatternSymbolMatrix`

### BEFORE
```
        │ 1D          │ 1W          │ 1M          │ 3M
NIFTY50 │ ● ●         │ ●           │             │ ● ● ●
        │ ▲▲ (unexplained colour/weight)
```

### AFTER
```
        │ 1D              │ 1W              │ 1M              │ 3M
NIFTY50 │ ▰▰ 2 patterns   │ ▰ 1             │ —               │ ▰▰▰ 3
        │  ▲ weight = pattern count · colour = dominant direction · hover = list
```

| Element | BEFORE | AFTER |
|---|---|---|
| cell | dot(s), no legend | meter whose width = count, colour = direction, tooltip lists names |
| header | inert | click sorts symbols by that timeframe's count |
| empty | blank | `—` so "no pattern" ≠ "not scanned" |

---

## 7. Watch tab

### BEFORE
```
┌ Long-base breakout ▾ │ Vol (adj) ≥ [0.7] │ Refresh ─────────────── updated 12:04 · 2m · ● live ┐
│ Long tight base; trigger = box high, invalidate = box low · Long-base breakout · Vol(adj) ≥ 0.7 │
│ ⌕ symbol │ All states ▾ │ ≤ % of trigger [5] │ ▣ hide inval │ ▣ hide ETFs │ 2/2 │ CSV │ Symbols │
```
The `Vol (adj) ≥ 0.7` gate **only applies on the next scan** but looks like a live filter.

### AFTER
```
┌ Long-base breakout ▾ │ Vol (adj) ≥ [0.7] ⓘ next scan ▸ │ Refresh ────── updated 12:04 · 2m · ● live ┐
│ Long tight base; trigger = box high, invalidate = box low · gate applies on re-scan              │
│ ⌕ symbol │ All states ▾ │ ≤ % of trigger [5] │ ▣ hide inval ⓘ │ ▣ hide ETFs ⓘ │ 2/2 │ CSV │ Symbols │
```
`ⓘ next scan ▸` + the inline note make the distinction explicit. The two hide toggles get `ⓘ` so it is
clear they are client-side.

| Element | BEFORE | AFTER |
|---|---|---|
| vol-adj gate | looks like a filter, is scan-time | `ⓘ next scan ▸` label |
| state badges | ARMED/FRESH/CONFIRMED, no legend | legend popover on the header |
| hide toggles | plain switches | `ⓘ` marks them as instant/client-side |

---

## 8. Empty / loading / error states

### BEFORE
```
loading:  ◯ (centred spinner, black page)          empty:  ┌────────────┐
                                                   │ No results │
                                                   └────────────┘
```

### AFTER
```
loading:  ┌ Scan ═╤═ Watch ── [skeleton stat blocks] ┐   ← bands paint immediately
          ├ SCOPE [skeleton pills] ────────────────┤
          ├ [skeleton tool row] ───────────────────┤
          ├ ┌───────┐ ┌───────┐ ┌───────┐           │   ← card skeleton, no shift
          │ └───────┘ └───────┘ └───────┘           │
empty:    │  No patterns match these filters       │
          │  [ clear 3 filters ]  [ widen scope ]  │   ← the way out, not just a message
```

| State | BEFORE | AFTER |
|---|---|---|
| loading | centred spinner, whole page dark | band + card skeleton (shipped) |
| empty w/ filters | "No results" | states the cause + one-click clear |
| empty no filters | "No results" | "Scan returned nothing for NIFTY 50 — widen scope" |
| error | alert above the table | alert + `Retry` + `Force re-run` |

---

## 9. Interaction map — old vs new

### BEFORE
```
  counter (CONFIRMED) ──► filter applied   (looks inert, so nobody finds it)
  Filters ──► rail stages ──[Filter]──► applied
  chip ✕ ──► applied IMMEDIATELY          (second model)
  row click ──► in-app chart
  symbol cell ──► TradingView (external)   (same look, different destination)
  rows 81-312 ──► unreachable
```

### AFTER
```
  counter ▸ ─────► filter applied        (arrow + hover says so)
  Filters 3 ─────► rail stages ──[Filter·41]──► applied
                            └─[Discard]/Esc──► discarded
  chip ✕ ────────► STAGED, then [Filter·41]  (one model)
  row click ─────► in-app chart
  TV glyph ──────► external, with ↗ and hover-only
  footer [load more] ──► rows 81-312 appear (client slice, no refetch)
  / ──► focus search      f ──► filters      ↑↓ ──► move    Enter ──► chart
```

---

## 10. Ranked backlog

| # | Change | Why | Effort | Risk |
|---|---|---|---|---|
| 1 | `49 of 50` + clickable-counter affordance | three numbers became one; a filter stops hiding | S | low |
| 2 | Universe pills → control + `▾ more` menu | 10 pills force 9px labels at 1366 | S | low |
| 3 | `load more` in the existing footer | 232 of 312 rows unreachable | M | low |
| 4 | Symbol cell: in-app vs external split | the click inversion every pro trips on | S | low |
| 5 | Grid 3-up at ≤1440 | 90px chart cannot show a wedge | S | low |
| 6 | One filter model (chips stage too) | two models for one dataset | M | med |
| 7 | Rail: `3 changes` + `Filter · 41` preview | staging is invisible today | M | med |
| 8 | `ⓘ` on SCORE / BO / Q / TLS-TLR / Indices | seven unlabelled abbreviations | S | low |
| 9 | Card keyboard focus + `Enter` | 312 rows, Tab-only navigation | M | low |
| 10 | Matrix cell weight + legend | dense grid with no legend | S | med |
| 11 | Watch: `ⓘ next scan ▸` on the gate | silently does nothing today | S | low |
| 12 | Empty state offers the way out | "No results" is a dead end | S | low |

---

## 11. Do not change

- The three-band composition; chrome is at 97px, inside the ≤96 budget once the counters fold.
- `<For>`-based rows and the memoised card derivation (~0.18ms identical update).
- The flat tab strip with an accent underline.
- Rail staging as a *concept* — only the feedback is missing.

## 12. Open questions

1. Merge `Scan again` + `Force re-run`, or keep both with a modifier?
2. Is Watch a tab or its own route (own setup, own polling)?
3. Keep Matrix as a third view, or make it a List grouping?
4. Move the counters into the table header (data, not chrome)?
