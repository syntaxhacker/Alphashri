// @vitest-environment happy-dom
import { describe, test, vi, beforeEach, expect } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useReplayState } from "./useReplayState";
import * as rs from "../state/replay";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const {
  capturedOnEvent,
  capturedOnError,
  capturedOnComplete,
  mockRunReplay,
  mockFetchSymbols,
  mockSaveConfig,
} = vi.hoisted(() => {
  const capturedOnEvent: { current: ((event: any) => void) | null } = {
    current: null,
  };
  const capturedOnError: { current: ((error: Error) => void) | null } = {
    current: null,
  };
  const capturedOnComplete: { current: (() => void) | null } = {
    current: null,
  };
  return {
    capturedOnEvent,
    capturedOnError,
    capturedOnComplete,
    mockRunReplay: vi.fn(
      (
        _config: any,
        onEvent: any,
        onError: any,
        onComplete: any,
      ) => {
        capturedOnEvent.current = onEvent;
        capturedOnError.current = onError;
        capturedOnComplete.current = onComplete;
        return vi.fn();
      },
    ),
    mockFetchSymbols: vi.fn(() => Promise.resolve([])),
    mockSaveConfig: vi.fn(() => Promise.resolve()),
  };
});

vi.mock("../state/replay", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof rs;
  const subscribeMock = vi.fn((callback: () => void) => {
    const realUnsubscribe = actual.subscribeToReplay(callback);
    return vi.fn(() => realUnsubscribe());
  });
  return {
    ...actual,
    subscribeToReplay: subscribeMock,
  };
});

vi.mock("../api/replay", () => ({
  runReplay: mockRunReplay,
  fetchReplaySymbols: mockFetchSymbols,
  saveReplayConfig: mockSaveConfig,
}));

function setWindowURL(urlStr: string) {
  window.history.pushState({}, "", urlStr);
}

