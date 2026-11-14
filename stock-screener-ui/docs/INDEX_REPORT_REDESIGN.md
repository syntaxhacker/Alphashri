# Index Report — redesign spec

Scope: both report surfaces in `src/pages/report/` (68 components).
Analysis only; no code changed.

- **A. Daily Report** — `/report`
- **B. NIFTY desk** — `/report/index`

Every section is an **old → new** pair. `BEFORE` ships today.

---

# A. Daily Report

## A0. Page shell

### BEFORE — first `<table>` at 147px, chrome 60px + 87px of panel header

```
┌ Daily Report │ 13/11/2026 ◀ ▶ │ Nifty 500 ▾ │ Refresh │ NIFTY 25,118 ▲ ABOVE 20DMA ───── as of 21:26 │ Copy CSV │ Copy symbols ┐ 32
├ Scan │ Breakouts │ Moves │ Follow-through │ Events ────────────────────────────────────────────────────────────────────────────────┤ 28
│ ┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ │ Breakouts TODAY (31)  [501 scanned]  [All 31][52W High 4][Gap 2][Base 20D 25][Base 50D 1] ───────────── [Intraday│5D]          │ 87px
│ │                                    ▲ badge + chip row + 2 nested paddings                                                   │
│ ├────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ │ SYMBOL        TYPE      LEVEL     CLOSE     %ABOVE   VOL×   CHG%    52W GAP%  SECTOR      TREND                              │ ← 147px
│ │ ANURAS        BASE 20D  ₹1209.60  ₹1304.50  +7.85%   4.1x   +9.45%  -7.81%    —           ∿∿∿∿                              │
│ └────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
│ ┌ Breakdowns TODAY (0) ─────────────────────────────────────────────┐   ← empty, yet full height
│ │ No breakdowns today                                               │
│ └───────────────────────────────────────────────────────────────────┘
```

### AFTER — first row at ~88px, empty side collapsed, chips on the header line

```
┌ Daily Report │ 13/11/2026 ◀▶ │ Nifty 500 ▾ │ 31 breakouts · 0 breakdowns  ⟩  Refresh ──── as of 21:26 │ CSV ▾ │ Copy ▾ ┐ 32
├ Scan │ Breakouts │ ●31 Moves │ Follow-through │ Events ────────────────────────────────────────────────────────────────────────────────┤ 28
│ ┌ Breakouts TODAY [501 scanned] [All 31][52W 4][Gap 2][Base20 25][Base50 1] ───────────── [Intraday│5D ⓘ column source] ┐ 24px
│ ├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ │ SYMBOL       TYPE      LEVEL     CLOSE     %ABOVE  VOL×  CHG%    52W GAP%→below high  SECTOR    TREND                      │ ← ~88px
│ │ ANURAS       BASE 20D  ₹1209.60  ₹1304.50  +7.85%  4.1x  +9.45%  -7.81%              —         ∿∿∿∿                      │
│ └──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
│  ▸ Breakdowns TODAY (0) — none today  (collapsed to one 20px line, click to expand)
```

| Element | BEFORE | AFTER |
|---|---|---|
| panel header | 87px: badge row + chip row + two paddings | 24px: badge and chips on one line with the table header |
| date / universe in the panel | reprinted (`nifty500 · 2026-11-13`) | removed; the identity band owns it |
| `Breakdowns (0)` | full table + empty state | one collapsed 20px line |
| `Intraday│5D` | looks like a filter | `ⓘ column source` — it re-renders TREND, not the rows |
| first row | 147px | ~88px |
| Copy actions | two full-width buttons | one `CSV ▾` menu (CSV / symbols) |

---

## A1. Tab bar / loading semantics

### BEFORE
```
tab click → that tab shows its own skeleton         (fixed: was gated on daily && breakouts)
```

### AFTER
```
tab click → instant switch; the tab's own panel shows a 24px skeleton line
            the tab badge shows the row count:  ●31  so a tab advertises content
other tabs stay mounted (no refetch on return)
```

---

## A2. Scan tab — the strips stack

