// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { UIProvider, typeSize } from "@/ui";
import { VIZ_MUTED, VIZ_PANEL } from "@/ui/palette";
import { contrastRatio } from "@/utils/contrast";
import type { MarketRow } from "@/types/marketScreener";
import {
  buildRsiAdxOption,
  MAX_RSI_ADX_POINTS,
  RSI_ADX_FIXED_SIZE,
  RSI_ADX_MARK_LABEL_COLOR,
  RsiAdxScatterView,
  rsiAdxSize,
  selectRsiAdxRows,
} from "./RsiAdxScatterView";

const captured = vi.hoisted(() => ({
  option: null as any,
  clickHandler: null as ((params: any) => void) | null,
}));
vi.mock("@/utils/loadEcharts", () => ({
  loadEcharts: async () => ({
    init: () => ({
      setOption: (option: any) => {
        captured.option = option;
      },
      on: (event: string, handler: (params: any) => void) => {
        if (event === "click") captured.clickHandler = handler;
      },
      resize: () => {},
      dispose: () => {},
    }),
  }),
}));

const row = (
  symbol: string,
  rsi: number | null,
  adx: number | null,
  change: number,
  marketCapCr: number | null = 1000,
): MarketRow => ({
  symbol,
  name: `${symbol} Ltd`,
  sector: "Energy",
  exchange: "NSE",
  close: 100,
  change,
  relativeVolume: 1,
  marketCapCr,
  capTier: "mid",
  rsi,
  adx,
  sma20: null,
  sma50: null,
  sma200: null,
  perfW: null,
  perf1m: null,
  high52w: null,
  low52w: null,
  pos52w: null,
  peRatio: null,
  pbRatio: null,
  dividendYield: null,
  roe: null,
  psRatio: null,
  fcfYield: null,
  revenue: null,
  netIncome: null,
  debtToEquity: null,
  currentRatio: null,
  grossMargin: null,
  operatingMargin: null,
  revYoy: null,
  epsYoy: null,
  volume: null,
  avgVolume: null,
  gap: null,
  atr: null,
  high: null,
  low: null,
  valueTraded: null,
  to52wHighPct: null,
  from52wLowPct: null,
  rangeVsAtr: null,
  fno: false,
  etf: false,
});

const fixture = () => [
  row("AAA", 62, 28, 2.5, 5000),
  row("BBB", 18, 15, -1.5, 2500),
  row("NOADX", 55, null, 3, 900),
  row("NORSI", null, 30, 1, 800),
];

async function renderScatter(rows: MarketRow[], onSymbolClick = vi.fn()) {
  render(() => (
    <UIProvider>
      <RsiAdxScatterView rows={rows} onSymbolClick={onSymbolClick} />
    </UIProvider>
  ));
  await vi.waitFor(() => expect(captured.option).toBeTruthy());
  return onSymbolClick;
}

const data = () => captured.option.series[0].data as any[];

beforeEach(() => {
  captured.option = null;
  captured.clickHandler = null;
});
afterEach(cleanup);

