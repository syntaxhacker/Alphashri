// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { renderSolidHook } from "@/test-utils/solidRenderHook";
import { fetchPatternHit, fetchSymbolChart } from "@/api/chartPatterns";
import { fetchQuotes } from "@/api/marketScreener";
import type {
  ChartIndicators,
  ChartPayload,
  PatternHitDTO,
  SRZone,
} from "@/types/chartPatterns";
import { usePatternFullscreen } from "./patternsFullscreen";

vi.mock("@/api/chartPatterns", () => ({
  fetchPatternHit: vi.fn(),
  fetchSymbolChart: vi.fn(),
}));

vi.mock("@/api/marketScreener", () => ({
  fetchQuotes: vi.fn(),
}));

vi.mock("@/components/patterns/FullscreenPatternList", () => ({
  newestHit: (hits: unknown[]) => hits?.[0] ?? null,
  sortHitsNewest: (hits: unknown[]) => [...hits],
}));

let hook: ReturnType<typeof renderSolidHook<ReturnType<typeof usePatternFullscreen>>> | undefined;

const chartPayload = (hits: PatternHitDTO[] = []): ChartPayload => ({
  symbol: "KAYNES",
  timeframe: "1D",
  candles: [{ t: "2026-11-13", o: 100, h: 100, l: 100, c: 100, v: 1 }],
  overlays: [],
  trend_lines: [],
  hits,
  stale: false,
});

const INDICATORS: ChartIndicators = {
  aligned: "candles",
  timeframe: "1D",
  session: "2026-11-13",
  partial_last: false,
  series: [{ id: "sma20", values: [100] }],
  crosses: [],
};

const SR_ZONES: SRZone[] = [
  {
    kind: "resistance",
    top: 110,
    bottom: 108,
    start_date: "2026-11-01",
    end_date: "2026-11-13",
    touches: 4,
    score: 0.9,
  },
];

function makeHit(id: number, end_date: string): PatternHitDTO {
  return {
    id,
    symbol: "KAYNES",
    name: null,
    timeframe: "1D",
    pattern_id: `pattern_${id}`,
    pattern_name: `Pattern ${id}`,
    family: "continuation",
    direction: "bullish",
    status: "confirmed",
    quality: "strong",
    confidence: 80 - id,
    start_date: "2026-11-01",
    end_date,
    start_price: 100,
    end_price: 110,
    breakout_level: 110,
    target: 120,
    stop: 95,
    rr: 2,
    bars_ago: id,
    volume_confirmed: true,
    trendlines: [],
    notes: "",
  };
}

type Api = ReturnType<typeof usePatternFullscreen>;
const settled = (api: Api) =>
  vi.waitFor(() => {
    expect(api.fullscreen()?.loading).toBe(false);
    expect(api.fullscreen()?.patternsLoading).toBe(false);
  });