### BEFORE
```
┌ breadth: NIFTY 25,118 ▲0.42% │ Adv 159 │ Dec 334 │ … 9 stats ────────────────┐ 24
┌ SECTOR LEADERS ───────────────────────┐ ┌ THEME LEADERS ────────────────┐
│ +9.1pp Producer Mfg   −1.2pp Utilities│ │ …                             │
└──────────────────────────────────────┘ └───────────────────────────────┘
┌ INDEX MOVERS ─────────────────────────┐
│ gainers / losers / most-active inline │
└──────────────────────────────────────┘
┌ NIFTY WALLS card ─────────────────────┐
```

### AFTER — one 48px band of strips, detail on demand
```
┌ BREADTH  NIFTY ▲0.42% · Adv 159 / Dec 334 · vol 63/61 ────────────────────── ▾ ┐ 24
├ LEADERS  ▲ Producer Mfg +9.1  ▲ Health Svc +0.9  ▼ Utilities −1.2  ▼ Retail −0.3  ▾ ┤ 24
├ MOVERS   ▲ POWERINDIA +10.7  ▲ TDPSWRS +4.6  ▼ COALINDIA −2.0  ▼ ONGC −1.5  ▾ ┤ 24
└──────────────────────────────────────────────────────────────────────────────┘
   ▲ each ▾ expands that strip in place; nothing is a card
```

| Element | BEFORE | AFTER |
|---|---|---|
| leadership strips | two bordered panels side by side | one line each, `▾` expands in place |
| index movers | own panel | same line grammar as leaders |
| walls card | a card among strips | moves to the Breakouts tab (it is wall data, not breadth) |
| strip count | 4 separate bands | 3 lines in one band |

---

## A3. Events tab

### BEFORE
```
┌ EventWatch ───────────────────── ┐ ┌ ReportEventsStrip ───────────────┐
│ next-week calendar (own endpoint)│ │ separate strip, own loading      │
└──────────────────────────────────┘ └──────────────────────────────────┘
   ▲ two loading indicators, two error paths, one after the other
```

### AFTER
```
┌ EVENTS  next week · 18 scheduled · 98 fresh ──────── ⟳ 07:30 digest ⓘ ┐
│ 2026-11-13 ─ ABB RESULTS · APTUS DIV · ASTRAL DIV · CAMS DIV           │
│ 2026-11-14 ─ ASHOKLEY RESULTS · PATANJALI RESULTS                      │
└────────────────────────────────────────────────────────────────────────┘
   ▲ one indicator, one error path; the digest time is stated
```

| Element | BEFORE | AFTER |
|---|---|---|
| loading | two independent spinners | one, on the band |
| error | two alerts | one alert + Retry |
| refresh cadence | invisible | `⟳ 07:30 digest ⓘ` explains when it updates |

---

# B. NIFTY desk (`/report/index`)

## B0. Shell

### BEFORE
```
┌ Nifty ▾ │ 13 Nov │ LIVE ● │ as of 11:36 ── Replay ◀ ▮▶ ▶ ── [LIVE|EOD|REPLAY] ── ⋯ ┐ 32
├ VERDICT: BIAS ▲ LONG · 12 signals · 3 walls breached · flow flip 11:20 · squeeze 0.42 ┤ 24
├ CHART 59% ───────────────────────────┬ TAPE 41% ───────────────────────────────────────┤
│ candles + CW/PW + spot + ΔOI underlay│ time │ spot │ ce_oi │ pe_oi │ ΔOI │ prem │ flow  │
├──────────────────────────────────────┴─────────────────────────────────────────────────┤
├ PRESSURE LANE (bursts, median, zero) ──────────────────────────────────────────────────┤ 44
├ FLOW WINDOWS 5m/15m CE−PE OI + flip ───────────────────────────────────────────────────┤ 28
├ GEX │ IV SKEW │ DELTA │ GAMMA │ WALLS │ EROSION │ MIGRATION ───────────────────────────┤
└ DESK DOCK: Plan │ Pressure │ Tape (collapsible rail) ──────────────────────────────────┘
```

