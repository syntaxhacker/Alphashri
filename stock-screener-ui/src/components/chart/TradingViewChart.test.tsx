// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";

const lwMocks = vi.hoisted(() => ({ series: [] as any[] }));

vi.mock("lightweight-charts", () => {
  const makeSeries = () => {
    const series = {
      setData: vi.fn(),
      applyOptions: vi.fn(),
      removePriceLine: vi.fn(),
      createPriceLine: vi.fn(),
      priceScale: () => ({ applyOptions: vi.fn() }),
      priceToCoordinate: vi.fn(() => null),
    };
    lwMocks.series.push(series);
    return series;
  };
  return {
    createChart: vi.fn(() => ({
      addSeries: vi.fn(() => makeSeries()),
      removeSeries: vi.fn(),
      remove: vi.fn(),
      applyOptions: vi.fn(),
      panes: vi.fn(() => []),
      timeScale: vi.fn(() => ({
        subscribeVisibleLogicalRangeChange: vi.fn(),
        unsubscribeVisibleLogicalRangeChange: vi.fn(),
        fitContent: vi.fn(),
        setVisibleLogicalRange: vi.fn(),
        setVisibleRange: vi.fn(),
        timeToCoordinate: vi.fn(() => null),
      })),
    })),
    createSeriesMarkers: vi.fn(() => ({ setMarkers: vi.fn() })),
    ColorType: { Solid: "solid" },
    CandlestickSeries: "candlestick",
    HistogramSeries: "histogram",
    LineSeries: "line",
    LineStyle: { Dashed: 1, Dotted: 2, LargeDashed: 3, SparseDotted: 4, Solid: 0 },
    TickMarkType: { Year: 0, Month: 1, DayOfMonth: 2, TimeWithSeconds: 3, Time: 4 },
  };
});

import {
  TradingViewChart,
  extendAutoscaleWithLevels,
  levelWithinAutoscale,
  visibleBarsRange,
} from "./TradingViewChart";
import { createChart } from "lightweight-charts";
import { CHART_BG } from "@/ui/palette";

afterEach(() => {
  cleanup();
});

const CANDLES = [
  { time: "2026-10-12 09:15:00", open: 25700, high: 25720, low: 25690, close: 25710, volume: 1000 },
  { time: "2026-10-12 09:16:00", open: 25710, high: 25730, low: 25700, close: 25725, volume: 1200 },
];

describe("TradingViewChart redraw loop", () => {
  test("default chart surface is pitch black with no grid lines", () => {
    render(<TradingViewChart candles={CANDLES} />);
    const calls = vi.mocked(createChart).mock.calls;
    const opts = calls[calls.length - 1]?.[1] as any;
    expect(CHART_BG).toBe("#000000");
    expect(opts.layout.background).toEqual({ type: "solid", color: "#000000" });
    // Grid lines are hidden so the black surface stays clean; axes + crosshair remain.
    expect(opts.grid.vertLines.visible).toBe(false);
    expect(opts.grid.horzLines.visible).toBe(false);
  });

  test("resize redraws are coalesced and a pending frame is cancelled on unmount", () => {
    const rafSpy = vi.spyOn(window, "requestAnimationFrame");
    const cancelSpy = vi.spyOn(window, "cancelAnimationFrame");
    try {
      const { unmount } = render(<TradingViewChart candles={CANDLES} />);
      expect(rafSpy).not.toHaveBeenCalled();

      act(() => {
        window.dispatchEvent(new Event("resize"));
      });
      expect(rafSpy).toHaveBeenCalledTimes(1);
      expect(cancelSpy).not.toHaveBeenCalled();

      // A second resize before the frame fires coalesces: the first frame
      // is cancelled instead of queueing a second one behind it.
      act(() => {
        window.dispatchEvent(new Event("resize"));
      });
      expect(rafSpy).toHaveBeenCalledTimes(2);
      expect(cancelSpy).toHaveBeenCalledTimes(1);

      // Unmounting with a frame still pending cancels it — the stale
      // drawEntryLabels closure (and its candle arrays) is never retained
      // past cleanup, and nothing draws on a detached canvas.
      unmount();
      expect(cancelSpy).toHaveBeenCalledTimes(2);
    } finally {
      rafSpy.mockRestore();
      cancelSpy.mockRestore();
    }
  });
});

