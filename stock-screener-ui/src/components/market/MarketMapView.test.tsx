// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { UIProvider } from "@/ui";
import {
  MARKET_VIEW_OPTIONS,
  MarketMapView,
  MarketViewToggle,
  VIS_OPTIONS,
  VIS_RENDERERS,
  type VisMode,
} from "./MarketMapView";
import {
  buildSectorTreemapOption,
  estimatedTileWidthPx,
  marketLerpRgb,
  marketTileColor,
  MARKET_SIZE_METRICS,
  MIN_LABEL_WIDTH_PX,
  toTreemapRow,
  type MarketSizeMetric,
} from "./marketTreemap";
import { buildStockTreemapOption, getStockMetricRange } from "@/components/heatmap/stockTreemap";
import { SCALE_BLUE } from "@/ui/palette";
import { parseColor } from "@/utils/contrast";
import type { MarketRow } from "../../types/marketScreener";

// ECharts cannot be inspected in happy-dom. Capture the option the primitive
// receives so the tile weights (size/order) and fills (colour) can be asserted apart.
const captured = vi.hoisted(() => ({ option: null as any }));
vi.mock("@/utils/loadEcharts", () => ({
  loadEcharts: async () => ({
    init: () => ({
      setOption: (option: any) => {
        captured.option = option;
      },
      on: () => {},
      resize: () => {},
      dispose: () => {},
    }),
  }),
}));