### AFTER
```
┌ Nifty ▾ │ 13 Nov │ ● LIVE  as of 11:36 │ ⏮ ◀ ▮▶ ▶ ⏭ │ 1x ▾ │ [L|E|R] ⓘ ──── ⟳ │ ⋯ ┐ 32
├ BIAS ▲ LONG ▸ │ 12 signals ▸ │ 3 walls breached ▸ │ flow flip 11:20 ▸ │ squeeze 0.42 ▸ ┤ 24
├ CHART 59% ────────────────────────────┬ TAPE 41% ──────────────────────────────────────┤
│  as-of 11:36 ⓘ                        │ ⌕ symbol  [All strikes ▾]  ⏷ fresh             │ 20
│  candles + CW/PW + spot + ΔOI         │ time │ spot │ ce_oi │ pe_oi │ ΔOI │ prem │ flow │
│  overlay switches: ▣CW ▣PW ▣spot ▣OI  │ ▸ pinned minute highlighted across ALL panels   │
├───────────────────────────────────────┴────────────────────────────────────────────────┤
├ PRESSURE (44) ─────────────────────────────────────────────────────────────────────────┤
├ FLOW 5m −1.2cr ▼ │ 15m −3.4cr ▼ │ FLIP 11:20 ▲ ───────────────── ⟳ ⟩  [chart ▾] ──────┤ 28
├ GEX │ IV │ DELTA │ GAMMA │ WALLS │ EROSION │ MIGRATION  (one band, tabbed, 240px) ──────┤
└ DESK: Plan 3 │ Pressure 2 │ Tape ───────────────────────────────────────────────────────┘
```

| Element | BEFORE | AFTER |
|---|---|---|
| verdict strip | five numbers, none clickable | each `▸` filters/pins the matching panel |
| tape | no way to find a strike | `⌕ symbol` + strike filter + freshness |
| pinned minute | affects flow + pressure, undiscoverable | row highlight + "pinned across all panels" note |
| flow | three surfaces (strip, windows, chart) | one band: 5m/15m verdict + `chart ▾` for the detail |
| panel band | 7 panels competing for width | one tabbed band at a fixed 240px |
| desk tabs | names only | `Plan 3` — a collapsed rail advertises its content |
| as-of | only in the toolbar | repeated on every panel header (the whole desk is as-of that time) |
| mode `[LIVE|EOD|REPLAY]` | three letters, unexplained | `[L|E|R] ⓘ` with the tooltip stating what each does |

---

## B1. Flow — three components, one metric

### BEFORE
```
NiftyFlowStrip      ──────●──────      28px   a line with a dot
NiftyFlowWindows    │ 5m −1.2 │ 15m −3.4 │     28px    two numbers
NiftyFlowChart      ┌──────────────┐   200px   a chart
                    └──────────────┘
        ▲ the same CE−PE OI move at three sizes, three places, no shared state
```

### AFTER
```
┌ FLOW  ✔ 5m −1.2cr ▼   ✔ 15m −3.4cr ▼   ▲ FLIP 11:20 ──────── [ ····▮▮▮▮ ] ⟩ ┐ 28
│  strip + windows merged: the numbers ARE the legend for the sparkline        │
└─────────────────────────────────────────────────────────────────────────────┘
     ⟩ expands to the full flow chart in place (no separate panel)
```

| Element | BEFORE | AFTER |
|---|---|---|
| strip / windows | two bands, one dot + two numbers | one band: number + matching sparkline colour |
| chart | a permanent 200px panel | expands on `⟩` |
| flip | badge and a chart line, no link | `FLIP 11:20` is the anchor of both |

---

## B2. Walls — four overlapping surfaces

### BEFORE
```
NiftyWallsCard      top 3 walls, compact
NiftyWallsExpanded  the full wall table
WallsMap            ladder with legend
NiftyWallErosionBoard   erosion + fuel per side
NiftyWallMigration  migration over time
        ▲ five components all answering "where are the walls?"
```

