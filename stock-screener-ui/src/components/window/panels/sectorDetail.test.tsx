// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { createMemo, type Accessor } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UIProvider } from "@/ui";
import { resetSectorState } from "@/state/sector";
import type { DockPanelContext } from "../../dock/types";
import { getPanelSpec, WINDOW_PANEL_TYPES } from "../panelRegistry";

const ctl = vi.hoisted(() => ({
  fetchSectorPerformance: vi.fn(),
  dockOpen: vi.fn(),
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
    open: ctl.dockOpen,
    preview: vi.fn(),
    endPreview: vi.fn(),
    close: vi.fn(),
    pinned: false,
    setOutlet: vi.fn(),
  }),
}));

// The canvas view is not inspectable in happy-dom; only the panel wiring is.
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
      top_movers: "RELIANCE(1.20%), ONGC(0.80%)",
    },
    {
      sector: "IT",
      avg_change: -0.5,
      stock_count: 8,
      advances: 2,
      declines: 6,
      avg_rsi: 45,
      avg_adx: 18,
      top_movers: "TCS(-0.60%), INFY(-0.40%)",
    },
    {
      sector: "NoData",
      avg_change: 0,
      stock_count: 3,
      advances: 1,
      declines: 2,
      avg_rsi: 50,
      avg_adx: 15,
      top_movers: "",
    },
  ],
  top_stock_movers: [{ symbol: "RELIANCE", change: 1.2, prev_change: 0.4, delta: 0.8 }],
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
  ctl.dockOpen.mockClear();
});

afterEach(() => {
  cleanup();
  resetSectorState();
});

describe("sector.detail — HOME desk drilldown", () => {
  it("(a) renders the selected sector's constituents with their change %", async () => {
    renderPanels(["sector.detail"]);

    await waitFor(() => expect(screen.getByTestId("sector-detail-table")).toBeInTheDocument());
    expect(screen.getByTestId("sector-detail-row-RELIANCE")).toHaveTextContent("+1.20%");
    expect(screen.getByTestId("sector-detail-row-ONGC")).toHaveTextContent("+0.80%");
    expect(screen.queryByTestId("sector-detail-row-TCS")).not.toBeInTheDocument();
    expect(WINDOW_PANEL_TYPES.has("sector.detail")).toBe(true);
  });

  it("(b) the selector is populated from the store and swaps the list without a new fetch", async () => {
    renderPanels(["sector.detail"]);

    await waitFor(() => expect(screen.getByTestId("sector-detail-row-RELIANCE")).toBeInTheDocument());
    const select = within(screen.getByTestId("sector-detail-select")).getByRole("combobox");
    expect(Array.from(select.querySelectorAll("option")).map((o) => o.textContent)).toEqual([
      "Energy", "IT", "NoData",
    ]);
    expect(ctl.fetchSectorPerformance).toHaveBeenCalledTimes(1);

    fireEvent.input(select, { target: { value: "IT" } });

    await waitFor(() => expect(screen.getByTestId("sector-detail-row-TCS")).toHaveTextContent("-0.60%"));
    expect(screen.queryByTestId("sector-detail-row-RELIANCE")).not.toBeInTheDocument();
    expect(ctl.fetchSectorPerformance).toHaveBeenCalledTimes(1);
  });

  it("(c) a sector with no member data shows an explanatory state, not a blank table", async () => {
    ctl.fetchSectorPerformance.mockResolvedValueOnce({
      ...SECTOR_RESPONSE,
      sectors: [{ ...SECTOR_RESPONSE.sectors[0], top_movers: "" }],
    });

    renderPanels(["sector.detail"]);

    await waitFor(() => expect(screen.getByTestId("sector-detail-no-members")).toBeInTheDocument());
    expect(screen.getByTestId("sector-detail-no-members")).toHaveTextContent(/no constituent data/i);
    expect(screen.queryByTestId("sector-detail-table")).not.toBeInTheDocument();
  });

  it("(d1) shows a loading state while the sector feed is in flight", async () => {
    let resolveFeed!: (value: typeof SECTOR_RESPONSE) => void;
    ctl.fetchSectorPerformance.mockImplementationOnce(
      () => new Promise<typeof SECTOR_RESPONSE>((resolve) => { resolveFeed = resolve; }),
    );

    renderPanels(["sector.detail"]);

    await waitFor(() => expect(screen.getByTestId("sector-detail-loading")).toBeInTheDocument());
    resolveFeed(SECTOR_RESPONSE);
    await waitFor(() => expect(screen.getByTestId("sector-detail-table")).toBeInTheDocument());
    expect(screen.queryByTestId("sector-detail-loading")).not.toBeInTheDocument();
  });

  it("(d2) shows the error message and a retry action when the feed fails", async () => {
    ctl.fetchSectorPerformance.mockRejectedValueOnce(new Error("sector feed exploded"));

    renderPanels(["sector.detail"]);

    await waitFor(() => expect(screen.getByTestId("sector-detail-error")).toHaveTextContent("sector feed exploded"));
    fireEvent.click(screen.getByTestId("sector-detail-retry"));
    await waitFor(() => expect(ctl.fetchSectorPerformance).toHaveBeenCalledTimes(2));
  });

  it("(e) clicking a constituent row opens the symbol dock with that symbol", async () => {
    renderPanels(["sector.detail"]);

    await waitFor(() => expect(screen.getByTestId("sector-detail-row-RELIANCE")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("sector-detail-row-RELIANCE"));
    expect(ctl.dockOpen).toHaveBeenCalledWith("RELIANCE");
  });

  it("(f) three sector panels open still produce exactly one /api/sector request", async () => {
    renderPanels(["sector.detail", "sector.table", "sector.movers"]);

    await waitFor(() => expect(screen.getByTestId("sector-detail-row-RELIANCE")).toBeInTheDocument());
    expect(screen.getByTestId("sector-row-energy")).toBeInTheDocument();
    expect(screen.getByTestId("interval-movers-table")).toBeInTheDocument();
    expect(ctl.fetchSectorPerformance).toHaveBeenCalledTimes(1);
  });
});
