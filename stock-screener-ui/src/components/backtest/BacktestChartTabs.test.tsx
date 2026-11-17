// @vitest-environment happy-dom
import type { JSX } from "solid-js";
import { describe, expect, test, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import type { SymbolChartData } from "../../types/backtest";
import { BacktestChartTabs } from "./BacktestChartTabs";
import "@testing-library/jest-dom/vitest";

// The real chart is heavy (lightweight-charts); this test guards the chart-vs-placeholder
// branch in BacktestChartTabs, not the chart renderer itself.
vi.mock("../chart/TradingViewChart", () => ({
  TradingViewChart: () => <div data-testid="tv-chart" />,
}));

afterEach(cleanup);

function Wrapper({ children }: { children: JSX.Element }) {
  return <UIProvider>{children}</UIProvider>;
}

function chartData(symbol: string): SymbolChartData {
  return {
    symbol,
    candles: [
      {
        time: "2026-05-07T09:15:00",
        date: "2026-05-07",
        time_str: "09:15",
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 1000,
      },
    ],
    orb_zones: [],
    pivot_levels: [],
    week52_levels: [],
    trades: [],
    date_range: { start: "2026-05-07", end: "2026-05-07" },
    total_candles: 1,
    total_trades: 0,
  } as unknown as SymbolChartData;
}

function renderTabs(selectedSymbol: string | null) {
  return render(
    () => (
      <BacktestChartTabs
        symbols={["RELIANCE"]}
        selectedSymbol={selectedSymbol}
        onSymbolSelect={() => {}}
        zoomValue="all"
        onZoomChange={() => {}}
        chartDataMap={new Map([["RELIANCE", chartData("RELIANCE")]])}
        selectedTf={null}
        onTfChange={() => {}}
      />
    ),
    { wrapper: Wrapper },
  );
}

describe("BacktestChartTabs chart branch", () => {
  test("mounts the chart and tabs when a symbol is selected (non-null)", () => {
    renderTabs("RELIANCE");
    expect(screen.queryByTestId("chart-placeholder")).not.toBeInTheDocument();
    expect(screen.getByTestId("echarts-container")).toBeInTheDocument();
    expect(screen.getByTestId("echarts-container")).toHaveAttribute("data-symbol", "RELIANCE");
    expect(screen.getByTestId("tv-chart")).toBeInTheDocument();
    expect(screen.getByTestId("chart-tabs-header")).toBeInTheDocument();
    expect(screen.getByText("RELIANCE")).toBeInTheDocument();
  });

  test("mounts the placeholder when symbols exist but none is selected", () => {
    renderTabs(null);
    expect(screen.getByTestId("chart-placeholder")).toBeInTheDocument();
    expect(screen.queryByTestId("echarts-container")).not.toBeInTheDocument();
  });
});
