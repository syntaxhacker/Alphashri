# App visual audit — design-system adoption on real surfaces

## Current status (2026-11-23)

> **This section is authoritative.** It supersedes the consistency verdicts and the 10-item inconsistency table in the historical audit below. That audit is kept for traceability but describes earlier snapshots; where it conflicts with this section, this section wins. "Fixed" means confirmed in source or in a committed capture — not a fresh live render.

**Fixed since the historical audit:**

- The report no longer owns a private 9/10/11/23px scale: `REPORT_FONT` derives from the shared `TYPE_SCALE` (12/13/16/24), radii are 2/4/6/10, and `ReportLegibility` / `ReportTypographyContrast` enforce the 12px floor.
- Typography primitives (`Text/Title/Anchor/List`) resolve named sizes through `SIZE_ROLE` → `TYPE_CLASS` on the shared scale; there is no private rem table or 18px step.
- Replay error copy now separates a human message from collapsed technical detail; dense tabs/table regions scroll intentionally at 390.
- A fresh **Index Report** route capture exists at `docs/screenshots/app/report-{1600,390}.png` — real route, honest shared mocks, **viewport** captures at 1600×1000 and 390×844 (not full-page). The 1600 capture exposed a spot-value ellipsis; the KPI minimum was widened so `22,363.35` stays complete.

**Still open / unverified:**

- The mobile-nav gutter fix is unverified — no fresh capture proves it.
- **Home, bare `/screener`, `/options` and `/patterns` app routes are unverified.** They have no fresh 1600/390 route captures with honest mocks; Storybook images are not a substitute and those findings remain open until a route capture exists.
- Agri heatmap colour, focus/keyboard order, actual WCAG ratios and reduced-motion still lack fresh live evidence.

---

> **Historical evidence (superseded).** Everything from **Reference baseline** to the end of this file is the original read-only audit, retained for traceability only. Its findings were accurate for the captured images but are superseded by the status above.

---

**Branch:** `improve/ds-p3-tokens-forms-tests` · **Date:** 2026-11-23 · **Mode:** read-only
**Method:** committed screenshots + source reads only. No builds, servers, git writes, or code edits. This is the only file written.
**Evidence rule:** a claim is either tied to a checked-in screenshot, a file/line, or it is marked **unknown**. Screenshots are snapshots, not live renders (see *Unknowns*).

## Reference baseline (what "the design system" looks like)

From `docs/screenshots/showcase/{overview,foundations,typography,data-display,skeleton}-1600.png` and `src/tailwind.css:6-26`, `src/ui/tokens.ts`, `src/ui/index.ts`:

| Dimension | DS contract |
|---|---|
| Surfaces / ink | bg `#000000`, surface `#13161C`, surface-alt `#1F242D`, border `#2C313B`, text `#E8E8E8`, muted `#9B9B9B` |
| Semantic accents | primary amber `#D9902A`, positive `#2FA36B`, negative `#E5606A`, warning `#C9912F`, info `#4A8FD8` |
| Spacing | 4 / 8 / 16 / 24 / 32 (xs…xl) |
| Type | `Text` 12/14/16/18/20; `Title` 12/14/16/18/24; mono for prices, P&L, OI, IV |
| Radius / density | terminal 2px hairline panels; table rows 20px compact / 28px comfortable (`src/ui/density.tsx`) |
| Focus | 2px amber ring, 1px offset, global `:focus-visible` (`src/tailwind.css:98-102`) |
| Motion / loading | transform-only shimmer, `prefers-reduced-motion` (`showcase/skeleton-1600.png`) |
| Table | one shared `TanStackTable`, text left / numbers right, `stickyHeader`, `meta.align` |

The storybook screenshot `docs/screenshots/storybook/design-system-1600.png` shows a *second* type scale (Display 28 / Title 28 / Subtitle 16 / Body 13 / Caption 11 / Micro 9), so the kit is not even internally single-scaled. That is the root of most findings below.