### AFTER
```
┌ WALLS   CW 25,200 (OI 1.2cr, ▼18%)   PW 25,000 (OI 0.9cr, ▲4%)   [card ▾] [ladder ▾] [migration ▾] ┐
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
     ▲ one band, three views of the same fact, one at a time
```

| Element | BEFORE | AFTER |
|---|---|---|
| card / expanded | two components for the same list | one, with a detail toggle |
| ladder | separate panel | `[ladder ▾]` in the same band |
| migration | separate panel | `[migration ▾]` — the long view of the same fact |
| erosion | own board | merged into the card as a fuel meter per side |

---

## B3. Gamma / GEX / IV — inconsistent units

### BEFORE
```
┌ GEX      −₹4.2 lakh ┐  ┌ IV SKEW  +2.1% ┐  ┌ GAMMA  1.8e-4 ┐
   ▲ three neighbouring panels, three units, no conversion shown
```

### AFTER
```
┌ GEX  −₹4.2L  ⓘ ₹ per 1% move ┐  ┌ IV   +2.1σ  ⓘ skew vs ATM ┐  ┌ Γ  1.8 ×10⁻⁴ ⓘ per ₹ ┐
   ▲ every panel states its unit in the header, with a hover definition
```

| Element | BEFORE | AFTER |
|---|---|---|
| units | mixed, implicit | stated per header + `ⓘ` |
| scales | `1.8e-4` | `1.8 ×10⁻⁴` — same value, readable |
| colour | some signed, some neutral | signed values colour; magnitudes don't |

---

## B4. Replay

### BEFORE
```
Replay ◀ ▮▶ ▶   [LIVE|EOD|REPLAY]       ← the playhead time is 9px, at the far left
every panel renders at "now" or at the playhead with no per-panel indication
```

### AFTER
```
⏮ ◀ ▮▶ ▶ ⏭  11:36  ⟩⟩ 1x ▾     [REPLAY ⓘ]    ← time is 12px, adjacent to the controls
each panel header ends with  "as of 11:36"     ← the desk is uniformly as-of
[ / ] step the playhead · space toggles play
```

| Element | BEFORE | AFTER |
|---|---|---|
| playhead time | 9px, distant | 12px, next to the transport |
| per-panel as-of | none | on every panel header |
| keyboard | none | `[` `]` step, `space` play, `l`/`e`/`r` mode |

---

## C. Component inventory — all 68, with a verdict

