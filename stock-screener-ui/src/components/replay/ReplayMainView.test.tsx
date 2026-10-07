// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { UIProvider } from "@/ui";
import { ReplayMainView } from "./ReplayMainView";

afterEach(() => {
  cleanup();

  vi.clearAllMocks();
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
  it("renders a flex-fill container that fills its parent", () => {
    render(
      <UIProvider>
        <ReplayMainView {...baseProps} />
      </UIProvider>,
    );
    const container = screen.getByTestId("replay-main-view");
    expect(container).toBeInTheDocument();
    expect(container.getAttribute("style")).toContain("flex-grow: 1");
    expect(container.getAttribute("style")).toContain("height: 100%");
  });

  it("flex layout includes both chart and trade log", () => {
    render(
      <UIProvider>
        <ReplayMainView {...baseProps} />
      </UIProvider>,
    );
    expect(screen.getByTestId("replay-trade-log")).toBeInTheDocument();
  });

  it("passes props to ReplayTradeLog", () => {
    render(
      <UIProvider>
        <ReplayMainView {...baseProps} />
      </UIProvider>,
    );
    expect(screen.getByTestId("replay-trade-log")).toBeInTheDocument();
  });
});
