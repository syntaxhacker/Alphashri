// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";

vi.mock("@/ui", async () => {
  const { mockSolidUi } = await import("@/test-utils/solidUiMock");
  const { typeSize } = await import("@/ui/typography");
  return { ...mockSolidUi(), typeSize };
});
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import * as palette from "@/ui/palette";
import { createSignal } from "solid-js";
import { legendEntryBudget, PatternChartLegend } from "./PatternChartLegend";
import { buildPatternTVData } from "./patternTVData";
import type { ChartCandle, PatternHitDTO } from "@/types/chartPatterns";


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
    pivots: [],
    notes: "",
  };
}

describe("PatternChartLegend", () => {
  afterEach(() => cleanup());

  test("renders one swatch+label per drawn line name from buildPatternTVData", () => {
    const { lines } = buildPatternTVData({ candles: CANDLES, hit: makeHit() });
    expect(lines.length).toBeGreaterThan(0);
    render(() => <PatternChartLegend lines={lines} />);

    expect(screen.getByTestId("patterns-chart-legend")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-chart-legend-item-Falling Wedge")).toBeInTheDocument();
    expect(screen.getByText("Falling Wedge")).toBeInTheDocument();
  });

  test("renders nothing when there are no lines", () => {
    const { container } = render(() => <PatternChartLegend lines={[]} />);
    expect(screen.queryByTestId("patterns-chart-legend")).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  test("toggles a series via onToggle and reflects the hidden state", () => {
    const { lines } = buildPatternTVData({ candles: CANDLES, hit: makeHit() });
    const onToggle = vi.fn();
    const [hidden, setHidden] = createSignal<ReadonlySet<string>>(new Set());
    render(() => <PatternChartLegend lines={lines} hidden={hidden()} onToggle={onToggle} />);

    const item = screen.getByTestId("patterns-chart-legend-item-Falling Wedge");
    expect(item).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(item);
    expect(onToggle).toHaveBeenCalledWith("Falling Wedge");

    setHidden(new Set(["Falling Wedge"]));
    expect(screen.getByTestId("patterns-chart-legend-item-Falling Wedge")).toHaveAttribute("aria-pressed", "false");
  });

  test("is display-only without onToggle", () => {
    const { lines } = buildPatternTVData({ candles: CANDLES, hit: makeHit() });
    render(() => <PatternChartLegend lines={lines} />);
    const item = screen.getByTestId("patterns-chart-legend-item-Falling Wedge");
    expect(item).not.toHaveAttribute("aria-pressed");
    expect(item.tagName).toBe("SPAN");
  });

  test("includes level guides (Breakout/Target/Stop) as toggleable entries", () => {
    const { lines } = buildPatternTVData({ candles: CANDLES, hit: makeHit() });
    const onToggle = vi.fn();
    render(() =>       <PatternChartLegend
        lines={lines}
        levels={[
          { name: "Breakout", color: "#4C8DFF" },
          { name: "Target", color: palette.POSITIVE },
          { name: "Stop", color: palette.NEGATIVE },
        ]}
        hidden={new Set()}
        onToggle={onToggle}
      />);

    const item = screen.getByTestId("patterns-chart-legend-item-Breakout");
    expect(item).toBeInTheDocument();
    fireEvent.click(item);
    expect(onToggle).toHaveBeenCalledWith("Breakout");
  });

  test("includes a Pivots marker entry as a toggleable item", () => {
    const { lines } = buildPatternTVData({ candles: CANDLES, hit: makeHit() });
    const onToggle = vi.fn();
    render(() =>       <PatternChartLegend
        lines={lines}
        markers={[{ name: "Pivots", color: palette.NEUTRAL }]} 
        hidden={new Set()}
        onToggle={onToggle}
      />);

    const item = screen.getByTestId("patterns-chart-legend-item-Pivots");
    expect(item).toBeInTheDocument();
    fireEvent.click(item);
    expect(onToggle).toHaveBeenCalledWith("Pivots");
  });

  test("legendEntryBudget maps the chart column width to 3 / 5 / 7 entries", () => {
    expect(legendEntryBudget(0)).toBe(7);
    expect(legendEntryBudget(419)).toBe(3);
    expect(legendEntryBudget(420)).toBe(5);
    expect(legendEntryBudget(639)).toBe(5);
    expect(legendEntryBudget(640)).toBe(7);
  });

  test("maxEntries caps the rendered rows and reports the rest as +N", () => {
    const lines = [
      { name: "Alpha", color: palette.POSITIVE },
      { name: "Bravo", color: palette.NEGATIVE },
      { name: "Charlie", color: palette.WARNING },
      { name: "Delta", color: palette.INFO },
      { name: "Echo", color: palette.PRIMARY },
    ];
    render(() => <PatternChartLegend lines={lines} maxEntries={3} />);

    expect(screen.getByTestId("patterns-chart-legend-item-Alpha")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-chart-legend-item-Bravo")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-chart-legend-item-Charlie")).toBeInTheDocument();
    expect(screen.queryByTestId("patterns-chart-legend-item-Delta")).toBeNull();
    const overflow = screen.getByTestId("patterns-chart-legend-overflow");
    expect(overflow).toHaveTextContent("+2");
    expect(overflow).toHaveAttribute("title", "Delta, Echo");
  });

  test("maxEntries is a minimum of one and keeps toggle semantics for visible rows", () => {
    const lines = [
      { name: "Alpha", color: palette.POSITIVE },
      { name: "Bravo", color: palette.NEGATIVE },
    ];
    const onToggle = vi.fn();
    render(() => (
      <PatternChartLegend
        lines={lines}
        maxEntries={0}
        hidden={new Set(["Alpha"])}
        onToggle={onToggle}
      />
    ));
    const item = screen.getByTestId("patterns-chart-legend-item-Alpha");
    expect(item).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(item);
    expect(onToggle).toHaveBeenCalledWith("Alpha");
    expect(screen.getByTestId("patterns-chart-legend-overflow")).toHaveTextContent("+1");
  });

  test("no overflow chip when every entry fits", () => {
    render(() => (
      <PatternChartLegend
        lines={[
          { name: "Alpha", color: palette.POSITIVE },
          { name: "Bravo", color: palette.NEGATIVE },
        ]}
        maxEntries={3}
      />
    ));
    expect(screen.queryByTestId("patterns-chart-legend-overflow")).toBeNull();
  });
});