const row = (symbol: string, marketCapCr: number | null, rsi: number): MarketRow => ({
  symbol,
  name: symbol,
  sector: "Energy",
  exchange: "NSE",
  close: 100,
  change: 1,
  relativeVolume: 1,
  marketCapCr,
  capTier: "small",
  rsi,
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

type Tile = Record<string, any>;
const tiles = () => (captured.option?.series?.[0]?.data ?? []) as Tile[];
const order = () => tiles().map((d) => d.name).join(",");
const metricLabel = () => tiles()[0]?.metricLabel;
const select = () => screen.getByTestId("market-map-metric").querySelector("select") as HTMLSelectElement;
const selectedMetric = () => select().value;
const toolbarSelects = () => screen.getByTestId("market-map-toolbar").querySelectorAll("select");
const choose = (metric: string) => fireEvent.input(select(), { target: { value: metric } });
const dayRange = (rows: MarketRow[]) => {
  const { min, max } = getStockMetricRange(rows.map((r) => toTreemapRow(r)), "change_pct");
  return { min, max };
};

async function renderMap(jsx: () => unknown) {
  render(() => <UIProvider>{jsx() as never}</UIProvider>);
  await vi.waitFor(() => expect(captured.option).toBeTruthy());
}

beforeEach(() => {
  captured.option = null;
});

afterEach(cleanup);

describe("MarketMapView — one Size by control, ranked tiles", () => {
  test("tiles are emitted largest-first by the selected metric, not by market cap", async () => {
    const rows = [
      row("SMALL", 12_000, 91),
      row("BIG", 900_000, 30),
      { ...row("MID", 240_000, 74), change: 5 },
    ];
    await renderMap(() => <MarketMapView rows={rows} />);
    // Areas: MID 5, BIG 1, SMALL 1 — cap order (BIG, MID, SMALL) is not the
    // emitted order. The biggest tile is first; equal areas keep their input
    // order (SMALL before BIG), so this can never be mistaken for cap sorting.
    expect(order()).toBe("MID,SMALL,BIG");
    expect(tiles()[0]!.value).toBe(5);
    expect(tiles()[0]!.value).toBe(Math.max(...tiles().map((d) => d.value)));
  });

  test("an empty universe renders no tiles without throwing", async () => {
    await renderMap(() => <MarketMapView rows={[]} />);
    expect(order()).toBe("");
    expect(screen.queryByTestId("market-map-legend")).not.toBeInTheDocument();
    expect(screen.getByTestId("market-map-empty")).toHaveTextContent("No stocks to map");
  });

  test("the canvas is an image named by both the size and colour metrics", async () => {
    await renderMap(() => (
      <MarketMapView rows={[row("A", 100, 55)]} sizeBy="market_cap" colorBy="rsi" />
    ));
    const canvas = screen.getByTestId("market-map-canvas");
    expect(canvas).toHaveAttribute("role", "img");
    expect(canvas).toHaveAccessibleName(/Market Cap/);
    expect(canvas).toHaveAccessibleName(/RSI/);
  });

  test("the legend wraps and folds the size/clamp notes into a title below sm", async () => {
    await renderMap(() => <MarketMapView rows={[row("A", 100, 55)]} />);
    const legend = screen.getByTestId("market-map-legend");
    expect(legend.className).toContain("flex-wrap");
    expect(legend.className).toContain("h-auto");
    expect(legend.className).toContain("min-h-8");
    expect(legend.className.split(/\s+/)).not.toContain("h-8");
    expect(legend.getAttribute("title")).toContain("size: Day Change");
    const sizeNote = screen.getByTestId("market-map-size-note");
    expect(sizeNote.className).toContain("hidden");
    expect(sizeNote.className).toContain("sm:inline");
    expect(screen.getByTestId("market-map-color-range")).toBeInTheDocument();
  });

  test("day change is the default sizing metric", async () => {
    await renderMap(() => <MarketMapView rows={[row("A", 100, 55)]} />);
    expect(selectedMetric()).toBe("change_pct");
    expect(metricLabel()).toBe("Day Change");
  });

  test("changing the size metric resizes tiles and re-ranks them", async () => {
    const rows = [row("HUGE", 1_805_376, 21), row("SMALL", 12_000, 91)];
    await renderMap(() => <MarketMapView rows={rows} />);
    // Both rows carry change = 1, so the default change_pct sizing is uniform.
    expect(tiles().map((d) => d.value)).toEqual([1, 1]);
    expect(order()).toBe("HUGE,SMALL");

    choose("rsi");
    expect(metricLabel()).toBe("RSI");
    // RSI 91 is the bigger tile and now leads, regardless of its market cap.
    expect(order()).toBe("SMALL,HUGE");
    expect(tiles().map((d) => d.value)).toEqual([91, 21]);
  });

  test.each([
    ["change_pct", ["B", "A"], [4, 2]],
    ["relative_volume", ["A", "B"], [3, 1.5]],
    ["pos_52w", ["B", "A"], [70, 40]],
    ["rsi", ["B", "A"], [45, 15]],
    ["market_cap", ["B", "A"], [200 * 1e7, 100 * 1e7]],
  ] as const)("selecting %s sizes each tile by |%s| and emits them largest-first", async (metric, expectedOrder, expectedValues) => {
    const rows = [
      { ...row("A", 100, 15), change: 2, relativeVolume: 3, pos52w: 40, rsi: 15 },
      { ...row("B", 200, 45), change: -4, relativeVolume: 1.5, pos52w: 70, rsi: 45 },
    ];
    await renderMap(() => <MarketMapView rows={rows} />);
    choose(metric);
    expect(metricLabel()).toBe(
      ({ change_pct: "Day Change", rsi: "RSI", relative_volume: "Rel Volume", pos_52w: "52W Position", market_cap: "Market Cap" } as Record<string, string>)[metric],
    );
    expect(order()).toBe(expectedOrder.join(","));
    expect(tiles().map((d) => d.value)).toEqual([...expectedValues]);
    expect(tiles()[0]!.value).toBe(Math.max(...tiles().map((d) => d.value)));
  });

  test.each(["change_pct", "relative_volume", "rsi", "pos_52w", "market_cap"] as const)(
    "selecting %s paints every tile with its own %s value, never a day-change fill",
    async (metric) => {
      const rows = [
        { ...row("A", 100, 15), change: 2, relativeVolume: 3, pos52w: 40 },
        { ...row("B", 200, 45), change: -4, relativeVolume: 1.5, pos52w: 70 },
      ];
      await renderMap(() => <MarketMapView rows={rows} />);
      choose(metric);
      const { min, max } = getStockMetricRange(rows.map((r) => toTreemapRow(r)), metric);
      for (const datum of tiles()) {
        const value = Number(datum.metricNumeric);
        expect(datum.itemStyle.color).toBe(marketTileColor(metric, value, min, max));
        expect(datum.itemStyle.color).toBeTruthy();
        expect(SCALE_BLUE, `${metric} emitted a blue ramp stop`).not.toContain(datum.itemStyle.color);
      }
    },
  );

  test("a losing tile has a positive area but keeps the loss colour", async () => {
    const rows = [
      { ...row("DOWN", 100_000, 60), change: -2.5 },
      { ...row("UP", 200_000, 60), change: 1.25 },
    ];
    await renderMap(() => <MarketMapView rows={rows} />);
    const down = tiles().find((d) => d.name === "DOWN")!;
    expect(down.value).toBe(2.5);
    expect(down.metricNumeric).toBe(-2.5);
    expect(down.itemStyle.color).toBe(marketTileColor(-2.5, -2.5, 1.25));
    expect(down.itemStyle.color).not.toBe(marketTileColor(2.5, -2.5, 1.25));
    // The biggest tile (the −2.5% mover) leads the ranking.
    expect(order()).toBe("DOWN,UP");
  });

  test("missing metric rows are dropped; a real zero survives with its own colour", async () => {
    const rows = [
      { ...row("GOOD", 200_000, 60), change: 3 },
      { ...row("FLAT", 100_000, 60), change: 0 },
      { ...row("NAN", 150_000, 60), change: Number.NaN },
    ];
    await renderMap(() => <MarketMapView rows={rows} />);
    expect(order()).toBe("GOOD,FLAT");
    expect(tiles()[0]!.value).toBe(3);
    expect(tiles()[0]!.itemStyle.color).toBe(marketTileColor(3, 0, 3));
    const flat = tiles().find((d) => d.name === "FLAT")!;
    expect(flat.value).toBeGreaterThan(0);
    expect(flat.value).toBeLessThan(1);
    expect(flat.metricNumeric).toBe(0);
    expect(flat.itemStyle.color).toBe(marketTileColor(0, 0, 3));
  });

  test.each([
    ["a real zero is kept", [
      { ...row("GOOD", 200_000, 60), change: 3 },
      { ...row("ZERO", 100_000, 60), change: 0 },
    ]],
    ["a missing value is dropped", [
      { ...row("GOOD", 200_000, 60), change: 3 },
      { ...row("MISSING", 100_000, 60), change: Number.NaN },
    ]],
  ] as const)("the stock counter equals the rendered tile count when %s", async (_label, rows) => {
    await renderMap(() => <MarketMapView rows={[...rows]} />);
    expect(screen.getByTestId("market-map-count").textContent?.trim()).toBe(
      `${tiles().length} stocks`,
    );
  });

  test("a zero day change is a visible tile, not a phantom stock in the counter", async () => {
    const rows = [
      { ...row("ITC", 100_000, 60), change: 0 },
      { ...row("GOOD", 200_000, 60), change: 3 },
    ];
    await renderMap(() => <MarketMapView rows={rows} />);
    expect(order().split(",")).toHaveLength(2);
    expect(tiles().find((d) => d.name === "ITC")!.value).toBeGreaterThan(0);
    expect(screen.getByTestId("market-map-count")).toHaveTextContent("2 stocks");
  });

  test("exactly one dropdown exists in the map toolbar and market-map-sort is gone", async () => {
    await renderMap(() => <MarketMapView rows={[row("A", 100, 55)]} />);
    expect(toolbarSelects()).toHaveLength(1);
    expect(screen.queryByTestId("market-map-sort")).not.toBeInTheDocument();
    expect(screen.getByTestId("market-map-toolbar")).toHaveTextContent("Size by");
    expect(select()).toHaveAccessibleName("Size the map by");
  });

  test("the native select renders five optgroups in the requested order", async () => {
    await renderMap(() => <MarketMapView rows={[row("A", 100, 55)]} />);
    const labels = Array.from(select().querySelectorAll("optgroup")).map((g) => g.getAttribute("label"));
    expect(labels).toEqual(["Momentum", "Trend", "Performance", "Size", "Valuation"]);
  });

  test("each optgroup contains the exact persisted values for its category", async () => {
    await renderMap(() => <MarketMapView rows={[row("A", 100, 55)]} />);
    const grouped = Object.fromEntries(
      Array.from(select().querySelectorAll("optgroup")).map((g) => [
        g.getAttribute("label"),
        Array.from(g.querySelectorAll("option")).map((o) => (o as HTMLOptionElement).value),
      ]),
    );
    expect(grouped).toEqual({
      Momentum: ["change_pct", "relative_volume", "rsi"],
      Trend: ["adx", "pos_52w"],
      Performance: ["perf_w", "perf_1m"],
      Size: ["market_cap"],
      Valuation: ["pe_ratio", "pb_ratio", "roe", "dividend_yield"],
    });
  });

  test("none of the twelve size options is disabled in the native select", async () => {
    await renderMap(() => <MarketMapView rows={[row("A", 100, 55)]} />);
    const options = Array.from(select().querySelectorAll("option")) as HTMLOptionElement[];
    expect(options).toHaveLength(12);
    expect(options.filter((option) => option.disabled)).toEqual([]);
    expect(options.every((option) => !option.disabled)).toBe(true);
  });

  test.each([
    ["adx", { adx: 20 }, "ADX"],
    ["perf_w", { perfW: 3 }, "1W Return"],
    ["perf_1m", { perf1m: 4 }, "1M Return"],
    ["pe_ratio", { peRatio: 12 }, "P/E"],
    ["pb_ratio", { pbRatio: 1.5 }, "P/B"],
    ["roe", { roe: 15 }, "ROE"],
    ["dividend_yield", { dividendYield: 2 }, "Div Yield"],
  ] as const)("selecting the %s option resizes tiles and reaches the parent", async (metric, field, label) => {
    const [sizeBy, setSizeBy] = createSignal<string>("change_pct");
    await renderMap(() => (
      <MarketMapView
        rows={[{ ...row("A", 100, 55), ...field }]}
        sizeBy={sizeBy() as any}
        onSizeByChange={setSizeBy as any}
      />
    ));
    choose(metric);
    expect(selectedMetric()).toBe(metric);
    expect(sizeBy()).toBe(metric);
    expect(metricLabel()).toBe(label);
    expect(tiles()).toHaveLength(1);
  });

  test("Day Change stays the selected first option under Momentum", async () => {
    await renderMap(() => <MarketMapView rows={[row("A", 100, 55)]} />);
    const first = select().options[0]!;
    expect(select().value).toBe("change_pct");
    expect(first.value).toBe("change_pct");
    expect(first.textContent).toBe("Day Change");
    expect(first.parentElement?.getAttribute("label")).toBe("Momentum");
    expect(metricLabel()).toBe("Day Change");
  });

  test("sizeBy seeds the control and a user choice reaches the parent", async () => {
    const [sizeBy, setSizeBy] = createSignal<MarketSizeMetric>("change_pct");
    await renderMap(() => <MarketMapView rows={[row("A", 100, 55)]} sizeBy={sizeBy()} onSizeByChange={setSizeBy} />);
    expect(selectedMetric()).toBe("change_pct");

    choose("rsi");
    expect(selectedMetric()).toBe("rsi");
    expect(sizeBy()).toBe("rsi");

    setSizeBy("market_cap");
    expect(selectedMetric()).toBe("market_cap");
    expect(metricLabel()).toBe("Market Cap");
  });

  test("the legend follows the selected metric and shows its min..max", async () => {
    const rows = [
      { ...row("A", 100, 55), pos52w: 40 },
      { ...row("B", 200, 70), pos52w: 70 },
    ];
    await renderMap(() => <MarketMapView rows={rows} />);
    const legend = screen.getByTestId("market-map-legend");
    expect(screen.getByTestId("market-map-color-label")).toHaveTextContent("Day Change");
    expect(screen.getByTestId("market-map-size-note")).toHaveTextContent("Day Change");

    choose("pos_52w");
    expect(screen.getByTestId("market-map-color-label")).toHaveTextContent("52W Position");
    expect(screen.getByTestId("market-map-size-note")).toHaveTextContent("52W Position");
    expect(legend).toHaveTextContent(/size/i);
    expect(legend).toHaveTextContent("40%");
    expect(legend).toHaveTextContent("70%");
    const range = screen.getByTestId("market-map-color-range");
    expect(range).toHaveTextContent("40%");
    expect(range).toHaveTextContent("70%");
    expect(legend).not.toHaveTextContent("Rel Volume");
  });

  test("(a) sizeBy perf_1m paints +29.3% green and −12.9% red, not the day-change fills", async () => {
    const rows = [
      { ...row("GAIN", 100, 55), change: -4.8, perf1m: 29.3 },
      { ...row("LOSS", 200, 60), change: 2.1, perf1m: -12.9 },
    ];
    await renderMap(() => <MarketMapView rows={rows} sizeBy="perf_1m" />);
    const gain = tiles().find((d) => d.name === "GAIN")!;
    const loss = tiles().find((d) => d.name === "LOSS")!;
    const month = getStockMetricRange(rows.map((r) => toTreemapRow(r)), "perf_1m");
    expect(gain.metricValue).toBe("+29.3%");
    expect(loss.metricValue).toBe("-12.9%");
    expect(gain.itemStyle.color).toBe(
      marketTileColor("perf_1m", 29.3, month.min, month.max),
    );
    expect(loss.itemStyle.color).toBe(
      marketTileColor("perf_1m", -12.9, month.min, month.max),
    );
    const day = dayRange(rows);
    expect(gain.itemStyle.color).not.toBe(marketTileColor("change_pct", -4.8, day.min, day.max));
    expect(gain.itemStyle.color).not.toBe(loss.itemStyle.color);
    const greenChannel = (c: string) => Number(c.match(/\d+/g)![1]);
    expect(greenChannel(gain.itemStyle.color)).toBeGreaterThan(greenChannel(loss.itemStyle.color));
  });

  test("colourBy decouples the fill from the size metric", async () => {
    const rows = [
      { ...row("SMALL", 10, 20), change: 5 },
      { ...row("BIG", 200, 90), change: -1 },
    ];
    await renderMap(() => <MarketMapView rows={rows} sizeBy="market_cap" colorBy="rsi" />);
    const big = tiles().find((d) => d.name === "BIG")!;
    expect(big.value).toBe(200 * 1e7);
    expect(big.metricNumeric).toBe(90);
    expect(screen.getByTestId("market-map-color-label")).toHaveTextContent("RSI");
    expect(screen.getByTestId("market-map-size-note")).toHaveTextContent("Market Cap");
  });

  test("(e) the legend names the selected metric and its min..max", async () => {
    const rows = [
      { ...row("A", 100, 55), change: -4.8, perf1m: 29.3 },
      { ...row("B", 200, 60), change: 2.1, perf1m: -12.9 },
    ];
    await renderMap(() => <MarketMapView rows={rows} sizeBy="perf_1m" />);
    const legend = screen.getByTestId("market-map-legend");
    expect(screen.getByTestId("market-map-color-label")).toHaveTextContent("1M Return");
    expect(legend).toHaveTextContent("-12.9%");
    expect(legend).toHaveTextContent("+29.3%");
    const range = screen.getByTestId("market-map-color-range");
    expect(range).toHaveTextContent("-12.9%");
    expect(range).toHaveTextContent("+29.3%");
  });
});

/** 3,592-row snapshot is ~2,000+ sub-10px tiles in a 740x765 window. */
describe("flat heatmap label legibility", () => {
  const manyRows = (count: number) =>
    Array.from({ length: count }, (_, i) => row(`S${String(i).padStart(4, "0")}`, 100 + i, 50));

  /** happy-dom has no layout engine; pin the canvas box before the component mounts. */
  function stubCanvasSize(width: number, height: number): () => void {
    const proto = HTMLElement.prototype as unknown as Record<string, PropertyDescriptor | undefined>;
    const originals = new Map(
      ["clientWidth", "clientHeight"].map((key) => [key, Object.getOwnPropertyDescriptor(proto, key)]),
    );
    Object.defineProperty(proto, "clientWidth", { configurable: true, get: () => width });
    Object.defineProperty(proto, "clientHeight", { configurable: true, get: () => height });
    return () => {
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(proto, key, descriptor);
        else delete proto[key];
      }
    };
  }

  /** 3 huge tiles keep a label; the other 3,589 are slivers that must not. */
  const denseRows = (): MarketRow[] => [
    { ...row("MEGA", 100, 50), change: 1000 },
    { ...row("LARGE", 110, 50), change: 800 },
    { ...row("MID", 120, 50), change: 600 },
    ...Array.from({ length: 3589 }, (_, i) => ({
      ...row(`S${String(i).padStart(4, "0")}`, 200 + i, 50),
      change: 0.5 + (i % 20) * 0.1,
    })),
  ];

  test("(a) 3,592 tiles at 740x765: full symbol or no label, never a truncated stub", async () => {
    const restore = stubCanvasSize(740, 765);
    try {
      await renderMap(() => <MarketMapView rows={denseRows()} />);
      await vi.waitFor(() => expect(tiles().some((d) => d.label.show === false)).toBe(true));
      const data = tiles();
      expect(data).toHaveLength(3592); // flat map is never silently capped
      const formatter = (captured.option.series[0] as any).label.formatter as (p: any) => string;
      const suppressed = data.filter((d) => d.label.show === false);
      const labelled = data.filter((d) => d.label.show !== false);
      expect(suppressed.length).toBeGreaterThan(0);
      expect(labelled.length).toBeGreaterThan(0);
      for (const tile of data) {
        if (tile.label.show === false) continue;
        const text = formatter({ name: tile.name, data: tile });
        expect(text).toContain(tile.name); // the full symbol, not "OMP…"
        expect(text).toContain(tile.metricValue); // the full value
        expect(text).not.toMatch(/…|\.\.\./); // no ellipsis stub at any size
      }
    } finally {
      restore();
    }
  });

  test("(c) unlabelled tiles keep distinct fills, full tooltip names and click identity", async () => {
    const restore = stubCanvasSize(740, 765);
    try {
      await renderMap(() => <MarketMapView rows={denseRows()} />);
      const suppressed = tiles().filter((d) => d.label.show === false);
      expect(suppressed.length).toBeGreaterThan(1);
      const fills = new Set(suppressed.map((d) => d.itemStyle.color as string));
      expect(fills.size).toBeGreaterThan(1); // colour still encodes the value
      expect([...fills].every((color) => /^rgb\(\d+,\d+,\d+\)$/.test(color))).toBe(true);
      const sample = suppressed[0]!;
      const tooltip = (captured.option.tooltip as any).formatter({ data: sample }) as string;
      expect(tooltip).toContain(sample.name); // hover still identifies the stock
      expect(sample.name).toMatch(/^S\d{4}$/); // click forwards this exact symbol
    } finally {
      restore();
    }
  });

  test("(b) a tile below the label-width threshold paints no label at all", async () => {
    await renderMap(() => <MarketMapView rows={manyRows(2000)} />);
    const small = tiles()[0]!;
    const total = tiles().reduce((sum: number, d: Tile) => sum + d.value, 0);
    expect(estimatedTileWidthPx(small.value, total)).toBeLessThan(MIN_LABEL_WIDTH_PX);
    // The whole ECharts label block is off — no "S…" stub can be painted.
    expect(small.label.show).toBe(false);
    // Colour, tooltip datum and click identity survive the suppression.
    expect(small.itemStyle.color).toBeTruthy();
    expect(small.name).toMatch(/^S\d{4}$/);
    expect(small.metricValue).toBe("+1.0%");
  });

  test("(c) a tile above the threshold keeps its full symbol", async () => {
    await renderMap(() => <MarketMapView rows={[row("RELIANCE", 100, 55)]} />);
    const big = tiles()[0]!;
    expect(estimatedTileWidthPx(big.value, big.value)).toBeGreaterThanOrEqual(MIN_LABEL_WIDTH_PX);
    expect(big.label.show).toBe(true);
    const formatter = (captured.option.series[0] as any).label.formatter;
    const text = formatter({ name: big.name, data: big });
    expect(text).toContain("RELIANCE");
    expect(text).not.toContain("…");
  });
});

describe("market view vocabulary", () => {
  test("offers the Deep Value view alongside table/vis/movers", () => {
    expect(MARKET_VIEW_OPTIONS.map((o) => o.value)).toEqual(["table", "vis", "movers", "value"]);
    // Labelled "Deep Value", not "Value": the rail also has a "Value filters"
    // band, and two controls called "Value" with different meanings is exactly
    // the ambiguity this label exists to remove.
    expect(MARKET_VIEW_OPTIONS.find((o) => o.value === "value")?.label).toBe("Deep Value");
  });

  test("the view toggle is labelled Vis, never Map", () => {
    const onChange = vi.fn();
    render(() => <MarketViewToggle value="vis" onChange={onChange} />);
    const toggle = screen.getByTestId("market-view-toggle");
    expect(within(toggle).getByText("Vis")).toBeInTheDocument();
    expect(within(toggle).queryByText("Map")).not.toBeInTheDocument();
  });

  test("the toggle selects the Deep Value view", () => {
    const onChange = vi.fn();
    render(() => <MarketViewToggle value="value" onChange={onChange} />);
    const toggle = screen.getByTestId("market-view-toggle").querySelector("button, input");
    expect(screen.getByText("Deep Value")).toBeInTheDocument();
    expect(toggle).toBeTruthy();
  });
});

describe("visualization registry", () => {
  test("VIS_OPTIONS registers all eleven modes in display order with their exact labels", () => {
    expect(VIS_OPTIONS.map((o) => o.value)).toEqual([
      "heatmap",
      "sector",
      "themes",
      "flow",
      "range52",
      "sector52",
      "rsiadx",
      "trend",
      "relvol",
      "sectorperiod",
      "corrmatrix",
    ]);
    expect(VIS_OPTIONS.map((o) => o.label)).toEqual([
      "Heatmap",
      "Sector treemap",
      "Themes",
      "Money flow",
      "52W range",
      "Sector 52W",
      "RSI × ADX",
      "Trend alignment",
      "Relative volume",
      "Sector × period",
      "Correlation",
    ]);
    const defaultMode: VisMode = VIS_OPTIONS[0]!.value;
    expect(defaultMode).toBe("heatmap");
  });

  test("every registered viz has a renderer, including all seven new views", () => {
    for (const option of VIS_OPTIONS) {
      expect(VIS_RENDERERS[option.value]).toBeTypeOf("function");
    }
    for (const mode of [
      "range52",
      "sector52",
      "rsiadx",
      "trend",
      "relvol",
      "sectorperiod",
      "corrmatrix",
    ] as const) {
      expect(VIS_RENDERERS[mode], `${mode} has no renderer`).toBeTypeOf("function");
    }
    expect(VIS_RENDERERS.flow, "flow has no renderer").toBeTypeOf("function");
  });

  test("the default viz renders the heatmap implementation", async () => {
    await renderMap(() => <MarketMapView rows={[row("A", 100, 55)]} />);
    expect(screen.getByTestId("market-map-view")).toBeInTheDocument();
    expect(screen.getByTestId("market-map-canvas")).toBeInTheDocument();
  });
});

/** The live snapshot this fixed: one +12026% print, the rest within ±43%. */
describe("robust colour domain in the flat map", () => {
  const outlierRows = () => [
    { ...row("VIVIDEL", 100, 55), change: -43 },
    { ...row("DOWN5", 110, 55), change: -5 },
    { ...row("FLAT", 120, 55), change: 0 },
    { ...row("UP5", 130, 55), change: 5 },
    { ...row("MELSTAR", 140, 55), change: 12026 },
  ];
  const colorOf = (name: string) => tiles().find((d) => d.name === name)!.itemStyle.color as string;

  test("(a) ±5% tiles read red/neutral/green, not the flattened raw ±12026 domain", async () => {
    await renderMap(() => <MarketMapView rows={outlierRows()} />);
    const flat = colorOf("FLAT");
    const up = colorOf("UP5");
    const down = colorOf("DOWN5");
    const redBias = (c: string) => parseColor(c).r - parseColor(c).g;
    expect(redBias(down), `down ${down} must read red`).toBeGreaterThan(0);
    expect(redBias(up), `up ${up} must read green`).toBeLessThan(0);
    expect(Math.abs(redBias(flat)), `flat ${flat} must be neutral`).toBeLessThan(10);
    expect(redBias(down) - redBias(up)).toBeGreaterThan(40);
    expect(flat).toBe(marketLerpRgb(50));
  });

  test("(b) the +12026% tile saturates at the green end but keeps its true value and area", async () => {
    await renderMap(() => <MarketMapView rows={outlierRows()} />);
    const bad = tiles().find((d) => d.name === "MELSTAR")!;
    expect(bad.itemStyle.color).toBe(marketLerpRgb(100));
    expect(bad.metricValue).toBe("+12026.0%");
    expect(bad.value).toBe(12026);
  });

  test("(e) the legend states the clamped domain, never the corrupt raw extreme", async () => {
    await renderMap(() => <MarketMapView rows={outlierRows()} />);
    const legend = screen.getByTestId("market-map-legend");
    expect(legend).not.toHaveTextContent("12026");
    const range = screen.getByTestId("market-map-color-range");
    expect(range).toHaveTextContent("≤");
    const clampNote = screen.getByTestId("market-map-color-clamp-note");
    expect(clampNote).toHaveTextContent(/saturat/i);
    expect(clampNote.className).toContain("hidden");
    expect(clampNote.className).toContain("sm:inline");
    expect(legend.getAttribute("title")).toContain("saturates past bounds");
  });
});

/** The diverging scale needs a stated direction: red is low, green is high. */
describe("MarketMapView — red-green legend states direction", () => {
  test("(e) the legend reads low → high and paints red → neutral → green", async () => {
    const rows = [row("A", 100, 55), row("B", 200, 70)];
    await renderMap(() => <MarketMapView rows={rows} />);
    expect(screen.getByTestId("market-map-color-direction")).toHaveTextContent("low → high");
    const bar = screen.getByTestId("market-map-color-range").querySelector("div[style*='linear-gradient']") as HTMLElement;
    const style = bar.getAttribute("style")!;
    // Endpoint order is the semantic: negative red on the left, positive green
    // on the right, with the raised-surface neutral in the middle.
    expect(style).toContain("#e5606a");
    expect(style).toContain("#1F242D");
    expect(style).toContain("#2fa36b");
    expect(style.indexOf("#e5606a")).toBeLessThan(style.indexOf("#2fa36b"));
  });
});

/** Audit: a linear position scale has no zero anchor, so the legend must say what hue encodes. */
describe("MarketMapView — legend honesty audit", () => {
  const flatRows = () => [
    { ...row("LOSS", 100, 55), change: -5 },
    { ...row("GAIN", 200, 60), change: 5 },
  ];
  const outlierRows = () => [
    { ...row("VIVIDEL", 100, 55), change: -43 },
    { ...row("DOWN5", 110, 55), change: -5 },
    { ...row("FLAT", 120, 55), change: 0 },
    { ...row("UP5", 130, 55), change: 5 },
    { ...row("MELSTAR", 140, 55), change: 12026 },
  ];

  test("(a) the legend names the active metric and its clamped low..high bounds", async () => {
    await renderMap(() => <MarketMapView rows={outlierRows()} />);
    expect(screen.getByTestId("market-map-color-label")).toHaveTextContent("Day Change");
    const range = screen.getByTestId("market-map-color-range");
    expect(range).toHaveTextContent("≤");
    expect(range).toHaveTextContent("≥");
    expect(range).not.toHaveTextContent("12026");
    expect(screen.getByTestId("market-map-color-clamp-note")).toHaveTextContent(/saturat/i);
    // The scale note is part of an honest legend, not an optional extra.
    expect(screen.getByTestId("market-map-color-direction")).toHaveTextContent(/position in range/i);
  });

  test("(c) the legend states hue = position in range, not gain/loss", async () => {
    await renderMap(() => <MarketMapView rows={flatRows()} />);
    const direction = screen.getByTestId("market-map-color-direction");
    expect(direction).toHaveTextContent("low → high");
    expect(direction).toHaveTextContent(/position in range/i);
    expect(direction).toHaveTextContent(/not gain\/loss/i);
  });
});

/** P2-04: at 390 the legend must show the semantic notes, not only a tooltip. */
describe("MarketMapView — narrow legend keeps notes visible at 390", () => {
  const noFixedClamp = (node: HTMLElement) => {
    const classes = node.className.split(/\s+/);
    expect(classes).not.toContain("w-24");
    expect(classes).not.toContain("max-w-24");
    expect(classes).not.toContain("truncate");
    expect(classes).not.toContain("whitespace-nowrap");
  };

  test("direction and colour meaning are visible text, not just a title", async () => {
    await renderMap(() => <MarketMapView rows={[row("A", 100, 55), row("B", 200, 70)]} />);
    const narrow = screen.getByTestId("market-map-narrow-notes");
    const classes = narrow.className.split(/\s+/);
    expect(classes).toContain("sm:hidden"); // visible at 390, hidden at 1600
    expect(classes).not.toContain("hidden");
    noFixedClamp(narrow);
    expect(narrow.textContent).toContain("low → high");
    expect(narrow.textContent).toContain("position in range, not gain/loss");
    expect(screen.getByTestId("market-map-color-range")).toBeInTheDocument();
    expect(screen.queryByTestId("market-map-color-clamp-note-narrow")).not.toBeInTheDocument();
    expect(screen.getByTestId("market-map-legend").getAttribute("title")).toContain("position in range");
  });

  test("the literal clamp phrase is visible beside the ≥ glyph when clamped", async () => {
    const rows = [
      { ...row("VIVIDEL", 100, 55), change: -43 },
      { ...row("FLAT", 120, 55), change: 0 },
      { ...row("MELSTAR", 140, 55), change: 12026 },
    ];
    await renderMap(() => <MarketMapView rows={rows} />);
    expect(screen.getByTestId("market-map-color-range")).toHaveTextContent("≥");
    const narrow = screen.getByTestId("market-map-narrow-notes");
    const clamp = screen.getByTestId("market-map-color-clamp-note-narrow");
    noFixedClamp(narrow);
    noFixedClamp(clamp);
    expect(narrow.textContent).toContain("saturates past bounds");
    expect(clamp.textContent?.trim()).toBe("saturates past bounds");
    expect(clamp.getAttribute("title")).toBeNull();
  });
});

/** The flat-only gate must not leak into the two shared treemap callers. */
describe("shared-code guard — NSE heatmap and sector treemap stay byte-identical", () => {
  const guardStyle = {
    borderDark: "#000",
    borderLight: "#fff",
    label: { fontSize: 12, fontWeight: 600 as const, lineHeight: 1 },
    changePositive: "#0f0",
    changeNegative: "#f00",
    sortTilesByValueDesc: false,
  };
  const stocks = [
    toTreemapRow({ ...row("A1", 100, 50), change: 4 }),
    toTreemapRow({ ...row("A2", 100, 50), change: 2 }),
    toTreemapRow({ ...row("B1", 100, 50), sector: "IT", change: 6 }),
  ];
  const replacer = (_key: string, value: unknown) => (typeof value === "function" ? "[fn]" : value);

  // Frozen before the flat-map gate existed. The NSE heatmap calls the shared
  // builder directly; the sector treemap calls it through the wrapper. Neither
  // may inherit the flat map's label.show override or a new fill/order.
  const FLAT_BEFORE = `{"tooltip":{"trigger":"item","backgroundColor":"#1F242D","borderColor":"#2C313B","textStyle":{"color":"#E8E8E8"},"formatter":"[fn]"},"series":[{"type":"treemap","sort":false,"top":0,"left":0,"right":0,"bottom":0,"roam":false,"nodeClick":false,"squareRatio":1,"label":{"show":true,"formatter":"[fn]","fontSize":12,"fontWeight":600,"lineHeight":1},"breadcrumb":{"show":false},"itemStyle":{"borderColor":"#000","borderWidth":1,"gapWidth":0},"levels":[{"itemStyle":{"borderColor":"#000","borderWidth":0,"gapWidth":0}},{"itemStyle":{"borderColorSaturation":0.6,"gapWidth":0,"borderWidth":1}}],"data":[{"name":"A1","value":4,"path":"A1","nameFull":"A1","sector":"Energy","price":100,"change":4,"mcap":1000000000,"pe":null,"metricLabel":"Day Change","metricValue":"+4.0%","metricNumeric":4,"label":{"color":"#F0F6FC"},"itemStyle":{"color":"rgb(20,149,89)"}},{"name":"A2","value":2,"path":"A2","nameFull":"A2","sector":"Energy","price":100,"change":2,"mcap":1000000000,"pe":null,"metricLabel":"Day Change","metricValue":"+2.0%","metricNumeric":2,"label":{"color":"#F0F6FC"},"itemStyle":{"color":"rgb(28,163,102)"}},{"name":"B1","value":6,"path":"B1","nameFull":"B1","sector":"IT","price":100,"change":6,"mcap":1000000000,"pe":null,"metricLabel":"Day Change","metricValue":"+6.0%","metricNumeric":6,"label":{"color":"#F0F6FC"},"itemStyle":{"color":"rgb(14,138,79)"}}]}]}`;
  const SECTOR_BEFORE = `{"tooltip":{"trigger":"item","backgroundColor":"#1F242D","borderColor":"#2C313B","textStyle":{"color":"#E8E8E8"},"formatter":"[fn]"},"series":[{"type":"treemap","sort":false,"top":0,"left":0,"right":0,"bottom":0,"roam":false,"nodeClick":false,"squareRatio":1,"label":{"show":true,"formatter":"[fn]","fontSize":12,"fontWeight":600,"lineHeight":1},"breadcrumb":{"show":false},"itemStyle":{"borderColor":"#000","borderWidth":1,"gapWidth":0},"levels":[{"itemStyle":{"borderColor":"#000","borderWidth":0,"gapWidth":0}},{"itemStyle":{"borderColor":"#2C313B","borderWidth":1,"gapWidth":1},"upperLabel":{"show":true,"height":18,"color":"#E8E8E8","fontWeight":"bold","formatter":"{b}"}},{"itemStyle":{"borderColorSaturation":0.6,"gapWidth":0,"borderWidth":1}}],"data":[{"name":"Energy","value":6,"sectorParent":true,"stockCount":2,"children":[{"name":"A1","value":4,"path":"A1","nameFull":"A1","sector":"Energy","price":100,"change":4,"mcap":1000000000,"pe":null,"metricLabel":"Day Change","metricValue":"+4.0%","metricNumeric":4,"label":{"color":"#F0F6FC","show":true},"itemStyle":{"color":"rgb(20,149,89)"}},{"name":"A2","value":2,"path":"A2","nameFull":"A2","sector":"Energy","price":100,"change":2,"mcap":1000000000,"pe":null,"metricLabel":"Day Change","metricValue":"+2.0%","metricNumeric":2,"label":{"color":"#F0F6FC","show":true},"itemStyle":{"color":"rgb(28,163,102)"}}],"label":{"show":false,"color":"#E8E8E8"},"itemStyle":{"color":"#1F242D"}},{"name":"IT","value":6,"sectorParent":true,"stockCount":1,"children":[{"name":"B1","value":6,"path":"B1","nameFull":"B1","sector":"IT","price":100,"change":6,"mcap":1000000000,"pe":null,"metricLabel":"Day Change","metricValue":"+6.0%","metricNumeric":6,"label":{"color":"#F0F6FC","show":true},"itemStyle":{"color":"rgb(14,138,79)"}}],"label":{"show":false,"color":"#E8E8E8"},"itemStyle":{"color":"#1F242D"}}]}]}`;

  test("(d) the NSE flat builder and the sector wrapper emit byte-identical options", () => {
    const flat = buildStockTreemapOption(stocks, "change_pct", MARKET_SIZE_METRICS, true, guardStyle, "metric");
    const nested = buildSectorTreemapOption(stocks, "change_pct", MARKET_SIZE_METRICS, true, guardStyle);
    expect(JSON.stringify(flat, replacer)).toBe(FLAT_BEFORE);
    expect(JSON.stringify(nested.option, replacer)).toBe(SECTOR_BEFORE);
  });
});
