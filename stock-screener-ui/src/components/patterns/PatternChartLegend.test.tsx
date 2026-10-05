// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { UIProvider } from "@/ui";
import { PatternChartLegend } from "./PatternChartLegend";
import { buildPatternTVData } from "./patternTVData";
import type { ChartCandle, PatternHitDTO } from "@/types/chartPatterns";

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: ({ children }) => <UIProvider>{children}</UIProvider> });
}

const CANDLES: ChartCandle[] = [
  { t: "2026-04-01", o: 100, h: 103, l: 99, c: 102, v: 1000 },
  { t: "2026-04-02", o: 102, h: 104, l: 100, c: 101, v: 1000 },
  { t: "2026-04-03", o: 101, h: 106, l: 100, c: 105, v: 1000 },
];

function makeHit(): PatternHitDTO {
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
    start_date: "2026-04-01",
    end_date: "2026-04-03",
    start_price: 100,
    end_price: 105,
    breakout_level: 0,
    target: 0,
    stop: 0,
    rr: 1.7,
    bars_ago: 2,
    volume_confirmed: true,
    trendlines: [
      [
        { t: "2026-04-01", price: 103 },
        { t: "2026-04-03", price: 106 },
      ],
      [
        { t: "2026-04-01", price: 99 },
        { t: "2026-04-03", price: 101 },
      ],
    ],
    trend_lines: [
      {
        kind: "support",
        start_date: "2026-04-01",
        start_price: 99,
        end_date: "2026-04-03",
        end_price: 101,
        slope: 1,
        touches: 3,
        span_bars: 3,
        violations: 0,
      },
      {
        kind: "resistance",
        start_date: "2026-04-01",
        start_price: 103,
        end_date: "2026-04-03",
        end_price: 105,
        slope: 1,
        touches: 2,
        span_bars: 3,
        violations: 0,
      },
    ],
    pivots: [],
    notes: "",
  };
}

describe("PatternChartLegend", () => {
  afterEach(() => cleanup());

  test("renders one swatch+label per drawn line name from buildPatternTVData", () => {
    const { lines } = buildPatternTVData({ candles: CANDLES, hit: makeHit() });
    expect(lines.length).toBeGreaterThan(0);
    r(<PatternChartLegend lines={lines} />);

    expect(screen.getByTestId("patterns-chart-legend")).toBeInTheDocument();
    // Two boundary segments share the pattern name → a single legend entry.
    expect(screen.getByTestId("patterns-chart-legend-item-Falling Wedge")).toBeInTheDocument();
    expect(screen.getByText("Falling Wedge")).toBeInTheDocument();
  });

  test("renders TLS/TLR entries when standalone lines are present", () => {
    const { lines } = buildPatternTVData({ candles: CANDLES, hit: makeHit() });
    r(<PatternChartLegend lines={lines} />);

    expect(screen.getByTestId("patterns-chart-legend-item-TLS")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-chart-legend-item-TLR")).toBeInTheDocument();
    expect(screen.getByText("TLS")).toBeInTheDocument();
    expect(screen.getByText("TLR")).toBeInTheDocument();
  });

  test("omits TLS/TLR when the view filter hides standalone lines", () => {
    const { lines } = buildPatternTVData({ candles: CANDLES, hit: makeHit(), trendlinesView: "none" });
    r(<PatternChartLegend lines={lines} />);

    expect(screen.getByTestId("patterns-chart-legend")).toBeInTheDocument();
    expect(screen.queryByTestId("patterns-chart-legend-item-TLS")).toBeNull();
    expect(screen.queryByTestId("patterns-chart-legend-item-TLR")).toBeNull();
  });

  test("renders nothing when there are no lines", () => {
    const { container } = r(<PatternChartLegend lines={[]} />);
    expect(screen.queryByTestId("patterns-chart-legend")).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  test("toggles a series via onToggle and reflects the hidden state", () => {
    const { lines } = buildPatternTVData({ candles: CANDLES, hit: makeHit() });
    const onToggle = vi.fn();
    const { rerender } = r(<PatternChartLegend lines={lines} hidden={new Set()} onToggle={onToggle} />);

    const item = screen.getByTestId("patterns-chart-legend-item-TLS");
    expect(item).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(item);
    expect(onToggle).toHaveBeenCalledWith("TLS");

    rerender(<PatternChartLegend lines={lines} hidden={new Set(["TLS"])} onToggle={onToggle} />);
    expect(screen.getByTestId("patterns-chart-legend-item-TLS")).toHaveAttribute("aria-pressed", "false");
  });

  test("is display-only without onToggle", () => {
    const { lines } = buildPatternTVData({ candles: CANDLES, hit: makeHit() });
    r(<PatternChartLegend lines={lines} />);
    const item = screen.getByTestId("patterns-chart-legend-item-TLS");
    expect(item).not.toHaveAttribute("aria-pressed");
    expect(item.tagName).toBe("SPAN");
  });

  test("includes level guides (Breakout/Target/Stop) as toggleable entries", () => {
    const { lines } = buildPatternTVData({ candles: CANDLES, hit: makeHit() });
    const onToggle = vi.fn();
    r(
      <PatternChartLegend
        lines={lines}
        levels={[
          { name: "Breakout", color: "#4C8DFF" },
          { name: "Target", color: "#3FB950" },
          { name: "Stop", color: "#F85149" },
        ]}
        hidden={new Set()}
        onToggle={onToggle}
      />,
    );

    const item = screen.getByTestId("patterns-chart-legend-item-Breakout");
    expect(item).toBeInTheDocument();
    fireEvent.click(item);
    expect(onToggle).toHaveBeenCalledWith("Breakout");
  });

  test("includes a Pivots marker entry as a toggleable item", () => {
    const { lines } = buildPatternTVData({ candles: CANDLES, hit: makeHit() });
    const onToggle = vi.fn();
    r(
      <PatternChartLegend
        lines={lines}
        markers={[{ name: "Pivots", color: "#8B949E" }]}
        hidden={new Set()}
        onToggle={onToggle}
      />,
    );

    const item = screen.getByTestId("patterns-chart-legend-item-Pivots");
    expect(item).toBeInTheDocument();
    fireEvent.click(item);
    expect(onToggle).toHaveBeenCalledWith("Pivots");
  });
});
