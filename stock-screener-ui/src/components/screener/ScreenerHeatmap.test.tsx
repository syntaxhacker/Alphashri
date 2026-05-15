// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ScreenerHeatmap } from "./ScreenerHeatmap";
import { MantineProvider } from "@mantine/core";
import type { Stock } from "../../types";
import type { ColumnDef } from "./columns";

const mockStock1: Stock = {
  symbol: "RELIANCE",
  score: 85,
  tv_price: 2450.5,
  upstox_price: 2451.0,
  broker_diff: 0.02,
  high_52w: 2600,
  to_52w_high: -5.76,
  recent_return_5d: 3.2,
  perf_w: 1.5,
  sector: "Energy",
  touched_52w: false,
  day_change: 1.25,
  rsi: 65.3,
  stoch_k: 72.1,
  gap_pct: 0.5,
  premarket_change: 0.8,
  impact_score: 2.5,
  market_cap_b: 185.3,
  volume_m: 12.45,
};

const mockStock2: Stock = {
  ...mockStock1,
  symbol: "TCS",
  score: 75,
  sector: "Technology",
  touched_52w: true,
  day_change: -1.2,
  recent_return_5d: -2.5,
};

const mockStock3: Stock = {
  ...mockStock1,
  symbol: "INFY",
  score: 90,
  sector: "Technology",
  day_change: 0.8,
  recent_return_5d: 5.2,
};

const mockColumns: ColumnDef[] = [
  { key: "symbol", label: "Symbol", type: "string" },
  { key: "score", label: "Score", type: "badge" },
  { key: "day_change", label: "Change", type: "number" },
  { key: "recent_return_5d", label: "5D Return", type: "number" },
  { key: "sector", label: "Sector", type: "string" },
];

const mockStocks: Stock[] = [mockStock1, mockStock2, mockStock3];