---

## 1. Blunt consistency audit

**The app is not one product.** There are at least four visual dialects fighting each other:

1. **Screener / Market — the good citizen.** `src/components/market/MarketBreadthStrip.tsx`, `src/components/screener/ScreenerHeader.tsx`, `ScreenerLoading.tsx`, `ScreenerEmpty.tsx`, `ScreenerErrorPanel.tsx` all import `@/ui` and use the token classes. The chrome, hairlines and control sizes match the showcase. The remaining drift is *density*: table cells at 9–11px (`grep text-[9px|10px|11px]`: screener 8 sites, market 5) and a 1000px minimum table width that clips columns at 390 (`docs/screenshots/market-breadth/market-breadth-390.png` — "SECTO" cut mid-word, no visible scroll affordance).

2. **Index report — a separate terminal skin.** It does not consume the DS scale at all; it owns `REPORT_FONT` (11px "hard floor", 13 body, 17 value, **23px verdict**), `REPORT_ROW` 22–28, `REPORT_PAD` 2–16, `REPORT_RADIUS` 4/8/12, and its own ink constants (`src/pages/report/reportTokens.ts:8-42,50-69,195-201`). Controls are `SegmentedControl`s restyled through `REPORT_CONTROL_LABEL_CLASS`/`REPORT_CONTROL_LABEL_STYLE` (`ReportToolbar.tsx:134-171`), the tape table overrides the shared `TanStackTable` with a wall of `!important` selectors (`NiftyTapeTable.tsx:128-153`), and section errors/skeletons are hand-painted inline styles with raw palette imports (`NiftyReportShell.tsx:81-115`, `ReportWorkspace.tsx:197-209`). The result in `docs/screenshots/report-strip-overlap/strip-1600.png` is visually a different application from the showcase: 23px amber headline, blue/green numeric islands, 11px everything else, and "unavailable"/"—" placeholders scattered through the strip. At 390 (`strip-390.png`) the KPI cards clip numeric values ("MAX PAIN 22,4…").

3. **Options / paper / replay — mostly `@/ui`, with local furniture.** `src/pages/options-replay/ReplayPanel.tsx` imports 13 DS primitives (`:3-6`) and uses `Alert`, `Badge`, `Tabs`, `CompactStat`, `EmptyState` correctly — but it wraps everything in a local `WorkstationPanel` whose header is hard-coded 14px amber mono uppercase (`:209-237`), uses a raw `<input type="range">` instead of DS `Slider` (`:587-602`), glyph-only play text, and prints raw API error strings into an `Alert` (`:375-382`, `:502-504`). `docs/screenshots/options-paper-replay/replay-workbench-committed-1600.png` reads as a third dialect: amber all-caps section titles, a gradient-looking PLAY pill, and a payoff chart whose axis/tick styling matches neither the DS charts nor the report charts. At 390 the title is clipped ("**ptions replay**"), tab labels wrap into three lines, and the dense table is cut at the right edge (`replay-workbench-committed-390.png`, `replay-dense-table-390.png`).

4. **Agri — its own chart/control language.** `src/pages/agri/AgriPage.tsx:61-67` defines local `MICRO_LABEL`/`SECTION_LABEL`/`SECTION_HINT` at **10px** and a local `SEGMENT_TRACK` with 6px radius instead of `@/ui` `SegmentedControl`; `src/pages/agri/agriChartTheme.ts:55-68` sets 10px chart font and 11px tooltips (`:139`). `docs/screenshots/agri/desktop-heatmap.png` shows large cards with 9–10px labels — legible only at 1600; `mobile-heatmap.png` drops the page header entirely and leaves a blank strip under the floating nav button. **Caveat:** the purple/yellow heatmap in that screenshot is stale — current `src/pages/agri/options/heatmap.ts:1,138` and `src/ui/palette.ts:245-257` now use the shared red/green stops, introduced after the screenshot commit (see *Unknowns*).

