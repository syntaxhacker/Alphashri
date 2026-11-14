# Patterns — redesign spec

Scope: `/patterns` (Scan + Watch), `src/components/patterns/**` (37 components) and
`src/pages/patterns/PatternsPage.tsx`. Analysis only; no code changed.

---

## 1. Current state, measured

| Band | Height | Contents |
|---|---|---|
| Tab strip + counters | 31px | `Scan | Watch`, then SCANNED/PATTERNS/IN VIEW/CONFIRMED/BULL-BEAR/LAST CANDLE/LAST SCAN right-aligned |
| Context | 26px | `SCOPE` + 10 universe pills, `CACHED · 17 MIN AGO`, Force re-run, Scan again |
| Tools | 30px | symbol · timeframe · lookback │ replay · TLS/TLR ─ search · Matrix|List|Grid · Filters · ⋮ |
| **First data pixel** | **97px** | |
| Left rail (optional) | 240px wide | Groups panel (sector performance, 18px rows) |

Contract budget for a primary workspace is ≤96px, so chrome is at target. **The layout is not the
remaining problem — interaction legibility is.**

---

## 2. Every component

### 2.1 Page shell — `PatternsPage.tsx`

```
┌─ Scan ══╤═ Watch ─────────────────────────────────────────────────────────────┐ 31
│         │ SCANNED 50  PATTERNS 49  IN VIEW 49  CONFIRMED 18  BULL/BEAR 35/11 │
│         │ LAST CANDLE 11-12 18:30 · LAST SCAN 5h ago                        │
├─────────┴───────────────────────────────────────────────────────────────────┤ 26
│ SCOPE (All NSE 2,757) (NSE F&O 218) (Indices 52) [NIFTY 50 50] …  [CACHED·17M] [Force] [Scan]│
├─────────────────────────────────────────────────────────────────────────────┤ 30
│ ⌕ symbol │ Timeframe 1D ▾ │ Bars Auto ▾ │ ⎯ │ ▮ REPLAY │ ▮ TLS/TLR ⎯ ⌕ results │ Matrix List Grid │ ⚙ Filters │ ⋮ │
└─────────────────────────────────────────────────────────────────────────────┘
```

| Element | Interaction |
|---|---|
| `Scan` / `Watch` tab | URL `?tab=`; keeps both panels mounted (no remount on switch) |
| counter chips | CONFIRMED and BULL/BEAR are **clickable → apply a filter**; the rest are inert but look identical |
| universe pill | sets scope, refetches, writes `?universe=` |
| `Custom` pill | opens the paste-symbols modal |
| `CACHED · 17 MIN AGO` | hover shows the scan-session timestamp |
| Force re-run | clears candle cache for the scope + re-scans |
| Scan again | starts a scan; label changes with state |

**Problems**
1. Clickable counters are indistinguishable from inert ones (no cursor, no hover, no affordance).
2. `TLS/TLR`, `BARS`, `SCOPE` are unexplained abbreviations with no tooltip on the label.
3. `CACHED · 17 MIN AGO` and `LAST SCAN 5h ago` are two different ages with no visual distinction.
4. Force re-run vs Scan again is a coin flip for a new user.

### 2.2 `UniverseBar` — pills

```
┌ SCOPE ┐ ┌(All NSE 2,757)(NSE F&O 218)(Indices 52)│[NIFTY 50 50]│(NIFTY 100 100)…(Custom 🔗)┐ [CACHED] [Force re-run] [▶ Scan again] ┐
```
Active pill: `bg-fin-primary/12`, semibold, 1px inset ring. Counts are 9.5px tabular.

**Problems**
- Ten pills in one row force 9px labels on a 1366 viewport; the least-used (`NIFTY 500 501`) is the
  widest. Collapse to `All NSE | NIFTY 50 | ▾ more` (a menu), keeping the last-used ones visible.
- `Indices 52` is a *mode*, not a universe — it changes the symbol set semantics. It sits in the same
  visual grammar, which misleads.

### 2.3 `ScanStats` — counters

```
SCANNED 50 · PATTERNS 49 · IN VIEW 49 · CONFIRMED 18 · BULL/BEAR 35/11 · LAST CANDLE … · LAST SCAN …
```
Labels 9px uppercase muted, values 11px mono tabular. Dividers 12px.

**Problems**
- `IN VIEW` duplicates the visible row count; `PATTERNS` and `SCANNED` differ only when a filter is on.
  Three numbers where one (`49 of 50`) would do.
- Truncates at 1366 with no indication.

### 2.4 `PatternFilterRail` + `AppliedFilters`

