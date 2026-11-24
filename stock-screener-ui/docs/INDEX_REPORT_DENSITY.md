# Index Report — density & readability contract

Scope: the Index Report surface (`/report/index`, NIFTY and generic SENSEX/RELIANCE).
This is a contract over **existing** tokens, components and constants. It invents
no new component, panel, breakpoint or font size. Every rule below points at the
file that owns it. The composition is the final A++ shape: one decision hero,
chart-first content at both widths, and everything else collapsed or ordered
behind it.

Sources of truth: `src/pages/report/reportTokens.ts` (report dialect),
`src/ui/typography.ts` + `docs/TYPOGRAPHY.md` (shared scale),
`src/pages/report/NiftyReportShell.tsx` + `ReportWorkspace.tsx` (shell/workspace,
mobile order), `ReportToolbar.tsx` (chrome), `reportBits.tsx` (panel/stat/disclosure
primitives), the `ReportDecisionStrip.*` modules (decision band), `reportCells.chain*.tsx`
+ `chainStyles.ts` (OI chain), `NiftyChartPanel.constants.ts` +
`NiftyChartPanel.body.tsx` (chart geometry). The report tree is **facade + satellites**:
a small facade file (`ReportDecisionStrip.tsx`, `reportCells.tsx`, `niftyReportStore.ts`,
`NiftyWallsCard.tsx`, …) re-exports pure helpers/types and holds composition only;
the constants and implementations named below live in the sibling `<stem>.*`
modules listed in §4.

## 1. Type ladder

| Size | Role on this page | Owner / use |
|---:|---|---|
| **12** | labels, axes, hints, timestamps | `REPORT_FONT.micro` (`text-ui-micro`) — hard floor. Chain column labels: `OI_CHAIN_METRICS.labelSize` in `reportCells.chainMetrics.ts`; heatmap axis/legend in `NiftyOiHeatmap.format.ts`/`legend.tsx`. |
| **13** | body, table cells, secondary values | `REPORT_FONT.body` (`text-ui-body`). Chain values: `OI_CHAIN_METRICS.valueSize`, `td`/`th` overrides in `reportCells.chainCells.tsx`. |
| **14** | controls, panel titles | `text-ui-label` (`TYPE_SCALE.label`) — compact panel header and disclosure toggle in `reportBits.tsx`. |
| **16** | section/value hierarchy | `REPORT_FONT.value` = `TYPE_SCALE.title` — replay banner title (`NiftyReportShell.tsx`), driven values in `ReportStrips.tsx`, chart title (`CHART_HEADER_METRICS.titleSize`). |
| **24** | page display | `REPORT_FONT.display` = `TYPE_SCALE.display` — the single hero claim (`PLAN_HEADLINE_STYLE` in `ReportDecisionStrip.format.ts`). |

Rules:

- The shared six-step scale also defines `20` (`text-ui-heading`); the report
  deliberately spends only the five steps above. Never add a private size to
  make text fit (`docs/TYPOGRAPHY.md` §Usage; `reportFontFloor.test.ts`).
- Classes first (`TYPE_CLASS`); `REPORT_FONT` is for SVG/canvas/inline styles.
  `REPORT_CONTROL_LABEL_STYLE` / `REPORT_CONTROL_LABEL_CLASS` are the only
  toolbar-control overrides (`ReportToolbar.tsx`); `CHART_CONTROL_LABEL_STYLE`
  is the chart-header equivalent.
- Weight and colour carry emphasis, not size. Change component width/wrapping
  when a label clips; never shrink the font.
- Mono + tabular numerals for every numeric readout (`tabular-nums`,
  `palette.MONO` in `reportCells.format.ts`, `ReportDecisionStrip.format.ts`).

## 2. Spacing, density and borders

**One gutter** — `REPORT_GUTTER` in `reportTokens.ts`:

