// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { renderSolidHook } from "@/test-utils/solidRenderHook";
import { fetchPatternHit, fetchSymbolChart } from "@/api/chartPatterns";
import { fetchQuotes } from "@/api/marketScreener";
import type { ChartPayload, PatternHitDTO } from "@/types/chartPatterns";
import { usePatternFullscreen } from "./usePatternFullscreenSolid";

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

let framePrice = 1000;
let hook: ReturnType<typeof renderSolidHook<ReturnType<typeof usePatternFullscreen>>> | undefined;

const chartPayload = (price: number, hits: PatternHitDTO[] = []): ChartPayload => ({
  symbol: "KAYNES",
  timeframe: "1D",
  candles: [{ t: "2026-11-13", o: price, h: price, l: price, c: price, v: 1 }],
  overlays: [],
  trend_lines: [],
  hits,
  stale: false,
});

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

describe("usePatternFullscreen refreshSymbolChart", () => {
  beforeEach(() => {
    framePrice = 1000;
    vi.mocked(fetchPatternHit).mockResolvedValue(null as never);
    vi.mocked(fetchSymbolChart).mockImplementation(async () => chartPayload(framePrice));
    vi.mocked(fetchQuotes).mockResolvedValue([
      { symbol: "KAYNES", close: 2986, change: -12.94 },
    ]);
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

  test("refresh sends refresh=1 on both phases and serves freshly fetched candles", async () => {
    hook = renderSolidHook(() => usePatternFullscreen({ timeframe: "1D" }));
    const api = hook.result.current;
    api.openFromSymbol("KAYNES");
    await settled(api);
    expect(fetchSymbolChart).toHaveBeenCalledTimes(2);

    framePrice = 2000;
    vi.mocked(fetchSymbolChart).mockClear();
    api.refreshSymbolChart();
    await settled(api);

    // The cache was invalidated: the new price comes from the wire, not the
    // 1000-priced candle cached by the first open.
    expect(api.fullscreen()?.candles[0].c).toBe(2000);
    const calls = vi.mocked(fetchSymbolChart).mock.calls;
    expect(calls).toHaveLength(2); // candles phase + patterns phase
    expect(calls.every((call) => {
      const opts = call[2];
      return typeof opts === "object" && opts?.refresh === true;
    })).toBe(true);
    expect(calls[0][2]).toEqual(expect.objectContaining({ detectPatterns: false, refresh: true }));
  });

  test("a normal open does not send refresh=1", async () => {
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

  test("openFromSymbol fetches the quote and stores livePrice/liveChange", async () => {
    hook = renderSolidHook(() => usePatternFullscreen({ timeframe: "1D" }));
    const api = hook.result.current;
    api.openFromSymbol("KAYNES");
    await vi.waitFor(() => expect(api.fullscreen()?.livePrice).toBe(2986));
    expect(fetchQuotes).toHaveBeenCalledTimes(1);
    expect(fetchQuotes).toHaveBeenCalledWith(["KAYNES"], expect.objectContaining({ signal: expect.anything() }));
    expect(api.fullscreen()?.liveChange).toBe(-12.94);
    expect(api.fullscreen()?.candles[0].c).toBe(1000);
  });

  test("previewFromSymbol (pinned=false) also fetches the quote", async () => {
    hook = renderSolidHook(() => usePatternFullscreen({ timeframe: "1D" }));
    const api = hook.result.current;
    api.previewFromSymbol("KAYNES");
    await vi.waitFor(() => expect(api.fullscreen()?.livePrice).toBe(2986));
    expect(api.fullscreen()?.pinned).toBe(false);
    expect(fetchQuotes).toHaveBeenCalledWith(["KAYNES"], expect.objectContaining({ signal: expect.anything() }));
  });

  test("refresh refetches both the quote and the chart", async () => {
    hook = renderSolidHook(() => usePatternFullscreen({ timeframe: "1D" }));
    const api = hook.result.current;
    api.openFromSymbol("KAYNES");
    await vi.waitFor(() => expect(api.fullscreen()?.loading).toBe(false));
    await vi.waitFor(() => expect(api.fullscreen()?.livePrice).toBe(2986));
    expect(fetchQuotes).toHaveBeenCalledTimes(1);
    expect(fetchSymbolChart).toHaveBeenCalledTimes(2);

    framePrice = 2000;
    vi.mocked(fetchQuotes).mockResolvedValueOnce([
      { symbol: "KAYNES", close: 3010, change: -11.2 },
    ]);
    api.refreshSymbolChart();
    expect(api.fullscreen()?.livePrice).toBeNull(); // reset while reloading
    await vi.waitFor(() => expect(api.fullscreen()?.loading).toBe(false));
    await vi.waitFor(() => expect(api.fullscreen()?.livePrice).toBe(3010));
    expect(fetchQuotes).toHaveBeenCalledTimes(2);
    expect(fetchSymbolChart).toHaveBeenCalledTimes(4);
    expect(api.fullscreen()?.candles[0].c).toBe(2000);
  });

  test("a quote failure leaves LTP null but the chart still renders", async () => {
    vi.mocked(fetchQuotes).mockRejectedValueOnce(new Error("snapshot down"));
    hook = renderSolidHook(() => usePatternFullscreen({ timeframe: "1D" }));
    const api = hook.result.current;
    api.openFromSymbol("KAYNES");
    await vi.waitFor(() => expect(api.fullscreen()?.loading).toBe(false));
    expect(api.fullscreen()?.livePrice).toBeNull();
    expect(api.fullscreen()?.liveChange).toBeNull();
    expect(api.fullscreen()?.candles[0].c).toBe(1000);
  });

  test("refresh preserves the selected hit instead of resetting to the newest", async () => {
    const newest = makeHit(1, "2026-11-13");
    const oldest = makeHit(3, "2026-11-11");
    const hits = [newest, makeHit(2, "2026-11-12"), oldest];
    vi.mocked(fetchSymbolChart).mockImplementation(async () => chartPayload(framePrice, hits));

    hook = renderSolidHook(() => usePatternFullscreen({ timeframe: "1D" }));
    const api = hook.result.current;
    api.openFromSymbol("KAYNES");
    await settled(api);
    expect(api.fullscreen()?.hit?.id).toBe(newest.id); // fresh open defaults to newest

    api.selectFullscreenHit(oldest);
    expect(api.fullscreen()?.hit?.id).toBe(oldest.id);

    api.refreshSymbolChart();
    await settled(api);
    expect(api.fullscreen()?.hit?.id).toBe(oldest.id); // selection survives refresh
  });

  test("refresh takes the same-identity hit from the new payload (new close_bar_date wins)", async () => {
    const oldHit = { ...makeHit(1, "2026-11-13"), close_bar_date: null, last_close: 3550, day_change_pct: 3.5 };
    const newest = makeHit(2, "2026-11-13");
    const refreshed = { ...makeHit(1, "2026-11-13"), close_bar_date: "2026-11-16", last_close: 3600, day_change_pct: 2.86 };
    vi.mocked(fetchSymbolChart).mockImplementation(async () => chartPayload(framePrice, [newest, oldHit]));

    hook = renderSolidHook(() => usePatternFullscreen({ timeframe: "1D" }));
    const api = hook.result.current;
    api.openFromSymbol("KAYNES");
    await settled(api);
    expect(api.fullscreen()?.hit?.id).toBe(newest.id); // fresh open defaults to newest

    api.selectFullscreenHit(oldHit);
    expect(api.fullscreen()?.hit?.id).toBe(oldHit.id);
    expect(api.fullscreen()?.hit?.close_bar_date).toBeNull();

    vi.mocked(fetchSymbolChart).mockImplementation(async () => chartPayload(framePrice, [newest, refreshed]));
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
      chartPayload(framePrice, [newest, makeHit(2, "2026-11-12"), picked]),
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
    vi.mocked(fetchSymbolChart).mockImplementation(async () => chartPayload(framePrice, payloadHits));

    hook = renderSolidHook(() => usePatternFullscreen({ timeframe: "1D" }));
    const api = hook.result.current;
    api.openFromSymbol("KAYNES");
    await settled(api);

    api.selectFullscreenHit(oldest);
    payloadHits = [newest, makeHit(2, "2026-11-12")]; // oldest no longer detected
    api.refreshSymbolChart();
    await settled(api);
    expect(api.fullscreen()?.hit?.id).toBe(newest.id);
  });

  test("a fresh open with no prior hit still selects the newest hit", async () => {
    const newest = makeHit(1, "2026-11-13");
    vi.mocked(fetchSymbolChart).mockImplementation(async () =>
      chartPayload(framePrice, [newest, makeHit(2, "2026-11-12")]),
    );

    hook = renderSolidHook(() => usePatternFullscreen({ timeframe: "1D" }));
    const api = hook.result.current;
    api.openFromSymbol("KAYNES");
    await settled(api);
    expect(api.fullscreen()?.hit?.id).toBe(newest.id);
  });

  test("timeframe change keeps the selected hit when its identity exists in the new timeframe", async () => {
    const newest = makeHit(1, "2026-11-13");
    const oldest = makeHit(3, "2026-11-11");
    vi.mocked(fetchSymbolChart).mockImplementation(async () => chartPayload(framePrice, [newest, oldest]));

    hook = renderSolidHook(() => usePatternFullscreen({ timeframe: "1D" }));
    const api = hook.result.current;
    api.openFromSymbol("KAYNES");
    await settled(api);

    api.selectFullscreenHit(oldest);
    api.changeFullscreenTimeframe("1h");
    await settled(api);
    expect(api.fullscreen()?.timeframe).toBe("1h");
    expect(api.fullscreen()?.hit?.id).toBe(oldest.id);
  });
});

describe("usePatternFullscreen cleanup", () => {
  beforeEach(() => {
    vi.mocked(fetchPatternHit).mockResolvedValue(null as never);
    vi.mocked(fetchQuotes).mockResolvedValue([
      { symbol: "KAYNES", close: 2986, change: -12.94 },
    ]);
  });

  afterEach(() => {
    hook?.unmount();
    hook = undefined;
    vi.clearAllMocks();
  });

  test("unmount invalidates an in-flight chart request instead of letting it write state", async () => {
    let resolveCandles: ((payload: ChartPayload) => void) | undefined;
    vi.mocked(fetchSymbolChart).mockImplementation(
      () => new Promise((resolve) => { resolveCandles = resolve; }),
    );

    hook = renderSolidHook(() => usePatternFullscreen({ timeframe: "1D" }));
    const api = hook.result.current;
    api.openFromSymbol("KAYNES");
    await vi.waitFor(() => expect(fetchSymbolChart).toHaveBeenCalledTimes(1));

    hook.unmount();

    resolveCandles?.(chartPayload(4321));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // A resolved-after-cleanup payload must not land: candles stay empty and
    // the state stays in its loading placeholder.
    expect(api.fullscreen()?.candles).toEqual([]);
    expect(api.fullscreen()?.loading).toBe(true);
  });
});

describe("usePatternFullscreen live quote polling (15s, fake timers)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    framePrice = 1000;
    vi.mocked(fetchPatternHit).mockResolvedValue(null as never);
    vi.mocked(fetchSymbolChart).mockImplementation(async () => chartPayload(framePrice));
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

describe("usePatternFullscreen stale marker vs displayed candle date", () => {
  beforeEach(() => {
    framePrice = 1000;
    vi.mocked(fetchPatternHit).mockResolvedValue(null as never);
    vi.mocked(fetchQuotes).mockResolvedValue([
      { symbol: "KAYNES", close: 2986, change: -12.94 },
    ]);
  });

  afterEach(() => {
    hook?.unmount();
    hook = undefined;
    vi.clearAllMocks();
  });

  // A stale-first frame: `as_of` stays pinned to the detection frame while the
  // displayed series has had today's tape bar appended.
  const staleChart = (candleDates: string[], asOf?: string | null): ChartPayload => ({
    ...chartPayload(framePrice),
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

  // The gap this field closes: a current display (today's tape bar) over a
  // detection frame two sessions older. `stale` is false because the display is
  // current, so only `detectionAsOf` can carry the caveat.
  test("a current display keeps detection_as_of so the dock can date the hit", async () => {
    vi.mocked(fetchSymbolChart).mockResolvedValue({
      ...staleChart(["2026-11-12", "2026-11-13", "2026-11-16"], "2026-11-16"),
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

  test("a 18:30Z detection stamp resolves to the next IST session", async () => {
    vi.mocked(fetchSymbolChart).mockResolvedValue({
      ...staleChart(["2026-11-16"], "2026-11-16"),
      stale: false,
      detection_as_of: "2026-11-13T18:30:00Z",
    });

    hook = renderSolidHook(() => usePatternFullscreen({ timeframe: "1D" }));
    const api = hook.result.current;
    api.openFromSymbol("KAYNES");
    await settled(api);

    expect(api.fullscreen()?.detectionAsOf).toBe("2026-11-14");
  });

  test("a payload without detection_as_of leaves the field null", async () => {
    vi.mocked(fetchSymbolChart).mockResolvedValue(staleChart(["2026-11-16"], "2026-11-16"));

    hook = renderSolidHook(() => usePatternFullscreen({ timeframe: "1D" }));
    const api = hook.result.current;
    api.openFromSymbol("KAYNES");
    await settled(api);

    expect(api.fullscreen()?.detectionAsOf).toBeNull();
  });
});

describe("usePatternFullscreen stored-first default (symbol dock)", () => {
  // APLAPOLLO: the stored scan says Consolidation while live detection says
  // Ascending Triangle. The dock must trust the stored scan.
  const stored = {
    ...makeHit(10, "2026-11-13"),
    symbol: "APLAPOLLO",
    pattern_id: "consolidation",
    pattern_name: "Consolidation",
  };
  const live = {
    ...makeHit(11, "2026-11-14"),
    symbol: "APLAPOLLO",
    pattern_id: "ascending_triangle",
    pattern_name: "Ascending Triangle",
  };

  const chartFor = (hits: PatternHitDTO[]): ChartPayload => ({
    ...chartPayload(1000, hits),
    symbol: "APLAPOLLO",
  });

  const liveAwareChart = async (
    _symbol: string,
    _tf: string,
    opts: number | { detectPatterns?: boolean } | undefined,
  ) =>
    chartFor(
      typeof opts === "object" && opts?.detectPatterns ? [live] : [stored],
    );

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(fetchPatternHit).mockResolvedValue(null as never);
    vi.mocked(fetchQuotes).mockResolvedValue([
      { symbol: "APLAPOLLO", close: 1000, change: 1 },
    ]);
  });

  afterEach(() => {
    hook?.unmount();
    hook = undefined;
    vi.clearAllMocks();
  });

  test("stored Consolidation is selected with one stored call and no live call", async () => {
    vi.mocked(fetchSymbolChart).mockImplementation(liveAwareChart);

    hook = renderSolidHook(() => usePatternFullscreen({ timeframe: "1D" }));
    const api = hook.result.current;
    api.openFromSymbol("APLAPOLLO");
    await settled(api);

    expect(api.fullscreen()?.hit?.pattern_name).toBe("Consolidation");
    const calls = vi.mocked(fetchSymbolChart).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][2]).toEqual(expect.objectContaining({ detectPatterns: false }));
  });

  test("empty stored response triggers exactly one live fallback with Ascending Triangle", async () => {
    vi.mocked(fetchSymbolChart)
      .mockResolvedValueOnce(chartFor([]))
      .mockResolvedValueOnce(chartFor([live]));

    hook = renderSolidHook(() => usePatternFullscreen({ timeframe: "1D" }));
    const api = hook.result.current;
    api.openFromSymbol("APLAPOLLO");
    await settled(api);

    expect(api.fullscreen()?.hit?.pattern_name).toBe("Ascending Triangle");
    const calls = vi.mocked(fetchSymbolChart).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][2]).toEqual(expect.objectContaining({ detectPatterns: false }));
    expect(calls[1][2]).toEqual(expect.objectContaining({ detectPatterns: true }));
  });

  test("APLAPOLLO: stored hits win over live when both exist (one request)", async () => {
    vi.mocked(fetchSymbolChart)
      .mockResolvedValueOnce(chartFor([stored]))
      .mockResolvedValueOnce(chartFor([live]));

    hook = renderSolidHook(() => usePatternFullscreen({ timeframe: "1D" }));
    const api = hook.result.current;
    api.openFromSymbol("APLAPOLLO");
    await settled(api);

    expect(api.fullscreen()?.hit?.pattern_name).toBe("Consolidation");
    expect(api.fullscreen()?.hits).toHaveLength(1);
    expect(api.fullscreen()?.hits[0].pattern_name).toBe("Consolidation");
    expect(fetchSymbolChart).toHaveBeenCalledTimes(1);
  });

  test("explicit detectPatterns: true still goes live immediately", async () => {
    vi.mocked(fetchSymbolChart).mockImplementation(liveAwareChart);

    hook = renderSolidHook(() => usePatternFullscreen({ timeframe: "1D" }));
    const api = hook.result.current;
    api.openFromSymbol("APLAPOLLO", undefined, true);
    await settled(api);

    expect(api.fullscreen()?.hit?.pattern_name).toBe("Ascending Triangle");
    const calls = vi.mocked(fetchSymbolChart).mock.calls;
    expect(calls).toHaveLength(2); // candles phase, then live detection
    expect(calls[1][2]).toEqual(expect.objectContaining({ detectPatterns: true }));
  });

  test("previewFromSymbol also defaults to stored-first", async () => {
    vi.mocked(fetchSymbolChart).mockImplementation(liveAwareChart);

    hook = renderSolidHook(() => usePatternFullscreen({ timeframe: "1D" }));
    const api = hook.result.current;
    api.previewFromSymbol("APLAPOLLO");
    await settled(api);

    expect(api.fullscreen()?.pinned).toBe(false);
    expect(api.fullscreen()?.hit?.pattern_name).toBe("Consolidation");
    expect(fetchSymbolChart).toHaveBeenCalledTimes(1);
  });
});
