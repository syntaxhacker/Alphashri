// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useReplayState } from "./useReplayState";
import * as rs from "../state/replay";
import { fetchReplaySymbols } from "../api/replay";

vi.mock("../state/replay", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof rs;
  return {
    ...actual,
    subscribeToReplay: vi.fn(() => vi.fn()),
  };
});

vi.mock("../api/replay", () => ({
  runReplay: vi.fn(),
  fetchReplaySymbols: vi.fn(),
}));

vi.mock("./useStoreSubscription", () => ({
  useStoreSubscription: vi.fn(),
}));

describe("useReplayState", () => {
  const mockState = {
    config: { date: "", strategy: "ALL", symbols: null, refresh_cache: false, bot_uuid: "" },
    isRunning: false,
    progress: null,
    trades: [],
    openPositions: [],
    orLevels: [],
    pivotLevels: [],
    high52wLevels: [],
    emaData: {},
    summary: null,
    candlesBySymbol: {},
    selectedSymbol: "",
    strategyFilter: "ALL",
    error: null,
    totalCandles: 0,
    totalSymbols: 0,
    chartOptions: {
      show_orb_zones: false,
      show_pivot_levels: false,
      show_52w_high: false,
      show_ema: false,
      show_markers: false,
      show_all_trades: false,
    },
    highlightedTradeId: null,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/replay");
  });

  it("returns combined state and actions", async () => {
    const { result } = renderHook(() => useReplayState());

    expect(result.current).toHaveProperty("config");
    expect(result.current).toHaveProperty("isRunning");
    expect(result.current).toHaveProperty("setConfig");
    expect(result.current).toHaveProperty("startReplay");
    expect(result.current).toHaveProperty("stopReplay");
    expect(result.current).toHaveProperty("reset");
    expect(result.current).toHaveProperty("setSelectedSymbol");
    expect(result.current).toHaveProperty("setStrategyFilter");
    expect(result.current).toHaveProperty("setChartOptions");
    expect(result.current).toHaveProperty("setHighlightedTrade");
    expect(result.current).toHaveProperty("loadSymbols");
  });

  describe("loadSymbols", () => {
    it("returns symbol list from API", async () => {
      vi.mocked(fetchReplaySymbols).mockResolvedValue(["TCS", "INFY"]);

      const { result } = renderHook(() => useReplayState());

      const symbols = await result.current.loadSymbols();

      expect(symbols).toEqual(["TCS", "INFY"]);
      expect(fetchReplaySymbols).toHaveBeenCalled();
    });

    it("propagates API errors", async () => {
      vi.mocked(fetchReplaySymbols).mockRejectedValue(new Error("Network error"));

      const { result } = renderHook(() => useReplayState());

      await expect(result.current.loadSymbols()).rejects.toThrow("Network error");
    });
  });

  describe("stopReplay and reset", () => {
    it("stopReplay calls rs.stopRunning", () => {
      const mockStopRunning = vi.spyOn(rs, "stopRunning");

      const { result } = renderHook(() => useReplayState());

      act(() => {
        result.current.stopReplay();
      });

      expect(mockStopRunning).toHaveBeenCalled();
    });

    it("reset calls rs.reset", () => {
      const mockReset = vi.spyOn(rs, "reset");

      const { result } = renderHook(() => useReplayState());

      act(() => {
        result.current.reset();
      });

      expect(mockReset).toHaveBeenCalled();
    });
  });

  describe("mount and unmount", () => {
    it("subscribes on mount via useStoreSubscription", async () => {
      const { useStoreSubscription } = await import("./useStoreSubscription");
      const mockUseStoreSubscription = vi.fn().mockReturnValue(() => {});
      vi.mocked(useStoreSubscription).mockImplementation(mockUseStoreSubscription);

      renderHook(() => useReplayState());

      expect(mockUseStoreSubscription).toHaveBeenCalled();
    });

    it("cleans up subscription on unmount", () => {
      const { unmount } = renderHook(() => useReplayState());

      expect(() => unmount()).not.toThrow();
    });
  });
});
