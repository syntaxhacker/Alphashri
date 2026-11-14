# Index Report — full redesign, BEFORE / AFTER

Measured at **1366×890** on the running app (`/report/index`), not estimated.

---

## 0. The defect, measured

```
nifty-stat-strip        59px   top  72
nifty-flow-windows      24px   top 135
movers-strip            24px   top 163
nifty-report-strips    605px   top 191   ← ONE wall listing owns the viewport
nifty-main-row         300px   top 800   ← THE CHART — below the fold (vp 890)
desk-dock               26px   top 860   ← floating, overlapping
────────────────────────────────────────
toolbar 68 + content 1066 in a 822 client → 244px of scroll
```

**The single most important panel on a trading desk is below the fold, while a
list of wall strikes occupies 605px above it.** Every other problem on this page is
downstream of that hierarchy inversion.

---

# A. NIFTY desk (`/report/index`)

## A0. Composition — the hierarchy inversion

### BEFORE

```
┬ NIFTY ▾ │ NIFTY SENSEX │ Live EOD Chart Depth [DESK] RESEARCH │ Nearest expi ▾ │ 11/13/2026 │ ⟳ SIM 1 │ POS ✕ │ Refresh Snapshot ⓘ ┬  68
│ ▮─────────────────────────────────────────────────────────────────────────────────────────────────────── 12:55 13.8% ─ 53/385 ─┤
├ SPOT 25,106.75 │ REGIME SELL PREMIUM │ Γ FLIP 25,500 │ MAX-OI CALL 25,200 │ MAX-OI PUT 25,000 │ PIN RISK LOW │ PCR 0.80 …────────────┤ 59
├ SESSION CALL WRITING ΔOI −19.3 │ NORMAL 0.7× RV 11.4/13.7 │ VIX 16.04 │ WEAK score 3.0 │ BEARISH · spot 25,106.75 · sell rallies at 25,078 ┤
├ WINDOWS ? │ SESSION CALL WRITING −₹87,407cr │ 15m CE — · PE — │ 5m CE — · PE — ────────────────────────────────────────── ALIGNED ─┤ 24
├ BREADTH · live only ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤ 24
├ 01 1m CE 0 PE 0 FLAT 0.0 │ 12:55:17 ──────────────────────────────────────────────────────────────────────────────────────────────────┤
├ MOVERS · live only ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤ 24
├ ┌ WALL EROSION ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐ │
│ │ CALL 25,200  STABLE +93 pts 14.88M  0.0% vol  FUEL 10                                                                              │ │
│ │ PUT  25,100  STABLE −7 pts  11.88M  0.0% vol  FUEL 33                                                                              │ │
│ ├ WALLS ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤ │ 605
│ │ WALL WATCH 4-DTE │ SPOT 25,106.75 │ MAX PAIN 25,150 │ GEX 55.9                                                                       │ │
│ │ CALL   OI      NEW  5m   30m  DIST            PUT    OI      NEW  5m   30m  DIST                                                     │ │
│ │ 25,200 CW 14.88M  0  0.0% 0.0% +0.37%         25,000 PW 13.59M  0  0.0% 0.0% −0.42%                                                 │ │
│ │ 26,000 CW 14.26M  0  0.0% 0.0% +3.56%         25,100 PW 11.88M  0  0.0% 0.0% −0.03%                                                 │ │
│ │ 26,500 CW 13.93M  0  0.0% 0.0% +5.55%         24,000 PW 10.72M  0  0.0% 0.0% −4.41%                                                 │ │
│ │ SEQ  TRACKED WALL 25,200 · LAST 60m · call 01 · 30m Δ                                                                              │ │
│ │ READ 4-DTE · call wall 25,200 · put wall 25,000 · positioning, not gamma                                                           │ │
│ └──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘ │
├ · NIFTY CHART ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ │ (candles)                                                                     1m 5m 15m PATTERNS S M L XL  CHAIN HEATMAP│VOL PREM │ │ 300
│ └──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘ │
└ ──────────────────────────────────────────────────────────────────────────────── ▲ below fold: the chart, DELTA, GEX, IV, 30 strikes ─┘
```

### AFTER

