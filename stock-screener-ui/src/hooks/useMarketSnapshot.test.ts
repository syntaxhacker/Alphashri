// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useMarketSnapshot } from "./useMarketSnapshot";
import { fetchMarketSnapshot } from "../api/marketScreener";
import type { MarketSnapshot, MarketUniverse } from "../types/marketScreener";

vi.mock("../api/marketScreener", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/marketScreener")>();
  return {
    ...actual,
    fetchMarketSnapshot: vi.fn(),
  };
});

const mockFetchMarketSnapshot = vi.mocked(fetchMarketSnapshot);

function makeSnapshot(overrides: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return {
    asOf: "2026-11-06T15:30:00+05:30",
    universe: "all_equity",
    total: 2,
    updateMode: "streaming",
    rows: [
      {
        symbol: "RELIANCE",
        name: "Reliance Industries",
        sector: "Energy",
        industry: "Oil & Gas",
        exchange: "NSE",
        close: 2946,
        change: 0.82,
        volume: 1234567,
        relativeVolume: 1.4,
        marketCap: 1990000000000,
        marketCapCr: 199000,
        capTier: "large",
        rsi: 61.2,
        adx: 24.1,
        atr: 45,
        sma20: 2880,
        sma50: 2800,
        sma200: 2600,
        perfW: 2.1,
        perf1m: 4.6,
        perf3m: 8.2,
        high52w: 3000,
        low52w: 1800,
        pos52w: 95,
        fno: true,
        etf: false,
      },
      {
        symbol: "NIFTYBEES",
        name: "Nippon India Nifty 50 ETF",
        sector: null,
        industry: null,
        exchange: "NSE",
        close: 265.4,
        change: -0.35,
        volume: 900000,
        relativeVolume: 0.8,
        marketCap: 8000000000,
        marketCapCr: 800,
        capTier: "micro",
        rsi: 48,
        adx: 18,
        atr: 2.1,
        sma20: 262,
        sma50: 258,
        sma200: 240,
        perfW: 0.5,
        perf1m: 1.2,
        perf3m: 3.4,
        high52w: 270,
        low52w: 225,
        pos52w: 89,
        fno: false,
        etf: true,
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
});

describe("useMarketSnapshot", () => {
  test("loads the snapshot and exposes rows, totals and mode", async () => {
    mockFetchMarketSnapshot.mockResolvedValue(makeSnapshot());
    const { result } = renderHook(() => useMarketSnapshot("all_equity"));
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.rows).toHaveLength(2);
    expect(result.current.total).toBe(2);
    expect(result.current.updateMode).toBe("streaming");
    expect(result.current.asOf).toBe("2026-11-06T15:30:00+05:30");
    expect(mockFetchMarketSnapshot).toHaveBeenCalledWith(
      { universe: "all_equity", force: false },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  test("passes force through to the api call", async () => {
    mockFetchMarketSnapshot.mockResolvedValue(makeSnapshot());
    renderHook(() => useMarketSnapshot("nifty50", { force: true }));
    await waitFor(() => expect(mockFetchMarketSnapshot).toHaveBeenCalled());
    expect(mockFetchMarketSnapshot).toHaveBeenCalledWith(
      { universe: "nifty50", force: true },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  test("exposes the error state and stops loading on failure", async () => {
    mockFetchMarketSnapshot.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useMarketSnapshot("all_equity"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error?.message).toBe("boom");
    expect(result.current.rows).toEqual([]);
  });

  test("refetches when the universe changes", async () => {
    mockFetchMarketSnapshot.mockResolvedValue(makeSnapshot());
    const { rerender } = renderHook(({ u }: { u: MarketUniverse }) => useMarketSnapshot(u), {
      initialProps: { u: "all_equity" as MarketUniverse },
    });
    await waitFor(() => expect(mockFetchMarketSnapshot).toHaveBeenCalledTimes(1));
    rerender({ u: "nse_fo" });
    await waitFor(() => expect(mockFetchMarketSnapshot).toHaveBeenCalledTimes(2));
    expect(mockFetchMarketSnapshot.mock.calls[1][0]).toEqual({
      universe: "nse_fo",
      force: false,
    });
  });

  test("drops the previous universe's rows while the new fetch is in flight", async () => {
    mockFetchMarketSnapshot.mockResolvedValueOnce(makeSnapshot());
    const { result, rerender } = renderHook(({ u }: { u: MarketUniverse }) => useMarketSnapshot(u), {
      initialProps: { u: "all_equity" as MarketUniverse },
    });
    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    let resolveSecond!: (value: MarketSnapshot) => void;
    mockFetchMarketSnapshot.mockReturnValueOnce(
      new Promise((res) => {
        resolveSecond = res;
      }),
    );
    rerender({ u: "nse_fo" });
    await waitFor(() => expect(result.current.rows).toHaveLength(0));
    expect(result.current.isLoading).toBe(true);
    resolveSecond(makeSnapshot({ universe: "nse_fo" }));
    await waitFor(() => expect(result.current.rows).toHaveLength(2));
  });

  test("aborts the in-flight request on unmount", async () => {
    mockFetchMarketSnapshot.mockReturnValue(new Promise(() => {}));
    const { unmount } = renderHook(() => useMarketSnapshot("all_equity"));
    await waitFor(() => expect(mockFetchMarketSnapshot).toHaveBeenCalledTimes(1));
    const signal = mockFetchMarketSnapshot.mock.calls[0][1]?.signal as AbortSignal;
    unmount();
    expect(signal.aborted).toBe(true);
  });

  test("refresh() refetches immediately", async () => {
    mockFetchMarketSnapshot.mockResolvedValue(makeSnapshot());
    const { result } = renderHook(() => useMarketSnapshot("nifty500"));
    await waitFor(() => expect(mockFetchMarketSnapshot).toHaveBeenCalledTimes(1));
    mockFetchMarketSnapshot.mockResolvedValue(makeSnapshot({ total: 9 }));
    act(() => {
      result.current.refresh();
    });
    await waitFor(() => expect(mockFetchMarketSnapshot).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.total).toBe(9));
  });

  test("ignores a stale response that resolves after a newer universe fetch", async () => {
    let resolveFirst!: (value: MarketSnapshot) => void;
    const first = new Promise<MarketSnapshot>((res) => {
      resolveFirst = res;
    });
    mockFetchMarketSnapshot.mockReturnValueOnce(first);
    mockFetchMarketSnapshot.mockResolvedValue(makeSnapshot({ universe: "nse_fo", total: 7 }));
    const { result, rerender } = renderHook(
      ({ u }: { u: MarketUniverse }) => useMarketSnapshot(u),
      { initialProps: { u: "all_equity" as MarketUniverse } },
    );
    await waitFor(() => expect(mockFetchMarketSnapshot).toHaveBeenCalledTimes(1));
    rerender({ u: "nse_fo" });
    await waitFor(() => expect(result.current.total).toBe(7));
    resolveFirst(makeSnapshot({ universe: "all_equity", total: 999 }));
    await waitFor(() => expect(result.current.total).toBe(7));
  });

  test("hydrates rows from the sessionStorage cache synchronously on mount", () => {
    window.sessionStorage.setItem(
      "alphashri.market_snapshot.v1.all_equity",
      JSON.stringify(makeSnapshot({ total: 3 })),
    );
    mockFetchMarketSnapshot.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useMarketSnapshot("all_equity"));
    expect(result.current.rows).toHaveLength(2);
    expect(result.current.total).toBe(3);
    expect(result.current.stale).toBe(true);
    expect(result.current.isLoading).toBe(true);
  });

  test("hydrates from a different universe's cache on switch, instantly dropping the skeleton", async () => {
    mockFetchMarketSnapshot.mockResolvedValue(makeSnapshot({ universe: "all_equity" }));
    window.sessionStorage.setItem(
      "alphashri.market_snapshot.v1.nse_fo",
      JSON.stringify(makeSnapshot({ universe: "nse_fo", total: 42 })),
    );
    const { result, rerender } = renderHook(({ u }: { u: MarketUniverse }) => useMarketSnapshot(u), {
      initialProps: { u: "all_equity" as MarketUniverse },
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    mockFetchMarketSnapshot.mockReturnValue(new Promise(() => {}));
    rerender({ u: "nse_fo" });
    expect(result.current.total).toBe(42);
    expect(result.current.rows).toHaveLength(2);
    expect(result.current.stale).toBe(true);
  });

  test("ignores malformed cached data and falls back to the skeleton", () => {
    window.sessionStorage.setItem("alphashri.market_snapshot.v1.all_equity", "{not json");
    mockFetchMarketSnapshot.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useMarketSnapshot("all_equity"));
    expect(result.current.rows).toHaveLength(0);
    expect(result.current.stale).toBe(false);
    expect(result.current.isLoading).toBe(true);
  });

  test("stale cache is discarded when its rows fail shape validation", () => {
    window.sessionStorage.setItem(
      "alphashri.market_snapshot.v1.all_equity",
      JSON.stringify({ ...makeSnapshot(), rows: [{ name: "no symbol" }] }),
    );
    mockFetchMarketSnapshot.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useMarketSnapshot("all_equity"));
    expect(result.current.rows).toHaveLength(0);
    expect(window.sessionStorage.getItem("alphashri.market_snapshot.v1.all_equity")).toBeNull();
  });

  test("fresh fetch replaces the cache and clears the stale flag", async () => {
    window.sessionStorage.setItem(
      "alphashri.market_snapshot.v1.all_equity",
      JSON.stringify(makeSnapshot({ total: 3 })),
    );
    mockFetchMarketSnapshot.mockResolvedValue(makeSnapshot({ total: 9 }));
    const { result } = renderHook(() => useMarketSnapshot("all_equity"));
    expect(result.current.stale).toBe(true);
    await waitFor(() => expect(result.current.stale).toBe(false));
    expect(result.current.total).toBe(9);
    expect(result.current.isLoading).toBe(false);
    const cached = window.sessionStorage.getItem("alphashri.market_snapshot.v1.all_equity");
    expect(cached).not.toBeNull();
    expect(JSON.parse(cached as string).total).toBe(9);
  });

  test("timeout aborts the fetch after 15s and sets a clear error", async () => {
    vi.useFakeTimers();
    try {
      mockFetchMarketSnapshot.mockReturnValue(new Promise(() => {}));
      const { result } = renderHook(() => useMarketSnapshot("all_equity"));
      expect(result.current.isLoading).toBe(true);
      await act(async () => {
        vi.advanceTimersByTime(15_000);
      });
      expect(result.current.error?.message).toBe("Market snapshot timed out");
      expect(result.current.isLoading).toBe(false);
      expect(result.current.warming).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  test("does not timeout before 15s — error stays null while pending", async () => {
    vi.useFakeTimers();
    try {
      mockFetchMarketSnapshot.mockReturnValue(new Promise(() => {}));
      const { result } = renderHook(() => useMarketSnapshot("nifty500"));
      await act(async () => {
        vi.advanceTimersByTime(14_999);
      });
      expect(result.current.error).toBeNull();
      expect(result.current.isLoading).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  test("warming flag flips on after 4s of loading and clears when the fetch lands", async () => {
    vi.useFakeTimers();
    try {
      let resolveFetch!: (value: MarketSnapshot) => void;
      mockFetchMarketSnapshot.mockReturnValue(
        new Promise<MarketSnapshot>((res) => {
          resolveFetch = res;
        }),
      );
      const { result } = renderHook(() => useMarketSnapshot("all_equity"));
      expect(result.current.warming).toBe(false);
      await act(async () => {
        vi.advanceTimersByTime(4_000);
      });
      expect(result.current.warming).toBe(true);
      await act(async () => {
        resolveFetch(makeSnapshot());
        await Promise.resolve();
      });
      expect(result.current.warming).toBe(false);
      expect(result.current.isLoading).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  test("warming never flips on when the fetch resolves before 4s", async () => {
    vi.useFakeTimers();
    try {
      mockFetchMarketSnapshot.mockResolvedValue(makeSnapshot());
      const { result } = renderHook(() => useMarketSnapshot("all_equity"));
      await act(async () => {
        await Promise.resolve();
      });
      await act(async () => {
        vi.advanceTimersByTime(10_000);
      });
      expect(result.current.warming).toBe(false);
      expect(result.current.isLoading).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
