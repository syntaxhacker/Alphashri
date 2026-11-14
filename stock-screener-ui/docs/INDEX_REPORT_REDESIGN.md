# Index Report — redesign spec

Scope: the two report surfaces under `src/pages/report/` (68 components).
Analysis only; no code changed.

- **A. Daily Report** — `/report`
- **B. NIFTY desk (Index Report)** — `/report/index`

---

## 1. Surface A — Daily Report (`/report`)

### 1.1 Current state, measured

| Band | Height | Contents |
|---|---|---|
| Identity | 32px | `Daily Report` · date ◀ ▶ · universe ▾ · Refresh · `NIFTY vs 20DMA` chip ─── as-of · Copy CSV · Copy symbols |
| Context | 28px | tab strip: Scan · Breakouts · Moves · Follow-through · Events |
| **First panel** | **60px** | |
| First `<table>` | 147px | 87px of panel-internal header rows |

```
┌ Daily Report │ 13/11/2026 ◀ ▶ │ Nifty 500 ▾ │ Refresh │ NIFTY 25,118 ▲ ABOVE 20DMA ───── as of 21:26 │ Copy CSV │ Copy symbols ┐ 32
├ Scan │ Breakouts │ Moves │ Follow-through │ Events ───────────────────────────────────────────────────────────────────────────────┤ 28
│ ┌ Breakouts TODAY (31)  [501 scanned]  [All 31][52W High 4][Gap 2][Base 20D 25] ──────── [Intraday│5D] ┐   ← 87px of header
│ │ SYMBOL │ TYPE │ LEVEL │ CLOSE │ %ABOVE │ VOL× │ CHG% │ 52W GAP% │ SECTOR │ TREND │
│ │ ANURAS │ BASE 20D │ ₹1209.60 │ ₹1304.50 │ +7.85% │ 4.1x │ +9.45% │ -7.81% │ — │ ∿ │
│ └──────────────────────────────────────────────────────────────────────────────────────────────┘
│ ┌ Breakdowns TODAY (0) … ┐  (stacked, not side by side)
```

| Element | Interaction |
|---|---|
| date ◀ ▶ | shifts ±1 day; refetches all four sections |
| universe ▾ | `nifty500` / `all`; refetches |
| Refresh | refetches every section |
| regime chip | inert |
| tab | client-side switch; each tab has its own loading gate |
| type chip (`All 31`, `Gap 2`) | client-side filter of the visible rows |
| table header | click sorts |
| row | click → opens the symbol chart |
| Copy CSV / symbols | clipboard; scoped to the active section |
| `Intraday | 5D` | switches the sparkline source; **refetches nothing** |

**Problems**
1. **87px of panel header above the first row.** `report-breakouts-meta` (scanned badge) + a chip row +
   two nested paddings. The chips could live on the table's own header line.
2. `Breakouts` and `Breakdowns` stack vertically even when one is empty — an empty table still
   consumes its header + empty state.
3. Date + universe appear in the identity band **and** the panel reprints `nifty500 · 2026-11-13`.
4. `Intraday | 5D` sits in the panel header but changes column data (`TREND`), not the row set — it
   reads like a filter.
5. No indication that `Events` is a different data source with its own refresh cadence.

### 1.2 Other tabs

| Tab | Content | Note |
|---|---|---|
| Scan | breadth strip (9 stats), sector/theme leadership strips, index movers, NIFTY walls card | the densest tab; strips are 24px bands now |
| Moves | gainers / losers / most-active panels | 9 panels in a grid, flush lattice |
| Follow-through | winners/losers + breakdown follow-through tables | two tables, same shape |
| Events | `EventWatch` + `ReportEventsStrip` | separate endpoint, own loading |

---

## 2. Surface B — NIFTY desk (`/report/index`)

### 2.1 Current state

```
┌ Nifty ▾ │ 13 Nov │ LIVE ● │ as of 11:36 ─── Replay ◀ ▮▶ ▶ ─── [LIVE|EOD|REPLAY] ─── ⋯ ┐
├ VERDICT STRIP:  BIAS ▲ LONG · 12 signals · 3 walls breached · flow flip 11:20 · squeeze 0.42 ┤
├─ CHART (60%) ────────────────────────┬─ TAPE (40%) ────────────────────────────────────┤
│  candles + CW/PW walls + spot line   │  time │ spot │ ce_oi │ pe_oi │ ΔOI │ prem │ flow  │
│  ΔOI heatmap underlay                │  (sticky header, 1m rows)                        │
├──────────────────────────────────────┴──────────────────────────────────────────────────┤
├ PRESSURE LANE (bursts, median, zero rule) ──────────────────────────────────────────────┤
├ FLOW WINDOWS (5m/15m CE−PE OI, flip badge) ─────────────────────────────────────────────┤
├ GEX profile │ IV skew │ delta positioning │ gamma │ walls card │ erosion board │ migration│
└ DESK DOCK (right rail): Plan │ Pressure │ Tape ─ tabbed, collapsible ─────────────────────┘
```