```
┬ NIFTY ▾ │ NIFTY SENSEX │ ● LIVE  as of 12:55 │ ⏮ ◀ ▮▶ ▶ ⏭ │ 1x ▾ │ [L|E|R] ⓘ ──── ⟳ │ POS ✕ │ ⋯ ┬  36
├ SPOT 25,106.75 ▲0.42% │ SL BIAS ▲ LONG ▸ │ 12 signals ▸ │ 3 walls breached ▸ │ FLIP 12:55 ▸ │ PCR 0.80 ▸ │ VIX 16.04 ▸ ┤ 28
├─ CHART  58%  ───────────────────────────────────────┬─ TAPE 42% ────────────────────────────────────────────────┤
│  as of 12:55  ▣CW ▣PW ▣spot ▣ΔOI  ⛶                     │ ⌕ strike  [All ▾]  ⏷ 12:55                                │
│                                                          │ time  spot   ce_oi  pe_oi   ΔOI    prem   flow           │
│      ╱╲    ╱╲                                            │ 12:55 25,106.8 14.88M 13.59M  −0.3M  42.1   ▼ sell         │
│    ╱╲  ╲  ╱  ╲╱   ← CW 25,200 · PW 25,000 dashed         │ 12:54 25,108.2 14.91M 13.55M  +0.1M  41.8   ▲ buy          │
│  ╱    ╲  ╲╱                                              │ 12:53 …                                                   │
│ ▁▂▃▅▇█▇▅▃▂▁  ΔOI underlay                               │  ▲ own scroll · pinned minute highlights every panel       │
│                                                          │                                                            │
├────────────── draggable splitter ───────────────────────┴────────────────────────────────────────────────────────────┤
│  ├ FLOW  5m −1.2cr ▼   │ 15m −3.4cr ▼  │ ▲ FLIP 12:55 ───────────────────────────── [ ⟩ expand ] ┤                │ 28
├─ TRADER DOCK  [ Analytics · Overlays · Walls · Erosion · GEX · IV · Γ ]  ──────── [ ⌃ open ] ────────────────────────┤ 28
└══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════┘
                          ▲ collapsed by default; expands as a 340px drawer OVER the chart
                            so it never pushes the chart off the fold
```

| Element | BEFORE | AFTER |
|---|---|---|
| toolbar | 68px (second row is the replay bar) | 36px + replay bar merged into the same row |
| verdict | one 59px strip scrolled away from its panels | 28px, each item `▸`-clickable to pin the matching panel |
| **walls / erosion** | **605px**, above the chart | inside a **collapsed drawer**, opened on demand |
| **chart** | **below the fold at top 800** | **first panel, 58% of the remaining height** |
| chart height | 300px | ~430px at 890 viewport |
| flow | 3 separate bands + a panel | one 28px band, `⟩` expands |
| scroll | one `overflow-auto`, 1066 in 822 → whole page scrolls | **two independent scroll owners** (chart column, tape column); page never scrolls |
| desk-dock | floating at top 860, overlapping content | part of the dock strip, no overlap |

**The maths:** 890 − 36 (toolbar) − 28 (verdict) − 28 (flow) − 28 (dock) = **770px for chart + tape**, versus 300px today.

**Measured chrome above the chart: 800px → 92px.**

---

## A1. Where the walls go

### BEFORE — the wall listing is the page

```
┌ WALL EROSION ────────────────────────────────────────────────────────┐
│ CALL 25,200 STABLE +93 pts 14.88M  0.0% vol  FUEL 10                  │
│ PUT  25,100 STABLE  −7 pts 11.88M  0.0% vol  FUEL 33                  │  605px
├ WALLS ────────────────────────────────────────────────────────────────┤
│ CALL  OI  NEW 5m 30m DIST  ← 3 strikes × 5 columns, then PUT × 3     │
│ SEQ · READ 4-DTE · TRACKED WALL 25,200 · LAST 60m                     │
└───────────────────────────────────────────────────────────────────────┘
```

### AFTER — two-line summary inline, detail in the drawer