Rail: a column of sections (Instrument → Pattern → Direction/Quality → Score/Range → Triggers), each
with a divider. Opens as a right-side modal under `lg`.

```
┌ Filters ─────────────────── ✕ ┐
│ INSTRUMENT                      │   symbols · F&O only · ETFs · indices groups
│ PATTERN                         │   family · pattern (multi-select) · timeframe
│ DIRECTION / QUALITY             │   bullish/bearish · quality tiers
│ SCORE / RANGE                   │   min confidence · range position
│ TRIGGERS                        │   breakout · retest · within % of trigger
│                        [Reset] [Filter] │
└─────────────────────────────────┘
```
`AppliedFilters` above the table: chips capped at 6 with `+N` expander, `Clear all` at the end.

| Element | Interaction |
|---|---|
| any rail control | **staged** — changes nothing until `Filter` is pressed (or `Enter`) |
| preset dropdown | replaces staged filters rather than merging |
| `Escape` / backdrop | discards staged edits |
| chip `×` | removes that filter **immediately** (asymmetric with staging) |

**Problems**
- Staged-then-applied is invisible: the Filter button does not show a dirty badge, so users press it
  blindly or forget.
- Chips apply immediately while the rail stages — two mental models for the same data.
- No "N results" preview on the Filter button, so the user cannot tell if a filter is safe.

### 2.5 `PatternListView` (List)

```
SYMBOL            PATTERN           SCORE  BO  DIR  STATUS     Q  52W%   POS%  BARS  PRICE    CHG%    TO TRIGGER
TATASTEEL  F&O    Falling Wedge      93.9  ▲    CONFIRMED  T  16.2%    0%     4  ₹188.00  -0.68%  —
```
23px rows, 12 columns, sticky header, numeric right + mono tabular.

| Element | Interaction |
|---|---|
| header | click sorts; click again flips; 3rd clears (if `enableSortingRemoval`) |
| row | click → opens the symbol in the docked chart |
| symbol cell | TV link (external) + chart icon (in-app) — **two different destinations in one cell** |
| `F&O` tag | none (inert badge) |
| members button | opens the index-members drawer |
| expanded row | none on List |

**Problems**
1. **Rows past 80 are unreachable** — `rowWindowSize` is a hard slice. Footer now discloses
   "showing 80 of 312", but there is no way to see the rest.
2. Symbol cell has two click targets with different outcomes and no visual distinction.
3. `BO` (breakout) vs `SCORE` (fit confidence) are two scores with no explanation on hover.
4. `Q` column is a single glyph (`T`/`S`/`F`) — meaningless without the legend.

### 2.6 `PatternGrid` + `PatternCard`

```
┌──────────────────────────────────┐
│ TATASTEEL           4 1D ago     │  header: symbol (700), pattern name (10px), bars ago, status dot+label
│ Falling Wedge   ●CONFIRMED  T    │
│ ┌──────────────────────────────┐ │
│ │  sparkline + trendlines      │ │  chart: flex-1
│ └──────────────────────────────┘ │
│ SCORE 93.9            POS 0%     │  18px strip, surface-alt, no rules
└──────────────────────────────────┘
```
Gap 8, `minmax(0,1fr)` columns, 2/3/4-up responsive.

| Element | Interaction |
|---|---|
| card | click → docked chart |
| expand icon | fullscreen chart (modal) |
| members | members drawer |
| chart hover | symbol preview (debounced) |
| status dot | tooltip with the derived status reason |

**Problems**
- At 4-up on 1366 the chart is ~250×90 — too short to read a wedge. 3-up would be legible.
- No keyboard focus on the card: you cannot Tab to a tile.
- The stat strip shows only 2 numbers where the List shows 12 columns — inconsistent vocabulary.

### 2.7 `PatternSymbolMatrix`

Symbols × timeframes grid of pattern cells. `minTableWidth = max(560, cols×72)`, `fillContainer`.

| Element | Interaction |
|---|---|
| cell | click → opens that symbol at that timeframe |
| row | click → symbol at default TF |
| timeframe column header | none (not sortable) |

**Problems**
- No visual weight for a cell with multiple patterns vs one.
- No legend for cell colour.

### 2.8 Supporting components (kept, minor fixes)

