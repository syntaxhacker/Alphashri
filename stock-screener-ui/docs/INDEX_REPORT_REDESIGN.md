# Index Report — redesign (visual)

1366×890 measured.

> **The chart is SMALL by default here.** Tape, walls, flow, GEX outrank candles on a desk.
> Opposite of Patterns.

## The problem — hierarchy inverted

```
nifty-stat-strip       59px  top  72
nifty-flow-windows     24px  top 135
movers-strip           24px  top 163
nifty-report-strips   605px  top 191   ← one wall list = whole viewport
nifty-main-row        300px  top 800   ← THE CHART, below fold (vp 890)
desk-dock              26px  top 860   ← floating, overlaps
──────────────────────────────────────
1066 in an 822 client · ONE overflow-auto · no scroll owner
```

```
BEFORE
┌ toolbar 68 ──────────────────────────────────────────────────┐
├ SPOT │ REGIME │ ΓFLIP │ MAX-CALL │ MAX-PUT │ PCR │ VIX  ──────┤ 59
├ WINDOWS │ SESSION CALL WRITING −₹87,407cr ──────────────────┤ 24
├ BREADTH live only ─────────────────────────────────────────┤ 24
├ MOVERS live only ──────────────────────────────────────────┤ 24
├ ┌ WALL EROSION ────────────────────────────────────────────┐│
│ │ CALL 25,200 STABLE +93pts 14.88M FUEL 10                 ││
│ ├ WALLS ───────────────────────────────────────────────────┤│ 605
│ │ CALL  OI     NEW 5m 30m DIST    PUT   OI     NEW 5m 30m ││
│ │ 25,200 14.88M  0  0.0% 0.37%     25,000 13.59M 0  −0.42% ││
│ │ 26,000 14.26M  0  0.0% 3.56%     25,100 11.88M 0  −0.03% ││
│ │ SEQ · TRACKED · READ 4-DTE · positioning, not gamma      ││
│ └──────────────────────────────────────────────────────────┘│
├ · NIFTY CHART ─────────────────────────────────────────────┐
│ │ 1m 5m 15m  PATTERNS  S M L XL   CHAIN│HEATMAP│VOL│PREM   ││ 300
└ └──────────────────────────────────────────────────────────┘┘
                    ▲ below fold: chart, DELTA, GEX, IV, 30 strikes
```

```
AFTER   chrome above chart: 800 → 92
┌ toolbar 36 ─────────────────────────────────────────────────┐
├ SPOT │ ▲BIAS LONG ▸ │ 12 signals ▸ │ 3 walls ▸ │ FLIP ▸ │ PCR ▸ ┤ 28
├──────── CHART 38% ────────────┬───────── TAPE 62% ───────────┤
│ as of 12:55 ▣CW▣PW▣spot▣ΔOI ⛶ │ ⌕strike [All▾] ⏷12:55        │
│                              │ time  spot    ce_oi  pe_oi ΔOI│
│    ╱╲  ╱╲  CW 25,200 dashed  │ 12:55 25,106.8 14.88M 13.59M │
│  ╱    ╲╱  ╲                  │ 12:54 25,108.2 14.91M 13.55M │
│ ▁▂▃▅▇█▇▅▃▂▁ ΔOI              │ …    ↑ own scroll            │
├─────── draggable splitter ───┴──────────────────────────────┤
├ FLOW 5m −1.2cr▼ │ 15m −3.4cr▼ │ ▲FLIP 12:55 ── [⟩expand] ─────┤ 28
├ TRADER DOCK [Analytics·Overlays·Walls·Erosion·GEX·IV·Γ] [⌃] ┤ 28
└─────────────────────────────────────────────────────────────┘
   890−36−28−28−28 = 770px for chart+tape   (today: 300)
```

## Walls — 605px → 24px + drawer

```
BEFORE                            AFTER
┌ WALLS 605px ────────────────┐   ├ WALLS CW 25,200 (14.88M▲) │
│ 3 CALL rows × 5 cols        │   │        PW 25,000 (13.59M▼) │ 24
│ 3 PUT  rows × 5 cols        │   │        MP 25,150 GEX 55.9  │
│ SEQ · READ 2 lines prose    │   │        [detail ▸]          │
└─────────────────────────────┘   └────────────────────────────┘
                                            ▼
                                  ┌ WALLS ──────────── ✕ ┐
                                  │ CALL 25,200 +0.37%    │
                                  │      FUEL ▰▰▱ 10      │
                                  │ PUT  25,000 −0.42%    │
                                  │      FUEL ▰▰▰ 33      │
                                  │ EROSION call +93 put −7│
                                  │ READ 4-DTE positioning │
                                  └───────────────────────┘
                                    drawer over the chart
```

