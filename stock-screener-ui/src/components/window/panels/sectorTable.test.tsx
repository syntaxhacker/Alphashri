// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createMemo, createSignal, Show, type Accessor } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UIProvider } from "@/ui";
import { getSectorState, resetSectorState } from "@/state/sector";
import type { DockPanelContext } from "../../dock/types";
import { getPanelSpec, WINDOW_PANEL_TYPES } from "../panelRegistry";

// The registry defers this module; load it so hoisted mocks are ready on first mount.
await import("./sectorTable");

const ctl = vi.hoisted(() => ({
  fetchSectorPerformance: vi.fn(),
  sibling: (id: string) => ({
    id,
    page: "report" as const,
    title: id,
    size: 1,
    minWidth: 100,
    singleton: true,
    requires: [],
    mount: () => null,
  }),
}));

vi.mock("./marketHeatmap", () => ({ MARKET_HEATMAP_PANEL: ctl.sibling("market.heatmap") }));
vi.mock("./newsFeed", () => ({ NEWS_FEED_PANEL: ctl.sibling("news.feed") }));
vi.mock("./optionsChain", () => ({ OPTIONS_CHAIN_PANEL: ctl.sibling("options.chain") }));
vi.mock("./paperPositions", () => ({ PAPER_POSITIONS_PANEL: ctl.sibling("paper.positions") }));

vi.mock("@/api/sector", () => ({
  fetchSectorPerformance: (...args: unknown[]) => ctl.fetchSectorPerformance(...args),
}));

vi.mock("../../common/symbolDockContext", () => ({
  useSymbolDock: () => ({
    open: vi.fn(),
    preview: vi.fn(),
    endPreview: vi.fn(),
    close: vi.fn(),
    pinned: false,
    setOutlet: vi.fn(),
  }),
}));