```
├ WALLS  CW 25,200 (14.88M, ▲0.37%)  PW 25,000 (13.59M, ▼0.42%)  MP 25,150  GEX 55.9  [ detail ▸ ] ┤ 24
```

```
drawer open ([ detail ▸ ] or click the summary row):
┌ WALLS ─────────────────────────────────────────────────────────────── ✕ ┐
│ CALL │ 25,200 CW │ 14.88M │ +0.37% │ FUEL ▰▰▱ 10                         │
│      │ 26,000 CW │ 14.26M │ +3.56% │                                     │
│ PUT  │ 25,000 PW │ 13.59M │ −0.42% │ FUEL ▰▰▰ 33                        │
│ EROSION  CALL stable +93pts · PUT stable −7pts                          │
│ SEQ      TRACKED 25,200 · LAST 60m · call 01 · 30m Δ                     │
│ READ     4-DTE · positioning, not gamma                                  │
└──────────────────────────────────────────────────────────────────────────┘
```

| Element | BEFORE | AFTER |
|---|---|---|
| wall summary | 605px of rows | 24px line, always visible |
| detail | always expanded | drawer on demand |
| erosion | its own 60px block | `FUEL ▰▰▱` meters in the drawer |
| read text | 2 lines of prose mid-list | last row of the drawer |

---

## A2. Replay transport

### BEFORE
```
│ ▮───────────────────────────────────────────────────────────────────────── 12:55 13.8% ─ 53/385 ─┤ 32
   ▲ full-width scrubber on its own row · time is 9px at the far right
```

### AFTER
```
⏮ ◀ ▮▶ ▶ ⏭ │ 12:55.17 ▸ 1x ▾ │ keyframes ▁▂▃▅▇▅▃▂▁ │ 53/385 │ 13.8% · spread 0.3
   ▲ inline in the toolbar, time 12px bold next to the transport
   [ / ] step · space play-pause · l/e/r mode
```

---

## A3. Flow — three surfaces for one metric

### BEFORE
```
┌ nifty-flow-windows ─────────────────────────────────────────┐ 24
│ WINDOWS ? │ SESSION CALL WRITING −₹87,407cr │ 15m CE — PE — │ 5m CE — PE — │
└─────────────────────────────────────────────────────────────┘
┌ NiftyFlowStrip ─────────────────────────────────────────────┐ 28
│ 01 1m CE 0 PE 0 FLAT 0.0 │ 12:55:17 ────────────────────────│
└─────────────────────────────────────────────────────────────┘
   + NiftyFlowChart as a 200px panel further down
        ▲ same CE−PE OI story, three places, no shared state
```

### AFTER
```
├ FLOW  5m −1.2cr ▼ │ 15m −3.4cr ▼ │ ▲ FLIP 12:55 │ SESSION −₹87,407cr ─ [ ⟩ chart ] ┤ 28
        └─ numbers wear the sparkline's own colour: one read, one line
```

---

## A4. Loading and empty

### BEFORE
```
◯ Loading index report …            ← centred spinner, whole desk blank
```
Every panel streams in at a different time and the page shifts each time.

### AFTER
```
┬ NIFTY ▾ │ ● LIVE as of … │ ⏮ ◀ ▮▶ ▶ ───────────────── │ ⋯ ┬   ← chrome paints instantly
├ SPOT ──── │ BIAS ─── │ FLIP ─── │ PCR ─── │ VIX ─── ┤   ← stat skeleton, exact widths
├─ ░░░░░░░░░░░░░░░░░░░░░░░░░░┬─ ░░░░░░░░░░░░░░░░░░ ┤   ← chart + tape skeletons at
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░│  ░░░░░░░░░░░░░░░░░░ │     their real proportions
└────────────────────────────┴────────────────────┘     (no layout shift on arrival)
```

---

# B. Daily Report (`/report`)

## B0. Shell

