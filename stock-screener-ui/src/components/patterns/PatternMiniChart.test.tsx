// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";

vi.mock("@/ui", async () => {
  const { mockSolidUi } = await import("@/test-utils/solidUiMock");
  return mockSolidUi();
});
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createSignal } from "solid-js";
import { cleanup, render, screen, waitFor } from "@solidjs/testing-library";
import { NEGATIVE, POSITIVE } from "@/ui/palette";
import type { ChartCandle, PatternHitDTO, TrendLine, Trendline } from "@/types/chartPatterns";
import { BOUNDARY_COLORS, buildPatternChartOption } from "./patternChartOption";
import { PatternMiniChart } from "./PatternMiniChart";

const { setChartOption, resizeChart, disposeChart, initChart, loadEchartsSpy } = vi.hoisted(() => {
  const setChartOption = vi.fn();
  const resizeChart = vi.fn();
  const disposeChart = vi.fn();
  const initChart = vi.fn(() => ({ setOption: setChartOption, resize: resizeChart, dispose: disposeChart }));
  const loadEchartsSpy = vi.fn(async () => ({ init: initChart }));
  return { setChartOption, resizeChart, disposeChart, initChart, loadEchartsSpy };
});

vi.mock("@/utils/loadEcharts", () => ({ loadEcharts: loadEchartsSpy }));

vi.mock("./patternChartOption", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, buildPatternChartOption: vi.fn(() => ({ mocked: "mini-chart" })) };
});

const buildMock = vi.mocked(buildPatternChartOption);

// Controllable polyfill: existing tests auto-intersect on observe, the
// deferral tests disable that and emit manually.
class MockIntersectionObserver implements IntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  static autoIntersect = true;

  readonly root = null;
  readonly rootMargin = "";
  readonly thresholds: ReadonlyArray<number> = [];
  readonly targets: Element[] = [];
  readonly callback: IntersectionObserverCallback;

  readonly observe = vi.fn((target: Element) => {
    this.targets.push(target);
    if (MockIntersectionObserver.autoIntersect) this.emit(true);
  });
  readonly unobserve = vi.fn((target: Element) => {
    const i = this.targets.indexOf(target);
    if (i >= 0) this.targets.splice(i, 1);
  });
  readonly disconnect = vi.fn(() => {
    this.targets.length = 0;
  });
  readonly takeRecords = vi.fn((): IntersectionObserverEntry[] => []);

  constructor(callback: IntersectionObserverCallback, _options?: IntersectionObserverInit) {
    this.callback = callback;
    MockIntersectionObserver.instances.push(this);
  }

  emit(isIntersecting: boolean) {
    const rect = {} as DOMRect;
    const entries = this.targets.map(
      (target) =>
        ({
          isIntersecting,
          target,
          intersectionRatio: isIntersecting ? 1 : 0,
          boundingClientRect: rect,
          intersectionRect: rect,
          rootBounds: null,
          time: 0,
        }) as unknown as IntersectionObserverEntry,
    );
    if (entries.length) this.callback(entries, this);
  }
}

function candle(t: string, o: number, c: number): ChartCandle {
  return { t, o, h: Math.max(o, c) + 1, l: Math.min(o, c) - 1, c, v: 1000 };
}

function makeHit(overrides: Partial<PatternHitDTO> = {}): PatternHitDTO {
  return {
    id: 1,
    symbol: "IRCON",
    name: "IRCON International Ltd.",
    timeframe: "1D",
    pattern_id: "falling_wedge",
    pattern_name: "Falling Wedge",
    family: "reversal",
    direction: "bullish",
    status: "confirmed",
    quality: "strong",
    confidence: 78.4,
    start_date: "2026-04-26",
    end_date: "2026-09-26",
    start_price: 100,
    end_price: 112.6,
    breakout_level: 112.6,
    target: 129.6,
    stop: 102.5,
    rr: 1.7,
    bars_ago: 2,
    volume_confirmed: true,
    trendlines: [],
    notes: "",
    ...overrides,
  };
}


interface FallbackSeries {
  type: string;
  data: number[];
  lineStyle: { color: string };
}