| Step | px | Where |
|---|---:|---|
| inline | 4 | between inline items, inside a group; `REPORT_STRIP_METRICS.cellGap` and `groupRowGap` |
| section | 8 | between top-level bands; `gap-2` in `NiftyReportShell.tsx`, `ReportWorkspace.tsx`, `reportBits.tsx` |
| outer | 16 | `REPORT_GUTTER.outer` / `REPORT_PAD.xl`, page-level margin. `REPORT_PAD.lg = 12` is for modal outer / major breaks (`SectionError`, `LocalEmptyState`), not a second desk gutter. |

- The 8px group gutter is spent as **4px row gap + 1px hairline + 3px inset**
  (`REPORT_STRIP_METRICS`, `groupCellGap()`). No 6px slop; no 121/200px dead
  zones.
- **Row/band density** comes from `REPORT_ROW` only: `dense 22`, `normal 24`,
  `walls 26`, `comfortable 28`. Strip cells are `cellHeight 40`
  (`REPORT_STRIP_METRICS`), a different metric from a table row — do not
  conflate them. Panel title/body spacing is `REPORT_PAD.sm/md`.
- **One border per section**: every top-level band carries
  `REPORT_SECTION_ATTR`; `REPORT_SECTION_ALIGN.panel/content` zeroes inner left
  borders so content shares one left edge (`data-left-edge=4` in the shell).
  `LocalCompactPanel` (`reportBits.tsx`) paints a single border; inside a band,
  separation is a hairline divider, never a second card. Guarded by
  `ReportGridDiscipline.test.tsx`.
- **No nested card-on-card**. A stat is `LocalCompactStat` text on the section
  surface; a disclosure is `LiveTapeDisclosure`; drifts are fixed with the
  existing alignment classes, not a new wrapper.
- Radius vocabulary `REPORT_RADIUS` 2/4/6/10 only (hairline 2, chip/badge 4,
  control/panel 6, large container 10).

## 3. Final A++ composition

Both widths lead with the same content: **decision hero → chart → everything else**.
At 1600 the chart is the largest block (`ReportWorkspace.tsx` `1fr / 420px`,
`DESK_CHART_FLOOR_PX = 430`, `58vh` cap; `DESK_CONTENT_GRID_CLASS` row shares
`auto / 70fr / 30fr` at ≥1200). At 390 the chart is the second ordered band,
immediately after the hero, and every other band is a disclosure or a later
order slot. Low-frequency bands live behind the existing dock tabs
(`secondaryTabs`, `NiftyReportShell.tsx`). Breakpoints are the ones already in
source — `min-[1200px]`, `max-[600px]` and `CHAIN_COMPACT_QUERY = (max-width: 639px)`
(`chainStyles.ts`). Do not add a third.

### 3.1 One decision hero — spot/change + one neutral state

`ReportDecisionStrip.hero.tsx` / `.derive.ts` / `.format.ts`. The first viewport
owns a single band (`data-report-band="decision-hero"`, `DECISION_HERO_HEIGHT`
`wide 60 / narrowMax 72`, phone min 56px): `SPOT`, `CHANGE`, one status token,
one reason, and at most one claim. `resolveDecisionState()` returns exactly one
of `MARKET CLOSED` / `AWAITING DATA` / `AWAITING TRIGGER` / `LIVE READ`; no-call
states are **neutral** (amber `WARNING` tint), never bullish/bearish green, and
`chip: "decision"` is set only when real evidence plus confidence back a call
(`planConfidenceLabel()` suppresses a `confidence: 0` sentinel). The claim slot
(`HeroClaim`) is the only place the verdict headline prints; `VerdictContent`
is evidence-only. Guard: `ReportDecisionStrip.hero.test.tsx`, `.hierarchy.test.tsx`.

### 3.2 More stats

`ReportDecisionStrip.moreStats.tsx`. One `LiveTapeDisclosure` labelled
`MORE STATS` holds walls, volatility, evidence (`VerdictContent`) and the FLOW
group; its inner `display` gate keeps it genuinely collapsed on a phone even
when the shell promotes the legacy verdict body. Desk's second band is the
28px evidence line (`DECISION_CONTEXT_HEIGHT`). Guard: `.groups.test.tsx`,
`.tail.test.tsx`.

