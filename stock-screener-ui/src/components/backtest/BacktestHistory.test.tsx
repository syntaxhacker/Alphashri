// @vitest-environment happy-dom
import type { JSX } from "solid-js";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import "@testing-library/jest-dom/vitest";
import type { BacktestHistoryItem } from "../../types/backtest";

const fetchBacktestHistory = vi.fn();
const deleteBacktest = vi.fn();
const fetchBacktestDetails = vi.fn();

vi.mock("../../api/backtest", () => ({
  fetchBacktestHistory: (...a: unknown[]) => fetchBacktestHistory(...a),
  deleteBacktest: (...a: unknown[]) => deleteBacktest(...a),
  fetchBacktestDetails: (...a: unknown[]) => fetchBacktestDetails(...a),
}));

const setResults = vi.fn();
const setParams = vi.fn();
const setSelectedStrategy = vi.fn();
const setSelectedSymbols = vi.fn();
const setDays = vi.fn();
const setChartDataBatch = vi.fn();
const setSelectedChartSymbol = vi.fn();
const setSelectedVariationId = vi.fn();

vi.mock("../../state/backtest", () => ({
  setResults: (...a: unknown[]) => setResults(...a),
  setParams: (...a: unknown[]) => setParams(...a),
  setSelectedStrategy: (...a: unknown[]) => setSelectedStrategy(...a),
  setSelectedSymbols: (...a: unknown[]) => setSelectedSymbols(...a),
  setDays: (...a: unknown[]) => setDays(...a),
  setChartDataBatch: (...a: unknown[]) => setChartDataBatch(...a),
  setSelectedChartSymbol: (...a: unknown[]) => setSelectedChartSymbol(...a),
  setSelectedVariationId: (...a: unknown[]) => setSelectedVariationId(...a),
  getBacktestState: () => ({ variations: [] }),
}));

import { BacktestHistory } from "./BacktestHistory";

function Wrapper({ children }: { children: JSX.Element }) {
  return <UIProvider>{children}</UIProvider>;
}

const item: BacktestHistoryItem = {
  id: "bt-1",
  user_id: 1,
  strategy_id: "orb",
  strategy_name: "ORB Best",
  parameters: { days: 90 },
  symbols: ["RELIANCE", "TCS"],
  metrics: {
    total_pnl: 12500,
    total_pnl_pct: 8.4,
    win_rate: 62.5,
    total_trades: 16,
  },
  created_at: "2026-11-10T10:30:00.000Z",
};

beforeEach(() => {
  fetchBacktestHistory.mockReset();
  deleteBacktest.mockReset();
  fetchBacktestDetails.mockReset();
  fetchBacktestHistory.mockResolvedValue([item]);
  deleteBacktest.mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("BacktestHistory", () => {
  it("loads and renders saved backtests when active", async () => {
    render(() => (
      <Wrapper>
        <BacktestHistory active />
      </Wrapper>
    ));
    expect(await screen.findByText("ORB Best")).toBeInTheDocument();
    expect(screen.getByText("1 backtest saved")).toBeInTheDocument();
    expect(fetchBacktestHistory).toHaveBeenCalledTimes(1);
  });

  it("shows the empty state when there is no history", async () => {
    fetchBacktestHistory.mockResolvedValue([]);
    render(() => (
      <Wrapper>
        <BacktestHistory active />
      </Wrapper>
    ));
    expect(await screen.findByText("No backtest history")).toBeInTheDocument();
  });

  it("does not fetch when inactive", async () => {
    render(() => (
      <Wrapper>
        <BacktestHistory active={false} />
      </Wrapper>
    ));
    expect(fetchBacktestHistory).not.toHaveBeenCalled();
  });

  it("load button wires the stored backtest into state and calls onLoad", async () => {
    fetchBacktestDetails.mockResolvedValue({
      ...item,
      results: [],
      totals: { net_pnl: 0 },
      variation_id: null,
      chart_data: undefined,
    });
    const onLoad = vi.fn();
    render(() => (
      <Wrapper>
        <BacktestHistory active onLoad={onLoad} />
      </Wrapper>
    ));
    expect(await screen.findByTestId("history-load-btn-bt-1")).toBeInTheDocument();
    await fireEvent.click(screen.getByTestId("history-load-btn-bt-1"));
    await waitFor(() => expect(fetchBacktestDetails).toHaveBeenCalledWith("bt-1"));
    expect(setSelectedStrategy).toHaveBeenCalledWith("orb");
    expect(setSelectedSymbols).toHaveBeenCalledWith(["RELIANCE", "TCS"]);
    expect(setDays).toHaveBeenCalledWith(90);
    expect(onLoad).toHaveBeenCalledTimes(1);
  });

  it("delete removes the row after confirm", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(() => (
      <Wrapper>
        <BacktestHistory active />
      </Wrapper>
    ));
    expect(await screen.findByTestId("history-delete-btn-bt-1")).toBeInTheDocument();
    await fireEvent.click(screen.getByTestId("history-delete-btn-bt-1"));
    await waitFor(() => expect(deleteBacktest).toHaveBeenCalledWith("bt-1"));
    await waitFor(() => expect(screen.getByText("No backtest history")).toBeInTheDocument());
    confirmSpy.mockRestore();
  });
});
