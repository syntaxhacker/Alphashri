// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { UIProvider } from "@/ui";
import type { PatternHitDTO } from "@/types/chartPatterns";
import { PatternFullscreenView } from "./PatternFullscreenView";

const { setChartOption } = vi.hoisted(() => ({ setChartOption: vi.fn() }));

vi.mock("@/hooks/useECharts", () => ({
  useECharts: () => ({
    chartRef: { current: null },
    chartInstance: { current: null },
    setChartOption,
  }),
}));

const HIT: PatternHitDTO = {
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
  notes: "Higher lows into a falling wedge.",
  last_close: 113.4,
  day_change_pct: 1.2,
  pivots: [{ t: "2026-05-04", price: 108, kind: "low" }],
};

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: ({ children }) => <UIProvider>{children}</UIProvider> });
}

describe("PatternFullscreenView", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  test("renders the chart and the right data panel without a level row", () => {
    r(<PatternFullscreenView opened onClose={vi.fn()} hit={HIT} candles={[]} />);

    expect(screen.getByTestId("patterns-fullscreen-modal")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-fullscreen-chart")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-fullscreen-panel")).toBeInTheDocument();

    // Meta lives in the panel; the breakout/target/stop/rr/confidence row is gone.
    expect(screen.getByTestId("patterns-status-confirmed")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-quality-strong")).toBeInTheDocument();
    expect(screen.getByText("Last close")).toBeInTheDocument();
    expect(screen.getByText("Day")).toBeInTheDocument();
    expect(screen.queryByText("Target")).toBeNull();
    expect(screen.queryByText("Stop")).toBeNull();
    expect(screen.queryByText("R:R")).toBeNull();
    expect(screen.queryByText("Confidence")).toBeNull();
  });

  test("keeps the collapsible pivot list in the panel", () => {
    r(<PatternFullscreenView opened onClose={vi.fn()} hit={HIT} candles={[]} />);
    expect(screen.getByTestId("patterns-detail-pivots")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-detail-pivots-toggle")).toBeInTheDocument();
  });

  test("renders nothing but the chart when no hit is selected", () => {
    r(<PatternFullscreenView opened onClose={vi.fn()} hit={null} candles={[]} />);
    expect(screen.getByTestId("patterns-fullscreen-chart")).toBeInTheDocument();
    expect(screen.queryByTestId("patterns-fullscreen-panel")).toBeNull();
  });

  test("draws boundaries and pivots but no breakout/target/stop guides", () => {
    const t = "2026-09-26T09:15:00+05:30";
    const candles = [{ t, o: 100, h: 115, l: 98, c: 112, v: 1000 }];
    r(
      <PatternFullscreenView
        opened
        onClose={vi.fn()}
        hit={{
          ...HIT,
          trendlines: [
            [{ t, price: 115 }],
            [{ t, price: 100 }],
          ],
          pivots: [
            { t, price: 112, kind: "high" },
            { t, price: 101, kind: "low" },
          ],
        }}
        candles={candles}
      />,
    );

    expect(setChartOption).toHaveBeenCalled();
    const calls = setChartOption.mock.calls;
    const option = calls[calls.length - 1]?.[0] as {
      series: Array<{ name?: string; type: string; markLine?: unknown }>;
    };
    const names = option.series.map((s) => s.name);
    // Boundary lines are grouped under the pattern name (not generic upper/lower).
    expect(names).toContain("Falling Wedge");
    expect(names).not.toContain("Upper boundary");
    expect(names).not.toContain("Lower boundary");
    expect(names).toContain("Pivot High");
    expect(names).toContain("Pivot Low");

    const candleSeries = option.series.find((s) => s.type === "candlestick");
    expect(candleSeries?.markLine).toBeUndefined();
  });

  test("draws only the selected standalone trendline kinds", () => {
    const t = "2026-09-26T09:15:00+05:30";
    const candles = [{ t, o: 100, h: 115, l: 98, c: 112, v: 1000 }];
    r(
      <PatternFullscreenView
        opened
        onClose={vi.fn()}
        hit={HIT}
        candles={candles}
        trendLines={[
          { kind: "support", start_date: t, start_price: 98, end_date: t, end_price: 100, slope: 0, touches: 3, span_bars: 1, violations: 0 },
          { kind: "resistance", start_date: t, start_price: 112, end_date: t, end_price: 114, slope: 0, touches: 2, span_bars: 1, violations: 0 },
        ]}
        trendlinesView="support"
      />,
    );

    expect(setChartOption).toHaveBeenCalled();
    const calls = setChartOption.mock.calls;
    const option = calls[calls.length - 1]?.[0] as {
      series: Array<{ name?: string }>;
    };
    const names = option.series.map((s) => s.name);
    expect(names).toContain("TLS");
    expect(names).not.toContain("TLR");
  });

  test("renders nothing when closed", () => {
    r(<PatternFullscreenView opened={false} onClose={vi.fn()} hit={HIT} candles={[]} />);
    expect(screen.queryByTestId("patterns-fullscreen-modal")).toBeNull();
    expect(screen.queryByTestId("patterns-fullscreen-chart")).toBeNull();
    expect(setChartOption).not.toHaveBeenCalled();
  });

  test("shows the empty state and skips the chart option without candles", () => {
    r(<PatternFullscreenView opened onClose={vi.fn()} hit={HIT} candles={[]} />);
    expect(screen.getByText("No chart data")).toBeInTheDocument();
    expect(setChartOption).not.toHaveBeenCalled();
  });

  test("forwards onClose to the dialog close button", () => {
    const onClose = vi.fn();
    r(<PatternFullscreenView opened onClose={onClose} hit={HIT} candles={[]} />);
    fireEvent.click(screen.getByLabelText("close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("renders the title, meta, notes and last-close/day values in the panel", () => {
    r(<PatternFullscreenView opened onClose={vi.fn()} hit={HIT} candles={[]} />);
    expect(screen.getByText("IRCON · Falling Wedge")).toBeInTheDocument();
    expect(screen.getByText("IRCON · 1D · 2 bars ago")).toBeInTheDocument();
    expect(screen.getByText("Higher lows into a falling wedge.")).toBeInTheDocument();
    expect(screen.getByText(/113\.40/)).toBeInTheDocument();
    expect(screen.getByText(/1\.20%/)).toBeInTheDocument();
  });

  test("builds a large zoomable option with axes, legend and tooltip", () => {
    const t = "2026-09-26T09:15:00+05:30";
    const candles = [{ t, o: 100, h: 115, l: 98, c: 112, v: 1000 }];
    r(
      <PatternFullscreenView
        opened
        onClose={vi.fn()}
        hit={{ ...HIT, trendlines: [[{ t, price: 115 }], [{ t, price: 100 }]] }}
        candles={candles}
      />,
    );

    expect(setChartOption).toHaveBeenCalled();
    const calls = setChartOption.mock.calls;
    const option = calls[calls.length - 1]?.[0] as {
      grid: { left: number; right: number; top: number; bottom: number };
      dataZoom: unknown[];
      legend: { data: string[] } | undefined;
      xAxis: { show: boolean };
      yAxis: { show: boolean };
      tooltip: { trigger: string };
    };
    // large: true → roomy margins; showZoom: true → inside + slider zoom.
    expect(option.grid).toEqual({ left: 64, right: 96, top: 48, bottom: 64 });
    expect(option.dataZoom).toHaveLength(2);
    expect(option.xAxis.show).toBe(true);
    expect(option.yAxis.show).toBe(true);
    expect(option.tooltip.trigger).toBe("axis");
    expect(option.legend?.data).toContain("Falling Wedge");
  });

  test("draws sibling overlays dashed while skipping the selected instance", () => {
    const t = "2026-09-26T09:15:00+05:30";
    const candles = [{ t, o: 100, h: 115, l: 98, c: 112, v: 1000 }];
    r(
      <PatternFullscreenView
        opened
        onClose={vi.fn()}
        hit={{ ...HIT, trendlines: [[{ t, price: 115 }], [{ t, price: 100 }]] }}
        candles={candles}
        overlays={[
          // Same pattern id AND same start date → the selected instance, hidden.
          { pattern_id: "falling_wedge", pattern_name: "Falling Wedge", start_date: "2026-04-26", trendlines: [[{ t, price: 115 }], [{ t, price: 100 }]] },
          { pattern_id: "double_bottom", pattern_name: "Double Bottom", trendlines: [[{ t, price: 120 }], [{ t, price: 105 }]] },
        ]}
      />,
    );

    expect(setChartOption).toHaveBeenCalled();
    const calls = setChartOption.mock.calls;
    const option = calls[calls.length - 1]?.[0] as {
      series: Array<{ name?: string; type: string; lineStyle?: { type: string; width: number } }>;
    };
    const names = option.series.map((s) => s.name);
    // Sibling drawn; selected instance not duplicated as a dashed sibling.
    expect(names).toContain("Double Bottom");
    expect(names).not.toContain("Falling Wedge (2)");
    const selected = option.series.filter((s) => s.name === "Falling Wedge");
    const sibling = option.series.filter((s) => s.name === "Double Bottom");
    expect(selected.length).toBeGreaterThan(0);
    expect(sibling.length).toBeGreaterThan(0);
    expect(selected.every((s) => s.lineStyle?.type === "solid")).toBe(true);
    expect(sibling.every((s) => s.lineStyle?.type === "dashed")).toBe(true);
    // large: true → selected boundaries are thicker than siblings.
    expect(selected[0]?.lineStyle?.width).toBe(3);
    expect(sibling[0]?.lineStyle?.width).toBe(2);
  });

  test("draws both standalone kinds by default", () => {
    const t = "2026-09-26T09:15:00+05:30";
    const candles = [{ t, o: 100, h: 115, l: 98, c: 112, v: 1000 }];
    const lines = [
      { kind: "support" as const, start_date: t, start_price: 98, end_date: t, end_price: 100, slope: 0, touches: 3, span_bars: 1, violations: 0 },
      { kind: "resistance" as const, start_date: t, start_price: 112, end_date: t, end_price: 114, slope: 0, touches: 2, span_bars: 1, violations: 0 },
    ];
    r(<PatternFullscreenView opened onClose={vi.fn()} hit={HIT} candles={candles} trendLines={lines} />);

    const calls = setChartOption.mock.calls;
    const option = calls[calls.length - 1]?.[0] as { series: Array<{ name?: string }> };
    const names = option.series.map((s) => s.name);
    expect(names).toContain("TLS");
    expect(names).toContain("TLR");
  });

  test("draws only resistance lines for the resistance view", () => {
    const t = "2026-09-26T09:15:00+05:30";
    const candles = [{ t, o: 100, h: 115, l: 98, c: 112, v: 1000 }];
    r(
      <PatternFullscreenView
        opened
        onClose={vi.fn()}
        hit={HIT}
        candles={candles}
        trendLines={[
          { kind: "support", start_date: t, start_price: 98, end_date: t, end_price: 100, slope: 0, touches: 3, span_bars: 1, violations: 0 },
          { kind: "resistance", start_date: t, start_price: 112, end_date: t, end_price: 114, slope: 0, touches: 2, span_bars: 1, violations: 0 },
        ]}
        trendlinesView="resistance"
      />,
    );

    const calls = setChartOption.mock.calls;
    const option = calls[calls.length - 1]?.[0] as { series: Array<{ name?: string }> };
    const names = option.series.map((s) => s.name);
    expect(names).toContain("TLR");
    expect(names).not.toContain("TLS");
  });

  test("draws no standalone lines for the none view", () => {
    const t = "2026-09-26T09:15:00+05:30";
    const candles = [{ t, o: 100, h: 115, l: 98, c: 112, v: 1000 }];
    r(
      <PatternFullscreenView
        opened
        onClose={vi.fn()}
        hit={HIT}
        candles={candles}
        trendLines={[
          { kind: "support", start_date: t, start_price: 98, end_date: t, end_price: 100, slope: 0, touches: 3, span_bars: 1, violations: 0 },
          { kind: "resistance", start_date: t, start_price: 112, end_date: t, end_price: 114, slope: 0, touches: 2, span_bars: 1, violations: 0 },
        ]}
        trendlinesView="none"
      />,
    );

    const calls = setChartOption.mock.calls;
    const option = calls[calls.length - 1]?.[0] as { series: Array<{ name?: string }> };
    const names = option.series.map((s) => s.name);
    expect(names).not.toContain("TLS");
    expect(names).not.toContain("TLR");
  });

  test("falls back to the hit trend_lines when no trendLines prop is given", () => {
    const t = "2026-09-26T09:15:00+05:30";
    const candles = [{ t, o: 100, h: 115, l: 98, c: 112, v: 1000 }];
    r(
      <PatternFullscreenView
        opened
        onClose={vi.fn()}
        hit={{
          ...HIT,
          trend_lines: [
            { kind: "support", start_date: t, start_price: 98, end_date: t, end_price: 100, slope: 0, touches: 3, span_bars: 1, violations: 0 },
          ],
        }}
        candles={candles}
      />,
    );

    const calls = setChartOption.mock.calls;
    const option = calls[calls.length - 1]?.[0] as { series: Array<{ name?: string }> };
    expect(option.series.map((s) => s.name)).toContain("TLS");
  });

  test("suppresses the breakout/target/stop level guides on the candle series", () => {
    const t = "2026-09-26T09:15:00+05:30";
    const candles = [{ t, o: 100, h: 115, l: 98, c: 112, v: 1000 }];
    r(
      <PatternFullscreenView
        opened
        onClose={vi.fn()}
        hit={{ ...HIT, breakout_level: 112.6, target: 129.6, stop: 102.5 }}
        candles={candles}
      />,
    );

    const calls = setChartOption.mock.calls;
    const option = calls[calls.length - 1]?.[0] as {
      series: Array<{ name?: string; type: string; markLine?: unknown }>;
    };
    const candleSeries = option.series.filter((s) => s.type === "candlestick");
    expect(candleSeries).toHaveLength(1);
    expect(candleSeries[0]?.markLine).toBeUndefined();
  });
});
