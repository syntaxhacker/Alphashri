# Index Report — redesign (web app, visual)

1366×890 measured.

> **The chart is SMALL by default here.** Tape, walls, flow and GEX outrank candles on a
> desk. Opposite of Patterns. Click the chart to give it everything.

## The rule: web-app shell, adaptive density for data

```
CHROME / PANELS / BUTTONS          DATA (tape, walls, tables)
13–14px type                       32px rows, 12px numbers
12–16px padding                    mono + tabular
6px radius, 1px border             own scroll
32px buttons                       windowed
8/12/16 gaps
```

Air comes from **padding and gaps**, never from blur/shadow/animation on a scroll path.

## Type & space

```
BEFORE (terminal)        AFTER (web app)
11px / 9px               13px body · 12px secondary · 11px micro
23px rows                32px rows
2–4px gaps               8 / 12 / 16
1–2px radius             6px
border on every cell     border around groups only
20–24px buttons          32px, px-3
```

## The problem — hierarchy inverted

```
nifty-report-strips   605px  top 191   ← one wall list = whole viewport
nifty-main-row        300px  top 800   ← THE CHART, below fold (vp 890)
1066 content in an 822 client · ONE overflow-auto
```

```
BEFORE
┌ toolbar 68 ───────────────────────────────────────────────┐
├ SPOT │ REGIME │ ΓFLIP │ MAX-CALL │ MAX-PUT │ PCR │ VIX ────┤ 59
├ WINDOWS │ SESSION CALL WRITING −₹87,407cr ───────────────┤ 24
├ BREADTH live only ───────────────────────────────────────┤ 24
├ MOVERS live only ────────────────────────────────────────┤ 24
├ ┌ WALL EROSION ─────────────────────────────────────────┐│
│ │ CALL 25,200 STABLE +93pts 14.88M FUEL 10              ││ 605
│ ├ WALLS ────────────────────────────────────────────────┤│
│ │ CALL  OI  NEW 5m 30m DIST   PUT   OI  NEW 5m 30m DIST ││
│ │ 25,200 14.88M 0 0.0% 0.37%   25,000 13.59M 0 −0.42%   ││
│ │ SEQ · TRACKED · READ 4-DTE · positioning, not gamma   ││
│ └───────────────────────────────────────────────────────┘│
├ · NIFTY CHART ────────────────────────────────────────────┤
│ │ 1m 5m 15m PATTERNS S M L XL CHAIN│HEATMAP│VOL│PREM     │ 300
└ └───────────────────────────────────────────────────────┘┘
                 ▲ below fold: chart, DELTA, GEX, IV, 30 strikes
```

```
AFTER   chrome above chart 800 → 108 · web-app shell
┌──────────────────────────────────────────────────────────────────────────┐
│  NIFTY ▾    SENSEX    ● Live   as of 12:55      ⏮ ◀ ▮▶ ▶   1x ▾   ⟳   ⋯  │ 56
│  ╭─ Desk ─╮ Chart  Depth  Research                          POS ✕   [SIM] │ 44
├──────────────────────────────────────────────────────────────────────────┤
│  SPOT 25,106.8 ▲0.42%   ▲ LONG ▸   12 signals ▸   3 walls ▸   PCR 0.80 ▸ │ 56
├──────────────────────────────────────────────────────────────────────────┤
│  ╭── CHART 38% ────────────╮ ┌── TAPE 62% ────────────────────────────┐  │
│  │ as of 12:55  ▣CW ▣PW ⛶  │ │ ⌕ strike   [ All ▾ ]      ⏷ 12:55      │  │
│  │        ╱╲   ╱╲          │ │ 12:55  25,106.8  14.88M  13.59M  ▼sell  │  │
│  │      ╱    ╲╱  ╲         │ │ 12:54  25,108.2  14.91M  13.55M  ▲buy   │  │
│  │    ▁▂▃▅▇█▇▅▃▂▁ ΔOI      │ │ 12:53  …                               │  │
│  │ click the chart → focus │ │  ↑ own scroll, 32px rows               │  │
│  ╰─────────────────────────╯ └────────────────────────────────────────┘  │
├───── drag to resize chart / tape ────────────────────────────────────────┤
│  FLOW  5m −1.2cr ▼   15m −3.4cr ▼   ▲ FLIP 12:55        [ ⟩ chart ]     │ 44
├──────────────────────────────────────────────────────────────────────────┤
│  ╭─ Analytics ─╮ Overlays   Walls   Erosion   GEX   IV   Γ   ──  [ ⌃ ]   │ 48
└──────────────────────────────────────────────────────────────────────────┘
   890 − 56 − 44 − 56 − 44 − 48 = 642px for chart+tape   (today: 300)
```

## Walls — 605px → 56px card + drawer

```
BEFORE                              AFTER
┌ WALLS 605px ─────────────────┐    ┌─ Walls ───────────────────────────────┐
│ 3 CALL rows × 5 cols         │    │  Call 25,200   14.88M   ▲0.37%  ▰▰▱  │ 56
│ 3 PUT rows × 5 cols          │    │  Put  25,000   13.59M   ▼0.42%  ▰▰▰  │
│ SEQ · READ — 2 lines prose   │    │  MP 25,150   GEX 55.9     [ Detail ▸ ]│
└──────────────────────────────┘    └───────────────────────────────────────┘
                                                 ▼
                                     ╭─ Walls ───────────────────── ✕ ─╮
                                     │ CALL  25,200 CW  +0.37%  FUEL ▰▰▱ │
                                     │       26,000 CW  +3.56%           │
                                     │ PUT   25,000 PW  −0.42%  FUEL ▰▰▰ │
                                     │ Erosion  call stable +93          │
                                     │ Read     4-DTE positioning        │
                                     ╰───────────────────────────────────╯
                                        drawer over the chart
```