5. **Patterns — source-only, no committed screenshot.** The page shell uses `@/ui` (`src/pages/patterns/PatternsPage.tsx:2`), but `src/components/patterns/` has 22 files with inline `style={{…}}` and 29 arbitrary font-size classes (9px ×8, 10px ×13, 11px ×7, `src/components/patterns/**`). `PatternSkeleton.tsx:17-46` hand-rolls `animate-pulse` bars instead of the DS `Skeleton` shimmer. Actual rendered appearance at 1600/390 is **unknown** — no screenshot exists in `docs/screenshots/` for this route.

**Loading / empty / error are three different products:** DS `Skeleton` shimmer (showcase), flat `SURFACE_ALT` rectangles in report (`NiftyReportShell.tsx:103-115`), `animate-pulse` bars in patterns, `EmptyState`/`InlineLoader` from `components/common/states.tsx` in replay/agri, `Loader` + `Text` in screener, and a local `SectionError` with `white-space: pre-wrap` in report. Within one session a user sees four different loading shapes and three different empty-state glyph sizes.

---

## 2. Ten highest-impact visual inconsistencies

| # | Sev | Inconsistency | Exact files | Screenshot evidence |
|---:|---|---|---|---|
| 1 | **P0** | Floating mobile nav button overlaps page titles; 390 header reads "ptions replay", agri header is blank. No left inset reserved for the fixed 36px control. | `src/components/layout/AppLayout.tsx:61-82` (`position:fixed; top:8; left:8; z-index:1299`), `src/components/common/compact.tsx:59-75` (header box has no mobile offset) | `docs/screenshots/options-paper-replay/{replay-workbench-committed,replay-dense-table,replay-api-error}-390.png`; `docs/screenshots/agri/mobile-heatmap.png` |
| 2 | **P0** | Report replaces the DS type/radius/density scale with its own: 11px "hard floor", 23px verdict, 4/8/12px radii, 22–28px rows. Same app, different scale. | `src/pages/report/reportTokens.ts:8-42,50-69,195-201`; `src/pages/report/ReportDecisionStrip.tsx:103-118`; `src/pages/report/ReportTypographyContrast.test.tsx:76` and `ReportLegibility.test.tsx:65,86` codify 11px | `docs/screenshots/report-strip-overlap/strip-1600.png` (23px amber verdict over 11px labels) vs `docs/screenshots/showcase/typography-1600.png` |
| 3 | **P0** | Report tape completely reskins the shared table with `!important` overrides (pitch-black bg, 2px padding, 11px headers, custom borders/flash), so it no longer looks like any other table in the app. | `src/pages/report/NiftyTapeTable.tsx:128-162` (`[&_.paper-tanstack-cell]:…!`, `[&_th:first-of-type]:sticky…`) | `strip-1600.png` vs `docs/screenshots/showcase/data-display-1600.png` and `docs/screenshots/market-breadth/market-breadth-1600.png` |
| 4 | **P1** | Report controls are DS primitives wearing a local uniform (13px override via CSS var, 3px radius, custom pill border) and raw `palette.*` inline styles. | `src/pages/report/ReportToolbar.tsx:23-28,48-89,134-171`; `reportTokens.ts:44-48` | `strip-1600.png`, `strip-390.png` (toolbar wraps into two crowded rows) |
| 5 | **P1** | Report KPI strip clips values at 390 (no ellipsis rule that preserves the figure, min-widths tuned for 1600). | `src/pages/report/NiftyReportShell.tsx:183-200`; `reportTokens.ts:100-143` | `strip-390.png` — "MAX PAIN 22,4…", "SPOT 22,363.…" |
| 6 | **P1** | Replay invents `WorkstationPanel` (14px amber mono all-caps header), a glyph-only PLAY button and a raw range slider instead of DS `Card`/`Title`/`Button`/`Slider`. | `src/pages/options-replay/ReplayPanel.tsx:209-237,558-602` | `docs/screenshots/options-paper-replay/replay-workbench-committed-1600.png` (PLAYBACK / LEGS AT PLAYHEAD headers, PLAY pill) |
| 7 | **P1** | 390 replay is unusably crowded: tab labels wrap to 3 lines and collide, control row wraps, dense table columns are cut with no scroll cue. Known-open issue #3 in the previous UX audit. | `src/pages/options-replay/ReplayPanel.tsx:558-600`; `docs/OPTIONS_PAPER_REPLAY_UX_AUDIT.md:90-94,149` | `replay-dense-table-390.png`, `replay-workbench-committed-390.png` |
| 8 | **P1** | Raw backend error detail is printed to the user (`Failed to fetch replay frames (HTTP 500): {'detail': 'Replay frames unavailable'}`) inside a DS `Alert` — DS component, non-DS copy. | `src/pages/options-replay/ReplayPanel.tsx:375-382,500-504` | `docs/screenshots/options-paper-replay/replay-api-error-1600.png` |
| 9 | **P1** | Market screener's 1000px-minimum dense table clips columns at 390; screenshot shows "SECTO…" cut, and no scroll affordance is visible. | `src/components/market/MarketScreenerPanel.tsx:245-260` (`minTableWidth={1000}`, `stickyHeader`, `dense`) | `docs/screenshots/market-breadth/market-breadth-390.png` vs `…-1600.png` |
| 10 | **P2** | Agri uses a local 10px type/segment/chart theme and stat cards; the committed heatmap screenshot is a saturated full-panel fill, which `UI_RULES.md:58` forbids. Current source has moved to shared stops — fresh evidence needed. | `src/pages/agri/AgriPage.tsx:61-67`; `src/pages/agri/agriChartTheme.ts:55-68,139`; `src/pages/agri/options/heatmap.ts:1,138` | `docs/screenshots/agri/{desktop,mobile}-heatmap.png` (stale for colour, current for type/density) |

