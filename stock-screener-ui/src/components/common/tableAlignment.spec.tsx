// @vitest-environment happy-dom
/**
 * Alignment contract smoke test for every screen's table.
 * Contract (implemented in shared TanStackTable):
 *  - text columns  -> header + cell left
 *  - numeric cols  -> header + cell right
 *  - meta.align overrides
 */
import { describe, it, expect } from "vitest";
import { render, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { UIProvider } from "@/ui";
import { IntervalMoversTable } from "../sector/IntervalMoversTable";
import { SectorTable } from "../sector/SectorTable";
import { ReplayPositions } from "../replay/ReplayPositions";
import { ReplaySummaryPanel } from "../replay/ReplaySummary";
import { ReplayTradeLog } from "../replay/ReplayTradeLog";
import { HeatmapListView } from "../../pages/heatmap/HeatmapListView";
import { PositionsPanel } from "../options/OptionPositions/PositionsPanel";
import { SectorAlertsList } from "../sector/SectorAlertsList";
import { PerformanceView } from "../strategies/PerformanceView";
import type { MetricConfig } from "../../pages/heatmap/heatmapUtils";
import type { HeatmapStock } from "../../api/heatmap";

function wrap(ui: React.ReactNode) {
  cleanup();
  return render(<UIProvider>{ui}</UIProvider>);
}

function grab(label: string) {
  const table = document.body.querySelector("table");
  expect(table, `${label}: table rendered`).toBeTruthy();
  const ths = [...table!.querySelectorAll("thead th")];
  const firstRow = table!.querySelector("tbody tr");
  const tds = firstRow ? [...firstRow.querySelectorAll("td")] : [];
  const headerByText = new Map(
    ths.map((th) => [th.textContent!.trim(), getComputedStyle(th).textAlign]),
  );
  const cellAligns = tds.map((td) => ({
    text: td.textContent!.trim(),
    align: getComputedStyle(td).textAlign,
  }));
  return { headerByText, cellAligns };
}

const metric: MetricConfig = { value: "pe_ratio", label: "P/E", fmt: (v) => v.toFixed(1) };

describe("table alignment across screens", () => {
  it("IntervalMoversTable: text left, numeric right", () => {
    wrap(
      <IntervalMoversTable
        movers={[
          { symbol: "RELIANCE", prev_change: 1.1, change: 2.2, delta: 1.1 },
          { symbol: "TCS", prev_change: -0.5, change: 0.3, delta: 0.8 },
        ]}
      />,
    );
    const { headerByText, cellAligns } = grab("movers");
    expect(headerByText.get("Stock")).toBe("left");
    expect(headerByText.get("Prev")).toBe("right");
    expect(headerByText.get("Now")).toBe("right");
    expect(headerByText.get("Δ")).toBe("right");
    expect(cellAligns.find((c) => c.text === "RELIANCE")!.align).toBe("left");
    expect(cellAligns.find((c) => c.text.includes("1.10"))!.align).toBe("right");
  });

  it("ReplaySummaryPanel: strategy text left, numbers right", () => {
    wrap(
      <ReplaySummaryPanel
        summary={{
          total_trades: 7,
          winners: 5,
          losers: 2,
          win_rate: 71.4,
          profit_factor: 3.1,
          gross_pnl: 5191,
          total_costs: 0,
          net_pnl: 5191,
          strategy_breakdown: {
            "ORB High Beta": { trades: 2, win_rate: 100, net_pnl: 3991, profit_factor: 5.2 },
          },
        }}
      />,
    );
    const { headerByText, cellAligns } = grab("replay-summary");
    expect(headerByText.get("Strategy")).toBe("left");
    expect(headerByText.get("Trades")).toBe("right");
    expect(headerByText.get("Win Rate")).toBe("right");
    expect(headerByText.get("Net P&L")).toBe("right");
    expect(headerByText.get("PF")).toBe("right");
    expect(cellAligns.find((c) => c.text === "ORB High Beta")!.align).toBe("left");
  });

  it("ReplayPositions: symbol left, numeric right", () => {
    wrap(
      <ReplayPositions
        positions={[
          { id: 1, symbol: "RELIANCE", side: "BUY", quantity: 25, entry_price: 2900, sl: 2875, tp: 3010, strategy: "ORB", entry_time: "2026-08-08 09:30" },
        ]}
      />,
    );
    const { headerByText, cellAligns } = grab("replay-positions");
    expect(headerByText.get("Symbol") ?? headerByText.get("Stock")).toBe("left");
    const qty = cellAligns.find((c) => c.text === "25");
    if (qty) expect(qty.align).toBe("right");
  });

  it("ReplayTradeLog: symbol left, numeric cols right", () => {
    wrap(
      <ReplayTradeLog
        trades={[
          { id: 1, strategy: "ORB", symbol: "RELIANCE", side: "BUY", entry_price: 2900, exit_price: 2995.5, entry_time: "09:30", exit_time: "10:15", pnl: 2387.5, net_pnl: 2387.5, costs: 0, exit_reason: "TP", quantity: 25 },
        ]}
        strategyFilter="ALL"
        setStrategyFilter={() => {}}
        isRunning={false}
        highlightedTradeId={null}
      />,
    );
    const { headerByText, cellAligns } = grab("replay-tradelog");
    expect(headerByText.get("Symbol")).toBe("left");
    expect(headerByText.get("Qty")).toBe("right");
    const pnl = cellAligns.find((c) => c.text.includes("2387"));
    if (pnl) expect(pnl.align).toBe("right");
  });

  it("PositionsPanel (options): trading symbol left, numbers right", () => {
    wrap(
      <PositionsPanel
        positions={[
          { instrument_key: "NIFTY1", trading_symbol: "NIFTY 24AUG 24500 CE", option_type: "CE", strike_price: 24500, quantity: 75, average_price: 145.5, current_price: 162, pnl: 1237.5 },
        ]}
      />,
    );
    const { headerByText, cellAligns } = grab("options-positions");
    expect(headerByText.get("Type") ?? headerByText.get("Symbol")).toBe("left");
    const qty = cellAligns.find((c) => c.text === "75");
    if (qty) expect(qty.align).toBe("right");
  });

  it("PerformanceView (strategies): strategy left, numbers right", () => {
    wrap(
      <PerformanceView
        performance={[
          { strategy_id: 1, strategy_name: "ORB High Beta", total_trades: 120, winners: 74, losers: 46, win_rate: 61.7, total_pnl: 128400, net_pnl: 128400 },
        ]}
        strategies={[]}
        onSelectStrategy={() => {}}
        isLoading={false}
      />,
    );
    const { headerByText, cellAligns } = grab("perf-view");
    expect(headerByText.get("Strategy")).toBe("left");
    expect(headerByText.get("Total Trades")).toBe("right");
    expect(headerByText.get("Win Rate")).toBe("right");
    expect(headerByText.get("Net P&L")).toBe("right");
    expect(cellAligns.find((c) => c.text === "ORB High Beta")!.align).toBe("left");
  });

  it("HeatmapListView: symbol left, numeric right", () => {
    const stocks: HeatmapStock[] = [
      { symbol: "RELIANCE", name: "Reliance", sector: "Energy", market_cap: 19.2, pe_ratio: 24.5, pb_ratio: 3.1, dividend_yield: 0.4, perf_1y: 22.1, roe: 14.2, high_52w: 3050, low_52w: 2100, price: 2950.5, change_pct: 1.25 },
      { symbol: "TCS", name: "TCS", sector: "IT", market_cap: 12.4, pe_ratio: 28.1, pb_ratio: 8.2, dividend_yield: 1.1, perf_1y: 8.4, roe: 32.5, high_52w: 3600, low_52w: 2800, price: 3420, change_pct: -0.75 },
    ];
    wrap(
      <HeatmapListView
        stocks={stocks}
        metric="pe_ratio"
        activeMetric={metric}
        metricMin={0}
        metricMax={50}
      />,
    );
    const { headerByText, cellAligns } = grab("heatmap-list");
    expect(headerByText.get("Symbol")).toBe("left");
    expect(headerByText.get("P/E")).toBe("right");
    const price = cellAligns.find((c) => c.text.includes("2950"));
    if (price) expect(price.align).toBe("right");
  });

  it("SectorAlertsList: time/sector left, move badge rendered", () => {
    wrap(
      <SectorAlertsList
        alerts={[
          { timestamp: "10:30:00", sector: "IT", direction: "SURGING" as const, delta: 1.5 },
          { timestamp: "10:31:00", sector: "Banking", direction: "DROPPING" as const, delta: -0.8 },
        ]}
      />,
    );
    const { headerByText, cellAligns } = grab("sector-alerts");
    expect(headerByText.get("Time")).toBe("left");
    expect(headerByText.get("Sector")).toBe("left");
    expect(headerByText.get("Move")).toBe("left");
    expect(cellAligns.find((c) => c.text === "IT")!.align).toBe("left");
    expect(cellAligns.some((c) => c.text.includes("SURGING"))).toBe(true);
  });

  it("SectorTable: sector left, numeric right", () => {
    wrap(
      <SectorTable
        sectors={[
          { sector: "BANKNIFTY", avg_change: 1.25, stock_count: 12, advances: 9, declines: 3, avg_rsi: 61, avg_adx: 28.4, top_movers: "HDFCBANK" },
          { sector: "IT", avg_change: -0.75, stock_count: 10, advances: 3, declines: 7, avg_rsi: 48, avg_adx: 22.1, top_movers: "TCS" },
        ]}
      />,
    );
    const { headerByText, cellAligns } = grab("sector");
    expect(headerByText.get("Sector") ?? headerByText.get("Change")).toBe("left");
    const chg = cellAligns.find((c) => c.text.includes("1.25"));
    if (chg) expect(chg.align).toBe("right");
  });
});
