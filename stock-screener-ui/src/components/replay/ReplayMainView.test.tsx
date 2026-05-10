// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MantineProvider } from "@mantine/core";
import { ReplayMainView } from "./ReplayMainView";

afterEach(() => {
  cleanup();
});

const baseProps = {
  candlesBySymbol: {},
  trades: [],
  orLevels: [],
  pivotLevels: [],
  high52wLevels: [],
  emaData: {},
  selectedSymbol: null,
  setSelectedSymbol: vi.fn(),
  chartOptions: { show_orb_zones: false, show_pivot_levels: false, show_52w_high: false, show_ema: false, show_markers: false, show_all_trades: false },
  setChartOptions: vi.fn(),
  highlightedTradeId: null,
  strategyFilter: "ALL",
  setStrategyFilter: vi.fn(),
  isRunning: false,
  chartRef: { current: null },
  onTradeClick: vi.fn(),
  onTradeRowClick: vi.fn(),
};

describe("ReplayMainView", () => {
  it("renders container with fixed height", () => {
    render(
      <MantineProvider>
        <ReplayMainView {...baseProps} />
      </MantineProvider>,
    );
    const container = screen.getByTestId("replay-chart-empty").closest('[style*="height: 500px"]');
    expect(container).toBeTruthy();
  });

  it("flex layout includes both chart and trade log", () => {
    render(
      <MantineProvider>
        <ReplayMainView {...baseProps} />
      </MantineProvider>,
    );
    expect(screen.getByTestId("replay-trade-log")).toBeInTheDocument();
  });

  it("passes props to ReplayTradeLog", () => {
    render(
      <MantineProvider>
        <ReplayMainView {...baseProps} />
      </MantineProvider>,
    );
    expect(screen.getByTestId("replay-trade-log")).toBeInTheDocument();
  });
});
