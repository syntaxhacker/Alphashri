// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useScreenerState } from "./useScreenerState";
import * as state from "../state";
import { fetchData, loadScreeners, setupAutoRefresh } from "../api";
import { useStoreSubscription } from "./useStoreSubscription";
import { useNavigate } from "react-router-dom";

// Helper to flush pending promises
const flushPromises = () => new Promise(setImmediate);

// Mock dependencies
vi.mock("../state", () => ({
  ...vi.importActual("../state"),
  screenerOptions: [],
  activeScreener: "52w_high",
  isLoading: false,
  error: null,
  autoRefreshSeconds: 60,
  data: null,
  setActiveScreener: vi.fn(),
  setAutoRefreshSeconds: vi.fn(),
  subscribe: vi.fn(),
}));

vi.mock("../api", () => ({
  fetchData: vi.fn(),
  loadScreeners: vi.fn(() => Promise.resolve()),
  setupAutoRefresh: vi.fn(),
}));

vi.mock("./useStoreSubscription", () => ({
  useStoreSubscription: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: vi.fn(() => vi.fn()),
  useSearchParams: vi.fn(() => [new URLSearchParams(), vi.fn()]),
}));

describe("useScreenerState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useStoreSubscription as any).mockImplementation((_subscribe: any) => {});
  });

  afterEach(() => {
  cleanup();
    vi.clearAllMocks();
  });

  describe("initialization", () => {
    it("loads screeners and fetches data on mount when screenerOptions is empty", async () => {
      // Set state to have empty screenerOptions
      (state as any).screenerOptions = [];

      renderHook(() => useScreenerState());

      expect(loadScreeners).toHaveBeenCalledTimes(1);

      // Wait for loadScreeners promise to resolve and then check fetchData/setupAutoRefresh
      await flushPromises();

      expect(fetchData).toHaveBeenCalledWith("upstox", "intraday", "52w_high");
      expect(setupAutoRefresh).toHaveBeenCalledTimes(1);
    });

    it("fetches data on mount when screenerOptions already exist", () => {
      (state as any).screenerOptions = [{ id: "trending", label: "Trending" }];

      renderHook(() => useScreenerState());

      expect(loadScreeners).not.toHaveBeenCalled();
      expect(fetchData).toHaveBeenCalledWith("upstox", "intraday", "52w_high");
      expect(setupAutoRefresh).toHaveBeenCalledTimes(1);
    });

    it("uses provider and mode from state.data when available", () => {
      (state as any).data = { provider: "indmoney", mode: "historical" };
      (state as any).screenerOptions = [{ id: "trending", label: "Trending" }];

      renderHook(() => useScreenerState());

      expect(fetchData).toHaveBeenCalledWith("indmoney", "historical", "52w_high");
    });

    it("falls back to defaults when state.data is null", () => {
      (state as any).data = null;
      (state as any).screenerOptions = [{ id: "trending", label: "Trending" }];

      renderHook(() => useScreenerState());

      expect(fetchData).toHaveBeenCalledWith("upstox", "intraday", "52w_high");
    });
  });

  describe("derived state", () => {
    it("returns approachingStocks from state.data?.approaching", () => {
      const mockApproaching = [{ symbol: "RELIANCE" }, { symbol: "TCS" }];
      (state as any).data = { approaching: mockApproaching, touched: [] };

      const { result } = renderHook(() => useScreenerState());

      expect(result.current.approachingStocks).toEqual(mockApproaching);
    });

    it("returns touchedStocks from state.data?.touched", () => {
      const mockTouched = [{ symbol: "INFY", touched_52w: true }];
      (state as any).data = { approaching: [], touched: mockTouched };

      const { result } = renderHook(() => useScreenerState());

      expect(result.current.touchedStocks).toEqual(mockTouched);
    });

    it("returns empty arrays when state.data is null", () => {
      (state as any).data = null;

      const { result } = renderHook(() => useScreenerState());

      expect(result.current.approachingStocks).toEqual([]);
      expect(result.current.touchedStocks).toEqual([]);
    });

    it("returns screenerOptions from state", () => {
      const options = [{ id: "trending", label: "Trending" }];
      (state as any).screenerOptions = options;

      const { result } = renderHook(() => useScreenerState());

      expect(result.current.screenerOptions).toEqual(options);
    });

    it("returns activeScreener from state", () => {
      (state as any).activeScreener = "buyer_interest_enhanced";

      const { result } = renderHook(() => useScreenerState());

      expect(result.current.activeScreener).toBe("buyer_interest_enhanced");
    });

    it("returns isLoading from state", () => {
      (state as any).isLoading = true;

      const { result } = renderHook(() => useScreenerState());

      expect(result.current.isLoading).toBe(true);
    });

    it("returns error from state", () => {
      (state as any).error = "Failed to load";

      const { result } = renderHook(() => useScreenerState());

      expect(result.current.error).toBe("Failed to load");
    });

    it("returns autoRefreshSeconds from state", () => {
      (state as any).autoRefreshSeconds = 120;

      const { result } = renderHook(() => useScreenerState());

      expect(result.current.autoRefreshSeconds).toBe(120);
    });

    it("returns provider from state.data or defaults to upstox", () => {
      (state as any).data = { provider: "indmoney" };

      const { result } = renderHook(() => useScreenerState());

      expect(result.current.provider).toBe("indmoney");
    });

    it("returns mode from state.data or defaults to intraday", () => {
      (state as any).data = { mode: "historical" };

      const { result } = renderHook(() => useScreenerState());

      expect(result.current.mode).toBe("historical");
    });
  });

  describe("actions", () => {
    beforeEach(() => {
      (state as any).data = { provider: "upstox", mode: "intraday" };
    });

    it("onRefresh calls fetchData with current provider, mode, and activeScreener", () => {
      (state as any).activeScreener = "trending";
      const { result } = renderHook(() => useScreenerState());

      act(() => {
        result.current.onRefresh();
      });

      expect(fetchData).toHaveBeenCalledWith("upstox", "intraday", "trending");
    });

    it("onAutoRefreshChange calls setAutoRefreshSeconds and setupAutoRefresh", () => {
      const { result } = renderHook(() => useScreenerState());

      // Clear mount call to test only the action
      vi.clearAllMocks();

      act(() => {
        result.current.onAutoRefreshChange(180);
      });

      expect(state.setAutoRefreshSeconds).toHaveBeenCalledWith(180);
      expect(setupAutoRefresh).toHaveBeenCalledTimes(1);
    });

    it("onProviderChange fetches data with new provider", () => {
      (state as any).activeScreener = "trending";
      const { result } = renderHook(() => useScreenerState());

      act(() => {
        result.current.onProviderChange("indmoney");
      });

      expect(fetchData).toHaveBeenCalledWith("indmoney", "intraday", "trending");
    });

    it("onModeChange fetches data with new mode", () => {
      (state as any).activeScreener = "trending";
      const { result } = renderHook(() => useScreenerState());

      act(() => {
        result.current.onModeChange("historical");
      });

      expect(fetchData).toHaveBeenCalledWith("upstox", "historical", "trending");
    });

    it("onScreenerChange sets active screener and fetches data", () => {
      (state as any).activeScreener = "trending";
      const { result } = renderHook(() => useScreenerState());

      act(() => {
        result.current.onScreenerChange("rsi_reversal");
      });

      expect(state.setActiveScreener).toHaveBeenCalledWith("rsi_reversal");
      expect(fetchData).toHaveBeenCalledWith("upstox", "intraday", "rsi_reversal");
    });

    it("onSymbolClick navigates to chart page", () => {
      const mockNavigate = vi.fn();
      (useNavigate as any).mockReturnValue(mockNavigate);

      const { result } = renderHook(() => useScreenerState());

      act(() => {
        result.current.onSymbolClick("RELIANCE");
      });

      expect(mockNavigate).toHaveBeenCalledWith("/chart/RELIANCE");
    });

    it("onSymbolHover is a no-op placeholder", () => {
      const { result } = renderHook(() => useScreenerState());

      // Should not throw
      act(() => {
        result.current.onSymbolHover("RELIANCE");
      });

      act(() => {
        result.current.onSymbolHover(null);
      });

      // No assertions needed - just verify it doesn't error
    });
  });

  describe("edge cases", () => {
    it("handles missing data gracefully with defaults", () => {
      (state as any).data = undefined;
      (state as any).screenerOptions = [];

      const { result } = renderHook(() => useScreenerState());

      expect(result.current.provider).toBe("upstox");
      expect(result.current.mode).toBe("intraday");
      expect(result.current.approachingStocks).toEqual([]);
      expect(result.current.touchedStocks).toEqual([]);
    });

    it("handles undefined approaching/touched in data", () => {
      (state as any).data = { approaching: undefined, touched: undefined };
      (state as any).screenerOptions = [];

      const { result } = renderHook(() => useScreenerState());

      expect(result.current.approachingStocks).toEqual([]);
      expect(result.current.touchedStocks).toEqual([]);
    });
  });
});
