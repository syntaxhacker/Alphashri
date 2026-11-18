// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createMemo, type Accessor } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UIProvider } from "@/ui";
import type { DockPanelContext } from "../../dock/types";
import type { MarketRow } from "../../../types/marketScreener";
import { getPanelSpec } from "../panelRegistry";

const ctl = vi.hoisted(() => ({
  setRows: null as unknown as (rows: MarketRow[]) => void,
  dockOpen: vi.fn(),
  chart: null as unknown as { handlers: Record<string, (payload: unknown) => void> },
}));

vi.mock("../../market/useMarketSnapshotSolid", async () => {
  const { createSignal } = await import("solid-js");
  const [rows, setRows] = createSignal<MarketRow[]>([]);
  ctl.setRows = setRows;
  return {
    useMarketSnapshotSolid: () => ({
      snapshot: () => null,
      rows,
      total: () => rows().length,
      updateMode: () => null,
      asOf: () => null,
      isLoading: () => false,
      error: () => null,
      refresh: () => {},
      lastUpdated: () => null,
      stale: () => false,
      ageSec: () => null,
      warming: () => false,
    }),
  };
});

vi.mock("@/utils/loadEcharts", () => ({
  loadEcharts: async () => ({
    init: () => {
      const chart = {
        handlers: {} as Record<string, (payload: unknown) => void>,
        setOption: () => {},
        on: (event: string, fn: (payload: unknown) => void) => {
          chart.handlers[event] = fn;
        },
        resize: () => {},
        dispose: () => {},
      };
      ctl.chart = chart;
      return chart;
    },
  }),
}));

vi.mock("../../common/symbolDockContext", () => ({
  useSymbolDock: () => ({
    open: ctl.dockOpen,
    preview: vi.fn(),
    endPreview: vi.fn(),
    close: vi.fn(),
    pinned: false,
    setOutlet: vi.fn(),
  }),
}));

function row(symbol: string, over: Partial<MarketRow> = {}): MarketRow {
  return {
    symbol,
    name: symbol,
    sector: "Energy",
    exchange: "NSE",
    close: 100,
    change: 1,
    relativeVolume: 1,
    marketCapCr: 100_000,
    capTier: "large",
    rsi: 55,
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
    ...over,
  };
}

const CTX: Accessor<DockPanelContext> = () => ({ market: "india" });

function MountSpec() {
  const spec = getPanelSpec("market.heatmap");
  if (!spec) return <div data-testid="missing-spec" />;
  const data = createMemo(() => spec.data?.(CTX));
  return <>{spec.mount(CTX, { data, commands: spec.commands ?? {} })}</>;
}

function renderPanel() {
  return render(() => (
    <UIProvider>
      <MountSpec />
    </UIProvider>
  ));
}

function snapshotRows() {
  return [
    row("RELIANCE", { capTier: "large", sector: "Energy", change: 1.2 }),
    row("TCS", { capTier: "large", sector: "IT", change: -0.8, relativeVolume: 3 }),
    row("NIFTYBEES", { capTier: "etf", sector: "ETF", change: 0.4, etf: true }),
  ];
}

const openFilters = () => fireEvent.click(screen.getByTestId("heatmap-filters-button"));

beforeEach(() => {
  ctl.setRows([]);
  ctl.dockOpen.mockClear();
});

afterEach(() => cleanup());

describe("market heatmap compact filter popover", () => {
  it("(a) ticking a cap tier filters the tiles and the count shows N of M", async () => {
    ctl.setRows(snapshotRows());
    renderPanel();

    await waitFor(() => expect(screen.getByTestId("market-map-view")).toBeInTheDocument());
    expect(screen.getByTestId("heatmap-filter-count")).toHaveTextContent("3 of 3");

    openFilters();
    fireEvent.click(screen.getByTestId("heatmap-filter-cap-etf"));

    await waitFor(() => expect(screen.getByTestId("heatmap-filter-count")).toHaveTextContent("1 of 3"));
    expect(screen.getByTestId("market-map-count")).toHaveTextContent("1 stocks");
  });

  it("(b) the Filters (n) badge counts active filters using countActiveMarketFilters", async () => {
    ctl.setRows(snapshotRows());
    renderPanel();

    await waitFor(() => expect(screen.getByTestId("heatmap-filters-button")).toBeInTheDocument());
    const button = screen.getByTestId("heatmap-filters-button");
    expect(button).toHaveTextContent("Filters (0)");

    openFilters();
    fireEvent.click(screen.getByTestId("heatmap-filter-cap-etf"));
    fireEvent.click(screen.getByTestId("heatmap-filter-sector-option-IT"));

    expect(button).toHaveTextContent("Filters (2)");
    expect(button).toHaveAttribute("aria-label", "Filters (2)");
  });

  it("(c) sector options are derived from the loaded rows", async () => {
    ctl.setRows(snapshotRows());
    renderPanel();

    await waitFor(() => expect(screen.getByTestId("heatmap-filters-button")).toBeInTheDocument());
    openFilters();

    expect(screen.getByTestId("heatmap-filter-sector-option-IT")).toBeInTheDocument();
    expect(screen.getByTestId("heatmap-filter-sector-option-ETF")).toBeInTheDocument();
    expect(screen.queryByTestId("heatmap-filter-sector-option-Pharma")).not.toBeInTheDocument();
  });

  it("(d) filtering to zero rows renders the empty state, not a crash", async () => {
    ctl.setRows(snapshotRows());
    renderPanel();

    await waitFor(() => expect(screen.getByTestId("market-map-view")).toBeInTheDocument());
    openFilters();
    fireEvent.click(screen.getByTestId("heatmap-filter-cap-etf"));
    fireEvent.click(screen.getByTestId("heatmap-filter-sector-option-IT"));

    await waitFor(() => expect(screen.getByTestId("market-heatmap-empty")).toBeInTheDocument());
    expect(screen.getByTestId("market-heatmap-empty")).toHaveTextContent(/no stocks match/i);
    expect(screen.queryByTestId("market-map-view")).not.toBeInTheDocument();
    expect(screen.getByTestId("heatmap-filter-count")).toHaveTextContent("0 of 3");
  });

  it("(e) Esc closes the portalled popover and returns focus to the button", async () => {
    ctl.setRows(snapshotRows());
    renderPanel();

    await waitFor(() => expect(screen.getByTestId("heatmap-filters-button")).toBeInTheDocument());
    const button = screen.getByTestId("heatmap-filters-button") as HTMLButtonElement;
    openFilters();

    const popover = screen.getByTestId("heatmap-filters-popover");
    expect(popover).toBeInTheDocument();
    // Portalled out of the window panel: an in-flow child would be clipped by
    // the frame's overflow-hidden. Fixed positioning is the other half of it.
    expect(screen.getByTestId("market-heatmap-panel").contains(popover)).toBe(false);
    expect(popover.closest("body")).toBe(document.body);
    expect(popover).toHaveStyle({ position: "fixed" });
    await waitFor(() => expect(popover.contains(document.activeElement)).toBe(true));

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByTestId("heatmap-filters-popover")).not.toBeInTheDocument());
    expect(document.activeElement).toBe(button);
  });
});
