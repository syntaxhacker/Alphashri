# Index Report — redesign (web app, visual)

1366×890 measured.

## 2026-11-24 re-measure — chart is unreachable (P0)

Measured live on the EOD / replay 11:43 / market-closed state at **1920×890** via `getBoundingClientRect()`:

| Element | y | clientH | scrollH | Reading |
|---|---|---|---|---|
| `nifty-report-content` | 99 | 791 | **1177** | 386px clipped by `overflow:hidden` |
| `nifty-main-row` | 784 | 300 | **422** | 122px clipped; `min-height:300px` |
| `nifty-chart-panel` | 784 | 300 | 298 | only 106px inside the viewport |
| chart canvas (`tradingview-chart`) | 832 | 222 | 222 | only **58px** visible |
| `app-main` | 0 | 890 | 890 | page itself cannot scroll |

**This is not just "below the fold" — it is unreachable.** Two nested `overflow:hidden` owners clip 386px + 122px and no ancestor scrolls. The 1366px plan below assumed the chart was scrollable; that assumption is wrong. Fix reachability before any cosmetic work.

### Revised do-first (supersedes the order at the bottom of this doc)

| # | Change | Frees | Gate (fails today) |
|---|---|---|---|
| 0 | Add a layout budget test: chart canvas top + 200 ≤ viewport height AND content scrollH ≤ clientH (or a real scroll owner exists) | — | `nifty-chart-canvas.y + 200 <= innerHeight` is `832+200=1032 > 890` → **FAIL** |
| 1 | Collapse `MORE STATS` by default; move the two ~190px analytics charts (FUTURES POSITIONING, ITM PE FLOW) into the bottom dock/drawer | ~230px | chart-panel top 784 → ≤ ~554 |
| 2 | Remove `min-height:300px` from `nifty-main-row`; let it flex-fill. Make `nifty-report-content` the single scroll owner (`overflow-y:auto`) or eliminate its overflow — never both silent-clip | ~120px | content scrollH 1177 → ≤ 791, canvas height ≥ 400 |
| 3 | Chart focus 38%→100% on click / `F`, `Esc` to restore; verdict levels (sell/cut/target) as labelled chart lines | — | focus + annotation tests |
| 4 | Toolbar clusters (Underlying / Mode / Session), label renames, glossary expansion | — | label assertions updated |

### Target budget at 890px (desktop ≥1200px)

```
toolbar (2 rows, clustered)   72
replay bar                    28
verdict hero + [All stats ▾]  56
main split  CHART ~60% | CHAIN 40%   640
flow strip                    44
dock (Analytics/Walls/GEX/IV/Tape)   48
                              ───
                              888  ≤ 890
```

Non-negotiables: one scroll owner; chart never clipped; analytics stay reachable via drawer, not deleted; verify at 1600×1000 and 390×844 and read both PNGs back.

### A+ windowed redesign plan (2026-11-24, IN PROGRESS)

Target: lift `/report/index` from the last independent panel (**7 / 8.5 / 8 — not A+**) to the
A+ gate in `docs/DESIGN_SYSTEM_A_PLUS_GATE.md`: median ≥ 9 on every in-scope dimension from
three independent read-only raters, zero P0/P1. Self-scoring does not count.

Direction: adopt the **homepage's windowed-view pattern** (mapping in progress) instead of a
single packed panel. One window per concept — chart, option chain, walls, flow/tape, analytics —
each with a titlebar, its own scroll owner, predictable focus order and dismiss/restore. This
addresses the two recurring complaints the current layout cannot fix: poor readability at a
glance, and the top section getting worse when a disclosure expands.

Readability contract for this redesign:
- one 32px KPI/decision band; `ALL STATS` opens a bounded popover, never grows the band;
- each window owns one concept and one scroll; no nested bordered cards; one border per window;
- `text-ui-*` only (12px floor), mono + tabular numbers, semantic colour once per value;
- empty/loading/error states collapse and name the reason, never reserve data height;
- keyboard parity: Tab order follows visual order, Escape dismisses the top overlay,
  every window has a labelled close/restore control;
- verify with three independent raters plus 1600×1000 and 390×844 read-back.