describe("visibleBarsRange", () => {
  test("returns min-low / max-high of the rendered window", () => {
    expect(
      visibleBarsRange([
        { low: 22680, high: 22700 },
        { low: 22850, high: 22880 },
      ]),
    ).toEqual({ low: 22680, high: 22880 });
  });

  test("null when empty or degenerate", () => {
    expect(visibleBarsRange([])).toBeNull();
    expect(visibleBarsRange([{ low: 100, high: 100 }])).toBeNull();
  });
});

describe("levelWithinAutoscale", () => {
  const bars = { low: 22680, high: 22880 }; // 200-pt window, ±5% pad = ±10

  test("levels within ±0.6% of spot pass even outside the bars", () => {
    // |22650 − 22690| = 40 ≤ 136 → in the spot band, below the bars' low.
    expect(levelWithinAutoscale(22650, 22690, bars)).toBe(true);
  });

  test("a bar-edge level far from the last price still passes via the range pad", () => {
    // |22880 − 22690| = 190 > 136 (outside the spot band) but 22880 is the
    // bars' high → inside the ±5% pad.
    expect(levelWithinAutoscale(22880, 22690, bars)).toBe(true);
  });

  test("far levels fail both gates", () => {
    expect(levelWithinAutoscale(22500, 22690, bars)).toBe(false);
    expect(levelWithinAutoscale(23300, 22690, bars)).toBe(false);
  });
});

describe("extendAutoscaleWithLevels", () => {
  const range = (minValue: number, maxValue: number) => ({
    priceRange: { minValue, maxValue },
  });

  test("keeps the range when levels sit inside it", () => {
    const out = extendAutoscaleWithLevels(range(22660, 23030), [22700, 22900]);
    expect(out?.priceRange).toEqual({ minValue: 22660, maxValue: 23030 });
  });

  test("caps far-level extension at 1.3× the bars' span", () => {
    // Bars 22,000–22,200 (span 200, cap 260). Both far levels are kept
    // without a spot filter, so the raw [21,900, 22,300] span (400) is
    // clamped: the 60-pt over-budget is split evenly (100/100 each side).
    const out = extendAutoscaleWithLevels(range(22000, 22200), [21900, 22300]);
    expect(out?.priceRange).toEqual({ minValue: 21970, maxValue: 22230 });
  });

  test("regression: a tight last-price engine range still covers the rendered window", () => {
    // 2026-10-21 13:50 tape: visible bars 22,680–22,880 (10:00 ≈ 22,880 →
    // 13:35 ≈ 22,680, last 22,690) but the engine handed back the tight
    // 22,680–22,740 slice. The axis must include both bar extremes.
    const bars = { low: 22680, high: 22880 };
    const out = extendAutoscaleWithLevels(range(22680, 22740), [22700], {
      spot: 22690,
      barsRange: bars,
    });
    expect(out?.priceRange).toEqual({ minValue: 22680, maxValue: 22880 });
    // Final span (200) sits inside [bars span, 1.3× bars span] = [200, 260].
    const span =
      (out?.priceRange?.maxValue ?? 0) - (out?.priceRange?.minValue ?? 0);
    expect(span).toBeGreaterThanOrEqual(200);
    expect(span).toBeLessThanOrEqual(260);
  });

  test("spot-gated levels: near widens, far is dropped", () => {
    const bars = { low: 22680, high: 22880 };
    const out = extendAutoscaleWithLevels(range(22680, 22880), [22500, 22650], {
      spot: 22690,
      barsRange: bars,
    });
    // 22,500 fails both gates; 22,650 passes via the spot band and widens low.
    expect(out?.priceRange).toEqual({ minValue: 22650, maxValue: 22880 });
  });

  test("ignores non-finite/non-positive levels and null input", () => {
    expect(
      extendAutoscaleWithLevels(range(22660, 23030), [NaN, 0, -5])?.priceRange,
    ).toEqual({ minValue: 22660, maxValue: 23030 });
    expect(extendAutoscaleWithLevels(null, [22500])).toBeNull();
    expect(
      extendAutoscaleWithLevels({ priceRange: null }, [22500])?.priceRange,
    ).toBeNull();
  });
});