interface FallbackOption {
  series: FallbackSeries[];
}

describe("PatternMiniChart", () => {
  beforeEach(() => {
    for (const spy of [setChartOption, resizeChart, disposeChart, initChart, loadEchartsSpy, buildMock]) {
      spy.mockClear();
    }
    buildMock.mockImplementation(() => ({ mocked: "mini-chart" } as never));
    loadEchartsSpy.mockImplementation(async () => ({ init: initChart }));
    MockIntersectionObserver.instances = [];
    MockIntersectionObserver.autoIntersect = true;
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  test("renders the chart container", () => {
    render(() => <PatternMiniChart hit={makeHit()} />);
    expect(screen.getByTestId("patterns-mini-chart-IRCON-falling_wedge")).toBeInTheDocument();
  });

  test("passes candles, trendlines, trend_lines and trendlinesView to buildPatternChartOption", async () => {
    const candles = [candle("2026-09-01", 100, 102), candle("2026-09-02", 102, 105)];
    const lineA: Trendline = [
      { t: "2026-09-01", price: 106 },
      { t: "2026-09-02", price: 104 },
    ];
    const lineB: Trendline = [
      { t: "2026-09-01", price: 98 },
      { t: "2026-09-02", price: 99 },
    ];
    const trendLines: TrendLine[] = [
      {
        kind: "support",
        start_date: "2026-09-01",
        start_price: 98,
        end_date: "2026-09-02",
        end_price: 99,
        slope: 1,
        touches: 3,
        span_bars: 2,
        violations: 0,
      },
    ];
    const hit = makeHit({ candles, trendlines: [lineA, lineB], trend_lines: trendLines });

    render(() => <PatternMiniChart hit={hit} trendlinesView="support" />);

    await waitFor(() => expect(setChartOption).toHaveBeenCalled());
    expect(buildMock).toHaveBeenCalledTimes(1);
    expect(buildMock).toHaveBeenCalledWith({
      candles,
      trendlines: [lineA, lineB],
      hit,
      standaloneTrendLines: trendLines,
      trendlinesView: "support",
      compact: true,
    });
    expect(setChartOption).toHaveBeenCalledWith({ mocked: "mini-chart" }, true);
  });

  test("defaults trendlinesView to both", async () => {
    const hit = makeHit({ candles: [candle("2026-09-01", 100, 102)] });
    render(() => <PatternMiniChart hit={hit} />);
    await waitFor(() => expect(buildMock).toHaveBeenCalled());
    expect(buildMock).toHaveBeenCalledWith(expect.objectContaining({ trendlinesView: "both" }));
  });

  test("filters out empty trendlines before building the option", async () => {
    const lineA: Trendline = [
      { t: "2026-09-01", price: 106 },
      { t: "2026-09-02", price: 104 },
    ];
    const hit = makeHit({ candles: [candle("2026-09-01", 100, 102)], trendlines: [[], lineA] });
    render(() => <PatternMiniChart hit={hit} />);
    await waitFor(() => expect(buildMock).toHaveBeenCalled());
    expect(buildMock).toHaveBeenCalledWith(expect.objectContaining({ trendlines: [lineA] }));
  });

  test("falls back to the boundary sketch when there are no candles", async () => {
    const lineA: Trendline = [
      { t: "2026-09-01", price: 106 },
      { t: "2026-09-02", price: 104 },
    ];
    const lineB: Trendline = [
      { t: "2026-09-01", price: 98 },
      { t: "2026-09-02", price: 99 },
    ];
    render(() => <PatternMiniChart hit={makeHit({ candles: [], trendlines: [lineA, lineB] })} />);
    await waitFor(() => expect(setChartOption).toHaveBeenCalled());
    expect(buildMock).not.toHaveBeenCalled();
    const option = setChartOption.mock.calls[0][0] as FallbackOption;
    expect(option.series).toHaveLength(2);
    expect(option.series[0].type).toBe("line");
    expect(option.series[0].data).toEqual([106, 104]);
    expect(option.series[0].lineStyle.color).toBe(BOUNDARY_COLORS[0]);
    expect(option.series[1].data).toEqual([98, 99]);
    expect(option.series[1].lineStyle.color).toBe(BOUNDARY_COLORS[1]);
  });

  test("falls back to a start→end line colored by direction when nothing else exists", async () => {
    render(() => <PatternMiniChart hit={makeHit({ direction: "bullish", start_price: 100, end_price: 110 })} />);
    await waitFor(() => expect(setChartOption).toHaveBeenCalled());
    expect(buildMock).not.toHaveBeenCalled();
    const bullOption = setChartOption.mock.calls[0][0] as FallbackOption;
    expect(bullOption.series).toHaveLength(1);
    expect(bullOption.series[0].data).toEqual([100, 110]);
    expect(bullOption.series[0].lineStyle.color).toBe(POSITIVE);
    cleanup();

    setChartOption.mockClear();
    render(() => <PatternMiniChart hit={makeHit({ direction: "bearish", start_price: 110, end_price: 100 })} />);
    await waitFor(() => expect(setChartOption).toHaveBeenCalled());
    const bearOption = setChartOption.mock.calls[0][0] as FallbackOption;
    expect(bearOption.series).toHaveLength(1);
    expect(bearOption.series[0].data).toEqual([110, 100]);
    expect(bearOption.series[0].lineStyle.color).toBe(NEGATIVE);
  });

  test("visible card applies the option once", async () => {
    const hit = makeHit({ candles: [candle("2026-09-01", 100, 102)] });
    render(() => <PatternMiniChart hit={hit} />);
    await waitFor(() => expect(setChartOption).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(initChart).toHaveBeenCalledTimes(1);
    expect(setChartOption).toHaveBeenCalledTimes(1);
  });

  test("initially hidden card does not init until it intersects", async () => {
    MockIntersectionObserver.autoIntersect = false;
    const hit = makeHit({ candles: [candle("2026-09-01", 100, 102)] });
    render(() => <PatternMiniChart hit={hit} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByTestId("patterns-mini-chart-IRCON-falling_wedge")).toBeInTheDocument();
    expect(buildMock).not.toHaveBeenCalled();
    expect(loadEchartsSpy).not.toHaveBeenCalled();
    expect(initChart).not.toHaveBeenCalled();
    expect(setChartOption).not.toHaveBeenCalled();

    MockIntersectionObserver.instances[0]!.emit(true);
    await waitFor(() => expect(setChartOption).toHaveBeenCalledTimes(1));
    expect(buildMock).toHaveBeenCalledTimes(1);
    expect(initChart).toHaveBeenCalledTimes(1);
  });

  test("option updated while hidden is applied on reveal", async () => {
    MockIntersectionObserver.autoIntersect = false;
    let updateHit!: (hit: PatternHitDTO) => void;
    buildMock.mockImplementation(
      (input) => ({ version: input.candles[0]?.t ?? "none" } as never),
    );
    render(() => {
      const [hit, setHit] = createSignal(makeHit({ candles: [candle("2026-09-01", 100, 102)] }));
      updateHit = setHit;
      return <PatternMiniChart hit={hit()} />;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(buildMock).not.toHaveBeenCalled();
    expect(setChartOption).not.toHaveBeenCalled();

    updateHit(makeHit({ candles: [candle("2026-09-02", 200, 205)] }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(buildMock).not.toHaveBeenCalled();
    expect(setChartOption).not.toHaveBeenCalled();

    MockIntersectionObserver.instances[0]!.emit(true);
    await waitFor(() => expect(setChartOption).toHaveBeenCalledTimes(1));
    expect(buildMock).toHaveBeenCalledTimes(1);
    expect(setChartOption).toHaveBeenCalledWith({ version: "2026-09-02" }, true);
  });

  test("renders immediately when IntersectionObserver is unavailable", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const hit = makeHit({ candles: [candle("2026-09-01", 100, 102)] });
    render(() => <PatternMiniChart hit={hit} />);
    await waitFor(() => expect(setChartOption).toHaveBeenCalledTimes(1));
    expect(initChart).toHaveBeenCalledTimes(1);
    expect(MockIntersectionObserver.instances).toHaveLength(0);
  });

  test("cleanup disconnects the observer and disposes the chart", async () => {
    const hit = makeHit({ candles: [candle("2026-09-01", 100, 102)] });
    const view = render(() => <PatternMiniChart hit={hit} />);
    await waitFor(() => expect(setChartOption).toHaveBeenCalledTimes(1));
    const io = MockIntersectionObserver.instances[0]!;
    view.unmount();
    expect(io.disconnect).toHaveBeenCalledTimes(1);
    expect(disposeChart).toHaveBeenCalledTimes(1);
  });

  test("defers ECharts init so only intersecting cards initialize", async () => {
    MockIntersectionObserver.autoIntersect = false;
    render(() => (
      <>
        <PatternMiniChart hit={makeHit({ symbol: "VISIBLE", candles: [candle("2026-09-01", 100, 102)] })} />
        <PatternMiniChart hit={makeHit({ symbol: "OFFSCREEN", candles: [candle("2026-09-01", 100, 102)] })} />
      </>
    ));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(MockIntersectionObserver.instances).toHaveLength(2);
    expect(loadEchartsSpy).not.toHaveBeenCalled();
    expect(initChart).not.toHaveBeenCalled();

    MockIntersectionObserver.instances[0]!.emit(true);
    await waitFor(() => expect(initChart).toHaveBeenCalledTimes(1));
    expect(loadEchartsSpy).toHaveBeenCalledTimes(1);
    expect(initChart).toHaveBeenCalledTimes(1);
  });

  test("memoizes the option across unrelated resize events and keeps one instance", async () => {
    const hit = makeHit({ candles: [candle("2026-09-01", 100, 102)] });
    render(() => <PatternMiniChart hit={hit} />);
    await waitFor(() => expect(setChartOption).toHaveBeenCalledTimes(1));
    expect(buildMock).toHaveBeenCalledTimes(1);
    expect(initChart).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("resize"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(resizeChart).toHaveBeenCalled();
    expect(buildMock).toHaveBeenCalledTimes(1);
    expect(setChartOption).toHaveBeenCalledTimes(1);
    expect(initChart).toHaveBeenCalledTimes(1);
  });

  test("rebuilds the option on hit change without creating another instance", async () => {
    let updateHit!: (hit: PatternHitDTO) => void;
    buildMock.mockImplementation(
      (input) => ({ version: input.candles[0]?.t ?? "none" } as never),
    );
    render(() => {
      const [hit, setHit] = createSignal(makeHit({ candles: [candle("2026-09-01", 100, 102)] }));
      updateHit = setHit;
      return <PatternMiniChart hit={hit()} />;
    });
    await waitFor(() => expect(setChartOption).toHaveBeenCalledTimes(1));
    expect(buildMock).toHaveBeenCalledTimes(1);
    expect(initChart).toHaveBeenCalledTimes(1);

    updateHit(makeHit({ candles: [candle("2026-09-02", 200, 205)] }));
    await waitFor(() => expect(setChartOption).toHaveBeenCalledTimes(2));
    expect(buildMock).toHaveBeenCalledTimes(2);
    expect(setChartOption).toHaveBeenLastCalledWith({ version: "2026-09-02" }, true);
    expect(initChart).toHaveBeenCalledTimes(1);
  });

  test("ignores an ECharts module that resolves after unmount", async () => {
    let resolveLoad!: (lib: unknown) => void;
    loadEchartsSpy.mockImplementation(
      () => new Promise((resolve) => { resolveLoad = resolve; }),
    );
    const hit = makeHit({ candles: [candle("2026-09-01", 100, 102)] });
    const view = render(() => <PatternMiniChart hit={hit} />);
    await waitFor(() => expect(loadEchartsSpy).toHaveBeenCalled());
    view.unmount();

    expect(MockIntersectionObserver.instances[0]!.disconnect).toHaveBeenCalledTimes(1);

    resolveLoad({ init: initChart });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(initChart).not.toHaveBeenCalled();
    expect(setChartOption).not.toHaveBeenCalled();
  });
});