describe("RsiAdxScatterView — scatter geometry and filtering", () => {
  test("known RSI/ADX pairs land at [rsi, adx] and null indicators are excluded", async () => {
    await renderScatter(fixture());
    const points = data();
    expect(points).toHaveLength(2);
    expect(points.map((p) => p.name)).toEqual(["AAA", "BBB"]);
    expect(points.map((p) => p.value)).toEqual([
      [62, 28],
      [18, 15],
    ]);
    expect(captured.option.xAxis).toMatchObject({ type: "value", min: 0, max: 100 });
    expect(captured.option.yAxis).toMatchObject({ type: "value", min: 0, max: 100 });
    expect(screen.getByTestId("rsi-adx-count")).toHaveTextContent("2 / 4");
  });

  test("the pure builder agrees with the rendered option", () => {
    const { plotted } = selectRsiAdxRows(fixture());
    const built = buildRsiAdxOption(plotted);
    expect(built.series[0].data.map((p: any) => p.value)).toEqual([
      [62, 28],
      [18, 15],
    ]);
    expect(built.series[0].data.find((p: any) => p.name === "AAA").change).toBe(2.5);
    expect(built.series[0].data.find((p: any) => p.name === "BBB").itemStyle.color).not.toBe(
      built.series[0].data.find((p: any) => p.name === "AAA").itemStyle.color,
    );
  });

  test("markLine carries RSI 50/70 and ADX 20/25 with quadrant labels", async () => {
    await renderScatter(fixture());
    const markLine = captured.option.series[0].markLine;
    expect(markLine.label.color).toBe(RSI_ADX_MARK_LABEL_COLOR);
    const axes = markLine.data.map((line: any) => line.xAxis ?? line.yAxis);
    expect(axes).toEqual([50, 70, 20, 25]);
    const labels = markLine.data.map((line: any) => line.label.formatter).join(" | ");
    expect(labels).toContain("RSI 50 · weak");
    expect(labels).toContain("overbought");
    expect(labels).toContain("ADX 25 · trend");
    expect(labels).toContain("ADX 20");
  });
});

describe("RsiAdxScatterView — option layout", () => {
  const option = () => buildRsiAdxOption([]);

  test("threshold labels sit inside the plot ends, never on the axes", () => {
    const lines = option().series[0].markLine.data;
    const positions = lines.map((line: any) => line.label.position);
    expect(positions).toEqual([
      "insideEndTop",
      "insideEndTop",
      "insideEndTop",
      "insideEndTop",
    ]);
    expect(positions.every((position: string) => position.startsWith("inside"))).toBe(true);
    expect(positions.some((position: string) => position === "start")).toBe(false);
    // insideEndTop rotates a vertical markLine's label unless it is pinned flat.
    expect(lines[0].label.rotate).toBe(0);
    expect(lines[1].label.rotate).toBe(0);
  });

  test("threshold chips have a panel background, padding and readable ink", () => {
    const label = option().series[0].markLine.label;
    expect(label).toMatchObject({
      backgroundColor: VIZ_PANEL,
      padding: [2, 4],
      borderRadius: 4,
      fontSize: typeSize("micro"),
    });
    expect(contrastRatio(label.color, VIZ_PANEL)).toBeGreaterThanOrEqual(4.5);
    expect(label.color).toBe(VIZ_MUTED);
  });

  test("the grid contains axis labels and leaves room for the axis names", () => {
    const grid = option().grid;
    expect(grid.containLabel).toBe(true);
    expect(grid.right).toBeGreaterThanOrEqual(16);
    expect(grid.top).toBeGreaterThanOrEqual(20);
    expect(grid.bottom).toBeGreaterThanOrEqual(20);
    expect(option().xAxis.name).toBe("RSI");
    expect(option().yAxis.name).toBe("ADX");
  });

  test("axis label font size comes from the shared type scale", () => {
    const built = option();
    expect(built.xAxis.axisLabel.fontSize).toBe(typeSize("micro"));
    expect(built.yAxis.axisLabel.fontSize).toBe(typeSize("micro"));
    expect(typeSize("micro")).toBeGreaterThanOrEqual(12);
  });

  test("the four threshold labels live on the chart, not in the legend", async () => {
    await renderScatter(fixture());
    const built = buildRsiAdxOption(selectRsiAdxRows(fixture()).plotted);
    const formatters = built.series[0].markLine.data.map((line: any) => line.label.formatter);
    expect(formatters).toEqual([
      "RSI 50 · weak",
      "RSI 70 · overbought",
      "ADX 20",
      "ADX 25 · trend",
    ]);
    const legend = screen.getByTestId("rsi-adx-legend");
    expect(legend).toHaveTextContent("loss ← change → gain");
    expect(legend).toHaveTextContent("area ∝ √market cap");
    for (const duplicated of [
      "thresholds",
      "RSI 50",
      "ADX 20",
      "weak trend",
      "overbought",
      "no trend",
      "trending",
    ]) {
      expect(legend).not.toHaveTextContent(duplicated);
    }
    expect(legend.className).not.toContain("overflow-hidden");
  });

  test("the count is never clipped and carries the full sentence in its title", async () => {
    await renderScatter(fixture());
    const count = screen.getByTestId("rsi-adx-count");
    expect(count).toHaveTextContent("2 / 4");
    expect(count).toHaveAttribute("title", "2 of 4 eligible rows plotted (largest caps first)");
    expect(count.className).toContain("whitespace-nowrap");
    expect(screen.getByTestId("rsi-adx-toolbar").className).not.toContain("overflow-hidden");
  });
});