### 2.2 Component inventory — all 68 files, none omitted

**Shell / chrome**

| Component | Role | Verdict |
|---|---|---|
| `NiftyReportShell` | route shell, lazy panels | keep — 26kB shell after the split |
| `ReportToolbar` | date · mode · replay · refresh | keep; mode switch needs a clearer label |
| `NiftyReplayBar` | scrub · play · speed | keep; times are tiny (9px) |
| `ReportWorkspace` | chart + tape layout | keep |
| `DeskDock` | tabbed right rail | keep; tabs need a count badge |
| `LocalPanelModal` | per-panel expand | keep |
| `NiftyDeskGuide` | onboarding copy | keep |
| `NiftyDataFreshness` | staleness badge | keep |
| `RangeToggle` | 1m/5m/15m | keep |

**Chart / structure**

| Component | Role | Verdict |
|---|---|---|
| `NiftyChartPanel` | candles + overlays | keep; overlay count needs a control |
| `NiftyDepthMap` | ΔOI heat underlay | keep |
| `WallsMap` | wall ladder | keep; `Legend`/`AxisLabels` need units |
| `NiftyWallsCard` | top walls | keep |
| `NiftyWallsExpanded` | full wall table | keep |
| `NiftyWallErosionBoard` | erosion/fuel per side | keep |
| `NiftyWallMigration` | wall migration over time | keep — series fixed |
| `LevelsInPlay` | nearest levels | keep |
| `DeltaProfileChart` | delta by strike | keep |
| `DepthChart` | depth curve | keep |
| `NiftyGammaStrip` / `NiftyGammaTime` | gamma by strike/time | keep; duplicated units |
| `NiftyGexProfile` | GEX by strike | keep |
| `NiftyIvSkew` | IV by strike | keep |
| `NiftyIvStraddle` | straddle history | keep |
| `NiftyCoilGauge` | compression gauge | keep; `state()` narrowed twice, fixed |
| `NiftySqueezeRadar` | squeeze score | keep |
| `NiftyStructureShifts` | regime changes | keep |
| `SetupRadarStrip` | setups | keep |
| `NiftyPressureLane` | burst lane | keep |
| `NiftyPressureDesk` | pressure detail | keep |
| `NiftyFlowChart` / `NiftyFlowStrip` / `NiftyFlowWindows` | CE−PE flow | keep; three surfaces for one metric needs unifying |
| `NiftyOiHeatmap` | OI Δ over buckets | keep — canvas-painted, 1 node |
| `Nifty10sStrip` | 10s chain snaps | keep |
| `NiftyTapeTable` / `NiftyTapeColumns` | the tape | keep — the core surface |
| `NiftyUnusualVolume` | volume anomalies | keep |
| `NiftyParticipantFlow` | FII/DII | keep |
| `NiftyPnlAttribution` | P&L drivers | keep |
| `NiftyPositionsDrawer` | open positions | keep |
| `NiftyVerdictStrip` | bias summary | keep — the top read |
| `NiftyIntelStrip` | one-line intel | keep |
| `us/UsReportPage` + `us/UsChart` + `us/UsLadder` | US mirror | keep; shares the tape grammar |
| `sim/SimDesk` `SimBuilder` `SimRuns` `SimPayoff` | options simulator | keep |

**Strips (Daily Report)**

| Component | Verdict |
|---|---|
| `BreadthStrip` | keep — 24px band, one divider |
| `ReportLeaderStrip` | keep — shared type scale |
| `ReportStrips` | keep |
| `IndexMoversStrip` / `IndexMoversModal` | keep |
| `ReportEventsStrip` / `EventWatch` | keep |
| `ReportBreakoutTable` / `ReportFollowThrough` / `ReportMovePanels` / `Profitability` | keep; see §1.1 |
| `EventWatch` | keep; scan-time vs result filters must be labelled |
| `reportCells` / `reportBits` / `niftyChartData` / `niftyFlowRead` / `niftyOiHeatmap` | pure helpers, keep |