### BEFORE — first table row at 147px
```
┬ Daily Report │ 13/11/2026 ◀ ▶ │ Nifty 500 ▾ │ Refresh │ NIFTY 25,118 ▲ ABOVE 20DMA ─── as of 21:26 │ Copy CSV │ Copy symbols ┬ 32
├ Scan │ Breakouts │ Moves │ Follow-through │ Events ────────────────────────────────────────────────────────────────────────────────┤ 28
├ ┌───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ │ Breakouts TODAY (31)  [501 scanned]  [All 31][52W High 4][Gap 2][Base 20D 25][Base 50D 1] ─────── [Intraday│5D]                  │ 87px
│ ├───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ │ SYMBOL    TYPE     LEVEL     CLOSE     %ABOVE  VOL×  CHG%   52W GAP%  SECTOR   TREND                                              │ ← 147
│ │ ANURAS    BASE 20D ₹1209.60  ₹1304.50  +7.85%  4.1x  +9.45% -7.81%   —        ∿∿∿∿                                              │
│ └───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
│ ┌ Breakdowns TODAY (0) ─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ │ No breakdowns today                                                                                                               │ full height
│ └───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### AFTER — first row at ~76px, empty side collapsed
```
┬ Daily Report │ 13/11/2026 ◀▶ │ Nifty 500 ▾ │ 31 up · 0 down │ ⟳ ──────── as of 21:26 │ CSV ▾ ┬ 32
├ Scan │ Breakouts ●31 │ Moves │ Follow-through │ Events ────────────────────────────────────────────────────────────────────────────┤ 24
├ Breakouts TODAY [501 scanned] [All 31][52W 4][Gap 2][Base20 25][Base50 1] ───────── [1D│5D ⓘ column] ┤ 20
├ SYMBOL      TYPE     LEVEL     CLOSE     %ABOVE  VOL×  CHG%   52W BELOW HIGH  SECTOR   TREND        ┤ ← ~76
│ ANURAS      BASE 20D ₹1209.60  ₹1304.50  +7.85%  4.1x  +9.45% −7.81%          —        ∿∿∿∿         │
│ …
▸ Breakdowns TODAY (0) — none today                                          (click to expand)        │ 20
```

| Element | BEFORE | AFTER |
|---|---|---|
| panel header | 87px (badge row + chip row + 2 paddings) | 20px (chips on the table's header line) |
| empty side | full table + empty state | one 20px collapsed line |
| date/universe in panel | reprinted | removed — the identity band owns it |
| `Intraday│5D` | looks like a row filter | `1D│5D ⓘ column` — it re-renders TREND |
| Copy CSV / symbols | two buttons | one `CSV ▾` menu |
| first row | 147px | ~76px |

---

## B1. Scan tab — strips as cards

### BEFORE
```
┌ breadth  NIFTY ▲0.42% · Adv 159 · Dec 334 · … 9 stats ─────────────────────┐ 24
┌ SECTOR LEADERS ──────────────────────┐ ┌ THEME LEADERS ───────────────────────┐ 90
│ +9.1pp Producer Mfg   −1.2pp Utilities│ │ …                                    │
└──────────────────────────────────────┘ └──────────────────────────────────────┘
┌ INDEX MOVERS ────────────────────────┐
│ gainers / losers / most-active        │ 90
└───────────────────────────────────────┘
┌ NIFTY WALLS card ────────────────────┐
```

### AFTER — three lines, one band, expand in place
```
├ BREADTH  NIFTY ▲0.42% · Adv 159/Dec 334 · vol 63/61 ────────────────────────────────── ▾ ┤ 24
├ LEADERS  ▲Producer Mfg +9.1  ▲Health Svc +0.9  ▼Utilities −1.2  ▼Retail −0.3  +12 ▾ ┤ 24
├ MOVERS   ▲POWERINDIA +10.7  ▲TDPSWRS +4.6  ▼COALINDIA −2.0  ▼ONGC −1.5      +18 ▾ ┤ 24
└ walls moved to the Breakouts tab (wall data is not breadth data)
```

---

## B2. Events tab — two of everything

### BEFORE
```
┌ EventWatch ─────────────────────────────┐ ┌ ReportEventsStrip ──────────────────┐
│ next-week calendar · own loader · own   │ │ own loader · own error               │
│ error path                              │ │                                      │
└─────────────────────────────────────────┘ └──────────────────────────────────────┘
```

### AFTER
```
├ EVENTS  next week · 18 scheduled · 98 fresh ───────────────────── ⟳ 07:30 digest ⓘ ┤ 24
│ 11-13 ─ ABB RESULTS · APTUS DIV · ASTRAL DIV · CAMS DIV                             │
│ 11-14 ─ ASHOKLEY RESULTS · PATANJALI RESULTS                                         │
└ one loader, one error, cadence stated
```

---

# C. Interaction maps

## C1. NIFTY desk — BEFORE
```
mode [LIVE|EOD|REPLAY]  → switches data source (labels unexplained)
replay scrubber         → playhead; panels clip to it, no per-panel indication
panel expand            → LocalPanelModal
desk dock tab           → swaps rail
wall row                → nothing (rows are not clickable)
tape row                → nothing
scroll                  → ONE overflow-auto: the whole page moves, chart scrolls away
```

## C2. NIFTY desk — AFTER
```
● LIVE [L|E|R ⓘ] ─► data source; tooltip states each
⏮◀▮▶▶⏭ [ ]/space ─► playhead; every panel header shows "as of hh:mm"
chart ⛶ ───────────► LocalPanelModal
overlay chips ▣ ───► toggle CW / PW / spot / ΔOI without a modal
splitter drag ─────► chart:tape ratio persists per user
walls summary ▸ ───► opens the walls drawer over the chart
tape row ──────────► pins that minute; highlight propagates to flow + pressure
strike filter ─────► narrows the tape
chart column ──────► OWN scroll        ┐ page never scrolls
tape column ───────► OWN scroll        ┘
```

## C3. Daily Report — BEFORE → AFTER
```
BEFORE: date ◀▶ → refetch 4 sections · tab → client switch
        chip → client filter · row → /chart/:symbol
        Copy CSV → active section only (unclear)