describe("fitMarkLines scale guard", () => {
  const lines = () => [
    {
      yAxis: 22500,
      includeInScale: false,
      lineStyle: { color: "#f59e0b", type: "dotted", width: 1 },
      label: { position: "insideEndTop", formatter: "GFUEL↓ 22500" },
    },
    {
      yAxis: 25700,
      includeInScale: true,
      lineStyle: { color: "#16a34a", type: "solid", width: 1 },
      label: { position: "insideEndTop", formatter: "GSUP 25700" },
    },
  ];
  // Rendered window from CANDLES: low 25,690 / high 25,730, spot = 25,725.
  const barsRange = { minValue: 25690, maxValue: 25730 };

  test("far levels are still drawn as price lines but do not extend the scale", () => {
    const start = lwMocks.series.length;
    render(
      <TradingViewChart candles={CANDLES} fitMarkLines markLines={lines()} />,
    );
    // Last mounted chart's candle series.
    const candle = lwMocks.series[start];
    // Both levels are drawn…
    expect(candle.createPriceLine).toHaveBeenCalledTimes(2);
    // …but only the near one is folded into the autoscale.
    const applyCall = candle.applyOptions.mock.calls.find(
      ([opts]: any[]) => opts && "autoscaleInfoProvider" in opts,
    );
    expect(applyCall).toBeTruthy();
    const provider = (applyCall as any[])[0].autoscaleInfoProvider as (
      original: () => { priceRange: { minValue: number; maxValue: number } },
    ) => { priceRange: { minValue: number; maxValue: number } };
    // 22,500 fails the spot band (|22500 − 25725| ≫ 0.6%) and the bars pad,
    // so the window stays at the rendered bars; 25,700 sits inside already.
    const out = provider(() => ({ priceRange: { ...barsRange } }));
    expect(out.priceRange).toEqual({ minValue: 25690, maxValue: 25730 });
  });

  test("a tight engine range is floored back to the rendered window", () => {
    const start = lwMocks.series.length;
    render(
      <TradingViewChart candles={CANDLES} fitMarkLines markLines={lines()} />,
    );
    const candle = lwMocks.series[start];
    const applyCall = candle.applyOptions.mock.calls.find(
      ([opts]: any[]) => opts && "autoscaleInfoProvider" in opts,
    );
    expect(applyCall).toBeTruthy();
    const provider = (applyCall as any[])[0].autoscaleInfoProvider as (
      original: () => { priceRange: { minValue: number; maxValue: number } },
    ) => { priceRange: { minValue: number; maxValue: number } };
    // Engine hands a tight last-price slice; the rendered 25,690–25,730
    // window must still be covered.
    const out = provider(() => ({ priceRange: { minValue: 25710, maxValue: 25730 } }));
    expect(out.priceRange.minValue).toBeLessThanOrEqual(25690);
    expect(out.priceRange.maxValue).toBeGreaterThanOrEqual(25730);
    const span = out.priceRange.maxValue - out.priceRange.minValue;
    expect(span).toBeGreaterThanOrEqual(40);
    expect(span).toBeLessThanOrEqual(40 * 1.3);
  });

  test("far levels hide their gutter label + title (edge badges carry them); near keeps both", () => {
    const start = lwMocks.series.length;
    render(
      <TradingViewChart
        candles={CANDLES}
        fitMarkLines
        markLines={[
          {
            yAxis: 22500,
            includeInScale: false,
            lineStyle: { color: "#f59e0b", type: "dotted", width: 1 },
            label: { position: "insideEndTop", formatter: "GFUEL↓ 22500" },
          },
          {
            yAxis: 22700,
            includeInScale: true,
            lineStyle: { color: "#16a34a", type: "solid", width: 1 },
            label: { position: "insideEndTop", formatter: "GSUP 22700" },
          },
        ]}
      />,
    );
    const candle = lwMocks.series[start];
    const calls = candle.createPriceLine.mock.calls.map(([opts]: any[]) => opts);
    expect(calls).toHaveLength(2);
    // Far line: still a line, but no gutter label/title to stack at the edge.
    expect(calls[0]).toMatchObject({ price: 22500, axisLabelVisible: false, title: "" });
    // Near line: keeps its gutter label + in-chart title.
    expect(calls[1]).toMatchObject({ price: 22700, axisLabelVisible: true, title: "GSUP 22700" });
  });
});