// The canvas view is not inspectable in happy-dom; the panel's data wiring is.
vi.mock("../../sector/SectorHeatmapView", () => ({
  SectorHeatmapView: (props: { sectors: Array<{ sector: string }> }) => (
    <div data-testid="sector-heatmap-view">
      {props.sectors.map((s) => <div data-testid={`sector-tile-${s.sector}`}>{s.sector}</div>)}
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
      top_movers: "RELIANCE(1.20%)",
    },
  ],
  top_stock_movers: [
    { symbol: "RELIANCE", change: 1.2, prev_change: 0.4, delta: 0.8 },
  ],
  last_updated: "2026-11-19T10:00:00Z",
  market: "india",
};

const CTX: Accessor<DockPanelContext> = () => ({ market: "india" });

function MountSpec(props: { id: string }) {
  const spec = createMemo(() => getPanelSpec(props.id));
  const data = createMemo(() => spec()?.data?.(CTX));
  return (
    <>
      {spec() ? spec()!.mount(CTX, { data, commands: spec()!.commands ?? {} }) : <div data-testid="missing-spec" />}
    </>
  );
}

function renderPanels(ids: string[]) {
  return render(() => (
    <UIProvider>
      {ids.map((id) => <MountSpec id={id} />)}
    </UIProvider>
  ));
}

beforeEach(() => {
  resetSectorState();
  ctl.fetchSectorPerformance.mockReset();
  ctl.fetchSectorPerformance.mockResolvedValue(SECTOR_RESPONSE);
});

afterEach(() => {
  cleanup();
  resetSectorState();
});

describe("sector — two-window request count", () => {
  it("two table windows share one /api/sector fetch", async () => {
    renderPanels(["sector.table", "sector.table"]);

    await waitFor(() =>
      expect(screen.getAllByTestId("sector-row-energy")).toHaveLength(2),
    );
    expect(ctl.fetchSectorPerformance).toHaveBeenCalledTimes(1);
  });

  it("two heatmap windows share one /api/sector fetch", async () => {
    renderPanels(["sector.heatmap", "sector.heatmap"]);

    await waitFor(() =>
      expect(screen.getAllByTestId("sector-heatmap-panel")).toHaveLength(2),
    );
    expect(ctl.fetchSectorPerformance).toHaveBeenCalledTimes(1);
  });
});

describe("sector table + interval movers HOME desk panels", () => {
  it("(a) the table renders a sector row from the mocked sector response", async () => {
    renderPanels(["sector.table"]);

    await waitFor(() => expect(screen.getByTestId("sector-row-energy")).toBeInTheDocument());
    expect(screen.getByTestId("sector-row-energy")).toHaveTextContent("Energy");
    expect(WINDOW_PANEL_TYPES.has("sector.table")).toBe(true);
  });

  it("(b) the movers table renders a mover from the mocked sector response", async () => {
    renderPanels(["sector.movers"]);

    await waitFor(() => expect(screen.getByTestId("interval-movers-table")).toBeInTheDocument());
    expect(screen.getByTestId("interval-movers-table")).toHaveTextContent("RELIANCE");
    expect(WINDOW_PANEL_TYPES.has("sector.movers")).toBe(true);
  });

  it("(c) both panels render defined empty states when the feed has no rows", async () => {
    ctl.fetchSectorPerformance.mockResolvedValueOnce({
      ...SECTOR_RESPONSE,
      sectors: [],
      top_stock_movers: [],
    });

    renderPanels(["sector.table", "sector.movers"]);

    await waitFor(() => expect(screen.getByTestId("sector-table-empty")).toBeInTheDocument());
    expect(screen.getByTestId("sector-movers-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("sector-table")).not.toBeInTheDocument();
    expect(screen.queryByTestId("interval-movers-table")).not.toBeInTheDocument();
  });

  it("(empty-action) the empty states offer an enabled Retry button", async () => {
    ctl.fetchSectorPerformance.mockResolvedValueOnce({
      ...SECTOR_RESPONSE,
      sectors: [],
      top_stock_movers: [],
    });

    renderPanels(["sector.table", "sector.movers"]);

    await waitFor(() => expect(screen.getByTestId("sector-table-empty")).toBeInTheDocument());
    expect(screen.getByTestId("sector-table-empty-retry")).toBeEnabled();
    expect(screen.getByTestId("sector-movers-empty-retry")).toBeEnabled();
  });

  it("(d) a fetch failure renders its message in both panels", async () => {
    ctl.fetchSectorPerformance.mockRejectedValueOnce(new Error("sector feed exploded"));

    renderPanels(["sector.table", "sector.movers"]);

    await waitFor(() =>
      expect(screen.getByTestId("sector-table-error")).toHaveTextContent("sector feed exploded"),
    );
    expect(screen.getByTestId("sector-movers-error")).toHaveTextContent("sector feed exploded");
  });

  it("(e) mounting heatmap + table + movers triggers exactly one fetch", async () => {
    const [showHeatmap, setShowHeatmap] = createSignal(false);
    render(() => (
      <UIProvider>
        <Show when={showHeatmap()}><MountSpec id="sector.heatmap" /></Show>
        <MountSpec id="sector.table" />
        <MountSpec id="sector.movers" />
      </UIProvider>
    ));

    // Two new panels share one counter: one fetch for both.
    await waitFor(() => expect(screen.getByTestId("sector-row-energy")).toBeInTheDocument());
    expect(ctl.fetchSectorPerformance).toHaveBeenCalledTimes(1);

    // The heatmap reads the same store; it must not start a second request.
    setShowHeatmap(true);
    await waitFor(() => expect(screen.getByTestId("sector-heatmap-panel")).toBeInTheDocument());
    expect(screen.getByTestId("sector-movers-panel")).toBeInTheDocument();
    expect(ctl.fetchSectorPerformance).toHaveBeenCalledTimes(1);
  });

  it("(f) the shared market toggle switches every sector panel to america with one fetch", async () => {
    renderPanels(["sector.table", "sector.movers"]);
    await waitFor(() => expect(screen.getByTestId("sector-row-energy")).toBeInTheDocument());
    expect(ctl.fetchSectorPerformance).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("America"));

    await waitFor(() => expect(getSectorState().market).toBe("america"));
    await waitFor(() => expect(ctl.fetchSectorPerformance).toHaveBeenCalledWith("america"));
    expect(ctl.fetchSectorPerformance).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("sector-movers-panel")).toHaveTextContent("america");
  });
});