### 3.3 Chart-first at both widths

`NiftyReportShell.tsx` `REPORT_MOBILE_ORDER_CLASS` puts the stat strip (hero +
More stats) at order 1 and the chart main row at order 2; flow, movers, rail,
dock and analytics follow. The desk keeps the old paint sequence via negative
orders (`REPORT_DESK_FLOW_FIRST_CLASS`) without moving a lazy boundary.
`MOBILE_CHART_TARGET = 240` is reached by collapsing the SESSION/15m/5m flow
band, not by shrinking the chart. Guards: `NiftyReportShell.layout.test.tsx`,
`ReportWorkspaceMobile.test.tsx`, `ReportChartMobileBudget.test.tsx`.

### 3.4 Last-data boundary + mobile axis gutter

`NiftyChartPanel.constants.ts` + `.body.tsx`. `CHART_PLOT_MARGIN` =
`dataCutoffLane 24 / axisMinWidth 88 / edgeGutter 8`; `applyChartPlotMargin()`
sets `rightOffsetPixels = 24` and `entireTextOnly = true`, so the time domain
ends at the last populated bar plus one **labelled cutoff lane**
(`data-testid="nifty-chart-last-data-boundary"`), never unmarked grid. The 88px
desktop axis fits `22,350.00` but clipped a full `22,300.00` at 390, so a phone
reserves a dedicated `MOBILE_AXIS_MIN_WIDTH = 144` lane, `MOBILE_EDGE_GUTTER = 12`
outer gutter and `MOBILE_CUTOFF_LABEL_GAP = 6` (`MOBILE_CUTOFF_RIGHT = 180`);
desktop geometry is unchanged. Guard: `NiftyChartPanelGeometry.test.tsx`.

### 3.5 Desk chain — 384px width / 360px cap / ATM emphasis

`reportCells.chainMetrics.ts` + `.chainPanel.tsx`. Desk width is a definite
`OI_CHAIN_DESK_WIDTH = 384` (76+76+60+60+112), deliberately under the 420px
side-panel budget (`OI_CHAIN_PANEL_BUDGET`); full-chain columns stay roomy
behind the wrapper's scroll at 390. Height cap is
`OI_CHAIN_MAX_HEIGHT = 360` **px, never a percentage** — `max-height: 100%`
collapsed to a header-only strip in the real 1600 capture. The ~177px five-row
desk chain (28px header + 5×26px rows) hugs its content; a full chain scrolls
inside the table's own scroll area. ATM emphasis is real: `centreChainAtm()`
finds `nifty-strike-atm-badge`, sets `data-chain-atm-centered`, and opens on the
ATM strike; no placeholder tint on other rows. Guard: `reportCells.chain.test.tsx`.

### 3.6 Two-row 48+20 toolbar

`ReportToolbar.tsx`. Below 1200 the chrome is exactly two owned bands:
`TOOLBAR_PRIMARY_HEIGHT = 48` controls + `TOOLBAR_SECONDARY_HEIGHT = 20`
DATA/freshness = `TOOLBAR_CHROME_HEIGHT = 68`, with no outer vertical padding
or row gap to add a third. The selector strip scrolls (`snap-x`) behind a fade
and native-select scroll cue instead of clipping; a wrapped action used to be
the fourth row at 390. At ≥1200 both bands are inline, content-sized
(`h-auto`) — still one compact row. Guard: `ReportToolbar.test.tsx`.

### 3.7 Collapsed unavailable surfaces