| Component | Role | Verdict |
|---|---|---|
| `PatternMiniChart` | sparkline + trendlines in a card | keep; needs a `min-height` floor |
| `PatternFullscreenView` | full chart modal, single-select list | keep; list should show score+status, not just name |
| `PatternChartToolbar` | TF / bars / replay inside the modal | keep |
| `TimeframeSelect` | singleton + multi-select modes | keep; multi-select affordance is unclear |
| `LookbackSelect` | bars lookback | keep |
| `SymbolFilter` | multi-select symbol picker | keep |
| `ResultsSearch` | filters the visible rows | keep; should also offer "jump to symbol" |
| `ReplayScanControl` | replay-as-of scan | keep; `as of` stamp is good |
| `ScanProgress` | block/banner/inline/queued variants | keep; 4 variants is a lot, but each is used |
| `JobStatus` | queue position + last scan | keep |
| `rowBadges` | F&O / ETF tags | keep |
| `SymbolTvLink` | external TV link | keep; the click-inversion is the issue |
| `PatternImageManager` | reference image upload | keep; now has a real button role |
| `WatchView` | second tab: setups + relative volume gate | see §4 |

---

## 3. Interaction map (whole page)

```
                    ┌──────────── Scan again ────────────┐
                    │                                     ▼
  SCOPE pill ───────┼──────────────────────────────► refetch + write ?universe=
                    │
  counter (CONF) ───┼──► apply status filter ──► table narrows (no refetch)
                    │
  Filters ──────────┼──► rail modal (staged) ──Apply──► table narrows
                    │                              └──Esc──► discard
                    │
  view seg ─────────┼──► Matrix | List | Grid   (client only, ?view=)
                    │
  header click ─────┼──► sort asc ──► desc ──► (clear)
                    │
  row click ────────┼──► docked chart (right pane)
                    │
  symbol cell ──────┼──► TradingView (external)      ← ambiguous with row click
                    │
  card expand ──────┼──► fullscreen modal
                    │
  Tab → Watch ──────┼──► WatchView (?tab=watch), Scan stays mounted
```

---

## 4. Watch tab (`WatchView`)

Three bands (36/24/32), 0px centre spread. Setup select · vol-adj gate · Refresh │ updated · age ·
live/paused. Then search · state · within% · hide-invalidated · hide-ETFs · count · CSV · Symbols.

| Element | Interaction |
|---|---|
| setup select | changes the setup definition; refetches |
| vol-adj gate | **server-side**: only applies on the next scan, not instantly |
| Refresh | refetch now |
| state filter | client-only |
| hide toggles | client-only |
| CSV / Symbols | copy to clipboard |

**Problems**
- The vol-adj gate looks like a filter but only affects the *next* scan — same class of trap as the
  screener's scan-time filters.
- `ARMED` / `FRESH` / `CONFIRMED` state badges have no legend.

---

## 5. Best ideas, ranked by impact ÷ effort

| # | Idea | Why | Effort | Risk |
|---|---|---|---|---|
| 1 | **Make counters honest**: one `49 of 50` chip instead of SCANNED/PATTERNS/IN VIEW | three numbers, one fact; frees ~200px | S | low |
| 2 | **Distinguish clickable counters** — cursor+underline+tooltip "click to filter" | a filter affordance that looks inert is a non-feature | S | low |
| 3 | **Collapse universes**: `All NSE │ NIFTY 50 │ ▾` | 10 pills → 3; ends 9px labels | S | low |
| 4 | **Sortable-row disclosure**: keep the footer, add "load 80 more" | 232 of 312 rows unreadable today | M | low |
| 5 | **Separate the symbol cell's two destinations** — TV icon = external, rest of cell = in-app | the click inversion every pro trips on | S | low |
| 6 | **Say what BO and SCORE are** on hover, and put the quality legend in the header | two scores, one glyph column, no explanation | S | low |
| 7 | **Rail staging badge**: `Filter (12 results)` + dirty dot | removes the "did that apply?" loop | M | med |
| 8 | **Chips stage too** (same model as the rail) | two mental models for one dataset | M | med |
| 9 | **Grid at 3-up on ≤1440** so the chart is legible | 250×90 cannot show a wedge | S | low |
| 10 | **Keyboard**: `/` focus search, `f` filters, arrows move rows, Enter opens chart | tab-only navigation is slow at 312 rows | M | low |
| 11 | **Watch: mark the vol-adj gate `next scan ▸`** | it silently does nothing now | S | low |
| 12 | **Matrix cell weight** = pattern count, plus a colour legend | a dense grid with no legend is noise | S | med |

## 6. Do not change

- The three-band composition and 97px chrome — it is at contract.
- The `For`-based rows and the memoised card derivation (~0.18ms identical update).
- The flat tab strip with an accent underline.
- Rail staging itself — the model is right; only the *feedback* is missing.

## 7. Open questions

1. Should `Scan again` and `Force re-run` merge into one button with a modifier?
2. Does the Watch tab belong here, or is it a separate route (it has its own setup + polling)?
3. Keep the matrix as a third view, or fold it into List as a grouping?
4. Should the counters move into the table header (data, not chrome)?