describe("usePatternFullscreen (page) hit selection across reloads", () => {
  beforeEach(() => {
    vi.mocked(fetchPatternHit).mockResolvedValue(null as never);
    vi.mocked(fetchQuotes).mockResolvedValue([{ symbol: "KAYNES", close: 2986, change: -12.94 }]);
  });

  afterEach(() => {
    hook?.unmount();
    hook = undefined;
    vi.clearAllMocks();
  });

  test("refresh preserves the selected hit instead of resetting to the newest", async () => {
    const newest = makeHit(1, "2026-11-13");
    const oldest = makeHit(3, "2026-11-11");
    vi.mocked(fetchSymbolChart).mockImplementation(async () =>
      chartPayload([newest, makeHit(2, "2026-11-12"), oldest]),
    );

    hook = renderSolidHook(() => usePatternFullscreen({ timeframe: "1D" }));
    const api = hook.result.current;
    api.openFromSymbol("KAYNES");
    await settled(api);
    expect(api.fullscreen()?.hit?.id).toBe(newest.id);

    api.selectFullscreenHit(oldest);
    api.refreshSymbolChart();
    await settled(api);
    expect(api.fullscreen()?.hit?.id).toBe(oldest.id);
  });

  test("refresh sends refresh=1 on both phases and serves freshly fetched candles", async () => {
    let price = 100;
    vi.mocked(fetchSymbolChart).mockImplementation(async () => ({
      ...chartPayload(),
      candles: [{ t: "2026-11-13", o: price, h: price, l: price, c: price, v: 1 }],
    }));

    hook = renderSolidHook(() => usePatternFullscreen({ timeframe: "1D" }));
    const api = hook.result.current;
    api.openFromSymbol("KAYNES");
    await settled(api);
    expect(api.fullscreen()?.candles[0].c).toBe(100);
    expect(fetchSymbolChart).toHaveBeenCalledTimes(2);

    price = 200;
    vi.mocked(fetchSymbolChart).mockClear();
    api.refreshSymbolChart();
    await settled(api);

    // Cache was invalidated — the candle came from the wire, not the cached 100.
    expect(api.fullscreen()?.candles[0].c).toBe(200);
    const calls = vi.mocked(fetchSymbolChart).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => {
      const opts = call[2];
      return typeof opts === "object" && opts?.refresh === true;
    })).toBe(true);
    expect(calls[0][2]).toEqual(expect.objectContaining({ detectPatterns: false, refresh: true }));
  });

  test("a normal open does not send refresh=1", async () => {
    vi.mocked(fetchSymbolChart).mockImplementation(async () => chartPayload());
    hook = renderSolidHook(() => usePatternFullscreen({ timeframe: "1D" }));
    const api = hook.result.current;
    api.openFromSymbol("KAYNES");
    await settled(api);
    expect(fetchSymbolChart).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetchSymbolChart).mock.calls.every((call) => {
      const opts = call[2];
      return typeof opts !== "object" || opts?.refresh !== true;
    })).toBe(true);
  });

  test("refresh takes the same-identity hit from the new payload (new close_bar_date wins)", async () => {
    const oldHit = { ...makeHit(1, "2026-11-13"), close_bar_date: null, last_close: 3550, day_change_pct: 3.5 };
    const newest = makeHit(2, "2026-11-13");
    const refreshed = { ...makeHit(1, "2026-11-13"), close_bar_date: "2026-11-16", last_close: 3600, day_change_pct: 2.86 };
    vi.mocked(fetchSymbolChart).mockImplementation(async () =>
      chartPayload([newest, oldHit]),
    );

    hook = renderSolidHook(() => usePatternFullscreen({ timeframe: "1D" }));
    const api = hook.result.current;
    api.openFromSymbol("KAYNES");
    await settled(api);
    expect(api.fullscreen()?.hit?.id).toBe(newest.id); // fresh open defaults to newest

    api.selectFullscreenHit(oldHit);
    expect(api.fullscreen()?.hit?.id).toBe(oldHit.id);
    expect(api.fullscreen()?.hit?.close_bar_date).toBeNull();

    vi.mocked(fetchSymbolChart).mockImplementation(async () =>
      chartPayload([newest, refreshed]),
    );
    api.refreshSymbolChart();
    await settled(api);
    const hit = api.fullscreen()?.hit;
    expect(hit?.id).toBe(1); // identity preserved
    expect(hit?.close_bar_date).toBe("2026-11-16"); // object taken from the new payload
    expect(hit?.last_close).toBe(3600);
    expect(hit?.day_change_pct).toBe(2.86);
    expect(hit).not.toBe(oldHit); // not the stale old object
  });

  test("refresh preserves a card-opened hit without any explicit list selection", async () => {
    const newest = makeHit(1, "2026-11-13");
    const picked = makeHit(3, "2026-11-11");
    vi.mocked(fetchSymbolChart).mockImplementation(async () =>
      chartPayload([newest, makeHit(2, "2026-11-12"), picked]),
    );

    hook = renderSolidHook(() => usePatternFullscreen({ timeframe: "1D" }));
    const api = hook.result.current;
    api.openFromCard(picked);
    await vi.waitFor(() => expect(api.fullscreen()?.loading).toBe(false));
    expect(api.fullscreen()?.hit?.id).toBe(picked.id);

    api.refreshSymbolChart();
    await settled(api);
    expect(api.fullscreen()?.hit?.id).toBe(picked.id);
  });

  test("refresh falls back to newest when the selected hit disappears", async () => {
    const newest = makeHit(1, "2026-11-13");
    const oldest = makeHit(3, "2026-11-11");
    let payloadHits = [newest, makeHit(2, "2026-11-12"), oldest];
    vi.mocked(fetchSymbolChart).mockImplementation(async () => chartPayload(payloadHits));

    hook = renderSolidHook(() => usePatternFullscreen({ timeframe: "1D" }));
    const api = hook.result.current;
    api.openFromSymbol("KAYNES");
    await settled(api);

    api.selectFullscreenHit(oldest);
    payloadHits = [newest, makeHit(2, "2026-11-12")];
    api.refreshSymbolChart();
    await settled(api);
    expect(api.fullscreen()?.hit?.id).toBe(newest.id);
  });

  test("a fresh open with no prior hit still selects the newest hit", async () => {
    const newest = makeHit(1, "2026-11-13");
    vi.mocked(fetchSymbolChart).mockImplementation(async () =>
      chartPayload([newest, makeHit(2, "2026-11-12")]),
    );

    hook = renderSolidHook(() => usePatternFullscreen({ timeframe: "1D" }));
    const api = hook.result.current;
    api.openFromSymbol("KAYNES");
    await settled(api);
    expect(api.fullscreen()?.hit?.id).toBe(newest.id);
  });
});

