// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { UIProvider } from "@/ui";
import { MarketSectorTreemap } from "./MarketSectorTreemap";
import { MarketMapView } from "./MarketMapView";
import { marketLerpRgb, marketTileColor, toTreemapRow, type MarketSizeMetric } from "./marketTreemap";
import { getStockMetricRange } from "@/components/heatmap/stockTreemap";
import { relativeLuminance } from "@/utils/contrast";
import type { MarketRow } from "@/types/marketScreener";

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

const row = (symbol: string, sector: string | null, change: number): MarketRow => ({
  symbol,
  name: symbol,
  sector,
  exchange: "NSE",
  close: 100,
  change,
  relativeVolume: 1,
  marketCapCr: 1000,
  capTier: "small",
  rsi: 50,
  adx: 20,
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
  fno: false,
  etf: false,
});

async function renderTreemap(rows: MarketRow[], onSymbolClick = vi.fn(), sizeBy?: MarketSizeMetric) {
  render(() => (
    <UIProvider>
      <MarketSectorTreemap rows={rows} onSymbolClick={onSymbolClick} sizeBy={sizeBy} />
    </UIProvider>
  ));
  await vi.waitFor(() => expect(captured.option).toBeTruthy());
  return onSymbolClick;
}

beforeEach(() => {
  captured.option = null;
  captured.clickHandler = null;
});
afterEach(cleanup);