## ⭐ Chart focus — chart gets everything on click

```
LEVEL 0  desk, chart 38%  (default)
┌──────── chart ────────┬────────── tape ──────────┐
│ candles · CW/PW · ΔOI │ time spot ce_oi pe_oi ΔOI │
└───────────────────────┴──────────────────────────┘
        click the chart, or [ f ]  ↓

LEVEL 1  chart focus, 100%
┌────────────────────────────────────────────────────┐
│  NIFTY · 1m · as of 12:55          [ ⤡ Exit · Esc ]│ 44
│                                                    │
│        ╱╲    ┌────────────────────────┐            │
│      ╱╲  ╲╱╲│ CW 25,200 · PW 25,000   │            │
│    ╱    ╲   └────────────────────────┘            │
│  ▁▂▃▅▇█▇▅▃▂▁ ΔOI                                    │
│  ▣CW ▣PW ▣spot ▣ΔOI    1m 5m 15m      ⛶            │
├────────────────────────────────────────────────────┤
│  ▸ Tape  12:55 · 25,106.8 · ΔOI −0.3M ▼sell  [open]│ 40
│  ▸ Dock  Analytics · Overlays · Walls · GEX        │ 40
└────────────────────────────────────────────────────┘
        ⛶ ↓

LEVEL 2  fullscreen modal
```

| | desk | focus | full |
|---|---|---|---|
| chart | 38% | 100% | viewport |
| tape | 62% | 40px strip | hidden |
| dock | 48px | 40px strip | hidden |
| exit | — | Esc, nothing unmounts | ✕ |

## Verdict — 5 numbers → 4 actionable

```
BEFORE  SPOT 25,106 │ REGIME SELL PREMIUM │ ΓFLIP 25,500 │ MAX-CALL 25,200 │ MAX-PUT 25,000 │ PCR 0.80
        59px, scrolled away from the panels it describes

AFTER   SPOT 25,106.8 ▲0.42%  │  ▲ LONG ▸  │  12 signals ▸  │  3 walls ▸  │  PCR 0.80 ▸
        56px card, ▸ = pin the matching panel · hover = why
```

## Flow — 3 surfaces → 1

```
BEFORE  ├ WINDOWS │ SESSION −₹87,407cr │ 15m CE — PE — │ 5m CE — PE — ┤ 24
        ├ 1m CE 0 PE 0 FLAT │ 12:55:17 ─────────────────────────────┤ 28
          + NiftyFlowChart 200px panel further down
                        ▲ one metric, three places

AFTER   ├ FLOW  5m −1.2cr ▼   15m −3.4cr ▼   ▲ FLIP 12:55   [ ⟩ chart ] ┤ 44
```

## Daily Report — 87px header → 40px

```
BEFORE                                          AFTER
┌ Breakouts TODAY (31) [501 scanned]      ┐     ┌ Breakouts · 31 · 501 scanned  [All][52W][Gap] ┐ 40
│ [All][52W 4][Gap 2][Base20 25] [1D│5D]  │ 87  ├ SYMBOL      TYPE    LEVEL    %ABOVE   CHG%    ┤ 36
├ SYMBOL TYPE LEVEL CLOSE %ABOVE VOL× …   │←147 │ ANURAS      BASE20  ₹1209    +7.85%   +9.45%  │ 32
└ Breakdowns TODAY (0) ───────────────────┘     └ ╰ Breakdowns · 0 · none today  [ expand ▸ ]  ┘ 40
   ▲ empty table = full height
```

## Units — 3 neighbours, 3 implicit scales

```
BEFORE  ┌ GEX −₹4.2 lakh ┐ ┌ IV SKEW +2.1% ┐ ┌ GAMMA 1.8e-4 ┐
AFTER   ┌ GEX −₹4.2L  ⓘ ₹/1% ┐ ┌ IV +2.1σ ⓘ vs ATM ┐ ┌ Γ 1.8×10⁻⁴ ⓘ per ₹ ┐
```

## Perf guardrails

```
KEEP                         FORBID
lazy panels                  backdrop-filter / blur       ← compositing
canvas OI heatmap            shadow on scrolling rows     ← repaint/frame
<For>, windowed lists        animating height/width       ← layout thrash
per-section abort            nested bordered cards
transform/opacity only       big panel shadows
32px rows (not 44)
```

## Do first

```
1 walls → 56px card + drawer   M med   chrome 800→108
2 two scroll owners            M med   page stops scrolling
3 ⭐ chart focus 38%→100%      M med   tape/dock → strips
4 13px type, 32px rows         M med   web app, grid scannable
5 pill tabs + 56px header      S low   reads as an app
6 verdict items ▸              M med   top read drives the desk
7 flow → one 44px card         M low   −24px, one place
8 draggable splitter           M low   38/62 is a default
9 daily 87→40 header           M low   147→~108 first row
```

## Never change
lazy panels · canvas heatmap · per-section abort · 38/62 default

## Ask
1 REGIME / SESSION in verdict or drawer? 2 dock = bottom bar or right rail? 3 32px tape rows or 28?
