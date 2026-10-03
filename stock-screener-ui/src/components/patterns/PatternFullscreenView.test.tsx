// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
});