describe("usePatternFullscreen (page) live quote polling (15s, fake timers)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(fetchPatternHit).mockResolvedValue(null as never);
    vi.mocked(fetchSymbolChart).mockImplementation(async () => chartPayload());
    vi.mocked(fetchQuotes).mockResolvedValue([
      { symbol: "KAYNES", close: 2986, change: -12.94 },
    ]);
  });

  afterEach(() => {
    hook?.unmount();
    hook = undefined;
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  test("openFromSymbol fetches immediately, polls every 15s, stops on close", async () => {
    vi.mocked(fetchQuotes)
      .mockResolvedValueOnce([{ symbol: "KAYNES", close: 2986, change: -12.94 }])
      .mockResolvedValue([{ symbol: "KAYNES", close: 3010, change: -11.2 }]);

    hook = renderSolidHook(() => usePatternFullscreen({ timeframe: "1D" }));
    const api = hook.result.current;
    api.openFromSymbol("KAYNES");

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchQuotes).toHaveBeenCalledTimes(1);
    expect(fetchQuotes).toHaveBeenCalledWith(["KAYNES"], expect.objectContaining({ signal: expect.anything() }));
    expect(api.fullscreen()?.livePrice).toBe(2986);
    expect(api.fullscreen()?.liveChange).toBe(-12.94);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetchQuotes).toHaveBeenCalledTimes(2);
    expect(fetchQuotes).toHaveBeenLastCalledWith(["KAYNES"], expect.objectContaining({ signal: expect.anything() }));
    expect(api.fullscreen()?.livePrice).toBe(3010);
    expect(api.fullscreen()?.liveChange).toBe(-11.2);

    api.closeFullscreen();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchQuotes).toHaveBeenCalledTimes(2);
  });

  test("openFromCard fetches the quote and arms the same 15s poll", async () => {
    const hit = makeHit(7, "2026-11-13");
    vi.mocked(fetchQuotes).mockResolvedValueOnce([
      { symbol: "KAYNES", close: 2986, change: -12.94 },
    ]);

    hook = renderSolidHook(() => usePatternFullscreen({ timeframe: "1D" }));
    const api = hook.result.current;
    api.openFromCard(hit);

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchQuotes).toHaveBeenCalledTimes(1);
    expect(fetchQuotes).toHaveBeenCalledWith(["KAYNES"], expect.objectContaining({ signal: expect.anything() }));
    expect(api.fullscreen()?.livePrice).toBe(2986);
    expect(api.fullscreen()?.liveChange).toBe(-12.94);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetchQuotes).toHaveBeenCalledTimes(2);

    api.closeFullscreen();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchQuotes).toHaveBeenCalledTimes(2);
  });

  test("timeframe change clears live price immediately, repopulates on the next tick", async () => {
    vi.mocked(fetchQuotes)
      .mockResolvedValueOnce([{ symbol: "KAYNES", close: 2986, change: -12.94 }])
      .mockResolvedValueOnce([{ symbol: "KAYNES", close: 3010, change: -11.2 }])
      .mockResolvedValue([{ symbol: "KAYNES", close: 3055, change: -9.1 }]);

    hook = renderSolidHook(() => usePatternFullscreen({ timeframe: "1D" }));
    const api = hook.result.current;
    api.openFromSymbol("KAYNES");
    await vi.advanceTimersByTimeAsync(0);
    expect(api.fullscreen()?.livePrice).toBe(2986);

    api.changeFullscreenTimeframe("1h");
    expect(api.fullscreen()?.timeframe).toBe("1h");
    expect(api.fullscreen()?.livePrice).toBeNull();
    expect(api.fullscreen()?.liveChange).toBeNull();

    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetchQuotes).toHaveBeenCalledTimes(3);
    expect(api.fullscreen()?.livePrice).toBe(3055);
    expect(api.fullscreen()?.liveChange).toBe(-9.1);
  });

  test("as-of historical clears live price and pauses polling; returning to live refetches", async () => {
    vi.mocked(fetchQuotes).mockResolvedValue([
      { symbol: "KAYNES", close: 2986, change: -12.94 },
    ]);

    hook = renderSolidHook(() => usePatternFullscreen({ timeframe: "1D" }));
    const api = hook.result.current;
    api.openFromSymbol("KAYNES");
    await vi.advanceTimersByTimeAsync(0);
    expect(api.fullscreen()?.livePrice).toBe(2986);
    expect(fetchQuotes).toHaveBeenCalledTimes(1);

    api.changeFullscreenAsOf("2026-11-10", null);
    expect(api.fullscreen()?.asOf).toBe("2026-11-10");
    expect(api.fullscreen()?.livePrice).toBeNull();
    expect(api.fullscreen()?.liveChange).toBeNull();

    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetchQuotes).toHaveBeenCalledTimes(1); // no poll while historical

    api.changeFullscreenAsOf(null, null);
    expect(api.fullscreen()?.asOf).toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchQuotes).toHaveBeenCalledTimes(2); // restarted: immediate fetch
    expect(api.fullscreen()?.livePrice).toBe(2986);

    api.closeFullscreen();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchQuotes).toHaveBeenCalledTimes(2);
  });
});