| Component | Verdict | Note |
|---|---|---|
| `NiftyReportShell` | keep | 26kB shell after the lazy split |
| `ReportToolbar` | **change** | merge Copy buttons to a menu; state the mode meaning |
| `NiftyReplayBar` | **change** | 12px time + keyboard |
| `ReportWorkspace` | keep | 59/41 split matches a desk |
| `DeskDock` | **change** | tab count badges |
| `LocalPanelModal` | keep | |
| `NiftyVerdictStrip` | **change** | make the five items actionable |
| `NiftyPressureDesk` | keep | |
| `NiftyPressureLane` | keep | |
| `NiftyChartPanel` | **change** | overlay switches + as-of |
| `NiftyDepthMap` | keep | ΔOI underlay |
| `NiftyFlowChart` | **merge** | into the flow band |
| `NiftyFlowWindows` | **merge** | into the flow band |
| `NiftyFlowStrip` | **merge** | becomes the band's sparkline |
| `NiftyOiHeatmap` | keep | canvas: 1 node per tape |
| `NiftyWallsCard` | **merge** | one walls band |
| `NiftyWallsExpanded` | **merge** | detail toggle |
| `WallsMap` | **merge** | ladder view |
| `NiftyWallErosionBoard` | **merge** | fuel meter in the card |
| `NiftyWallMigration` | **merge** | migration view |
| `NiftyDepthMap` / `DepthChart` | keep | |
| `NiftyGammaStrip` / `NiftyGammaTime` | **change** | units |
| `NiftyGexProfile` | **change** | units |
| `NiftyIvSkew` / `NiftyIvStraddle` | **change** | state the unit |
| `NiftyDeltaPositioning` | keep | |
| `NiftyCoilGauge` | keep | |
| `NiftySqueezeRadar` | keep | |
| `NiftyStructureShifts` | keep | |
| `SetupRadarStrip` | keep | |
| `LevelsInPlay` | keep | |
| `Nifty10sStrip` | keep | |
| `NiftyTapeTable` / `NiftyTapeColumns` | **change** | strike filter + freshness + pinned row |
| `NiftyUnusualVolume` | keep | |
| `NiftyParticipantFlow` | keep | |
| `NiftyPnlAttribution` | keep | |
| `NiftyPositionsDrawer` | keep | |
| `NiftyIntelStrip` | keep | |
| `NiftyDataFreshness` | **change** | per panel, not global |
| `NiftyDeskGuide` | keep | |
| `RangeToggle` | keep | |
| `DeltaProfileChart` | keep | |
| `ReportAnalytics` / `ReportOverlays` / `ReportDecisionStrip` | keep | |
| `sim/SimDesk` `SimBuilder` `SimRuns` `SimPayoff` | keep | exec copy bug fixed |
| `us/UsReportPage` `us/UsChart` `us/UsLadder` | **change** | share the tape, don't copy it |
| `DailyReportPage` | **change** | 87px panel header |
| `ReportBreakoutTable` | **change** | chips onto the header line; collapse empty side |
| `ReportFollowThrough` | keep | |
| `ReportMovePanels` | keep | flush lattice |
| `ReportStrips` / `ReportLeaderStrip` / `BreadthStrip` | **change** | one band, three lines |
| `IndexMoversStrip` / `IndexMoversModal` | **change** | move into the movers line |
| `EventWatch` / `ReportEventsStrip` | **change** | one loader, one error |
| `Profitability` | **move** | belongs to strategy-runner |
| `reportCells` / `reportBits` / `niftyChartData` / `niftyFlowRead` / `niftyOiHeatmap` / `niftyWallsFormat` | keep | pure helpers |

---

## D. Ranked backlog

| # | Change | Why | Effort | Risk |
|---|---|---|---|---|
| 1 | Daily Report: 87px panel header → 24px (chips on the header line) | first row 147 → ~88px | M | low |
| 2 | Collapse an empty Breakouts/Breakdowns side to 20px | an empty table costs full height | M | low |
| 3 | Remove the reprinted date/universe in the panel | duplicates the identity band | S | low |
| 4 | Merge flow strip + windows into one band | one metric in three places | M | med |
| 5 | Merge the five walls surfaces into one banded view | five answers to one question | L | med |
| 6 | State units on GEX / IV / Gamma | three neighbours, three implicit units | S | low |
| 7 | Verdict items become actionable (`▸`) | the top read should drive the desk | M | med |
| 8 | Per-panel `as of` | a stale panel inside a fresh page is the dangerous case | M | med |
| 9 | Replay: 12px time + `[`/`]`/`space` | replay is the main workflow, mouse-only today | M | low |
| 10 | Desk dock tab counts | a collapsed rail hides everything | S | low |
| 11 | Events: one loader, one error, stated cadence | two of everything | S | low |
| 12 | `Intraday│5D` labelled as a column source | reads like a row filter | S | low |
| 13 | Move `Profitability` to strategy-runner | it is not a market report | M | low |
| 14 | US report shares the tape component | two tapes drift | L | med |

---

## E. Do not change

- The lazy panel boundaries and the 26kB shell — first paint is fixed.
- The canvas OI heatmap (one node for a ±500 tape; it is why the tape is smooth).
- Per-section fetch timeout + per-section abort on the Daily Report.
- The verdict strip's position (top of the desk, above the chart).
- The 59/41 chart/tape split.

## F. Open questions

1. One route with a mode, or keep Daily Report and the NIFTY desk separate?
2. Is `Profitability` a report tab at all?
3. `Events` uses a different endpoint and cadence — own tab group, or a widget on Scan?
4. Keep both erosion board and migration, or is migration the long view of the same fact?
5. Should the SIM desk live under `/report/index`, or under Options?
