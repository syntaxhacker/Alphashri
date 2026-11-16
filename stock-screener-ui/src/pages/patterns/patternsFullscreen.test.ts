// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { renderSolidHook } from "@/test-utils/solidRenderHook";
import { fetchPatternHit, fetchSymbolChart } from "@/api/chartPatterns";
import { fetchQuotes } from "@/api/marketScreener";
import type { ChartPayload, PatternHitDTO } from "@/types/chartPatterns";
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
