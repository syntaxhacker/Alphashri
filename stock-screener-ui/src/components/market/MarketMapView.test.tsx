// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { MarketMapView } from "./MarketMapView";
import type { MarketRow } from "../../types/marketScreener";

// ECharts cannot be inspected in happy-dom; this stub records the tile order
// the map hands to the primitive, which is the surface the user sees.
vi.mock("@/components/heatmap/HeatmapTreemap", () => ({
  HeatmapTreemap: (props: { stocks: { symbol: string }[] }) => (
    <div data-testid="treemap-received">
      {props.stocks.map((s) => s.symbol).join(",")}
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
