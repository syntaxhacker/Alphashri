// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UIProvider } from "@/ui";
import type { MarketRow } from "../../types/marketScreener";
import { MarketGrid } from "./MarketScreenerPanel";
import { buildMarketColumns } from "./marketColumns";
import {
  applyMarketNarrowLayout,
  MARKET_NARROW_PRIMARY_WIDTH,
  narrowMarketColumns,
} from "./marketNarrowLayout";

vi.mock("../common/useTablePrefs", () => ({
  useTablePrefs: () => ({
    prefs: () => ({ sorting: [], order: [], hidden: [] }),
    setSorting: () => {},
    setColumnPrefs: () => {},
    status: () => "ready",
    error: () => null,
    hydrated: () => true,
    retry: () => {},
  }),
}));

const row: MarketRow = {
  symbol: "RELIANCE",
  name: "Reliance Industries",
  sector: "Energy",
  exchange: "NSE",
  close: 1412.5,
  change: 1.2,
  relativeVolume: 1.8,
  marketCapCr: 1900000,
  capTier: "large",
  rsi: 62,
  adx: 28,
  pos52w: 0.82,
  fno: true,
  etf: false,
} as MarketRow;

function headers() {
  return [...document.querySelectorAll("thead th")].map((th) => ({
    id: th.id.replace("paper-tanstack-header-", ""),
    text: (th.textContent ?? "").trim(),
    width: Number.parseFloat(th.style.width),
  }));
}

afterEach(cleanup);

describe("MarketGrid narrow columns", () => {
  it("shows the four primary columns at initial scroll with short headers", () => {
    const columns = applyMarketNarrowLayout(narrowMarketColumns(buildMarketColumns({ narrow: true })));
    render(() => (
      <UIProvider>
        <MarketGrid
          data={[row]}
          columns={columns}
          narrow={true}
          hasActiveFilters={false}
          onResetFilters={() => {}}
          onRowClick={() => {}}
          getRowStyle={() => undefined}
          getRowTestId={(r) => `market-row-${r.symbol}`}
        />
      </UIProvider>
    ));

    const cols = headers();
    expect(cols.slice(0, 4).map((col) => col.id)).toEqual([
      "symbol",
      "close",
      "day_change",
      "sector",
    ]);
    expect(cols.slice(0, 4).map((col) => col.text)).toEqual(["SYMBOL", "LTP", "CHG%", "SECTOR"]);
    // NAME is still present, but only after the four readable metrics.
    expect(cols.findIndex((col) => col.id === "name")).toBeGreaterThan(3);
    expect(screen.getByTestId("market-close-RELIANCE")).toBeInTheDocument();
    expect(screen.getByTestId("market-change-RELIANCE")).toBeInTheDocument();
    expect(screen.getByTestId("market-sector-RELIANCE")).toBeInTheDocument();
  });

  it("keeps the first four columns inside 358px and pins the symbol column", () => {
    const columns = applyMarketNarrowLayout(narrowMarketColumns(buildMarketColumns({ narrow: true })));
    render(() => (
      <UIProvider>
        <MarketGrid
          data={[row]}
          columns={columns}
          narrow={true}
          hasActiveFilters={false}
          onResetFilters={() => {}}
          onRowClick={() => {}}
          getRowStyle={() => undefined}
          getRowTestId={(r) => `market-row-${r.symbol}`}
        />
      </UIProvider>
    ));

    const primaryWidth = headers()
      .slice(0, 4)
      .reduce((sum, col) => sum + col.width, 0);
    expect(primaryWidth).toBe(MARKET_NARROW_PRIMARY_WIDTH);
    expect(primaryWidth).toBeLessThanOrEqual(358);
    for (const col of headers().slice(0, 4)) {
      // No header is clipped: glyph width + dense padding fits its cell.
      expect(col.text.length * 7.6 + 12, col.id).toBeLessThanOrEqual(col.width);
    }

    const wrapper = document.querySelector<HTMLElement>('[data-market-narrow="true"]')!;
    expect(wrapper).toBeInTheDocument();
    expect(wrapper.textContent).toContain("position: sticky");
    const table = screen.getByTestId("market-grid");
    expect(table.style.minWidth).toBe(`${MARKET_NARROW_PRIMARY_WIDTH}px`);
  });

  it("attached scroll cue is shown above the header when columns overflow", async () => {
    const columns = applyMarketNarrowLayout(narrowMarketColumns(buildMarketColumns({ narrow: true })));
    render(() => (
      <UIProvider>
        <MarketGrid
          data={[row]}
          columns={columns}
          narrow={true}
          hasActiveFilters={false}
          onResetFilters={() => {}}
          onRowClick={() => {}}
          getRowStyle={() => undefined}
          getRowTestId={(r) => `market-row-${r.symbol}`}
        />
      </UIProvider>
    ));

    const scrollport = document.querySelector<HTMLElement>(".paper-tanstack-scroll")!;
    Object.defineProperty(scrollport, "clientWidth", { configurable: true, value: 354 });
    Object.defineProperty(scrollport, "scrollWidth", { configurable: true, value: 1100 });
    fireEvent.scroll(scrollport);
    const hint = await screen.findByTestId("market-grid-scroll-hint");
    expect(hint).toHaveTextContent("Scroll →");
    await waitFor(() => expect(scrollport).toHaveAttribute("data-scroll", "horizontal"));
    // The cue sits between the column controls and the table header.
    expect(hint.nextElementSibling).toBe(scrollport);
    expect(scrollport.querySelector("thead")).toBeInTheDocument();
  });

  it("keeps the 1600px table dense, ordered and 1000px wide", () => {
    const columns = buildMarketColumns();
    render(() => (
      <UIProvider>
        <MarketGrid
          data={[row]}
          columns={columns}
          narrow={false}
          hasActiveFilters={false}
          onResetFilters={() => {}}
          onRowClick={() => {}}
          getRowStyle={() => undefined}
          getRowTestId={(r) => `market-row-${r.symbol}`}
        />
      </UIProvider>
    ));

    expect(document.querySelector('[data-market-narrow="true"]')).toBeNull();
    expect(headers()[0].id).toBe("symbol");
    expect(headers().find((col) => col.id === "day_change")?.text).toBe("DAY %");
    expect(screen.getByTestId("market-grid").style.minWidth).toBe("1000px");
  });

  it("drops symbol affordances on narrow rows but keeps the symbol text", () => {
    const column = buildMarketColumns({ narrow: true }).find((col) => col.id === "symbol")!;
    render(() =>
      column.cell!({
        row: { original: row, index: 0, isExpanded: () => false, toggle: () => {} },
        column,
      }),
    );
    expect(screen.getByTestId("market-symbol-RELIANCE")).toHaveTextContent("RELIANCE");
    expect(screen.queryByTestId("market-chart-RELIANCE")).toBeNull();
    expect(screen.queryByTestId("symbol-tv-RELIANCE")).toBeNull();
    expect(screen.queryByTestId("symbol-options-RELIANCE")).toBeNull();
    expect(screen.getByTestId("market-fno-RELIANCE")).toBeInTheDocument();
  });
});