## ⭐ Chart focus — chart expands on click

```
LEVEL 0  desk, chart 38%  (default)
┌───────── chart ─────────┬────────── tape ──────────┐
│  candles · CW/PW · ΔOI  │ time spot ce_oi pe_oi ΔOI │
│  click anywhere → focus │ 12:55 …                  │
└─────────────────────────┴──────────────────────────┘
        click or [f] ↓

LEVEL 1  chart focus, 100%
┌────────────────────────────────────────────────────┐
│  [⤡ exit · Esc]                                    │
│      ╱╲    ┌──────────────────────┐                │
│    ╱╲  ╲╱╲ │ CW 25,200 · PW 25,000│                │
│  ╱    ╲    └──────────────────────┘                │
│ ▁▂▃▅▇█▇▅▃▂▁ ΔOI                                     │
├────────────────────────────────────────────────────┤
│ ▸ TAPE 12:55 spot 25,106.8 ΔOI −0.3M ▼sell [open]   │ 20
│ ▸ DOCK Analytics·Overlays·Walls·Erosion·GEX·IV·Γ    │ 20
└────────────────────────────────────────────────────┘
        ⛶ ↓

LEVEL 2  fullscreen modal
```

| | desk | focus | full |
|---|---|---|---|
| chart | 38% | 100% | viewport |
| tape | 62% | 20px strip | hidden |
| dock | 28px | 20px strip | hidden |
| exit | — | Esc (no unmount) | ✕ |

## Flow — 3 surfaces → 1 line

```
BEFORE
├ WINDOWS │ SESSION CALL WRITING −₹87,407cr │ 15m CE — PE — │ 5m CE — PE — ┤ 24
├ 01 1m CE 0 PE 0 FLAT 0.0 │ 12:55:17 ──────────────────────────────────┤ 28
  + NiftyFlowChart 200px panel further down
                ▲ one metric, three places

AFTER
├ FLOW 5m −1.2cr▼ │ 15m −3.4cr▼ │ ▲FLIP 12:55 │ SESSION −₹87,407cr ─ [⟩chart] ┤ 28
```

## Daily Report — 87px header

```
BEFORE                                                          AFTER
┌ Breakouts TODAY (31) [501 scanned]                    ┐        ├ Breakouts TODAY [501 scanned] [All 31]… ┤ 20
│ [All 31][52W 4][Gap 2][Base20 25][Base50 1] [1D│5D]  │ 87     ├ SYMBOL TYPE LEVEL CLOSE %ABOVE …       ┤
├ SYMBOL TYPE LEVEL CLOSE %ABOVE VOL× CHG% 52W% …      ┤ ←147   │ ANURAS BASE20 ₹1209 ₹1304 +7.85%        │ ←76
└ Breakdowns TODAY (0) ─────────────────────────────────┘        ▸ Breakdowns TODAY (0) — none  (click)      │ 20
   ▲ empty table = full height
```

## Units — 3 neighbours, 3 implicit scales

```
BEFORE  ┌ GEX −₹4.2 lakh ┐ ┌ IV SKEW +2.1% ┐ ┌ GAMMA 1.8e-4 ┐
AFTER   ┌ GEX −₹4.2L ⓘ₹/1% ┐ ┌ IV +2.1σ ⓘvs ATM ┐ ┌ Γ 1.8×10⁻⁴ ⓘper ₹ ┐
```

## Do first

```
1 walls → drawer          M med  chart above fold, 800→92 chrome
2 two scroll owners       M med  page stops scrolling
3 toolbar+replay one row  S low  −32px
4 verdict items ▸         M med  top read drives the desk
5 flow → one band         M low  −24px, one place
6 ⭐ chart focus          M med  38%→100%, tape→strip
7 tape strike filter      M med  core surface
8 chrome skeleton         S low  no layout shift
9 daily 87→20 header      M low  147→76 first row
10 collapse empty side    S low  empty ≠ full height
```

## Never change
lazy panels · canvas heatmap · per-section abort · 38/62 as default

## Ask
1 REGIME/SESSION in verdict or drawer? 2 dock = bottom or right rail? 3 Profitability here?
