# DRY Opportunities Report

**Branch:** refactor/dry-opportunities (created from main)
**Date:** Wed Jun  3 05:00:29 PM IST 2026
**Package.json checks:** Used `check:duplicates` (jscpd), `check:unused` (knip), `check:deps` (depcheck), `check:all`

## Summary from jscpd (similar code)
- Ran `bun run check:duplicates` and targeted `jscpd src --min-lines 5 --ignore "**/*.test.*"`
- Found 11 clones in production `src/` (0.72% duplicated lines).
- **Key production duplicates (refactor candidates):**
  1. **52W Gap column logic**:
     - `src/components/screener/columns/52wHigh.ts:6-15` (gapCol formatting with color classes)
     - `src/components/screener/columns/near52wBreakout.ts:20-29`
     - *Opportunity:* Extract to shared `src/components/screener/columns/gapCol.ts` or base.
  2. **Heatmap utils internal dup**:
     - `src/pages/heatmap/heatmapUtils.ts` (two similar blocks ~85-105)
     - *Opportunity:* Refactor duplicated color/scale logic into helper fn.
  3. **Backtest chart options overlap**:
     - `src/components/backtest/buildBacktestChartOption.ts` duplicates with `src/utils/chart/buildOverlays.ts` (multiple 14-line blocks for series/options)
     - *Opportunity:* Centralize in chart builders.
  4. **Chart utils + zoom/trade**:
     - `src/utils/chartUtils.ts` <-> `src/components/backtest/zoomToTrade.ts` (multiple blocks for time/price handling)
  5. **Internal in trading_agents.ts**:
     - Dupe SSE/function call patterns (lines 115-124 vs 210-219, 158-178 vs 293-313)
  6. **Replay vs Live prices streaming**:
     - `src/api/replay.ts` <-> `src/hooks/useLivePrices.ts` (SSE connection logic)
  7. **Paper trading internal**:
     - Duplicates in `src/api/paperTrading.ts`

- Full test clones (in e2e/ and src/...test.ts): 100+ , mostly repeated assertions/selectors in trade-history, sector, screener, paper-trading specs. 
  - *Opportunity (lower priority):* Introduce Page Object Model (POM) or shared test utils in tests/e2e/helpers/.

## From knip (unused = DRY by removal)
- `bun run check:unused` found:
  - 7 unused files (e.g., some backtest/news/sector components – can delete or integrate)
  - 1 unused dep: d3-interpolate
  - 49 unused exports (e.g., many in replay/mantine.ts, paper-trading helpers, heatmap colors, useApi hooks, useScreener* – dead code from refactors)
- Removing these reduces maintenance surface (DRY principle: don't keep similar-but-unused variants).

## From depcheck
- `bun run check:deps`:
  - Unused: d3-interpolate (matches knip)
  - Unused devDeps: several @storybook/* addons (can clean if not used)
  - Missing: babel pkgs for remove-console-logs.js (script dep?)

## Package.json observations
- Good: Has dedicated `check:*` scripts, `check:all` combines lint + dups + unused.
- `jscpd` configured with --min-lines 5 (reasonable).
- Opportunity: Enhance `check:duplicates` to ignore tests by default, or add src-only script.
- Add `check:deps` to `check:all`?
- Scripts use bun, consistent.

## Recommendations (high-level behavior for agents)
- Prioritize extracting shared column builders (screener columns, charts) and streaming helpers.
- Run `bun run check:all` before PRs.
- For e2e, consider DRY via helpers (already some in tests/e2e/helpers/).
- Clean unused to prevent "similar but dead" code.
- Re-run jscpd after refactors.

See full jscpd/knip output in terminal for exact clones.