`IndexMoversStrip.tsx` (`UnavailableBandsStrip`), `.tail.tsx`,
`NiftyReportShell.tsx` `REPORT_MOBILE_UNAVAILABLE_CLASS`,
`ReportWorkspace.tsx`. A live-only band with no data collapses to **one**
reason line with its testids still mounted, instead of reserving height for
empty rows: movers in EOD/replay, flow windows when `windowsAvailable()` finds
no numeric session/OI leg, and the 57px phone heatmap behind
`nifty-heatmap-mobile-disclosure`. The shell hides the placeholder movers strip
(`:not([data-report-spacing])`) and keeps DESK BAY a single horizontal scroller
at 390; 1600 keeps its tuned rhythm. One reason, never a duplicate of the replay
banner's note.

### 3.8 Mobile order contract

`NiftyReportShell.tsx` `REPORT_MOBILE_ORDER_CLASS`, declared **once** on the
shell content wrapper — no per-band `max-[600px]:order-*` classes:

| Order | Band |
|---:|---|
| 1 | `nifty-stat-strip` (hero + More stats) |
| 2 | `nifty-main-row` (chart) |
| 3 | `desk-dock-region` |
| 4 | flow-windows wrapper (`:has([data-testid='nifty-flow-windows'])`) |
| 6 | `movers-strip` |
| 7 | `nifty-context-rail` |
| 8 | `nifty-setup-radar` |
| 9 | `nifty-report-strips` |
| 10 | `nifty-analytics-row` |
| 11 | `nifty-iv-skew-row` |

Values are unique so no two bands tie for a viewport slot; focus order follows
DOM, so no positive tabindex is used or allowed. Guard:
`ReportWorkspaceMobile.test.tsx`, `NiftyReportShell.rhythm.test.tsx`.

## 4. Source decomposition modules

Facades keep stable import paths; satellites own constants, pure helpers and
rendering. Each pair is guarded by a `*.structure.test.ts` (and, for the heatmap,
`NiftyOiHeatmap.delegation.test.tsx`), so a facade that re-implements a satellite
fails rather than silently drifting.

| Facade | Satellite modules |
|---|---|
| `niftyReportStore.ts` (36-line re-export facade) | `.types`, `.helpers`, `.factory`, `.state`, `.derived`, `.effectsCore`, `.effectsReplay`, `.reportHandlers`, `.uiHandlers` |
| `NiftyWallsCard.tsx` | `.shared`, `.card`, `.read`, `.table`, `.stats`, `.history`, `.empty`, `.skeleton` |
| `NiftyWallsExpanded.tsx` | `.format`, `.header`, `.statStrip`, `.readout`, `.sequences`, `.eventTable` |
| `NiftyPressureDesk.tsx` | `.format`, `.legend`, `.ladder`, `.flow`, `.details`, `.table` |
| `NiftyOiHeatmap.tsx` | `.format`, `.geometry`, `.legend`, `.overlay` |
| `niftyOiBursts.ts` | `.types`, `.format`, `.normalize`, `.detect`, `.signal`, `.alerts` |
| `NiftyChartPanel.tsx` | `.constants`, `.patterns`, `.controls`, `.annotations`, `.body` |
| `ReportDecisionStrip.tsx` | `.format`, `.derive`, `.hero`, `.groups`, `.moreStats`, `.tail` |
| `reportCells.tsx` | `.format`, `.decision`, `.chainMetrics`, `.chainColumns`, `.chainCells`, `.chainPanel` |
| `NiftyDepthMap.tsx` | `.format`, `.header`, `.geometry`, `.bars`, `.option` |
| `NiftyGexProfile.tsx` | `.format`, `.levels`, `.geometry`, `.legend`, `.rows` |

Fixture files (`*.fixtures.tsx`) are test-only, not runtime satellites.

## 5. Source status — mismatches found

1. **14px has no report token.** The brief wants 14 for controls/panel titles.
   `REPORT_FONT` (`reportTokens.ts`) is a four-step dialect — `micro 12 / body
   13 / value 16 / display 24` — and its `xs`/`xsPlus`/`sm`/`md` aliases all
   resolve to **13**. The 14px step exists only in shared `TYPE_SCALE.label` and
   is used by `reportBits.tsx` headers; toolbar controls are forced back to 13
   via `REPORT_CONTROL_LABEL_STYLE`. If 14 must cover controls too, the change
   is a token/alias change in `reportTokens.ts`, not a new component.
