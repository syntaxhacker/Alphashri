// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ChartPayload, PatternHitDTO } from "@/types/chartPatterns";
import { useSymbolPatternChart } from "./useSymbolPatternChart";
import { fetchSymbolChart } from "@/api/chartPatterns";

vi.mock("@/api/chartPatterns", () => ({
  fetchSymbolChart: vi.fn(),
}));

const HIT = (symbol: string, endDate: string, id: number): PatternHitDTO =>
  ({
    id,
    symbol,
    name: null,
    timeframe: "1D",
    pattern_id: "falling_wedge",
    pattern_name: "Falling Wedge",
    family: "reversal",
    direction: "bullish",
    status: "confirmed",
    quality: "strong",
    confidence: 70,
    start_date: "2026-04-26",
    end_date: endDate,
    start_price: 100,
    end_price: 110,
    breakout_level: 110,
    target: 120,
    stop: 95,
    rr: 2,
    bars_ago: 1,
    volume_confirmed: true,
    trendlines: [],
    notes: "",
  }) as PatternHitDTO;

function payload(symbol: string, hits: PatternHitDTO[]): ChartPayload {
  return {
    symbol,
    timeframe: "1D",
    candles: [{ t: "2026-09-26T00:00:00+05:30", o: 100, h: 110, l: 99, c: 108, v: 1000 }],
    overlays: [],
    trend_lines: [],
    hits,
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("useSymbolPatternChart", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it("loads the chart with live detection and promotes the newest hit", async () => {
    vi.mocked(fetchSymbolChart).mockResolvedValue(
      payload("TEST", [HIT("TEST", "2026-09-20", 1), HIT("TEST", "2026-09-26", 2)]),
    );

    const { result } = renderHook(() =>
      useSymbolPatternChart({ symbol: "TEST", timeframe: "1D" }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetchSymbolChart).toHaveBeenCalledWith("TEST", "1D", {
      detectPatterns: true,
      computeTrendlines: true,
    });
    expect(result.current.hits).toHaveLength(2);
    // Newest end_date wins.
    expect(result.current.hit?.id).toBe(2);
    expect(result.current.candles).toHaveLength(1);
  });

  it("passes the as-of replay window through to the API", async () => {
    vi.mocked(fetchSymbolChart).mockResolvedValue(payload("TEST", []));

    const { result } = renderHook(() =>
      useSymbolPatternChart({
        symbol: "TEST",
        timeframe: "1D",
        asOf: "2026-09-20T15:30",
        fromDate: "2026-08-01T00:00",
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchSymbolChart).toHaveBeenCalledWith(
      "TEST",
      "1D",
      expect.objectContaining({
        asOf: "2026-09-20T15:30",
        fromDate: "2026-08-01T00:00",
      }),
    );
  });

  it("discards a stale response when the symbol changes mid-flight", async () => {
    const first = deferred<ChartPayload>();
    const second = deferred<ChartPayload>();
    vi.mocked(fetchSymbolChart)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const { result, rerender } = renderHook(
      ({ symbol }: { symbol: string }) =>
        useSymbolPatternChart({ symbol, timeframe: "1D" }),
      { initialProps: { symbol: "AAA" } },
    );

    rerender({ symbol: "BBB" });

    // Resolve the NEW symbol first, then the stale one.
    await act(async () => {
      second.resolve(payload("BBB", [HIT("BBB", "2026-09-26", 22)]));
      await Promise.resolve();
    });
    await act(async () => {
      first.resolve(payload("AAA", [HIT("AAA", "2026-09-26", 11)]));
      await Promise.resolve();
    });

    expect(result.current.symbol).toBe("BBB");
    expect(result.current.hit?.id).toBe(22);
    expect(result.current.candles).toHaveLength(1);
  });

  it("keeps candles visible while a timeframe change is loading", async () => {
    vi.mocked(fetchSymbolChart).mockResolvedValueOnce(payload("TEST", [HIT("TEST", "2026-09-26", 1)]));

    const { result, rerender } = renderHook(
      ({ timeframe }: { timeframe: string }) =>
        useSymbolPatternChart({ symbol: "TEST", timeframe }),
      { initialProps: { timeframe: "1D" } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    const pending = deferred<ChartPayload>();
    vi.mocked(fetchSymbolChart).mockReturnValueOnce(pending.promise);
    rerender({ timeframe: "1W" });

    expect(result.current.loading).toBe(true);
    expect(result.current.candles).toHaveLength(1);
    expect(result.current.hit?.id).toBe(1);

    await act(async () => {
      pending.resolve(payload("TEST", []));
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hit).toBeNull();
  });

  it("switches the active pattern without refetching", async () => {
    vi.mocked(fetchSymbolChart).mockResolvedValue(
      payload("TEST", [HIT("TEST", "2026-09-20", 1), HIT("TEST", "2026-09-26", 2)]),
    );

    const { result } = renderHook(() =>
      useSymbolPatternChart({ symbol: "TEST", timeframe: "1D" }),
    );
    await waitFor(() => expect(result.current.hit?.id).toBe(2));
    expect(fetchSymbolChart).toHaveBeenCalledTimes(1);

    act(() => result.current.selectHit(result.current.hits[1]));

    expect(result.current.hit?.id).toBe(1);
    expect(fetchSymbolChart).toHaveBeenCalledTimes(1);
  });

  it("surfaces a transport error and keeps the previous candles", async () => {
    vi.mocked(fetchSymbolChart).mockResolvedValueOnce(payload("TEST", [HIT("TEST", "2026-09-26", 1)]));
    const { result, rerender } = renderHook(
      ({ timeframe }: { timeframe: string }) =>
        useSymbolPatternChart({ symbol: "TEST", timeframe }),
      { initialProps: { timeframe: "1D" } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    vi.mocked(fetchSymbolChart).mockRejectedValueOnce(new Error("boom"));
    rerender({ timeframe: "1W" });

    await waitFor(() => expect(result.current.error).toBe("boom"));
    expect(result.current.loading).toBe(false);
    expect(result.current.candles).toHaveLength(1);
  });

  it("does not fetch without a symbol", async () => {
    const { result } = renderHook(() =>
      useSymbolPatternChart({ symbol: "", timeframe: "1D" }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchSymbolChart).not.toHaveBeenCalled();
  });
});