Implementation waves will be dispatched once the homepage window map lands; each wave gets
disjoint file ownership and a measurable gate that fails before the change.

### Window-system mapping (verified 2026-11-24)

The homepage uses two surfaces: `HomeMonitorView` (CSS grid) and an opt-in desk wrapping
`<WindowManager>`. Panels are registered once as `DockPanelSpec` (`src/components/dock/types.ts`)
and mounted by `Window` via `spec.mount(context, api)`. A `WindowLayout` is plain rect+z state
(`src/components/window/types.ts`); `Window` owns only in-flight drag rect, commits once on
pointer-up. `WindowManager` owns focus id, lock flag, measured canvas and the live region.
Presets are geometry-only canvas fractions; persistence is a `savedConfig` scope with 800ms
debounce and a hydration latch. A11y: labelled `region` per frame, `tabindex=0`, arrow keys
move / Shift+arrows resize, four titlebar buttons, lock hides resize handles. Readability comes
from `text-ui-micro` uppercase titlebars on `h-7` bars, one border per window, and
`PanelSkeleton` / `Text size="xs"` fallbacks.

### Waves

| Wave | Scope | Owner files | Gate |
|---|---|---|---|
| 1 (in flight) | KPI collapsed 32px + bounded `ALL STATS` popover | `ReportKpiHero.*`, `ReportDecisionStrip.hero.*`, `.moreStats.tsx`, `reportTokens.ts`, shell layout tests | band height identical collapsed/expanded; no inline blow-up |
| 1 (in flight) | Report window foundation: registry, presets, saved-config scope, `ReportWindowDesk` | new `reportWindow*.ts(x)` files only | non-overlap at 1280/1920/2560; layout round-trip; empty state; labelled regions |
Eligible window set (APPROVED 2026-11-24): `chart` (min 420×260), `chain` (340×240),
`walls` (280×180), `flow` (300×180), `analytics` (360×220, tabbed: futures positioning,
ITM PE flow, delta, GEX, IV skew), `movers` (260×140). Breadth, levels-in-play, GEX profile,
IV skew and heatmap are TABS inside analytics/chain, not separate windows. Never windows:
toolbar, 32px KPI/decision band (ALL STATS = bounded popover), replay bar, DESK BAY dock.
At 390px the monitor view stays chart-first; the desk degrades to single-column tiles.

| 2 | Shell integration: desk view toggle, mount `ReportWindowDesk` in desk mode, keep chart-first mobile fallback | `NiftyReportShell.tsx`, `ReportToolbar.tsx`, their tests | one scroll owner; no chart clipping; keyboard order matches visual order |
| 3 | Panel readability: consistent panel titlebars, mono/tabular numbers, empty/loading/error copy per window | windowed panel files + their tests | every window has a named empty + loading + error state |
| 4 | A+ verification: lint/typecheck/build, axe + keyboard gates, 1600×1000/390×844 screenshots read back, three independent read-only raters | main agent + raters | median ≥ 9 on every in-scope dimension, zero P0/P1 |

No A+ claim until wave 4 passes with independent raters. The prior panel (7 / 8.5 / 8) is the
honest baseline, not certification.

### Work priority (user instruction, 2026-11-24)
Right now: intuitiveness, design and the visible UI view only. Accessibility and
code-quality passes come AFTER the UI is visually right. Independent a11y findings
are logged but deferred unless they cause a visible UI defect.

### Independent verifier findings — 2026-11-24 (layout/fit)

- **P0** `reportWindowPresets.ts:70-77`, `layout.ts:11,51,54,139`, `WindowManager.tsx:174`:
  first-run `full` preset uses 3 columns at 390px; each window floors to 240px,
  so col-2 ends at x≈503 (113px off-screen) and the canvas is `overflow-hidden`.
  `fitAllToScreen` cannot recover (3×234=702 > 390). Fix: phone-aware preset or
  single-column tiles (already dispatched).
- **P1** `reportBits.tsx:46` + `NiftyGexProfile.tsx:106-133`: GEX stack exceeds the
  281px window; text cuts mid-sentence with no scroll cue. Add a cue or shrink the
  mini chart under a ≤300px container.