describe("RsiAdxScatterView — interaction, empty state and size", () => {
  test("clicking a point forwards its symbol to onSymbolClick", async () => {
    const onSymbolClick = await renderScatter(fixture());
    captured.clickHandler?.({ data: { symbol: "AAA" } });
    expect(onSymbolClick).toHaveBeenCalledTimes(1);
    expect(onSymbolClick).toHaveBeenCalledWith("AAA");
  });

  test("no plottable indicators renders the honest empty state", () => {
    render(() => (
      <UIProvider>
        <RsiAdxScatterView rows={[row("X", null, null, 0), row("Y", 50, null, 1)]} />
      </UIProvider>
    ));
    expect(screen.getByTestId("rsi-adx-empty")).toHaveTextContent(
      "No RSI/ADX data in the current filter.",
    );
    expect(screen.queryByTestId("rsi-adx-canvas")).not.toBeInTheDocument();
  });

  test("a null market cap gets the fixed size, never NaN", () => {
    expect(rsiAdxSize(null, 5000)).toBe(RSI_ADX_FIXED_SIZE);
    expect(rsiAdxSize(undefined, 5000)).toBe(RSI_ADX_FIXED_SIZE);
    expect(rsiAdxSize(Number.NaN, 5000)).toBe(RSI_ADX_FIXED_SIZE);
    expect(Number.isNaN(rsiAdxSize(null, 5000))).toBe(false);
  });

  test("a null-cap row still emits a finite marker size in the rendered option", async () => {
    await renderScatter([row("NOCAP", 50, 25, 0, null), row("WITHCAP", 60, 30, 1, 5000)]);
    const noCap = data().find((p) => p.name === "NOCAP");
    const withCap = data().find((p) => p.name === "WITHCAP");
    expect(noCap.symbolSize).toBe(RSI_ADX_FIXED_SIZE);
    expect(Number.isFinite(noCap.symbolSize)).toBe(true);
    expect(withCap.symbolSize).toBeGreaterThan(noCap.symbolSize);
  });

  test("the largest 300 names are plotted and the counter reports the remainder", async () => {
    const rows = Array.from({ length: MAX_RSI_ADX_POINTS + 1 }, (_, i) =>
      row(`S${String(i).padStart(4, "0")}`, 40 + (i % 40), 20 + (i % 30), 1, i + 1),
    );
    await renderScatter(rows);
    expect(data()).toHaveLength(MAX_RSI_ADX_POINTS);
    expect(screen.getByTestId("rsi-adx-count")).toHaveTextContent(
      `${MAX_RSI_ADX_POINTS} / ${MAX_RSI_ADX_POINTS + 1}`,
    );
    expect(screen.getByTestId("rsi-adx-count")).toHaveAttribute(
      "title",
      `${MAX_RSI_ADX_POINTS} of ${(MAX_RSI_ADX_POINTS + 1).toLocaleString()} eligible rows plotted (largest caps first)`,
    );
    expect(data()[0]!.name).toBe(`S${String(MAX_RSI_ADX_POINTS).padStart(4, "0")}`);
  });
});
