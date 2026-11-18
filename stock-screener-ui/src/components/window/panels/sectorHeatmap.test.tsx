// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createMemo, createSignal, Show, type Accessor } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UIProvider } from "@/ui";
import { getSectorState, resetSectorState } from "@/state/sector";
import type { DockPanelContext } from "../../dock/types";
import { getPanelSpec, WINDOW_PANEL_TYPES } from "../panelRegistry";

const ctl = vi.hoisted(() => ({
  fetchSectorPerformance: vi.fn(),
  dockOpen: vi.fn(),
  sibling: (id: string) => ({
    id,
    page: "report",
    title: id,
    size: 1,
    minWidth: 100,
    singleton: true,
    requires: [],
    mount: () => null,
  }),
}));

// Sibling window panels belong to other lanes. Stub them so this unit test
// exercises the real registry without loading their in-flight dependencies.
vi.mock("./marketHeatmap", () => ({ MARKET_HEATMAP_PANEL: ctl.sibling("market.heatmap") }));
vi.mock("./newsFeed", () => ({ NEWS_FEED_PANEL: ctl.sibling("news.feed") }));
vi.mock("./optionsChain", () => ({ OPTIONS_CHAIN_PANEL: ctl.sibling("options.chain") }));

vi.mock("@/api/sector", () => ({
  fetchSectorPerformance: (...args: unknown[]) => ctl.fetchSectorPerformance(...args),
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

// The real view paints to a canvas. A DOM double lets the panel's data wiring be
// asserted without re-testing ECharts (which has its own suite).
vi.mock("../../sector/SectorHeatmapView", () => ({
  SectorHeatmapView: (props: {
    viewMode: string;
    sectors: Array<{ sector: string }>;
    stocks: Array<{ symbol: string }>;
    metric: string;
    onSymbolClick?: (symbol: string) => void;
  }) => (
    <div data-testid="sector-heatmap-view" data-metric={props.metric} data-view={props.viewMode}>
      {props.viewMode === "sector"
        ? props.sectors.map((s) => (
            <button type="button" data-testid={`sector-tile-${s.sector}`}>
              {s.sector}
            </button>
          ))
        : props.stocks.map((s) => (
            <button
              type="button"
              data-testid={`stock-tile-${s.symbol}`}
              onClick={() => props.onSymbolClick?.(s.symbol)}
            >
              {s.symbol}
            </button>
          ))}
    </div>
  ),
}));

const SECTOR_RESPONSE = {
  sectors: [
    {
      sector: "Energy",
      avg_change: 1.2,
      stock_count: 10,
      advances: 6,
      declines: 4,
      avg_rsi: 55,
      avg_adx: 20,
      top_movers: "RELIANCE",
    },
    {
      sector: "IT",
      avg_change: -0.8,
      stock_count: 8,
      advances: 2,
      declines: 6,
      avg_rsi: 45,
      avg_adx: 18,
      top_movers: "TCS",
    },
  ],
  top_stock_movers: [
    { symbol: "RELIANCE", change: 1.2 },
    { symbol: "TCS", change: -0.8 },
  ],
  last_updated: "2026-11-19T10:00:00Z",
  market: "india",
};

const CTX: Accessor<DockPanelContext> = () => ({ market: "india" });

function MountSpec() {
  const spec = getPanelSpec("sector.heatmap");
  const data = createMemo(() => spec?.data?.(CTX));
  return (
    <>
      {spec ? spec.mount(CTX, { data, commands: spec.commands ?? {} }) : <div data-testid="missing-spec" />}
    </>
  );
}

function renderPanel() {
  return render(() => (
    <UIProvider>
      <MountSpec />
    </UIProvider>
  ));
}

beforeEach(() => {
  resetSectorState();
  ctl.fetchSectorPerformance.mockReset();
  ctl.fetchSectorPerformance.mockResolvedValue(SECTOR_RESPONSE);
  ctl.dockOpen.mockClear();
});

afterEach(() => {
  cleanup();
  resetSectorState();
});

describe("sector.heatmap window panel", () => {
  it("(a) renders sector tiles from the mocked sector response", async () => {
    renderPanel();

    await waitFor(() => expect(screen.getByTestId("sector-tile-Energy")).toBeInTheDocument());
    expect(screen.getByTestId("sector-tile-IT")).toBeInTheDocument();
    expect(ctl.fetchSectorPerformance).toHaveBeenCalledTimes(1);
    expect(WINDOW_PANEL_TYPES.has("sector.heatmap")).toBe(true);
  });

  it("(b) keeps one metric selector inside the window and changes the store metric", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("sector-tile-Energy")).toBeInTheDocument());

    const panel = screen.getByTestId("sector-heatmap-panel");
    expect(panel.querySelectorAll("select")).toHaveLength(1);
    const metric = screen.getByTestId("sector-heatmap-metric").querySelector("select")!;
    fireEvent.input(metric, { target: { value: "pe_ratio" } });

    await waitFor(() => expect(getSectorState().heatmapMetric).toBe("pe_ratio"));
    expect(screen.getByTestId("sector-heatmap-view")).toHaveAttribute("data-metric", "pe_ratio");
  });

  it("(c) loading renders a defined state, never a blank box", () => {
    let resolveLoad: (() => void) | undefined;
    ctl.fetchSectorPerformance.mockImplementationOnce(
      () => new Promise((resolve) => { resolveLoad = () => resolve(SECTOR_RESPONSE); }),
    );

    renderPanel();

    expect(screen.getByTestId("sector-heatmap-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("sector-heatmap-view")).not.toBeInTheDocument();
    resolveLoad?.();
  });

  it("(d) a fetch failure renders its message", async () => {
    ctl.fetchSectorPerformance.mockRejectedValueOnce(new Error("sector feed exploded"));

    renderPanel();

    await waitFor(() =>
      expect(screen.getByTestId("sector-heatmap-error")).toHaveTextContent("sector feed exploded"),
    );
    expect(screen.queryByTestId("sector-heatmap-view")).not.toBeInTheDocument();
  });

  it("(empty) renders a defined empty state", async () => {
    ctl.fetchSectorPerformance.mockResolvedValueOnce({
      ...SECTOR_RESPONSE,
      sectors: [],
      top_stock_movers: [],
    });

    renderPanel();

    await waitFor(() => expect(screen.getByTestId("sector-heatmap-empty")).toBeInTheDocument());
    expect(screen.queryByTestId("sector-heatmap-view")).not.toBeInTheDocument();
  });

  it("(e) stock view maps the store's movers and a click opens the symbol dock", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("sector-tile-Energy")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Stocks"));
    await waitFor(() => expect(screen.getByTestId("stock-tile-RELIANCE")).toBeInTheDocument());
    expect(screen.getByTestId("stock-tile-TCS")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("stock-tile-RELIANCE"));
    expect(ctl.dockOpen).toHaveBeenCalledWith("RELIANCE");
  });

  it("(f) two mounts share one load — no double-fetch storm", async () => {
    render(() => (
      <UIProvider>
        <MountSpec />
        <MountSpec />
      </UIProvider>
    ));

    await waitFor(() => expect(screen.getAllByTestId("sector-tile-Energy")).toHaveLength(2));
    expect(ctl.fetchSectorPerformance).toHaveBeenCalledTimes(1);
  });

  it("(g) one unmount keeps shared data; the last unmount tears the store down", async () => {
    const [count, setCount] = createSignal(2);
    render(() => (
      <UIProvider>
        <Show when={count() >= 1}><MountSpec /></Show>
        <Show when={count() >= 2}><MountSpec /></Show>
      </UIProvider>
    ));
    await waitFor(() => expect(screen.getAllByTestId("sector-tile-Energy")).toHaveLength(2));

    setCount(1);
    expect(getSectorState().data).not.toBeNull();
    expect(screen.getAllByTestId("sector-tile-Energy")).toHaveLength(1);

    setCount(0);
    expect(getSectorState().data).toBeNull();
  });
});