- **P1** `reportWindowTypes.ts:31-38` / adapters: duplicated titles — window frame
  "INDEX CHART" + inner "NIFTY CHART", "OPTIONS CHAIN" + "Option-chain OI", "OI
  WALLS" + "WALLS", "OPTIONS ANALYTICS" + tabs + "GEX profile". Suppress/demote
  inner headers in window adapters (~28px reclaimed per window).
- **P1** `NiftyChartPanel.body.tsx:182-212`: "CHART OPTIONS" clips to "CHA" at
  ~240px window; collapse behind `⋯` at narrow container widths.
- **P2** `NiftyChartPanel.body.tsx:170-181`: at 09:15 replay a blank plot shows
  only price tags, no candles and no empty state; phone axis reservation (116px)
  is viewport-keyed, not container-keyed.

### Independent verifier findings — typography/states/semantics (UI items only)

- WALLS stat label/value collision confirmed in captured PNG (source now fixed; re-capture
  needed). `NiftyWallsCard.stats.tsx:13-45`: adjacent inline label/value spans, `truncate`
  with no separator/tooltip.
- `reportCells.chainPanel.tsx:278-284` — 390 scroll cue clipped to `SCROLL FO` and painted
  over the last ΔOI value. Shorten copy, anchor to visible viewport, opaque backdrop.
- `reportWindowDeskContent.tsx:49-56` — empty-state reason truncates without recovery
  (`Not capt…` at 390). Wrap or provide a tooltip.
- `NiftyGexProfile.legend.tsx` + `.rows.tsx` + `ReportKpiHero.tsx` — flip/spot printed 3–4×
  (hero KPI, GEX stat row, regime sentence), sentence clips mid-clause at 472px. One owner
  per fact, duplicates to tooltip.
- Spot printed at two precisions (`25,976` hero vs `25,976.10` walls vs `25569.60` chart)
  with no as-of hint. One formatter + snapshot time.
- CW/PW/MP repeated in chart tags, walls legend and wall tables. Legend codes-only with
  values in tooltip.
- GEX glyph drift: `NET Γ (BOOK)` / `Γ FUEL ↓` vs hints `zero γ`, `γ support`. Use `γ`
  consistently.
- Deferred (a11y/later): error states disguised as empty in `reportWindowMarketContent.tsx`,
  missing `title` tooltips, non-focusable legend details.

### Independent verifier findings — code/a11y (UI items kept, rest deferred)

Kept for the UI wave: `Window.tsx:287` + `reportWindowDeskContent.tsx:20-30` — frame body
`overflow-auto` and inner `WindowBody overflow-y-auto` create two nested scroll owners
(double scrollbar / ambiguous scroll target); `Window.tsx:278-280` — truncated window title
has no `title` tooltip so a 320px frame cannot reveal it.
Deferred until UI is right: dead `REPORT_STANDALONE_PANEL_KEYS`, dead `HeroClaim` export,
`any` in chart/EChart, restated `rgba` fills, unlabelled analytics tab strip, missing
`title` tooltips on empty-state reasons, analytics error states disguised as empty.

### Direction chosen (2026-11-24): A + B KPI hero

The "chart-first desk" layout above, with the Bento concept's single 72px KPI band as the
visual anchor. Rejected: pure-A (keeps the cramped verdict strip as the anchor), pure Bento
(too much scroll for a live desk), three-column cockpit (panes too narrow at 1600, ugly at 390).

Root cause of "ugly" recorded from the live frame: no focal point — nine equal-weight
surfaces, two analytics charts placed above the chart, every stat in the same 12px mono weight,
free-floating sparklines inside stat cells, nested hairline borders, and the DESK BAY shortcut
overlay sitting on top of live content. The redesign gives one hero, one focal chart, one
companion table; everything else becomes a strip or a dock/drawer tab.

Implementation lanes (disjoint file sets): A walls-stat label · B glossary · C toolbar
clusters · D verdict levels on chart · E label renames · L1 shell/KPI hero/analytics
relocation/focus/scroll owner · L2 main-row reachability.

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

> Superseded by the 2026-11-24 re-measure at the top of this file: reachability (P0) comes first.

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
