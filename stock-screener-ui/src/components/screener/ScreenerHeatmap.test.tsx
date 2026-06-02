// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MantineProvider } from "@mantine/core";
import { ScreenerHeatmapView } from "./ScreenerHeatmapView";
import type { Stock } from "../../types";

vi.mock("../../pages/heatmap/HeatmapTreemap", () => ({
  HeatmapTreemap: (props: any) => (
    <div
      data-testid={props.testId}
      data-metric={props.metric}
      data-stocks={props.stocks.length}
    />
  ),
}));

const mockStock: Stock = {
  symbol: "RELIANCE",
  score: 85,
  sector: "Energy",
  day_change: 1.2,
  to_52w_high: -0.5,
};

describe("ScreenerHeatmapView", () => {
  const onSymbolClick = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders nothing when stocks empty", () => {
    render(
      <MantineProvider>
        <ScreenerHeatmapView
          stocks={[]}
          activeScreener="trending"
          onSymbolClick={onSymbolClick}
          testId="screener-heatmap-empty"
        />
      </MantineProvider>,
    );
    expect(screen.queryByTestId("screener-heatmap-empty")).not.toBeInTheDocument();
  });

  it("renders shared HeatmapTreemap with screener rows", () => {
    render(
      <MantineProvider>
        <ScreenerHeatmapView
          stocks={[mockStock]}
          activeScreener="52w_high"
          onSymbolClick={onSymbolClick}
          testId="screener-heatmap-touched"
        />
      </MantineProvider>,
    );
    const el = screen.getByTestId("screener-heatmap-touched");
    expect(el).toHaveAttribute("data-stocks", "1");
    expect(el).toHaveAttribute("data-metric", "to_52w_high");
  });

  it("defaults metric to day_change for nifty_movers", () => {
    render(
      <MantineProvider>
        <ScreenerHeatmapView
          stocks={[mockStock]}
          activeScreener="nifty_movers"
          onSymbolClick={onSymbolClick}
          testId="screener-heatmap-nifty"
        />
      </MantineProvider>,
    );
    expect(screen.getByTestId("screener-heatmap-nifty")).toHaveAttribute("data-metric", "day_change");
  });

  it("defaults metric to score for non-52w screeners", () => {
    render(
      <MantineProvider>
        <ScreenerHeatmapView
          stocks={[mockStock]}
          activeScreener="trending"
          onSymbolClick={onSymbolClick}
          testId="screener-heatmap-approaching"
        />
      </MantineProvider>,
    );
    expect(screen.getByTestId("screener-heatmap-approaching")).toHaveAttribute("data-metric", "score");
  });
});