---

## 3. Dense-financial-terminal constraints

| Constraint | Verdict | Evidence |
|---|---|---|
| **1600 and 390 coverage** | **Partial** | 1600+390 pairs exist for market breadth, report strip, replay (8 states), profitability nav, showcase; agri has desktop/mobile (not exact 1600/390). **No patterns screenshots at all.** |
| **Sticky headers** | **Pass** | `src/components/market/MarketScreenerPanel.tsx:254`, `src/components/screener/ScreenerTable.tsx:256`, `FnoScreenerTab.tsx:332`, `src/pages/agri/AgriPage.tsx:1210`, `AgriFluctuationMatrix.tsx:325`, `src/components/patterns/PatternSymbolMatrix.tsx:409`, `src/pages/report/NiftyTapeTable.tsx:143-144` (sticky first column). Pattern list explicitly opts out (`PatternListView.tsx:307`) — intentional or not is **unknown**. |
| **Table alignment** | **Pass, guarded** | `src/components/common/tableAlignment.spec.tsx` asserts text-left / numeric-right across 8 screens (grid and `<table>` paths). Report tape alignment is guarded separately in `ReportTypographyContrast.test.tsx`. All screenshot tables read right-aligned numerically. |
| **Contrast** | **Partial** | DS guard `src/test/contrast.test.ts`, report matrix `ReportTypographyContrast.test.tsx:102-149`, and `docs/COLOR_SEMANTICS.md:54-62` exist. But 9–11px text is a *legibility* floor problem, not a ratio problem; `showcase` info token `#44A8F0` in docs vs `#4A8FD8` in `src/tailwind.css:16` is doc drift. Actual WCAG conformance was not re-measured — **unknown**. |
| **Focus** | **Partial** | Global 2px amber ring (`src/tailwind.css:98-102`); DS Modal close fix is asserted (`src/ui/overlay/Modal.test.tsx:258`). Residual `focus:outline-none` on the Alert dismiss (`src/ui/feedback/Alert.tsx:115`); report local controls use 1px `outline` instead of the ring (`NiftyIntelStrip.tsx:377`, `WallsMap.tsx:293`). No keyboard/focus screenshots exist — verification is source-only. |
| **Loading** | **Fail (consistency)** | Four shapes: DS shimmer, report flat rectangles, patterns `animate-pulse`, screener `Loader`. See §1. |
| **Empty** | **Partial** | `EmptyState` in `components/common/states.tsx` is well-specified (no-data / market-closed / failed), used by replay and agri; screener has its own local empty; report uses a third family. Only replay empty states are screenshot-verified (`replay-empty-1600/390.png`). |
| **Error** | **Fail** | Raw HTTP detail exposure (finding 8); report `SectionError` uses `white-space: pre-wrap` with raw `error.message` (`NiftyReportShell.tsx:81-101`); screener uses its own error card. Replay expired vs 500 were merged historically (`docs/OPTIONS_PAPER_REPLAY_UX_AUDIT.md:78-82`) and are now split in source, but the committed API-error screenshot still shows the raw string. |