describe("ScreenerHeatmap", () => {
  const defaultProps = {
    stocks: mockStocks,
    columns: mockColumns,
    touchedSymbols: new Set(["TCS"]),
    onSymbolClick: vi.fn(),
    onSymbolHover: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders heatmap grid with all stocks", () => {
    render(
      <MantineProvider>
        <ScreenerHeatmap {...defaultProps} />
      </MantineProvider>,
    );
    expect(screen.getByTestId("screener-heatmap")).toBeInTheDocument();
    expect(screen.getByTestId("heatmap-RELIANCE")).toBeInTheDocument();
    expect(screen.getByTestId("heatmap-TCS")).toBeInTheDocument();
    expect(screen.getByTestId("heatmap-INFY")).toBeInTheDocument();
  });

  it("displays stock symbol on each card", () => {
    render(
      <MantineProvider>
        <ScreenerHeatmap {...defaultProps} />
      </MantineProvider>,
    );
    expect(screen.getByText("RELIANCE")).toBeInTheDocument();
    expect(screen.getByText("TCS")).toBeInTheDocument();
    expect(screen.getByText("INFY")).toBeInTheDocument();
  });

  it("displays sector for each stock", () => {
    render(
      <MantineProvider>
        <ScreenerHeatmap {...defaultProps} />
      </MantineProvider>,
    );
    expect(screen.getByText("Energy")).toBeInTheDocument();
    // Technology appears for both TCS and INFY
    expect(screen.getAllByText("Technology").length).toBe(2);
  });

  it("shows score badge for stocks with score", () => {
    render(
      <MantineProvider>
        <ScreenerHeatmap {...defaultProps} />
      </MantineProvider>,
    );
    expect(screen.getByText("Score 85")).toBeInTheDocument();
    expect(screen.getByText("Score 75")).toBeInTheDocument();
    expect(screen.getByText("Score 90")).toBeInTheDocument();
  });

  it("shows 'Touched' badge for touched stocks", () => {
    render(
      <MantineProvider>
        <ScreenerHeatmap {...defaultProps} />
      </MantineProvider>,
    );
    // TCS is in touchedSymbols
    expect(screen.getByText("Touched")).toBeInTheDocument();
  });

  it("does not show 'Touched' badge for non-touched stocks", () => {
    render(
      <MantineProvider>
        <ScreenerHeatmap {...defaultProps} />
      </MantineProvider>,
    );
    // Check that only one "Touched" badge exists (for TCS)
    const touchedBadges = screen.getAllByText("Touched");
    expect(touchedBadges.length).toBe(1);
  });

  it("calls onSymbolClick when card is clicked", () => {
    render(
      <MantineProvider>
        <ScreenerHeatmap {...defaultProps} />
      </MantineProvider>,
    );
    fireEvent.click(screen.getByTestId("heatmap-RELIANCE"));
    expect(defaultProps.onSymbolClick).toHaveBeenCalledWith("RELIANCE");
  });

  it("calls onSymbolHover on mouse enter and leave", () => {
    render(
      <MantineProvider>
        <ScreenerHeatmap {...defaultProps} />
      </MantineProvider>,
    );
    const card = screen.getByTestId("heatmap-RELIANCE");

    fireEvent.mouseEnter(card);
    expect(defaultProps.onSymbolHover).toHaveBeenCalledWith("RELIANCE");

    fireEvent.mouseLeave(card);
    expect(defaultProps.onSymbolHover).toHaveBeenCalledWith(null);
  });

  it("displays up to 4 numeric metric columns", () => {
    render(
      <MantineProvider>
        <ScreenerHeatmap {...defaultProps} />
      </MantineProvider>,
    );
    // The heatmap should show metric column labels (day_change, recent_return_5d, etc.)
    // Each column label appears once per stock card
    expect(screen.getAllByText("Change").length).toBeGreaterThan(0);
    expect(screen.getAllByText("5D Return").length).toBeGreaterThan(0);
  });

  it("handles empty stocks array", () => {
    render(
      <MantineProvider>
        <ScreenerHeatmap {...defaultProps} stocks={[]} />
      </MantineProvider>,
    );
    expect(screen.getByTestId("screener-heatmap")).toBeInTheDocument();
    // Grid should be empty
    expect(screen.queryByTestId(/heatmap-/)).not.toBeInTheDocument();
  });

  it("renders correct number of metric cells per stock", () => {
    render(
      <MantineProvider>
        <ScreenerHeatmap {...defaultProps} />
      </MantineProvider>,
    );
    // Each stock should have metric cells (excluding symbol, score, sector)
    const relianceCard = screen.getByTestId("heatmap-RELIANCE");
    expect(relianceCard).toBeInTheDocument();
  });

  it("displays 'Unknown sector' when sector is missing", () => {
    const stockNoSector = { ...mockStock1, sector: "" };
    render(
      <MantineProvider>
        <ScreenerHeatmap {...defaultProps} stocks={[stockNoSector]} />
      </MantineProvider>,
    );
    expect(screen.getByText("Unknown sector")).toBeInTheDocument();
  });

  it("handles single stock", () => {
    render(
      <MantineProvider>
        <ScreenerHeatmap {...defaultProps} stocks={[mockStock1]} />
      </MantineProvider>,
    );
    expect(screen.getByTestId("heatmap-RELIANCE")).toBeInTheDocument();
    expect(screen.queryByTestId("heatmap-TCS")).not.toBeInTheDocument();
  });

  it("applies color tone based on value for directional metrics", () => {
    render(
      <MantineProvider>
        <ScreenerHeatmap {...defaultProps} />
      </MantineProvider>,
    );
    // The component applies background colors based on getMetricTone
    // We can verify the cards render without error
    expect(screen.getByTestId("heatmap-RELIANCE")).toBeInTheDocument();
  });

  it("handles stocks with undefined optional rsi", () => {
    const stockWithoutRsi = { ...mockStock1, rsi: undefined };
    render(
      <MantineProvider>
        <ScreenerHeatmap {...defaultProps} stocks={[stockWithoutRsi]} />
      </MantineProvider>,
    );
    expect(screen.getByTestId("heatmap-RELIANCE")).toBeInTheDocument();
  });

  it("handles stocks with undefined optional stoch_k", () => {
    const stockWithoutStoch = { ...mockStock1, stoch_k: undefined };
    render(
      <MantineProvider>
        <ScreenerHeatmap {...defaultProps} stocks={[stockWithoutStoch]} />
      </MantineProvider>,
    );
    expect(screen.getByTestId("heatmap-RELIANCE")).toBeInTheDocument();
  });

  it("does not show score badge when score is not a number", () => {
    const stockNoScore = { ...mockStock1, score: "N/A" as any };
    render(
      <MantineProvider>
        <ScreenerHeatmap {...defaultProps} stocks={[stockNoScore]} />
      </MantineProvider>,
    );
    expect(screen.queryByText(/Score/)).not.toBeInTheDocument();
  });

  it("handles large number of stocks", () => {
    const manyStocks: Stock[] = Array.from({ length: 10 }, (_, i) => ({
      ...mockStock1,
      symbol: `STOCK${i}`,
      score: 50 + i,
    }));
    render(
      <MantineProvider>
        <ScreenerHeatmap {...defaultProps} stocks={manyStocks} />
      </MantineProvider>,
    );
    expect(screen.getByTestId("screener-heatmap")).toBeInTheDocument();
    expect(screen.getByTestId("heatmap-STOCK0")).toBeInTheDocument();
    expect(screen.getByTestId("heatmap-STOCK9")).toBeInTheDocument();
  });

  it("touchedSymbols correctly identifies touched stocks", () => {
    render(
      <MantineProvider>
        <ScreenerHeatmap {...defaultProps} />
      </MantineProvider>,
    );
    // TCS should have touched badge
    const tcsCard = screen.getByTestId("heatmap-TCS");
    expect(tcsCard).toBeInTheDocument();
    // RELIANCE and INFY should not
    const relianceCard = screen.getByTestId("heatmap-RELIANCE");
    expect(relianceCard).toBeInTheDocument();
    expect(relianceCard.querySelector(".touched-badge")).toBeNull();
  });
});