---

## 3. Interaction maps

### 3.1 Daily Report

```
date ◀ ▶ ──┐
universe ▾ ─┼──► refetch all 4 sections (each with its own 120s timeout + abort)
Refresh ────┘
tab ───────────► client switch; per-tab loading gate (fixed: was gating on &&)
type chip ─────► client filter (no refetch)
Intraday|5D ───► client re-render of TREND column
header click ──► sort
row click ─────► /chart/:symbol
Copy CSV ──────► clipboard (active section)
```

### 3.2 NIFTY desk

```
mode [LIVE|EOD|REPLAY]
  LIVE   → WS stream, panels update in place
  EOD    → static session payload
  REPLAY → scrub bar drives an as-of playhead; every panel clips to it
date ──────────► EOD payload for that session
replay ◀ ▮▶ ▶ ─► playhead; chart+heatmap+tape clip together
range 1m/5m/15m ► resample tape client-side
panel expand ──► LocalPanelModal
desk dock tab ─► swaps the rail; panel stays mounted
wall row click ► pins that strike across chart + ladder
tape row click ► pins that minute across flow + pressure
```

---

## 4. Best ideas, ranked

| # | Idea | Why | Effort | Risk |
|---|---|---|---|---|
| 1 | **Delete the 87px panel header**: move scanned badge + type chips onto the table's own header line | first row at 147px is 87px later than it should be | M | low |
| 2 | **Stop reprinting date/universe in the panel** | duplicates the identity band | S | low |
| 3 | **Greys out an empty side instead of mounting it**: Breakouts/Breakdowns side by side, empty one collapsed to a 20px line | an empty table costs the same height as a full one | M | low |
| 4 | **One flow surface, not three** — `NiftyFlowStrip` + `FlowWindows` + `FlowChart` show the same CE−PE OI move at three sizes; keep the strip in the verdict, make the other two one panel with a size switch | three places to look for one number | M | med |
| 5 | **Label `Intraday | 5D` as a column source, not a filter** — move it into the TREND header | it reads like a row filter and isn't | S | low |
| 6 | **Unify the units** across gamma/GEX/IV panels: ₹cr vs ₹ lakh vs % is inconsistent between neighbours | a trader compares panels | S | low |
| 7 | **Verdict strip gets the numbers it summarises** — 12 signals, 3 walls breached, flow flip are already there; add the missing "why" on hover | the top read should be self-explaining | S | low |
| 8 | **Desk dock tabs show a count** (`Plan 3`, `Pressure 2`) so a hidden panel advertises itself | a collapsed rail hides everything | S | low |
| 9 | **Tape row → pins the minute everywhere** (already works) — surface it: a hover hint on the first visit | the best interaction is undiscoverable | S | low |
| 10 | **Replay playhead readout at 11px**, and show the playhead time on every panel header, not just the bar | the whole desk is as-of that time | S | low |
| 11 | **Collapse empty strips entirely** (the Scan tab shows 4 strips even when one has no data) | chrome with no data | S | low |
| 12 | **Freshness badge per panel**, not one global `as of` | a stale panel inside a fresh page is the dangerous case | M | med |
| 13 | **Keyboard**: `[`/`]` step the replay playhead, `l`/`e`/`r` set mode | replay is the main workflow and is mouse-only | M | low |
| 14 | **US report shares the tape component**, not a copy | two tapes drift | L | med |

---

## 5. Do not change

- The lazy panel boundaries and the 26kB shell — first paint is fixed.
- The canvas OI heatmap (one node for a 1-minute ±500 tape; it is the only reason the tape is smooth).
- Per-section fetch timeouts + per-section abort.
- The verdict strip position (top of the desk, above the chart).
- The 59% → 41% chart/tape split; it matches how a desk reads.

---

## 6. Open questions

1. Should Daily Report and the NIFTY desk be one route with a mode, or stay separate?
2. Is `Profitability` a report tab or a strategy-runner concern? It reads as the latter.
3. `Events` on the Daily Report pulls a different endpoint with a different cadence — should it be its
   own tab group or a widget?
4. Do we keep both `NiftyWallErosionBoard` and `NiftyWallMigration`, or is migration the long view of
   the same fact?
5. Should the SIM desk live under `/report/index` at all, or under Options?