describe("usePatternFullscreen (page) stale marker vs displayed candle date", () => {
  beforeEach(() => {
    vi.mocked(fetchPatternHit).mockResolvedValue(null as never);
    vi.mocked(fetchQuotes).mockResolvedValue([{ symbol: "KAYNES", close: 2986, change: -12.94 }]);
  });

  afterEach(() => {
    hook?.unmount();
    hook = undefined;
    vi.clearAllMocks();
  });

  // A stale-first frame: `as_of` stays pinned to the detection frame while the
  // displayed series has had today's tape bar appended.
  const staleChart = (candleDates: string[], asOf?: string | null): ChartPayload => ({
    ...chartPayload(),
    candles: candleDates.map((t, i) => ({
      t,
      o: 100 + i,
      h: 101 + i,
      l: 99 + i,
      c: 100 + i,
      v: 1,
    })),
    stale: true,
    ...(asOf === undefined ? {} : { as_of: asOf }),
  });

  test("a displayed candle newer than as_of clears the stale marker", async () => {
    vi.mocked(fetchSymbolChart).mockResolvedValue(
      staleChart(["2026-11-12", "2026-11-13", "2026-11-16"], "2026-11-13"),
    );

    hook = renderSolidHook(() => usePatternFullscreen({ timeframe: "1D" }));
    const api = hook.result.current;
    api.openFromSymbol("KAYNES");
    await settled(api);

    expect(api.fullscreen()?.stale).toBe(false);
    expect(api.fullscreen()?.dataAsOf).toBeNull();
  });

  test("a daily bar stamped 18:30Z belongs to the next IST session", async () => {
    vi.mocked(fetchSymbolChart).mockResolvedValue(
      staleChart(["2026-11-12T18:30:00Z", "2026-11-13T18:30:00Z"], "2026-11-13"),
    );

    hook = renderSolidHook(() => usePatternFullscreen({ timeframe: "1D" }));
    const api = hook.result.current;
    api.openFromSymbol("KAYNES");
    await settled(api);

    expect(api.fullscreen()?.stale).toBe(false);
    expect(api.fullscreen()?.dataAsOf).toBeNull();
  });

  test("a series ending on as_of keeps the stale marker and its date", async () => {
    vi.mocked(fetchSymbolChart).mockResolvedValue(
      staleChart(["2026-11-12", "2026-11-13"], "2026-11-13"),
    );

    hook = renderSolidHook(() => usePatternFullscreen({ timeframe: "1D" }));
    const api = hook.result.current;
    api.openFromSymbol("KAYNES");
    await settled(api);

    expect(api.fullscreen()?.stale).toBe(true);
    expect(api.fullscreen()?.dataAsOf).toBe("2026-11-13");
  });

  test("no as_of keeps the previous behavior", async () => {
    vi.mocked(fetchSymbolChart).mockResolvedValue(staleChart(["2026-11-12", "2026-11-16"], null));

    hook = renderSolidHook(() => usePatternFullscreen({ timeframe: "1D" }));
    const api = hook.result.current;
    api.openFromSymbol("KAYNES");
    await settled(api);

    expect(api.fullscreen()?.stale).toBe(true);
    expect(api.fullscreen()?.dataAsOf).toBeNull();
  });

  test("a current display keeps detection_as_of for the dock caveat", async () => {
    vi.mocked(fetchSymbolChart).mockResolvedValue({
      ...staleChart(["2026-11-13", "2026-11-16"], "2026-11-16"),
      stale: false,
      detection_as_of: "2026-11-13",
    });

    hook = renderSolidHook(() => usePatternFullscreen({ timeframe: "1D" }));
    const api = hook.result.current;
    api.openFromSymbol("KAYNES");
    await settled(api);

    expect(api.fullscreen()?.stale).toBe(false);
    expect(api.fullscreen()?.detectionAsOf).toBe("2026-11-13");
  });

  test("a payload without detection_as_of leaves the field null", async () => {
    vi.mocked(fetchSymbolChart).mockResolvedValue(staleChart(["2026-11-16"], "2026-11-16"));

    hook = renderSolidHook(() => usePatternFullscreen({ timeframe: "1D" }));
    const api = hook.result.current;
    api.openFromSymbol("KAYNES");
    await settled(api);

    expect(api.fullscreen()?.detectionAsOf).toBeNull();
  });

  test("plumbs indicators and sr_zones through candle and pattern phases", async () => {
    vi.mocked(fetchSymbolChart).mockImplementation(async () => ({
      ...chartPayload([makeHit(1, "2026-11-13")]),
      indicators: INDICATORS,
      sr_zones: SR_ZONES,
    }));

    hook = renderSolidHook(() => usePatternFullscreen({ timeframe: "1D" }));
    const api = hook.result.current;
    api.openFromSymbol("KAYNES");
    await settled(api);

    expect(api.fullscreen()?.indicators).toEqual(INDICATORS);
    expect(api.fullscreen()?.srZones).toEqual(SR_ZONES);

    api.changeFullscreenTimeframe("1h");
    await settled(api);
    expect(api.fullscreen()?.timeframe).toBe("1h");
    expect(api.fullscreen()?.indicators).toEqual(INDICATORS);
    expect(api.fullscreen()?.srZones).toHaveLength(1);

    api.refreshSymbolChart();
    await settled(api);
    expect(api.fullscreen()?.indicators).toEqual(INDICATORS);
    expect(api.fullscreen()?.srZones).toEqual(SR_ZONES);
  });
});
