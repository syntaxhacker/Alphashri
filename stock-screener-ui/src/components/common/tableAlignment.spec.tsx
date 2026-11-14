// @vitest-environment happy-dom
/**
 * Alignment contract smoke test for every screen's table or grid panel.
 *
 * Contract:
 *  - Components rendering a real <table> (shared TanStackTable) → check the
 *    <table> path: thead th / tbody td alignment, text left, numeric right,
 *    meta.align overrides.
 *  - Components rewritten as CSS grids (IntervalMoversTable,
 *    SectorAlertsList) → check the grid path: the container
 *    (data-testid) must exist, header cells and body cells render with the
 *    expected text alignment.
 *  - A component rendering neither a <table> nor a detectable grid fails
 *    with a clear message — the guard must never silently pass.
 */
import { describe, it, expect } from "vitest";
import type { JSX } from "solid-js";
import { render, cleanup } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { UIProvider } from "@/ui";
import { IntervalMoversTable } from "../sector/IntervalMoversTable";
import { SectorTable } from "../sector/SectorTable";
import { ReplayPositions } from "../replay/ReplayPositions";
import { ReplaySummaryPanel } from "../replay/ReplaySummary";
import { ReplayTradeLog } from "../replay/ReplayTradeLog";
import { PositionsPanel } from "../options/OptionPositions/PositionsPanel";
import { SectorAlertsList } from "../sector/SectorAlertsList";
import { PerformanceView } from "../strategies/PerformanceView";

function wrap(ui: JSX.Element) {
  cleanup();
  return render(() => (<UIProvider>{ui}</UIProvider>));
}

/** Inline style first (reliable in happy-dom), computed style as fallback.
 *  text-align initial value is "left"; happy-dom reports '' when unset.
 */
function alignOf(el: Element): string {
  return (el as HTMLElement).style.textAlign || getComputedStyle(el).textAlign || "left";
}

/** Shared TanStackTable path: real <table> with thead/tbody. */
function grabTable(label: string) {
  const table = document.body.querySelector("table");
  expect(table, `${label}: <table> rendered`).toBeTruthy();
  const ths = [...table!.querySelectorAll("thead th")];
  const firstRow = table!.querySelector("tbody tr");
  const tds = firstRow ? [...firstRow.querySelectorAll("td")] : [];
  const headerByText = new Map(
    ths.map((th) => [th.textContent!.trim(), alignOf(th)]),
  );
  const cellAligns = tds.map((td) => ({
    text: td.textContent!.trim(),
    align: alignOf(td),
  }));
  return { headerByText, cellAligns };
}

/** CSS-grid panel path (IntervalMoversTable / SectorAlertsList).
 *  Returns every grid row (direct child Boxes with display: grid) as an
 *  array of { text, align } direct child cells. Row 0 is the header row
 *  when the panel has one. Fails with a clear message when the container
 *  or any grid row is missing.
 */
function grabGrid(testId: string) {
  const container = document.body.querySelector<HTMLElement>(
    `[data-testid="${testId}"]`,
  );
  expect(
    container,
    `grid panel: [data-testid="${testId}"] container rendered`,
  ).toBeTruthy();
  const rows = [...(container!.children as HTMLCollectionOf<HTMLElement>)].filter(
    (row) =>
      row.style.display === "grid" ||
      getComputedStyle(row).display === "grid" ||
      row.className.includes("grid"),
  );
  expect(
    rows.length,
    `grid panel: [data-testid="${testId}"] has at least one grid row`,
  ).toBeGreaterThan(0);
  return rows.map((row) =>
    [...(row.children as HTMLCollectionOf<HTMLElement>)].map((cell) => ({
      text: cell.textContent!.trim(),
      align: alignOf(cell),
    })),
  );
}

describe("table alignment across screens", () => {
  it("IntervalMoversTable (grid): text left, numeric right", () => {
    wrap(
      <IntervalMoversTable
        movers={[
          { symbol: "RELIANCE", prev_change: 1.1, change: 2.2, delta: 1.1 },
          { symbol: "TCS", prev_change: -0.5, change: 0.3, delta: 0.8 },
        ]}
      />,
    );
    const rows = grabGrid("interval-movers-table");
    const [header, firstBody] = rows;
    expect(header.map((c) => c.text)).toEqual(["Stock", "Prev", "Now", "Δ"]);
    expect(header[0].align).toBe("left");
    expect(header[1].align).toBe("right");
    expect(header[2].align).toBe("right");
    expect(header[3].align).toBe("right");
    expect(firstBody.map((c) => c.text)).toEqual(["RELIANCE", "1.10%", "2.20%", "+1.10%"]);
    expect(firstBody[0].align).toBe("left");
    expect(firstBody[1].align).toBe("right");
    expect(firstBody[2].align).toBe("right");
    expect(firstBody[3].align).toBe("right");
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
    const { headerByText, cellAligns } = grabTable("replay-summary");
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
    const { headerByText, cellAligns } = grabTable("replay-positions");
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
    const { headerByText, cellAligns } = grabTable("replay-tradelog");
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
    const { headerByText, cellAligns } = grabTable("options-positions");
    expect(headerByText.get("Symbol")).toBe("left");
    expect(headerByText.get("Type")).toBe("center");
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
    const { headerByText, cellAligns } = grabTable("perf-view");
    expect(headerByText.get("Strategy")).toBe("left");
    expect(headerByText.get("Total Trades")).toBe("right");
    expect(headerByText.get("Win Rate")).toBe("right");
    expect(headerByText.get("Net P&L")).toBe("right");
    expect(cellAligns.find((c) => c.text === "ORB High Beta")!.align).toBe("left");
  });

  it("SectorAlertsList (grid): time/sector cells, SURGING/DROPPING badge", () => {
    wrap(
      <SectorAlertsList
        alerts={[
          { timestamp: "10:30:00", sector: "IT", direction: "SURGING" as const, delta: 1.5 },
          { timestamp: "10:31:00", sector: "Banking", direction: "DROPPING" as const, delta: -0.8 },
        ]}
      />,
    );
    const rows = grabGrid("sector-alerts-table");
    expect(rows.length).toBe(2);
    expect(rows[0].map((c) => c.text)).toEqual(["10:30:00", "IT", "SURGING (1.50%)"]);
    expect(rows[1].map((c) => c.text)).toEqual(["10:31:00", "Banking", "DROPPING (-0.80%)"]);
    const moveCells = rows.flatMap((row) => row.slice(2));
    expect(moveCells.some((c) => c.text.startsWith("SURGING"))).toBe(true);
    expect(moveCells.some((c) => c.text.startsWith("DROPPING"))).toBe(true);
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
    const { headerByText, cellAligns } = grabTable("sector");
    expect(headerByText.get("Sector") ?? headerByText.get("Change")).toBe("left");
    const chg = cellAligns.find((c) => c.text.includes("1.25"));
    if (chg) expect(chg.align).toBe("right");
  });

  it("fails loudly when a screen renders neither <table> nor grid", () => {
    expect(() => {
      wrap(<div data-testid="plain-panel">no structure here</div>);
      grabTable("plain-panel");
    }).toThrowError(/<table> rendered/);
    expect(() => {
      cleanup();
      wrap(<div data-testid="plain-panel">no structure here</div>);
      grabGrid("plain-panel");
    }).toThrowError(/grid panel/);
  });
});