describe("useReplayState", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    rs.reset();
    setWindowURL("/replay");
    capturedOnEvent.current = null;
    capturedOnError.current = null;
    capturedOnComplete.current = null;
  });

  test("returns combined state and actions", () => {
    const { result } = renderHook(() => useReplayState());
    expect(result.current).toHaveProperty("config");
    expect(result.current).toHaveProperty("setConfig");
    expect(result.current).toHaveProperty("startReplay");
    expect(result.current).toHaveProperty("stopReplay");
    expect(result.current).toHaveProperty("reset");
    expect(result.current).toHaveProperty("setSelectedSymbol");
    expect(result.current).toHaveProperty("setStrategyFilter");
    expect(result.current).toHaveProperty("loadSymbols");
    expect(result.current).toHaveProperty("setChartOptions");
    expect(result.current).toHaveProperty("setHighlightedTrade");
    expect(typeof result.current.setConfig).toBe("function");
    expect(typeof result.current.startReplay).toBe("function");
    expect(typeof result.current.loadSymbols).toBe("function");
  });

  describe("state subscription", () => {
    test("subscribes to replay state on mount", () => {
      renderHook(() => useReplayState());
      expect(rs.subscribeToReplay).toHaveBeenCalledTimes(1);
    });

    test("unsubscribes on unmount", () => {
      const { unmount } = renderHook(() => useReplayState());
      const subscribeMock = vi.mocked(rs.subscribeToReplay);
      const unsubscribeFn = subscribeMock.mock.results[0].value;
      unmount();
      expect(unsubscribeFn).toHaveBeenCalled();
    });
  });

  describe("URL sync - init", () => {
    test("reads config from URL search params on mount", () => {
      setWindowURL("/replay?date=2024-01-15&strategy=SR_BREAKOUT");
      const { result } = renderHook(() => useReplayState());
      expect(result.current.config.date).toBe("2024-01-15");
      expect(result.current.config.strategy).toBe("SR_BREAKOUT");
    });

    test("empty URL params does not override config", () => {
      rs.setConfig({ date: "2024-01-15", strategy: "SR_BREAKOUT" });
      const { result } = renderHook(() => useReplayState());
      expect(result.current.config.date).toBe("2024-01-15");
      expect(result.current.config.strategy).toBe("SR_BREAKOUT");
    });

    test("partial URL params sets only those fields", () => {
      setWindowURL("/replay?date=2024-06-01");
      const { result } = renderHook(() => useReplayState());
      expect(result.current.config.date).toBe("2024-06-01");
      expect(result.current.config.end_date).toBe("");
      expect(result.current.config.strategy).toBe("ALL");
    });
  });

  describe("URL sync - config changes", () => {
    test("updates URL when config changes", () => {
      const replaceStateSpy = vi.spyOn(window.history, "replaceState");
      renderHook(() => useReplayState());

      act(() => {
        rs.setConfig({ date: "2024-01-15", strategy: "SR_BREAKOUT" });
      });

      expect(replaceStateSpy).toHaveBeenCalledWith(
        null,
        "",
        "/replay?date=2024-01-15&strategy=SR_BREAKOUT",
      );
    });

    test("does not duplicate URL on unchanged values", () => {
      setWindowURL("/replay?date=2024-01-15");
      rs.setConfig({ date: "2024-01-15" });

      const replaceStateSpy = vi.spyOn(window.history, "replaceState");
      renderHook(() => useReplayState());

      replaceStateSpy.mockClear();

      rs.setConfig({ date: "2024-01-15" });

      expect(replaceStateSpy).not.toHaveBeenCalled();
    });
  });

  describe("setConfig", () => {
    test("updates config via rs.setConfig", () => {
      const { result } = renderHook(() => useReplayState());
      act(() => {
        result.current.setConfig({ date: "2024-03-15" });
      });
      expect(result.current.config.date).toBe("2024-03-15");
    });

    test("merges with existing config", () => {
      setWindowURL("/replay?date=2024-01-15&symbols=RELIANCE,TCS");
      const { result } = renderHook(() => useReplayState());

      expect(result.current.config.date).toBe("2024-01-15");
      expect(result.current.config.end_date).toBe("");

      act(() => {
        result.current.setConfig({ end_date: "2024-01-20" });
      });

      expect(result.current.config.date).toBe("2024-01-15");
      expect(result.current.config.end_date).toBe("2024-01-20");
      expect(result.current.config.symbols).toEqual(["RELIANCE", "TCS"]);
    });
  });

  describe("startReplay", () => {
    beforeEach(() => {
      rs.setConfig({
        date: "2024-01-15",
        symbols: ["RELIANCE"],
      });
    });

    test("calls rs.startRunning", async () => {
      const { result } = renderHook(() => useReplayState());
      expect(result.current.isRunning).toBe(false);

      await act(async () => {
        result.current.startReplay();
      });

      expect(result.current.isRunning).toBe(true);
    });

    test("calls saveReplayConfig with auto-name", async () => {
      const { result } = renderHook(() => useReplayState());

      await act(async () => {
        result.current.startReplay();
      });

      expect(mockSaveConfig).toHaveBeenCalled();
      const callArgs = mockSaveConfig.mock.calls[0];
      expect(callArgs[0]).toContain("2024-01-15");
      expect(callArgs[0]).toContain("1sym");
      expect(callArgs[1]).toMatchObject({
        date: "2024-01-15",
        symbols: ["RELIANCE"],
      });
    });

    test("calls runReplay with current config", async () => {
      const { result } = renderHook(() => useReplayState());

      await act(async () => {
        result.current.startReplay();
      });

      expect(mockRunReplay).toHaveBeenCalledTimes(1);
      const configArg = mockRunReplay.mock.calls[0][0];
      expect(configArg).toMatchObject({
        date: "2024-01-15",
        symbols: ["RELIANCE"],
      });
    });

    test("processes loaded event -> setTotals", async () => {
      const { result } = renderHook(() => useReplayState());
      await act(async () => {
        result.current.startReplay();
      });

      await act(async () => {
        capturedOnEvent.current!({
          type: "loaded",
          symbols: 5,
          candles: 500,
        });
      });

      expect(result.current.totalSymbols).toBe(5);
      expect(result.current.totalCandles).toBe(500);
    });

    test("processes progress event -> setProgress", async () => {
      const { result } = renderHook(() => useReplayState());
      await act(async () => {
        result.current.startReplay();
      });

      const progressEvent = {
        type: "progress",
        candle: 42,
        total: 500,
        time: "09:45",
        symbol: "RELIANCE",
      };
      await act(async () => {
        capturedOnEvent.current!(progressEvent);
      });

      expect(result.current.progress).toEqual(progressEvent);
    });

    test("processes or_levels event -> addORLevels + auto-select symbol", async () => {
      const { result } = renderHook(() => useReplayState());
      await act(async () => {
        result.current.startReplay();
      });

      const orEvent = {
        type: "or_levels",
        strategy: "ORB",
        symbol: "TCS",
        or_high: 150.5,
        or_low: 149.0,
        or_range_pct: 1.01,
        from_index: 0,
        to_index: 5,
      };
      await act(async () => {
        capturedOnEvent.current!(orEvent);
      });

      expect(result.current.orLevels).toHaveLength(1);
      expect(result.current.orLevels[0].symbol).toBe("TCS");
      expect(result.current.selectedSymbol).toBe("TCS");
    });

    test("processes pivot_levels event with uppercase field normalization", async () => {
      const { result } = renderHook(() => useReplayState());
      await act(async () => {
        result.current.startReplay();
      });

      await act(async () => {
        capturedOnEvent.current!({
          type: "pivot_levels",
          strategy: "SR_BREAKOUT",
          symbol: "RELIANCE",
          PP: 2600,
          R1: 2620,
          S1: 2580,
          R2: 2640,
          S2: 2560,
          from_index: 0,
          to_index: 10,
        });
      });

      expect(result.current.pivotLevels).toHaveLength(1);
      const pl = result.current.pivotLevels[0];
      expect(pl.pp).toBe(2600);
      expect(pl.r1).toBe(2620);
      expect(pl.s1).toBe(2580);
      expect(pl.r2).toBe(2640);
      expect(pl.s2).toBe(2560);
    });

    test("processes 52w_high event -> add52WLevel", async () => {
      const { result } = renderHook(() => useReplayState());
      await act(async () => {
        result.current.startReplay();
      });

      await act(async () => {
        capturedOnEvent.current!({
          type: "52w_high",
          strategy: "WEEK52",
          symbol: "RELIANCE",
          high_52w: 3200,
          low_52w: 2400,
          from_index: 0,
          to_index: 10,
        });
      });

      expect(result.current.high52wLevels).toHaveLength(1);
      expect(result.current.high52wLevels[0].high_52w).toBe(3200);
    });

    test("processes ema_series event -> setEMAData", async () => {
      const { result } = renderHook(() => useReplayState());
      await act(async () => {
        result.current.startReplay();
      });

      const emaEvent = {
        type: "ema_series",
        symbol: "RELIANCE",
        ema_fast_period: 9,
        ema_slow_period: 21,
        timeframes: {
          "1m": { ema_fast: [100, 101], ema_slow: [99, 100] },
        },
      };
      await act(async () => {
        capturedOnEvent.current!(emaEvent);
      });

      expect(result.current.emaData["RELIANCE"]).toBeDefined();
      expect(result.current.emaData["RELIANCE"].ema_fast_period).toBe(9);
    });

    test("processes candles event -> addCandles + auto-select symbol", async () => {
      const { result } = renderHook(() => useReplayState());
      await act(async () => {
        result.current.startReplay();
      });

      const candle = {
        time: "09:30",
        open: 100,
        high: 101,
        low: 99,
        close: 100.5,
        volume: 1000,
      };
      await act(async () => {
        capturedOnEvent.current!({
          type: "candles",
          symbol: "INFY",
          candles: [candle],
        });
      });

      expect(result.current.candlesBySymbol["INFY"]).toHaveLength(1);
      expect(result.current.candlesBySymbol["INFY"][0].open).toBe(100);
      expect(result.current.selectedSymbol).toBe("INFY");
    });

    test("processes trade_open event -> addOpenPosition + auto-select symbol", async () => {
      const { result } = renderHook(() => useReplayState());
      await act(async () => {
        result.current.startReplay();
      });

      await act(async () => {
        capturedOnEvent.current!({
          type: "trade_open",
          strategy: "SR_BREAKOUT",
          symbol: "HDFC",
          side: "LONG",
          price: 1500,
          sl: 1485,
          tp: 1530,
          time: "09:45",
          quantity: 10,
        });
      });

      expect(result.current.openPositions).toHaveLength(1);
      expect(result.current.openPositions[0].symbol).toBe("HDFC");
      expect(result.current.openPositions[0].entry_price).toBe(1500);
      expect(result.current.openPositions[0].side).toBe("LONG");
      expect(result.current.selectedSymbol).toBe("HDFC");
    });

    test("processes trade_close event -> closeOpenPosition + addTrade + setSelectedSymbol", async () => {
      const { result } = renderHook(() => useReplayState());
      await act(async () => {
        result.current.startReplay();
      });

      await act(async () => {
        capturedOnEvent.current!({
          type: "trade_open",
          strategy: "SR_BREAKOUT",
          symbol: "HDFC",
          side: "LONG",
          price: 1500,
          sl: 1485,
          tp: 1530,
          time: "09:45",
          quantity: 10,
        });
      });

      expect(result.current.openPositions).toHaveLength(1);

      await act(async () => {
        capturedOnEvent.current!({
          type: "trade_close",
          strategy: "SR_BREAKOUT",
          symbol: "HDFC",
          side: "LONG",
          entry_price: 1500,
          exit_price: 1530,
          reason: "TP hit",
          pnl: 300,
          net_pnl: 295,
          costs: 5,
          entry_time: "09:45",
          exit_time: "10:15",
          quantity: 10,
        });
      });

      expect(result.current.openPositions).toHaveLength(0);
      expect(result.current.trades).toHaveLength(1);
      expect(result.current.trades[0].exit_reason).toBe("TP hit");
      expect(result.current.trades[0].pnl).toBe(300);
      expect(result.current.selectedSymbol).toBe("HDFC");
    });

    test("processes summary event -> setSummary", async () => {
      const { result } = renderHook(() => useReplayState());
      await act(async () => {
        result.current.startReplay();
      });

      const summaryEvent = {
        type: "summary",
        total_trades: 10,
        winners: 6,
        losers: 4,
        win_rate: 60,
        profit_factor: 1.5,
        gross_pnl: 5000,
        total_costs: 100,
        net_pnl: 4900,
        strategy_breakdown: {
          SR_BREAKOUT: {
            trades: 10,
            win_rate: 60,
            net_pnl: 4900,
            profit_factor: 1.5,
          },
        },
      };
      await act(async () => {
        capturedOnEvent.current!(summaryEvent);
      });

      expect(result.current.summary).toBeDefined();
      expect(result.current.summary!.total_trades).toBe(10);
      expect(result.current.summary!.net_pnl).toBe(4900);
    });

    test("processes error event -> setError", async () => {
      const { result } = renderHook(() => useReplayState());
      await act(async () => {
        result.current.startReplay();
      });

      await act(async () => {
        capturedOnEvent.current!({
          type: "error",
          message: "Something went wrong",
        });
      });

      expect(result.current.error).toBe("Something went wrong");
      expect(result.current.isRunning).toBe(false);
    });

    test("processes done event -> stopRunning", async () => {
      const { result } = renderHook(() => useReplayState());
      await act(async () => {
        result.current.startReplay();
      });

      expect(result.current.isRunning).toBe(true);

      await act(async () => {
        capturedOnEvent.current!({
          type: "done",
          success: true,
          duration_ms: 5000,
        });
      });

      expect(result.current.isRunning).toBe(false);
    });

    test("handles runReplay error callback -> setError", async () => {
      const { result } = renderHook(() => useReplayState());
      await act(async () => {
        result.current.startReplay();
      });

      await act(async () => {
        capturedOnError.current!(new Error("Run failed"));
      });

      expect(result.current.error).toBe("Run failed");
      expect(result.current.isRunning).toBe(false);
    });

    test("handles runReplay complete callback -> stopRunning", async () => {
      const { result } = renderHook(() => useReplayState());
      await act(async () => {
        result.current.startReplay();
      });

      expect(result.current.isRunning).toBe(true);

      await act(async () => {
        capturedOnComplete.current!();
      });

      expect(result.current.isRunning).toBe(false);
    });
  });

  describe("stopReplay", () => {
    test("calls rs.stopRunning", () => {
      const { result } = renderHook(() => useReplayState());
      act(() => {
        rs.startRunning();
      });

      expect(result.current.isRunning).toBe(true);

      act(() => {
        result.current.stopReplay();
      });

      expect(result.current.isRunning).toBe(false);
    });
  });

  describe("reset", () => {
    test("calls rs.reset", () => {
      rs.setConfig({ date: "2024-01-15" });
      const { result } = renderHook(() => useReplayState());

      expect(result.current.config.date).toBe("2024-01-15");

      act(() => {
        result.current.reset();
      });

      expect(result.current.config.date).toBe("");
      expect(result.current.config.strategy).toBe("ALL");
    });
  });

  describe("loadSymbols", () => {
    test("fetches symbols via fetchReplaySymbols", async () => {
      mockFetchSymbols.mockResolvedValue(["SYM1", "SYM2", "SYM3"]);
      const { result } = renderHook(() => useReplayState());

      const symbols = await result.current.loadSymbols();

      expect(mockFetchSymbols).toHaveBeenCalledTimes(1);
      expect(symbols).toEqual(["SYM1", "SYM2", "SYM3"]);
    });

    test("returns fetched symbols array", async () => {
      mockFetchSymbols.mockResolvedValue(["ABC", "XYZ"]);
      const { result } = renderHook(() => useReplayState());

      const symbols = await result.current.loadSymbols();

      expect(Array.isArray(symbols)).toBe(true);
      expect(symbols).toHaveLength(2);
    });
  });

  describe("setSelectedSymbol / setStrategyFilter", () => {
    test("delegates to rs.setSelectedSymbol / rs.setStrategyFilter", () => {
      const { result } = renderHook(() => useReplayState());

      act(() => {
        result.current.setSelectedSymbol("TCS");
      });
      expect(result.current.selectedSymbol).toBe("TCS");

      act(() => {
        result.current.setStrategyFilter("SR_BREAKOUT");
      });
      expect(result.current.strategyFilter).toBe("SR_BREAKOUT");
    });
  });

  describe("error state", () => {
    test("error set by runReplay error event", async () => {
      const { result } = renderHook(() => useReplayState());
      await act(async () => {
        result.current.startReplay();
      });

      await act(async () => {
        capturedOnEvent.current!({
          type: "error",
          message: "Data fetch failure",
        });
      });

      expect(result.current.error).toBe("Data fetch failure");
      expect(result.current.isRunning).toBe(false);
    });
  });

  describe("hasActiveRun", () => {
    test("returns true when isRunning and trades exist", async () => {
      const { result } = renderHook(() => useReplayState());

      await act(async () => {
        result.current.startReplay();
      });

      expect(result.current.isRunning).toBe(true);
      expect(result.current.trades.length).toBe(0);
      expect(
        result.current.isRunning && result.current.trades.length > 0,
      ).toBe(false);

      await act(async () => {
        capturedOnEvent.current!({
          type: "trade_close",
          strategy: "SR_BREAKOUT",
          symbol: "RELIANCE",
          side: "LONG",
          entry_price: 2500,
          exit_price: 2550,
          pnl: 50,
          net_pnl: 48,
          costs: 2,
          reason: "TP hit",
          entry_time: "09:30",
          exit_time: "10:00",
          quantity: 1,
        });
      });

      expect(result.current.isRunning).toBe(true);
      expect(result.current.trades.length).toBe(1);
      expect(
        result.current.isRunning && result.current.trades.length > 0,
      ).toBe(true);
    });

    test("returns false when not running", () => {
      const { result } = renderHook(() => useReplayState());

      expect(result.current.isRunning).toBe(false);
      expect(result.current.trades.length).toBe(0);
      expect(
        result.current.isRunning && result.current.trades.length > 0,
      ).toBe(false);
    });
  });
});
