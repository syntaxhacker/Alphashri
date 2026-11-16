// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { UIProvider } from "@/ui";
import { MarketMapView } from "./MarketMapView";
import type { MarketRow } from "../../types/marketScreener";
import type { MarketSortKey } from "./marketFilters";

// ECharts cannot be inspected in happy-dom; this stub records the tile order and
// the metric the map hands to the primitive — the two things the user sees.
vi.mock("@/components/heatmap/HeatmapTreemap", () => ({
  HeatmapTreemap: (props: { stocks: { symbol: string }[]; metric: string }) => (
    <div>
      <div data-testid="treemap-received">{props.stocks.map((s) => s.symbol).join(",")}</div>
      <div data-testid="treemap-metric">{props.metric}</div>
    </div>
  ),
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
  fno: false,
  etf: false,
});

const order = () => screen.getByTestId("treemap-received").textContent;
const mapMetric = () => screen.getByTestId("treemap-metric").textContent;

/** The metric select's own displayed value — what the user reads as "Color by". */
const selectedMetric = () =>
  (screen.getByTestId("market-map-metric").querySelector("select") as HTMLSelectElement).value;
const selectedSort = () =>
  (screen.getByTestId("market-map-sort").querySelector("select") as HTMLSelectElement).value;

function r(jsx: () => unknown) {
  return render(() => <UIProvider>{jsx() as never}</UIProvider>);
}

afterEach(cleanup);

describe("MarketMapView", () => {
  test("lays the map out by market cap, not by the table's RSI sort", () => {
    const rsiSorted = [
      row("SMALL", 12_000, 91),
      row("MID", 240_000, 74),
      row("HUGE", 1_805_376, 21),
    ];
    render(() => <MarketMapView rows={rsiSorted} />);
    expect(order()).toBe("HUGE,MID,SMALL");
  });

  test("a cap-less row keeps a tile and lands last", () => {
    render(() => <MarketMapView rows={[row("NOCAP", null, 60), row("HUGE", 900_000, 30)]} />);
    expect(order()).toBe("HUGE,NOCAP");
  });

  test("an empty universe renders no tiles without throwing", () => {
    render(() => <MarketMapView rows={[]} />);
    expect(order()).toBe("");
  });
});

describe("MarketMapView — the sort drives the colour", () => {
  const rows = [row("SMALL", 12_000, 91), row("HUGE", 1_805_376, 21)];

  test("sort=rsi_desc colours by RSI while the layout stays cap-ordered", () => {
    render(() => <MarketMapView rows={rows} sort="rsi_desc" onSortChange={() => {}} />);
    expect(selectedMetric()).toBe("rsi");
    expect(mapMetric()).toBe("rsi");
    // The regression: an RSI sort must never turn the map into cap-ascending slivers.
    expect(order()).toBe("HUGE,SMALL");
  });

  test("changing the sort prop re-colours on change, not on mount", () => {
    const [sort, setSort] = createSignal<MarketSortKey>("rsi_desc");
    r(() => <MarketMapView rows={rows} sort={sort()} onSortChange={setSort} />);
    expect(selectedMetric()).toBe("rsi");

    setSort("day_desc");
    expect(selectedMetric()).toBe("change_pct");

    setSort("pos_52w_desc");
    expect(selectedMetric()).toBe("pos_52w");
  });

  test("a manual Color-by choice survives until the sort changes again", () => {
    const [sort, setSort] = createSignal<MarketSortKey>("rsi_desc");
    r(() => <MarketMapView rows={rows} sort={sort()} onSortChange={setSort} />);
    const colorBy = screen.getByTestId("market-map-metric").querySelector("select")!;
    fireEvent.input(colorBy, { target: { value: "roe" } });
    expect(selectedMetric()).toBe("roe");

    // Re-selecting the same sort is not a change → no churn back to RSI.
    setSort("rsi_desc");
    expect(selectedMetric()).toBe("roe");

    setSort("perf_w_desc");
    expect(selectedMetric()).toBe("perf_w");
  });

  test("sort=symbol_asc leaves the current metric alone", () => {
    const [sort, setSort] = createSignal<MarketSortKey>("rsi_desc");
    r(() => <MarketMapView rows={rows} sort={sort()} onSortChange={setSort} />);
    expect(selectedMetric()).toBe("rsi");

    setSort("symbol_asc");
    expect(selectedMetric()).toBe("rsi");
  });

  test("changing the map's sort select reports the value and re-colours", () => {
    const onSortChange = vi.fn();
    render(() => (
      <MarketMapView rows={rows} sort="mcap_desc" onSortChange={onSortChange} />
    ));
    expect(selectedMetric()).toBe("market_cap");
    expect(selectedSort()).toBe("mcap_desc");

    fireEvent.input(screen.getByTestId("market-map-sort").querySelector("select")!, {
      target: { value: "rsi_desc" },
    });
    expect(onSortChange).toHaveBeenCalledWith("rsi_desc");
    expect(selectedMetric()).toBe("rsi");
  });
});
