// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { UIProvider } from "@/ui";
import { NEGATIVE, POSITIVE } from "@/ui/palette";
import type { ChartCandle, PatternHitDTO, TrendLine, Trendline } from "@/types/chartPatterns";
import { BOUNDARY_COLORS, buildPatternChartOption } from "./patternChartOption";
import { PatternMiniChart } from "./PatternMiniChart";

const { setChartOption } = vi.hoisted(() => ({ setChartOption: vi.fn() }));

vi.mock("@/hooks/useECharts", () => ({
  useECharts: () => ({
    chartRef: { current: null },
    chartInstance: { current: null },
    setChartOption,
  }),
}));

vi.mock("./patternChartOption", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, buildPatternChartOption: vi.fn(() => ({ mocked: "mini-chart" })) };
});

const buildMock = vi.mocked(buildPatternChartOption);

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

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: ({ children }) => <UIProvider>{children}</UIProvider> });
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
    setChartOption.mockClear();
    buildMock.mockClear();
  });
  afterEach(() => cleanup());

  test("renders the chart container", () => {
    r(<PatternMiniChart hit={makeHit()} />);
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

    r(<PatternMiniChart hit={hit} trendlinesView="support" />);

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
    expect(setChartOption).toHaveBeenCalledWith({ mocked: "mini-chart" });
  });

  test("defaults trendlinesView to both", async () => {
    const hit = makeHit({ candles: [candle("2026-09-01", 100, 102)] });
    r(<PatternMiniChart hit={hit} />);
    await waitFor(() => expect(buildMock).toHaveBeenCalled());
    expect(buildMock).toHaveBeenCalledWith(expect.objectContaining({ trendlinesView: "both" }));
  });

  test("filters out empty trendlines before building the option", async () => {
    const lineA: Trendline = [
      { t: "2026-09-01", price: 106 },
      { t: "2026-09-02", price: 104 },
    ];
    const hit = makeHit({ candles: [candle("2026-09-01", 100, 102)], trendlines: [[], lineA] });
    r(<PatternMiniChart hit={hit} />);
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
    r(<PatternMiniChart hit={makeHit({ candles: [], trendlines: [lineA, lineB] })} />);
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
    r(<PatternMiniChart hit={makeHit({ direction: "bullish", start_price: 100, end_price: 110 })} />);
    await waitFor(() => expect(setChartOption).toHaveBeenCalled());
    expect(buildMock).not.toHaveBeenCalled();
    const bullOption = setChartOption.mock.calls[0][0] as FallbackOption;
    expect(bullOption.series).toHaveLength(1);
    expect(bullOption.series[0].data).toEqual([100, 110]);
    expect(bullOption.series[0].lineStyle.color).toBe(POSITIVE);
    cleanup();

    setChartOption.mockClear();
    r(<PatternMiniChart hit={makeHit({ direction: "bearish", start_price: 110, end_price: 100 })} />);
    await waitFor(() => expect(setChartOption).toHaveBeenCalled());
    const bearOption = setChartOption.mock.calls[0][0] as FallbackOption;
    expect(bearOption.series).toHaveLength(1);
    expect(bearOption.series[0].data).toEqual([110, 100]);
    expect(bearOption.series[0].lineStyle.color).toBe(NEGATIVE);
  });
});
