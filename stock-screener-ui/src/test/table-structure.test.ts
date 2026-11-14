// @vitest-environment node
/**
 * Structural duplication guard.
 *
 * `jscpd` finds only 0.48% literal clones in this repo — the real problem is
 * structural: 44 files each declare their own `const columns` and 58 wrap a
 * TanStackTable, so a table gets re-invented instead of reused and the align /
 * type treatment drifts per file.
 *
 * This test does not forbid tables. It records the count and fails only when it
 * grows, so each restructure phase must lower the ceiling. The allowlist shrinks;
 * it never grows.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/** Files allowed to declare a `const columns` array. May only SHRINK. */
const INLINE_COLUMN_ALLOWLIST = new Set<string>([
  // Known debt, measured when the guard was added. Each of these owns a bespoke
  // table that has not been migrated to the factories in
  // components/table/columns yet. Delete a line when you migrate a file; never
  // add one.
  "components/backtest/BacktestHistory.tsx",
  "components/backtest/BacktestResultsTable.tsx",
  "components/backtest/TradeHistoryTable.tsx",
  "components/options/OptionPositions/PositionsPanel.tsx",
  "components/options/Positioning/PositioningStrikeTable.tsx",
  "components/options/Positioning/ReadingTable.tsx",
  "components/options/PremiumTracker/DiaryStrip.tsx",
  "components/paper-trading/ActivityFeed.tsx",
  "components/paper-trading/AggregatedDashboard.tsx",
  "components/paper-trading/PaperHistoryTable2.tsx",
  "components/paper-trading/PositionsHelpers.tsx",
  "components/paper-trading/WatchlistScan2.tsx",
  "components/patterns/PatternListView.tsx",
  "components/patterns/PatternSymbolMatrix.tsx",
  "components/replay/ReplayPositions.tsx",
  "components/replay/ReplaySummary.tsx",
  "components/replay/ReplayTradeLog.tsx",
  "components/replay/tick/NtChart.tsx",
  "components/replay/tick/ReplayTradeTable.tsx",
  "components/screener/CorrelationMatrix.tsx",
  "components/screener/FnoScreenerTab.tsx",
  "components/screener/ScreenerConfigView.tsx",
  "components/screener/ScreenerTable.tsx",
  "components/sector/RotationBoard.tsx",
  "components/sector/RotationMatrix.tsx",
  "components/sector/SectorCorrelationTab.tsx",
  "components/sector/SectorTable.tsx",
  "components/strategies/PerformanceView.tsx",
  "components/strategy-runner/StrategyRunnerTabs.tsx",
  "pages/admin/AdminPatternTimeframesPanel.tsx",
  "pages/admin/LLMStatsPanel.tsx",
  "pages/admin/OrderFlowJournalPanel.tsx",
  "pages/admin/RecentRunsTable.tsx",
  "pages/report/EventWatch.tsx",
  "pages/report/IndexMoversModal.tsx",
  "pages/report/NiftyPositionsDrawer.tsx",
  "pages/report/NiftyPressureDesk.tsx",
  "pages/report/NiftyTapeColumns.tsx",
  "pages/report/NiftyUnusualVolume.tsx",
  "pages/report/Profitability.tsx",
  "pages/report/ReportBreakoutTable.tsx",
  "pages/report/ReportFollowThrough.tsx",
  "pages/report/sim/SimRuns.tsx",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

/** Files that declare a column array inline instead of using a factory. */
export function filesDeclaringColumns(): string[] {
  const out: string[] = [];
  for (const path of walk(SRC)) {
    if (/\.test\.|\.spec\.|\.stories\./.test(path)) continue;
    const rel = relative(SRC, path);
    // The canonical homes are allowed to declare columns.
    if (rel.startsWith("components/table/")) continue;
    if (rel.endsWith(".columns.ts") || rel.endsWith(".columns.tsx")) continue;
    const source = readFileSync(path, "utf8");
    if (/const columns\s*:\s*TableColumnDef|const columns\s*=\s*createMemo<TableColumnDef|const columns\s*=\s*\[/.test(source)) {
      out.push(rel);
    }
  }
  return out.sort();
}

describe("table structure", () => {
  it("no new file declares its own column array", () => {
    const offenders = filesDeclaringColumns().filter((f) => !INLINE_COLUMN_ALLOWLIST.has(f));
    const report = offenders.join("\n");
    expect(
      offenders,
      `\n${report}\n\nUse components/table/columns factories, or add a *.columns.ts next to the consumer.`,
    ).toEqual([]);
  });

  it("the allowlist never grows past the measured baseline", () => {
    // 45 files declared their own columns when this guard was added. Migrating a
    // file to the factories removes its line; this ceiling stops the count
    // creeping back up while that work is in progress.
    expect(INLINE_COLUMN_ALLOWLIST.size).toBeLessThanOrEqual(45);
  });
});