2. **16 is value/title, not a section-heading step.** Shared `TYPE_SCALE`
   reserves 16 for card/panel titles and 20 for section headings; the report
   uses 16 for values (`REPORT_FONT.value`) and jumps to 24 for the verdict.
   The brief's "16 section/value" is fine as a value rule but has no `heading`
   counterpart in the report surface.
3. **Stale 17px references.** `docs/TYPOGRAPHY.md:27` says the report uses
   `12/13/17/24`, and `NiftyReportShell.tsx:57` says the narrow cells hold a
   "full 17px mono price". Source is `12/13/16/24`; `reportTokens.ts` explicitly
   forbids reintroducing a private 17px value step. Both docs/comments are
   wrong; this contract follows the token. (Not edited here — file ownership.)
4. **Stale density docs.** `docs/INDEX_REPORT_DESKTOP_SPEC.md` still says
   "type floor 11px" and "one value size: 15px"; `docs/INDEX_REPORT_REDESIGN.md`
   says 11px micro / 32px rows and describes an unbuilt chart-focus/drawer mode
   (also flagged as not built in `AGENTS.md`). None of those sizes or modes are
   in `reportTokens.ts` / `REPORT_ROW`; treat those two docs as history.
5. **Table type differs by surface.** The report's OI chain is label 12 /
   value 13 (`reportCells.chainMetrics.ts`), but the generic option chain's
   cells use `typeSize("sm") = 12` (`chainStyles.ts`). This contract specifies
   the report surface (13); do not "fix" the generic chain here.
6. **13px group labels.** `GROUP_LABEL_STYLE` in `ReportDecisionStrip.format.ts`
   sets stat-group labels to `REPORT_FONT.body` (13), while the brief assigns
   all labels to 12. Field-level labels in `reportCells.format.ts` are 12; group
   headers in the strip are the exception in source.

## 6. What not to do

- **No 11px** (or 9/10/15/17/23px): 12 is the floor, 16/24 are the promoted
  steps; use a token, never a literal.
- **No equal-weight micro walls**: one value per cell at the promoted step,
  one label, one optional hint — never a grid of same-sized numbers with no
  hierarchy.
- **No clipping numbers**: no ellipsis on `*-value`, the verdict headline, or
  any price/OI/PCR readout; wrap or stack instead.
- **No nested borders / card-on-card**: one border per section, hairline
  dividers inside, no new wrapper panels.
- **No second status**: one hero token, one reason, one claim. Don't reprint a
  no-call as a green verdict or a per-band confidence.
- **No invented geometry**: no percentage chain cap, no unmarked grid past the
  last bar, no per-band mobile `order-*` literal, no third breakpoint, no fixed
  height in a flex panel, no page-level scroll as a substitute for inner scroll
  regions, no invented component.

## Verification status

Verification for this contract is **source- and test-derived**, not a measurement
claim: `reportFontFloor.test.ts`, `ReportLegibility.test.tsx`,
`ReportGridDiscipline.test.tsx`, `ReportNarrowLayout.test.tsx`,
`ReportChartMobileBudget.test.tsx`, `NiftyReportShell.rhythm.test.tsx` /
`.layout.test.tsx`, `ReportDecisionStrip.hero.test.tsx` / `.tail.test.tsx` /
`.hierarchy.test.tsx`, `ReportToolbar.test.tsx`,
`ReportWorkspaceMobile.test.tsx`, `NiftyChartPanelGeometry.test.tsx`,
`niftyChartData.math.test.ts` / `.session.test.ts`, and every facade's
`*.structure.test.ts`. This was a docs-only edit: no build, lint, suite, browser
measurement or screenshot read-back was run for it. The 1600/390 final capture
read-back and the independent A++ rating are **not claimed here** — they remain
pending and are owned by the code/evidence wave.