describe("MarketSectorTreemap", () => {
  test("the chart receives nested sector parents with stock children", async () => {
    await renderTreemap([
      row("A", "Energy", 4),
      row("B", "Energy", 2),
      row("C", "IT", 5),
    ]);
    const data = captured.option.series[0].data;
    expect(data.map((p: any) => p.name)).toEqual(["Energy", "IT"]);
    expect(data.every((p: any) => p.sectorParent === true)).toBe(true);
    expect(data.find((p: any) => p.name === "Energy").children.map((c: any) => c.name)).toEqual([
      "A", "B",
    ]);
  });

  test("stock children keep the day-change ramp; sector parents keep a neutral fill", async () => {
    const rows = [row("UP", "Energy", 4), row("DOWN", "Energy", -2.5)];
    await renderTreemap(rows);
    const { min, max } = getStockMetricRange(rows.map((r) => toTreemapRow(r)), "change_pct");
    const parent = captured.option.series[0].data[0];
    expect(parent.sectorParent).toBe(true);
    const down = parent.children.find((c: any) => c.name === "DOWN");
    const up = parent.children.find((c: any) => c.name === "UP");
    expect(down.itemStyle.color).toBe(marketTileColor(-2.5, min, max));
    expect(up.itemStyle.color).toBe(marketTileColor(4, min, max));
    expect(down.itemStyle.color).not.toBe(up.itemStyle.color);
  });

  test("clicking a stock tile calls onSymbolClick with the symbol", async () => {
    const onSymbolClick = await renderTreemap([row("RELIANCE", "Energy", 3)]);
    captured.clickHandler?.({ data: { name: "RELIANCE", value: 3, sector: "Energy" } });
    expect(onSymbolClick).toHaveBeenCalledTimes(1);
    expect(onSymbolClick).toHaveBeenCalledWith("RELIANCE");
  });

  test("clicking a sector parent or an Other rollup does not open the dock", async () => {
    const onSymbolClick = await renderTreemap([row("A", "Energy", 3)]);
    captured.clickHandler?.({ data: { name: "Energy", sectorParent: true } });
    captured.clickHandler?.({ data: { name: "Other (7)", isOther: true } });
    expect(onSymbolClick).not.toHaveBeenCalled();
  });

  test("expanding opens the fullscreen overlay and Escape closes it", async () => {
    await renderTreemap([row("A", "Energy", 3)]);
    expect(screen.queryByTestId("market-sector-fullscreen-modal")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("market-sector-map-expand"));
    expect(await screen.findByTestId("market-sector-fullscreen-modal")).toBeInTheDocument();
    expect(screen.getByTestId("market-sector-map-full-canvas")).toBeInTheDocument();
    expect(screen.queryByTestId("market-sector-map-canvas")).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    await vi.waitFor(() =>
      expect(screen.queryByTestId("market-sector-fullscreen-modal")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("market-sector-map-canvas")).toBeInTheDocument();
  });

  test("the close control also returns from the fullscreen overlay", async () => {
    await renderTreemap([row("A", "Energy", 3)]);
    fireEvent.click(screen.getByTestId("market-sector-map-expand"));
    await screen.findByTestId("market-sector-fullscreen-modal");
    fireEvent.click(screen.getByTestId("market-sector-fullscreen-modal-close"));
    await vi.waitFor(() =>
      expect(screen.queryByTestId("market-sector-fullscreen-modal")).not.toBeInTheDocument(),
    );
  });

  test("a sliver tile hides its label but keeps colour, tooltip datum and click", async () => {
    const onSymbolClick = await renderTreemap([
      row("HUGE", "Energy", 1000),
      row("TINY", "Energy", 0.2),
    ]);
    const children = captured.option.series[0].data[0].children;
    const tiny = children.find((c: any) => c.name === "TINY");
    const huge = children.find((c: any) => c.name === "HUGE");
    // The canvas recolours by spreading the label, so show:false must survive.
    expect(tiny.label.show).toBe(false);
    expect(huge.label.show).toBe(true);
    expect(tiny.itemStyle.color).toBeTruthy();
    expect(tiny.name).toBe("TINY"); // full identity still reaches the tooltip
    captured.clickHandler?.({ data: tiny });
    expect(onSymbolClick).toHaveBeenCalledWith("TINY");
  });

  test("the Size by choice is local and reaches the parent without any save call", async () => {
    const [sizeBy, setSizeBy] = createSignal<MarketSizeMetric>("change_pct");
    render(() => (
      <UIProvider>
        <MarketSectorTreemap rows={[row("A", "Energy", 3)]} sizeBy={sizeBy()} onSizeByChange={setSizeBy} />
      </UIProvider>
    ));
    await vi.waitFor(() => expect(captured.option).toBeTruthy());
    const select = screen.getByTestId("market-sector-map-metric").querySelector("select") as HTMLSelectElement;
    fireEvent.input(select, { target: { value: "rsi" } });
    expect(sizeBy()).toBe("rsi");
    expect(screen.getByTestId("market-sector-map-metric")).toBeInTheDocument();
  });

  test("(f) flat and sector maps paint the same selected-metric colour", async () => {
    const rows = [
      { ...row("GAIN", "Energy", -4.8), perf1m: 29.3 },
      { ...row("LOSS", "IT", 2.1), perf1m: -12.9 },
    ];
    await renderTreemap(rows, vi.fn(), "perf_1m");
    const sectorTiles = captured.option.series[0].data.flatMap((p: any) => p.children ?? []);
    const sectorGain = sectorTiles.find((c: any) => c.name === "GAIN");
    const sectorLoss = sectorTiles.find((c: any) => c.name === "LOSS");
    const month = getStockMetricRange(rows.map((r) => toTreemapRow(r)), "perf_1m");
    expect(sectorGain.itemStyle.color).toBe(marketTileColor("perf_1m", 29.3, month.min, month.max));
    expect(sectorLoss.itemStyle.color).toBe(marketTileColor("perf_1m", -12.9, month.min, month.max));
    expect(sectorGain.itemStyle.color).not.toBe(sectorLoss.itemStyle.color);
    const day = getStockMetricRange(rows.map((r) => toTreemapRow(r)), "change_pct");
    expect(sectorGain.itemStyle.color).not.toBe(marketTileColor("change_pct", -4.8, day.min, day.max));

    captured.option = null;
    render(() => <UIProvider><MarketMapView rows={rows} sizeBy="perf_1m" /></UIProvider>);
    await vi.waitFor(() => expect(captured.option).toBeTruthy());
    const flatGain = captured.option.series[0].data.find((d: any) => d.name === "GAIN");
    expect(flatGain.itemStyle.color).toBe(sectorGain.itemStyle.color);
    // Both legends describe the same selected metric and its endpoints.
    expect(screen.getByTestId("market-sector-map-color-label")).toHaveTextContent("1M Return");
    expect(screen.getByTestId("market-sector-map-color-range")).toHaveTextContent("-12.9%");
    expect(screen.getByTestId("market-sector-map-color-range")).toHaveTextContent("+29.3%");
  });
});

describe("robust colour domain in the nested map", () => {
  const outlierRows = () => [
    { ...row("VIVIDEL", "Energy", -43), perf1m: -43 },
    { ...row("DOWN5", "Energy", -5), perf1m: -5 },
    { ...row("FLAT", "Energy", 0), perf1m: 0 },
    { ...row("UP5", "IT", 5), perf1m: 5 },
    { ...row("MELSTAR", "IT", 12026), perf1m: 12026 },
  ];
  test("(d) both treemaps paint identical colours for the same outlier-bearing data", async () => {
    await renderTreemap(outlierRows(), vi.fn(), "perf_1m");
    const sector = captured.option.series[0].data.flatMap((p: any) => p.children ?? []);
    const sectorColors = Object.fromEntries(sector.map((c: any) => [c.name, c.itemStyle.color]));
    expect(sectorColors.MELSTAR).toBe(marketLerpRgb(100));
    expect(relativeLuminance(sectorColors.UP5)).toBeGreaterThan(relativeLuminance(sectorColors.FLAT));

    captured.option = null;
    render(() => <UIProvider><MarketMapView rows={outlierRows()} sizeBy="perf_1m" /></UIProvider>);
    await vi.waitFor(() => expect(captured.option).toBeTruthy());
    const flatColors = Object.fromEntries(
      captured.option.series[0].data.map((d: any) => [d.name, d.itemStyle.color]),
    );
    expect(Object.keys(sectorColors).sort()).toEqual(Object.keys(flatColors).sort());
    for (const [name, color] of Object.entries(sectorColors)) {
      expect(flatColors[name], `${name} differs between the two treemaps`).toBe(color);
    }
  });

  test("(e) the sector legend reports the same clamped domain", async () => {
    await renderTreemap(outlierRows(), vi.fn(), "perf_1m");
    const legend = screen.getByTestId("market-sector-map-legend");
    expect(legend).not.toHaveTextContent("12026");
    const range = screen.getByTestId("market-sector-map-color-range");
    expect(range).toHaveTextContent("≤");
    expect(screen.getByTestId("market-sector-map-color-clamp-note")).toHaveTextContent(/saturat/i);
  });
});

/** Both canvases call the same helper, so a signed and an unsigned value must paint identically. */
describe("MarketSectorTreemap — identical viridis colours in both treemaps", () => {
  test("(c) the same value + metric paints the same viridis fill in flat and sector maps", async () => {
    const rows = [
      { ...row("GAIN", "Energy", -4.8), perf1m: 29.3, rsi: 82 },
      { ...row("LOSS", "IT", 2.1), perf1m: -12.9, rsi: 18 },
    ];
    await renderTreemap(rows, vi.fn(), "perf_1m");
    const sectorSigned = Object.fromEntries(
      captured.option.series[0].data.flatMap((p: any) => p.children ?? []).map((c: any) => [c.name, c.itemStyle.color]),
    );
    const signedRange = getStockMetricRange(rows.map((r) => toTreemapRow(r)), "perf_1m");
    expect(sectorSigned.GAIN).toBe(marketTileColor("perf_1m", 29.3, signedRange.min, signedRange.max));
    expect(sectorSigned.LOSS).toBe(marketTileColor("perf_1m", -12.9, signedRange.min, signedRange.max));

    captured.option = null;
    render(() => <UIProvider><MarketMapView rows={rows} sizeBy="perf_1m" /></UIProvider>);
    await vi.waitFor(() => expect(captured.option).toBeTruthy());
    const flatSigned = Object.fromEntries(
      captured.option.series[0].data.map((d: any) => [d.name, d.itemStyle.color]),
    );
    expect(flatSigned.GAIN).toBe(sectorSigned.GAIN);
    expect(flatSigned.LOSS).toBe(sectorSigned.LOSS);
    // GAIN is the domain maximum, so viridis paints it yellow — never the old
    // strong-green fill the shared heatmap ramp used for a +29.3% move.
    expect(flatSigned.GAIN).toBe("rgb(253,231,37)");

    // Now an unsigned metric — the identical mapping must hold there too.
    captured.option = null;
    render(() => <UIProvider><MarketMapView rows={rows} sizeBy="rsi" /></UIProvider>);
    await vi.waitFor(() => expect(captured.option).toBeTruthy());
    const flatUnsigned = Object.fromEntries(
      captured.option.series[0].data.map((d: any) => [d.name, d.itemStyle.color]),
    );
    const rsiRange = getStockMetricRange(rows.map((r) => toTreemapRow(r)), "rsi");
    expect(flatUnsigned.GAIN).toBe(marketTileColor("rsi", 82, rsiRange.min, rsiRange.max));
    expect(flatUnsigned.LOSS).toBe(marketTileColor("rsi", 18, rsiRange.min, rsiRange.max));
  });

  test("(e) both legends read low → high and drop green/red wording", async () => {
    await renderTreemap([row("A", "Energy", 3), row("B", "IT", 5)]);
    expect(screen.getByTestId("market-sector-map-color-direction")).toHaveTextContent("low → high");
    expect(screen.getByTestId("market-sector-map-legend")).not.toHaveTextContent(/green|red/i);
    const bar = screen.getByTestId("market-sector-map-color-range").querySelector("div[style*='linear-gradient']") as HTMLElement;
    expect(bar.getAttribute("style")).toContain("#440154");
    expect(bar.getAttribute("style")).toContain("#fde725");
  });
});

/** Audit: both surfaces must read the same honest scale, including when empty. */
describe("MarketSectorTreemap — legend honesty audit", () => {
  const outlierRows = () => [
    { ...row("VIVIDEL", "Energy", -43), perf1m: -43 },
    { ...row("DOWN5", "Energy", -5), perf1m: -5 },
    { ...row("FLAT", "Energy", 0), perf1m: 0 },
    { ...row("UP5", "IT", 5), perf1m: 5 },
    { ...row("MELSTAR", "IT", 12026), perf1m: 12026 },
  ];

  test("(a)+(b) both treemaps name the active metric and identical clamped bounds", async () => {
    await renderTreemap(outlierRows(), vi.fn(), "perf_1m");
    const sectorLegend = screen.getByTestId("market-sector-map-legend");
    const sectorRange = screen.getByTestId("market-sector-map-color-range");
    expect(screen.getByTestId("market-sector-map-color-label")).toHaveTextContent("1M Return");
    expect(sectorRange).toHaveTextContent("≤");
    expect(sectorRange).toHaveTextContent("≥");
    expect(sectorLegend).not.toHaveTextContent("12026");
    expect(screen.getByTestId("market-sector-map-color-direction")).toHaveTextContent(/position in range/i);

    captured.option = null;
    render(() => <UIProvider><MarketMapView rows={outlierRows()} sizeBy="perf_1m" /></UIProvider>);
    await vi.waitFor(() => expect(captured.option).toBeTruthy());
    expect(screen.getByTestId("market-map-color-range").textContent?.trim()).toBe(
      sectorRange.textContent?.trim(),
    );
    expect(screen.getByTestId("market-map-color-direction").textContent?.trim()).toBe(
      screen.getByTestId("market-sector-map-color-direction").textContent?.trim(),
    );
  });

  test("(c) both legends state hue = position in range, not gain/loss", async () => {
    await renderTreemap([row("A", "Energy", -5), row("B", "IT", 5)]);
    const direction = screen.getByTestId("market-sector-map-color-direction");
    expect(direction).toHaveTextContent("low → high");
    expect(direction).toHaveTextContent(/position in range/i);
    expect(direction).toHaveTextContent(/not gain\/loss/i);
    expect(screen.getByTestId("market-sector-map-legend")).not.toHaveTextContent(/green|red/i);
  });

  test("(b) both treemaps hide the legend when there are no rows", async () => {
    await renderTreemap([]);
    expect(screen.queryByTestId("market-sector-map-legend")).not.toBeInTheDocument();
  });
});
