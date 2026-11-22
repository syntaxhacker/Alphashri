import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../state/auth", async () => (await import("./apiTestMocks")).fetchWithAuthModuleMock());

import { fetchWithAuth } from "../state/auth";
import {
  REGISTRY_TTL_MS,
  clearPatternsApiCache,
  fetchPatternCatalog,
  fetchTimeframes,
  fetchUniverses,
  fetchWatchSetups,
} from "./chartPatterns";
import { okResponse } from "./apiTestMocks";

const mockedFetch = vi.mocked(fetchWithAuth);
const TF = { id: "1D", label: "1D", minutes: 1440, native: true, source_tf: null, max_lookback_days: 730, min_bars: 60 };

function urlOf(call: number): string {
  return String(mockedFetch.mock.calls[call][0]);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  clearPatternsApiCache();
  mockedFetch.mockResolvedValue(
    okResponse({
      timeframes: [TF],
      universes: [{ id: "nifty50", label: "Nifty 50", count: 50 }],
      default: "nifty50",
      families: [{ id: "reversal", label: "Reversal" }],
      patterns: [{ pattern_id: "falling_wedge", name: "Falling Wedge", family: "reversal", direction: "bullish", description: "" }],
      setups: [{ id: "breakout", label: "Breakout", description: "Base breakout", default_min_rel_volume: 0.7 }],
    }),
  );
});

afterEach(() => {
  clearPatternsApiCache();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("registry cache (call-count guards)", () => {
  it("two sequential reads of the same registry issue one fetch", async () => {
    const first = await fetchTimeframes();
    const second = await fetchTimeframes();

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(second).toEqual([TF]);
    expect(urlOf(0)).toContain("/api/chart-patterns/timeframes");
  });

  it("concurrent mounts share the in-flight request", async () => {
    const [a, b, c] = await Promise.all([fetchTimeframes(), fetchTimeframes(), fetchTimeframes()]);

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it("each registry has its own key and payload", async () => {
    const [timeframes, universes, catalog, setups] = await Promise.all([
      fetchTimeframes(),
      fetchUniverses(),
      fetchPatternCatalog(),
      fetchWatchSetups(),
    ]);

    expect(mockedFetch).toHaveBeenCalledTimes(4);
    expect(timeframes).toEqual([TF]);
    expect(universes.default).toBe("nifty50");
    expect(catalog.patterns).toHaveLength(1);
    expect(setups[0].id).toBe("breakout");

    await Promise.all([fetchTimeframes(), fetchUniverses(), fetchPatternCatalog(), fetchWatchSetups()]);
    expect(mockedFetch).toHaveBeenCalledTimes(4);
  });

  it("a settled entry is re-fetched after the TTL", async () => {
    await fetchTimeframes();
    vi.advanceTimersByTime(REGISTRY_TTL_MS + 1);
    await fetchTimeframes();

    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it("force bypasses both the settled value and an in-flight request", async () => {
    await fetchTimeframes();
    await fetchTimeframes(true);
    await fetchTimeframes(true);
    expect(mockedFetch).toHaveBeenCalledTimes(3);

    // Each forced caller runs its own fetch, even while another is in flight.
    clearPatternsApiCache();
    await Promise.all([fetchTimeframes(true), fetchTimeframes(true)]);
    expect(mockedFetch).toHaveBeenCalledTimes(5);
  });

  it("a failed request is never cached, so the next call retries", async () => {
    mockedFetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ detail: "boom" }) } as never);
    await expect(fetchTimeframes()).rejects.toThrow("boom");
    await expect(fetchTimeframes()).resolves.toEqual([TF]);
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it("clearPatternsApiCache invalidates every registry", async () => {
    await fetchTimeframes();
    await fetchUniverses();
    clearPatternsApiCache();
    await fetchTimeframes();
    await fetchUniverses();

    expect(mockedFetch).toHaveBeenCalledTimes(4);
  });
});