AFTER:  date ◀▶ → refetch · tab → instant, each tab has a count badge (●31)
        chip → client filter · row → /chart/:symbol
        CSV ▾ → [ current tab | all tabs ]        ← the scope is explicit
        ⟳ → refetches only the visible tab
```

---

# D. Ranked backlog

| # | Change | Gain | Effort | Risk |
|---|---|---|---|---|
| 1 | **Collapse walls/erosion into a drawer** | chart moves above the fold: 800px chrome → 92px | M | med |
| 2 | **Two scroll owners** (chart col, tape col) | page stops scrolling; chart stays pinned | M | med |
| 3 | **Merge toolbar + replay into one 36px row** | −32px | S | low |
| 4 | **Verdict items `▸`-clickable** | the top read drives the desk | M | med |
| 5 | **Flow: one 28px band** (merge windows+strip, chart behind `⟩`) | −24px, one place to look | M | low |
| 6 | **Draggable chart/tape splitter** | 59/41 is wrong when reading the tape | M | low |
| 7 | **Tape: strike filter + pinned-minute highlight** | the tape is the core surface | M | med |
| 8 | **Chrome skeleton, not a spinner** | no layout shift on cold load | S | low |
| 9 | **Daily: 87px panel header → 20px** | first row 147 → 76px | M | low |
| 10 | **Daily: collapse the empty Breakouts/Breakdowns side** | empty table costs full height | S | low |
| 11 | **Daily: strips → 3 lines, walls → Breakouts tab** | 4 cards → one band | M | low |
| 12 | **Events: one loader, one error, stated cadence** | two of everything | S | low |
| 13 | **Keyboard: `[`/`]`/space replay, `/` tape search** | replay is mouse-only | M | low |
| 14 | **Units on GEX / IV / Γ headers** | three neighbours, three implicit units | S | low |

## E. Do not change

- Lazy panel boundaries and the 26kB shell.
- The canvas OI heatmap (1 node for a ±500 tape).
- Per-section timeout + abort on the Daily Report.
- 59/41 as the *default* chart/tape ratio (the splitter changes it, not the default).

## F. Open questions

1. Should `REGIME` / `SESSION CALL WRITING` live in the verdict strip or the drawer?
2. Is `TRADER DOCK` a bottom drawer or a right rail? (bottom preserves chart width at 1366)
3. `Profitability` — report tab or strategy-runner?
4. Does the SIM desk belong under `/report/index`?
