// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { renderSolidHook } from "@/test-utils/solidRenderHook";
import { fetchPatternHit, fetchSymbolChart } from "@/api/chartPatterns";
import type { ChartPayload } from "@/types/chartPatterns";
import { usePatternFullscreen } from "./usePatternFullscreenSolid";

vi.mock("@/api/chartPatterns", () => ({
  fetchPatternHit: vi.fn(),
  fetchSymbolChart: vi.fn(),
}));

vi.mock("@/components/patterns/FullscreenPatternList", () => ({
  newestHit: (hits: unknown[]) => hits?.[0] ?? null,
  sortHitsNewest: (hits: unknown[]) => [...hits],
}));

let framePrice = 1000;
let hook: ReturnType<typeof renderSolidHook<ReturnType<typeof usePatternFullscreen>>> | undefined;

const chartPayload = (price: number): ChartPayload => ({
  symbol: "KAYNES",
  timeframe: "1D",
  candles: [{ t: "2026-11-13", o: price, h: price, l: price, c: price, v: 1 }],
  overlays: [],
  trend_lines: [],
  hits: [],
  stale: false,
});

describe("usePatternFullscreen refreshSymbolChart", () => {
  beforeEach(() => {
    framePrice = 1000;
    vi.mocked(fetchPatternHit).mockResolvedValue(null as never);
    vi.mocked(fetchSymbolChart).mockImplementation(async () => chartPayload(framePrice));
  });

  afterEach(() => {
    hook?.unmount();
    hook = undefined;
    vi.clearAllMocks();
  });

  test("refresh clears the symbol key and refetches instead of serving cached candles", async () => {
    hook = renderSolidHook(() => usePatternFullscreen({ timeframe: "1D" }));
    const api = hook.result.current;
    api.openFromSymbol("KAYNES");
    await vi.waitFor(() => expect(api.fullscreen()?.loading).toBe(false));
    expect(api.fullscreen()?.candles[0].c).toBe(1000);
    expect(fetchSymbolChart).toHaveBeenCalledTimes(2); // candles phase + patterns phase

    framePrice = 2000;
    api.refreshSymbolChart();
    expect(api.fullscreen()?.loading).toBe(true);
    await vi.waitFor(() => expect(api.fullscreen()?.loading).toBe(false));

    expect(api.fullscreen()?.candles[0].c).toBe(2000);
    expect(fetchSymbolChart).toHaveBeenCalledTimes(4);
    // The candles phase must actually re-run, not be answered from the cache.
    expect(fetchSymbolChart).toHaveBeenCalledWith(
      "KAYNES",
      "1D",
      expect.objectContaining({ detectPatterns: false }),
    );
  });

  test("a second open after refresh cannot surface the pre-refresh payload", async () => {
    hook = renderSolidHook(() => usePatternFullscreen({ timeframe: "1D" }));
    const api = hook.result.current;
    api.openFromSymbol("KAYNES");
    await vi.waitFor(() => expect(api.fullscreen()?.loading).toBe(false));

    framePrice = 2000;
    api.refreshSymbolChart();
    await vi.waitFor(() => expect(api.fullscreen()?.loading).toBe(false));
    expect(api.fullscreen()?.candles[0].c).toBe(2000);

    api.openFromSymbol("KAYNES");
    await vi.waitFor(() => expect(api.fullscreen()?.loading).toBe(false));
    expect(api.fullscreen()?.candles[0].c).toBe(2000);
    expect(vi.mocked(fetchSymbolChart).mock.calls.some((call) => {
      const opts = call[2];
      return typeof opts === "object" && opts?.detectPatterns === false;
    })).toBe(true);
  });
});
