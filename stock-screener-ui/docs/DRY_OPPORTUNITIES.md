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

## Python Backend DRY Check (jscpd on .py files)

**Command run:** `npx jscpd api/ scripts/ trading/ backtest/ db/ -f python --min-lines 5 --ignore "..." --reporters console`

**Results:**
- 182 Python files analyzed
- 142 clones found
- 2255 duplicated lines (6.96% of 32407 total lines)
- 23630 duplicated tokens (8.33%)

**Major clone hotspots (high DRY opportunity):**

1. **week52_chaser.py vs week52_target.py** (biggest overlap):
   - Many large blocks: 23 lines (226 tokens), 50 lines (774 tokens), 24 lines, 19 lines, 16 lines, 14 lines, 13 lines, 12 lines, 11 lines, 9 lines.
   - Examples:
     - chaser:13-36 <-> target:15-37
     - chaser:36-48 <-> target:39-52
     - chaser:362-370 <-> target:249-258
     - chaser:436-459 <-> target:482-505
     - chaser:461-474 <-> target:507-520
     - chaser:475-486 <-> target:520-531
     - chaser:487-501 <-> target:532-546
     - chaser:527-577 <-> target:576-626 (50 lines!)
     - chaser:594-618 <-> target:641-666
     - chaser:747-756 <-> target:386-396
     - chaser:762-781 <-> target:406-425
   - *Strong recommendation:* These two 52W strategies share ~20-30%+ code. Extract common logic into `backtest/strategies/base_52w.py` or shared `week52_utils.py` (some utils already exist). Use inheritance (BaseSignalGenerator mentioned in AGENTS). This is the #1 Python DRY win.

2. **Internal duplicates in strategies:**
   - week52_target.py has several self-clones (15 lines, 11 lines, 12 lines).

3. **db/migrations/versions/** (expected but high volume):
   - Repeated Alembic boilerplate (e.g. 7 lines in multiple migrations, schema defs duplicated across initial and later migrations).

4. **db/models/**:
   - trade.py self-dupe (model fields ~7 lines)
   - replay_saved_config.py <-> screener.py (similar model structure ~5 lines)

5. **api/ overlaps:**
   - api/chart.py internal dups (14 lines, 8 lines)
   - api/backtest_routes.py self and cross with backtest/api.py (7-9 lines)

6. **Other:**
   - api/trading_agents.py (from earlier full run, SSE patterns)
   - trading/ likely has more (run targeted if needed: e.g. signals files)

**Comparison to JS/TS:**
- Python has higher duplicate % (6.96% vs ~0.7% in src non-test) because of strategy duplication + migrations.
- E2e tests had even more, but Python strategies are core business logic.

**Recommendations for agents:**
- Run `npx jscpd api/ scripts/ trading/ backtest/ db/ -f python --min-lines 5 ...` as part of Python DRY checks.
- Consider adding to package.json: `"check:duplicates:python": "jscpd api scripts trading backtest db -f python --min-lines 5 --reporters console"`
- Update check:all or add check:python.
- Prioritize refactoring the week52_* pair (aligns with existing AGENTS notes on 52W strategies).
- For migrations, accept some boilerplate but extract common upgrade patterns if possible.
- Cross-ref AGENTS.md "Strategy Config Pipeline" and "52W" section.

See full output in terminal history for exact line numbers.

