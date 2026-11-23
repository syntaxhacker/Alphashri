# Index Report — density & readability contract

Scope: the Index Report surface (`/report/index`, NIFTY and generic SENSEX/RELIANCE)
after the readability wave. This is a contract over **existing** tokens and
components. It invents no new component, panel or breakpoint. Every rule below
points at the file that owns it.

Sources of truth: `src/pages/report/reportTokens.ts` (report dialect),
`src/ui/typography.ts` + `docs/TYPOGRAPHY.md` (shared scale),
`src/pages/report/NiftyReportShell.tsx` and `src/pages/report/ReportWorkspace.tsx`
(shell/workspace), `src/pages/report/reportBits.tsx` (panel/stat primitives),
`src/pages/report/reportCells.tsx`, `src/pages/report/ReportDecisionStrip.tsx`,
`src/pages/report/ReportStrips.tsx` (strips/chain cells) and
`src/pages/report/NiftyOiHeatmap.tsx` +
`src/components/options/OptionChain/chainStyles.ts` (heatmap/chain).

## 1. Type ladder

| Size | Role on this page | Owner / use |
|---:|---|---|
| **12** | labels, axes, hints, timestamps | `REPORT_FONT.micro` (`text-ui-micro`) — hard floor. Chain column labels: `OI_CHAIN_METRICS.labelSize` in `reportCells.tsx`; heatmap axis/legend text in `NiftyOiHeatmap.tsx`. |
| **13** | body, table cells, secondary values | `REPORT_FONT.body` (`text-ui-body`). Report OI-chain values: `OI_CHAIN_METRICS.valueSize`, `td`/`th` overrides in `reportCells.tsx`. |
| **14** | controls, panel titles | `text-ui-label` (`TYPE_SCALE.label`) — compact panel header and disclosure toggle in `reportBits.tsx`. |
| **16** | section/value hierarchy | `REPORT_FONT.value` = `TYPE_SCALE.title` — replay banner title (`NiftyReportShell.tsx`), driven values in `ReportStrips.tsx`. |
| **24** | page display | `REPORT_FONT.display` = `TYPE_SCALE.display` — verdict/plan headline (`PLAN_HEADLINE_STYLE` in `ReportDecisionStrip.tsx`). |

Rules:

- The shared six-step scale also defines `20` (`text-ui-heading`); the report
  deliberately spends only the five steps above. Never add a private size to
  make text fit (`docs/TYPOGRAPHY.md` §Usage; `reportFontFloor.test.ts`).
- Classes first (`TYPE_CLASS`); `REPORT_FONT` is for SVG/canvas/inline styles.
  `REPORT_CONTROL_LABEL_STYLE` / `REPORT_CONTROL_LABEL_CLASS` are the only
  toolbar-control overrides (`ReportToolbar.tsx`).
- Weight and colour carry emphasis, not size. Change component width/wrapping
  when a label clips; never shrink the font.
- Mono + tabular numerals for every numeric readout (`tabular-nums`,
  `palette.MONO` in `reportCells.tsx`, `ReportDecisionStrip.tsx`).

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

## 3. 1600 vs 390

| | **1600 (desk)** | **390 (phone)** |
|---|---|---|
| Primary | Chart is the largest block. At ≥1200 `DESK_CONTENT_GRID_CLASS` gives row shares `auto / 70fr / 30fr`; `ReportWorkspace.tsx` uses `1fr / 420px` (desk) and a `0.56` chart share with a `58vh` cap and `DESK_CHART_FLOOR_PX = 430`. Low-frequency bands live behind the existing dock tabs (`secondaryTabs` in `NiftyReportShell.tsx`), so only the decision strip and chart sit above the fold. | Chart still leads the stacked flow. `MOBILE_GRID_DEFAULT` / `MOBILE_GRID_HEATMAP` put the chart in `1fr` and the side row in `minmax(0,96px)`/`auto`; the flow band collapses behind `LiveTapeDisclosure`; the heatmap becomes a summary + expand-to-full, not a 57px treemap (`ReportWorkspace.tsx`). |
| Scroll | Real scroll regions, not one page scroller: desk mode is `overflow-hidden` with inner scrollers (chain fixed scrollport in `chainStyles.ts`, tape/analytics own scroll, `scrollIntoView`-style centering in `ReportWorkspace.tsx`); research mode is `overflow-auto`. Fill chain is `flex-1 min-h-0`; no fixed height inside a flex panel. | Same inner scroll regions; page scroll only where a band genuinely grows. Cues are the existing `ChainScrollActions` (top/ATM/bottom), the `sm:hidden` sideways cue for the 980px-wide chain, and disclosure chevrons (`reportBits.tsx`). |
| Numbers | Min widths from `REPORT_STRIP_CELL_MIN` and weights from `REPORT_STRIP_GROUP_WEIGHT` are derived, never hand-picked; a real readout fits its cell. | `REPORT_NARROW_KPI_CLASS` and `VERDICT_NARROW_OVERRIDES` stack groups (one per row, two cells per row) and disable ellipsis on `*-value` (`text-clip!`, `overflow-visible!`). `planHeadlineStyle(narrow)` wraps instead of clipping a number. Full text stays in `title`/hint. A truncated price is a wrong price. |
| Layout | Grouped strip: PRICE / WALLS / VOLATILITY / FLOW with hairline dividers; numbers right, labels left, badges centre. | **Intentional stacking** — groups keep their full-width row, cells wrap; nothing is shrunk to fit one line. No horizontal page scroll; `min-w-0` everywhere. |

Breakpoints are the ones already in source: `min-[1200px]`, `max-[600px]`
(shell/workspace/strip) and `CHAIN_COMPACT_QUERY = (max-width: 639px)`
(`chainStyles.ts`). Do not add a third.

## 4. Source status — mismatches found

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
   value 13 (`reportCells.tsx`), but the generic option chain's cells use
   `typeSize("sm") = 12` (`chainStyles.ts`). This contract specifies the report
   surface (13); do not "fix" the generic chain here.
6. **13px group labels.** `GROUP_LABEL_STYLE` in `ReportDecisionStrip.tsx`
   sets stat-group labels to `REPORT_FONT.body` (13), while the brief assigns
   all labels to 12. Field-level labels in `reportCells.tsx` are 12; group
   headers in the strip are the exception in source.

## 5. What not to do

- **No 11px** (or 9/10/15/17/23px): 12 is the floor, 16/24 are the promoted
  steps; use a token, never a literal.
- **No equal-weight micro walls**: one value per cell at the promoted step,
  one label, one optional hint — never a grid of same-sized numbers with no
  hierarchy.
- **No clipping numbers**: no ellipsis on `*-value`, the verdict headline, or
  any price/OI/PCR readout; wrap or stack instead.
- **No nested borders / card-on-card**: one border per section, hairline
  dividers inside, no new wrapper panels.
- No fixed height in a flex panel, no page-level scroll as a substitute for
  inner scroll regions, no new breakpoint, no invented component.

Verification for this contract is source-derived: `reportFontFloor.test.ts`,
`ReportLegibility.test.tsx`, `ReportGridDiscipline.test.tsx`,
`ReportNarrowLayout.test.tsx`, `ReportChartMobileBudget.test.tsx`,
`NiftyReportShell.rhythm.test.tsx`. Docs-only change — no build, server or
suite run is required here; visual evidence at 1600/390 belongs to the code
wave that implements it.