---

## 4. `@/ui` adoption and duplicated local components

Measured with `grep -rlE "from ['\"]@/ui" … | grep -v '\.test\.'` in this worktree:

| Area | Files importing `@/ui` | Read |
|---|---:|---|
| `src/components/screener` | 41/… | Strong adoption; small local `icons.tsx`, `Sparkline.tsx`, `SymbolAvatar.tsx` |
| `src/components/market` | 14 | Strong; own filter rail and `marketColumns.tsx` |
| `src/components/options`, `options-dock` | 42 / 44 | Strong; local `PayoffTable`, `OptionChainTable`, chart cores |
| `src/components/options-paper` | 6 | Thin surfaces; mostly delegated to dock primitives |
| `src/components/replay` | 30 | Strong |
| `src/pages/report` | 124 | **Import-heavy, but visuals overridden** — imports `@/ui` then restyles with local tokens and inline palette; §2 findings 2–5 |
| `src/pages/agri` | 13 | Partial; local theme constants and chart option builder |
| `src/components/patterns` | 49 | Partial; 22 files with inline `style={{…}}`, 29 arbitrary font sizes |
| `src/pages/paper`, `backtest`, `strategies`, `sector`, `bots` | 0 | These surfaces do not import `@/ui` at all (outside the brief's screenshot evidence; flagged, not deep-audited) |

**Duplicated / competing primitives still in active use** (confirmed in `docs/DESIGN_SYSTEM_BENCHMARK_2026-11-23.md:135-146` and by `grep` here):

- Icons: `src/ui/icons.tsx` ↔ `src/components/common/Icons.tsx`.
- Range: `src/ui/inputs/RangeSlider.tsx` ↔ `src/components/common/RangeInput.tsx` (replay uses a third, raw `<input type=range>`).
- Date: `src/ui/dates/DatePicker.tsx` ↔ `src/components/common/TradingDatePicker.tsx`.
- Table: `src/components/common/TanStackTable.tsx` ↔ `src/components/paper-trading/TanStackTable.tsx` (632 vs 223 lines; different keyboard/virtual behaviour).
- Modal/overlay: `src/ui/overlay/Modal.tsx` ↔ `src/components/common/PanelModal.tsx:86` ↔ `src/components/common/preview/ExpandedPanel.tsx:141` ↔ `src/pages/report/LocalPanelModal.tsx:70` (four hand-rolled centring overlays).
- States: `src/ui/feedback/Skeleton.tsx` ↔ `components/common/states.tsx` (`EmptyState`, `ErrorAlert`, `InlineLoader`) ↔ `TableEmptyState`/`TableLoadingState` ↔ `PatternSkeleton.tsx`.
- Local chrome wrappers: `CompactPage`/`CompactPanel`/`CompactStat` (`components/common/compact.tsx`) are used by 25+ files across report, agri, replay, patterns and options instead of DS `Paper`/`Card`/`Title`; their header typography is hard-coded at 10px (`:176-180`).
- Local `WorkstationPanel` (`ReplayPanel.tsx:209-237`) and Agri `SEGMENT_TRACK` (`AgriPage.tsx:65`) are one-off reimplementations of DS primitives.

Counting imports overstates adoption: `src/pages/report` imports `@/ui` in 124 files yet renders a distinct visual language. The metric that matters is *which primitive actually owns the pixels*, and report/agri/replay locals own too many.

---

## 5. Eight concrete fixes

### Must-fix

1. **Reserve the mobile nav gutter.** `src/components/layout/AppLayout.tsx:63-82` + `src/components/common/compact.tsx:59-75`: give page headers `padding-left: 44px` under 900px (or move the toggle into a real 44px-tall bar). Re-capture all 390 screenshots. Fixes findings 1, 7.

2. **Collapse the type/radius scales to one contract.** `src/pages/report/reportTokens.ts:12-42,195-201`, `src/pages/agri/AgriPage.tsx:61-67`, `src/pages/agri/agriChartTheme.ts:55-68`, `UI_RULES.md:43-45`: raise 9/10/11px to the DS 12px floor where the layout allows (report strip, chart labels, panel headers), retire `REPORT_FONT.display=23` in favour of DS `Title xl=24` or a documented single display token, and align radii to the terminal 2px/4px vocabulary. Update `ReportTypographyContrast.test.tsx:76` and `ReportLegibility.test.tsx:65,86` in the same change so the guard stops enforcing the old floor. Fixes 2, 5, 10.

3. **Stop reskinning the shared table with `!important`.** `src/pages/report/NiftyTapeTable.tsx:128-153`: add a `variant="tape"`/density slot to `src/components/common/TanStackTable.tsx` that accepts the tape ink and row pitch as props/tokens; delete the selector overrides. Fixes 3.

4. **Triage 390 layout with clip-safe primitives.** `src/pages/options-replay/ReplayPanel.tsx:558-600` (split control rows, wrap the slider in `flex-1 min-w-0`, let tab labels shrink without 3-line wraps), `src/pages/report/NiftyReportShell.tsx:183-200` (KPI min-widths that keep the whole number), `src/components/market/MarketScreenerPanel.tsx:245-260` (visible horizontal-scroll cue). Re-run `docs/OPTIONS_PAPER_REPLAY_UX_AUDIT.md:149` open item. Fixes 5, 7, 9.

5. **Make errors speak human.** `src/pages/options-replay/ReplayPanel.tsx:375-382,500-504`, `src/pages/report/NiftyReportShell.tsx:81-101`: map API failures to a stable message ("Replay frames are unavailable — retry" / "This section could not load"), keep the raw detail in a `title`/log, and use one `@/ui` `Alert` with a `Retry` action. Fixes 8.

### Polish

6. **Promote local furniture to DS composites.** `ReplayPanel.tsx:209-237` → DS `Card` + `Title`/`Text` token styling; raw range inputs → `@/ui` `Slider`; `AgriPage.tsx:65` → `@/ui` `SegmentedControl`. Gives replay and agri the same section-header rhythm as the showcase. Fixes 6, 10.

7. **One loading language.** Replace `PanelSkeleton` (`NiftyReportShell.tsx:103-115`, `ReportWorkspace.tsx:197-209`) and `PatternSkeleton.tsx:17-46` bars with `@/ui` `Skeleton`; either promote `components/common/states.tsx` `EmptyState`/`ErrorAlert` into `@/ui` or document them as the single app-level state composite and use them in screener and report too.

8. **Enforce one winner per duplicated family.** Icons, Range, DatePicker, Table, Modal, EmptyState (§4): turn the loser into a re-export wrapper and add a guard that fails when a feature dir introduces a new `translate(-50%,-50%)` overlay, `animate-pulse` bar, or hand-rolled range input. Pair with the existing `src/test/component-audit.test.ts` and `ui-guard.test.ts`.

---

## 6. Unknown / not verifiable from checked-in evidence

- `reports/agri/screenshots/` **does not exist** on this branch. Agri evidence was taken from `docs/screenshots/agri/{desktop,mobile}-*.png` instead.
- **No patterns screenshots** are committed anywhere under `docs/screenshots/`; the pattern page's rendered 1600/390 appearance, sticky behaviour and focus order are unknown. Findings there are source-only.
- Screenshots are dated 2026-11-22 (`git log`): `agri/desktop-heatmap.png` at `c7a2fdd3`, `strip-1600.png` at `ccab485e`, replay shots at `fe0e34c1`. Current HEAD is `a2d477d3` (2026-11-23) and the worktree has **uncommitted DS edits** (`src/tailwind.css`, `src/ui/feedback/{Alert,Badge,RingProgress}.tsx`, `src/ui/componentTokens.ts`, `src/ui/form/`, etc.). None of those changes were built or screenshotted. Treat screenshots as evidence of the *captured* state, not proof of the live render.
- The purple/yellow agri heatmap in the committed screenshot is **stale**: `src/ui/palette.ts:257` now aliases `VIRIDIS_STOPS` to the red/green stops in a 2026-11-23 commit (`git log -S 'VIRIDIS_STOPS = RED_GREEN'`). Whether the current render is fully DS-conformant is unknown until a fresh capture exists.
- Focus rings, keyboard order, actual WCAG ratios and reduced-motion behaviour have **no screenshot or axe evidence** in this repo; §3 verdicts there are source-reading only.
- Whether the mobile title overlap is still present after the uncommitted DS edits is unknown; source at `AppLayout.tsx:63-82` still places the toggle at fixed `top:8/left:8`.
- 1600/390 screenshots exist for only a subset of the 30 routes (`docs/ROUTE_SURFACE_AUDIT.md:32-63`); backtest, paper, bots, strategies, sector and settings were not visually audited.
- Chart palette consistency: report/agri charts still import `src/ui/palette` directly rather than `useTokenColor()`; because the product is dark-only, this is a token-discipline issue, but a liveScheme flip was not tested (and light mode is explicitly out of scope per `docs/DESIGN_SYSTEM_BENCHMARK_2026-11-23.md:8`).

---

## Historical status snapshot (2026-11-23 P5 — superseded by the "Current status" section at the top)

- The report no longer has a private 9/10/11/23px scale. `src/pages/report/reportTokens.ts` derives `REPORT_FONT` from the shared `TYPE_SCALE` (report uses 12/13/16/24) and report radii are 2/4/6/10; `ReportLegibility`/`ReportTypographyContrast` enforce the 12px floor and the closed ladder.
- Typography primitives (`Text/Title/Anchor/List`) are no longer a blind spot: their named sizes resolve through `SIZE_ROLE` → `TYPE_CLASS` on the shared 12/13/14/16/20/24 scale, with no private rem table or 18px step. The “one scale” claim now holds for direct primitive use; the five `xs…xl` props are aliases onto roles, so body 13px is reached with `text-ui-body` / `typeStyle("body")`, not a size alias.
- Replay error copy now separates a human message from collapsed technical detail; dense tabs/table regions scroll intentionally at 390.
- Fresh **Index Report** app captures now exist at `docs/screenshots/app/report-{1600,390}.png` (real route, mocked API, **viewport** captures at 1600×1000 and 390×844 — not full-page). The 1600 capture exposed a real spot-value ellipsis; the KPI minimum was widened so `22,363.35` stays complete.
- Still unverified in this doc: the mobile-nav gutter fix and fresh 1600/390 captures of home/screener/options/patterns. Storybook images are **not** a substitute; those route findings remain open until a route capture exists.
