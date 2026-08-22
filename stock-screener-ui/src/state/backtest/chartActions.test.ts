import { describe, it, expect, vi, beforeEach } from "vitest";
import { createChartActions } from "./chartActions";

vi.mock("../../api/chartBuilder", () => ({
  chartTradesToTrades: vi.fn((trades: any[]) => trades.map((t) => ({ id: t.trade_id, ...t.trade }))),
}));

import { chartTradesToTrades } from "../../api/chartBuilder";

const mockedChartTradesToTrades = vi.mocked(chartTradesToTrades);

function makeState(overrides: any = {}) {
  return {
    chartData: new Map([["A", { symbol: "A", trades: [] } as any]]),
    chartOptions: { show_orb_zones: true, show_entry_markers: true, show_exit_markers: true, show_sl_tp_lines: false, date_range: "all" } as any,
    tradeHistory: null,
    tradeHistorySymbol: null,
    ...overrides,
  };
}

describe("chartActions", () => {
  let state: ReturnType<typeof makeState>;
  let patches: Record<string, any>[];
  let getState: any;
  let setState: any;
  let actions: ReturnType<typeof createChartActions>;

  beforeEach(() => {
    vi.clearAllMocks();
    state = makeState();
    patches = [];
    getState = vi.fn(() => state);
    setState = vi.fn((patch: Record<string, any>) => {
      patches.push(patch);
      state = { ...state, ...patch };
    });
    actions = createChartActions(getState, setState);
  });

  it("setShowCharts patches showCharts", () => {
    actions.setShowCharts(true);
    expect(setState).toHaveBeenCalledWith({ showCharts: true });
  });

  it("setSelectedChartSymbol patches symbol", () => {
    actions.setSelectedChartSymbol("INFY");
    expect(setState).toHaveBeenCalledWith({ selectedChartSymbol: "INFY" });
    actions.setSelectedChartSymbol(null);
    expect(setState).toHaveBeenLastCalledWith({ selectedChartSymbol: null });
  });

  it("setChartDataBatch merges into new Map immutably", () => {
    const origMap = state.chartData;
    actions.setChartDataBatch({ B: { symbol: "B" } as any, C: { symbol: "C" } as any });
    expect(setState).toHaveBeenCalledWith(expect.objectContaining({ chartLoading: false }));
    const newMap = patches[0].chartData as Map<string, any>;
    expect(newMap).not.toBe(origMap);
    expect(newMap.get("A")).toBeTruthy();
    expect(newMap.get("B").symbol).toBe("B");
    expect(origMap.has("B")).toBe(false);
  });

  it("setChartData sets tradeHistory via chartTradesToTrades when trades exist", () => {
    const data = { symbol: "INFY", trades: [{ trade_id: 1, trade: { net_pnl: 100 } }] } as any;
    actions.setChartData("INFY", data);
    expect(mockedChartTradesToTrades).toHaveBeenCalledWith(data.trades);
    expect(patches[0].tradeHistory).toEqual([{ id: 1, net_pnl: 100 }]);
    expect(patches[0].tradeHistorySymbol).toBe("INFY");
    expect(patches[0].chartData).toBeInstanceOf(Map);
    expect(state.chartData.has("INFY")).toBe(true);
  });

  it("setChartData keeps previous tradeHistory when trades empty", () => {
    state.tradeHistory = [{ id: 1 }];
    state.tradeHistorySymbol = "OLD";
    const data = { symbol: "INFY", trades: [] } as any;
    actions.setChartData("INFY", data);
    expect(patches[0].tradeHistory).toEqual([{ id: 1 }]);
    expect(patches[0].tradeHistorySymbol).toBe("OLD");
    expect(mockedChartTradesToTrades).not.toHaveBeenCalled();
  });

  it("setChartLoading patches loading flag", () => {
    actions.setChartLoading(true);
    expect(setState).toHaveBeenCalledWith({ chartLoading: true });
    actions.setChartLoading(false);
    expect(setState).toHaveBeenLastCalledWith({ chartLoading: false });
  });

  it("setChartOptions merges partially and immutably", () => {
    const origOptions = state.chartOptions;
    actions.setChartOptions({ show_orb_zones: false });
    expect(patches[0].chartOptions).toEqual(expect.objectContaining({ show_orb_zones: false, show_entry_markers: true }));
    expect(patches[0].chartOptions).not.toBe(origOptions);
    expect(origOptions.show_orb_zones).toBe(true);
  });

  it("does not mutate original chartData Map", () => {
    const before = new Map(state.chartData);
    actions.setChartDataBatch({ X: { symbol: "X" } as any });
    expect(before.has("X")).toBe(false);
    expect(state.chartData.has("X")).toBe(true);
  });
});
