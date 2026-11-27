// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createMemo, type Accessor } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UIProvider } from "@/ui";
import type { RotationRow } from "@/types/rotation";
import type { DockPanelContext } from "../../dock/types";
import { getPanelSpec, WINDOW_PANEL_TYPES } from "../panelRegistry";

const ctl = vi.hoisted(() => ({
  fetchRotationOverview: vi.fn(),
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
vi.mock("./paperPositions", () => ({ PAPER_POSITIONS_PANEL: ctl.sibling("paper.positions") }));
vi.mock("./sectorHeatmap", () => ({ SECTOR_HEATMAP_PANEL: ctl.sibling("sector.heatmap") }));
vi.mock("./patternResults", () => ({ PATTERN_RESULTS_PANEL: ctl.sibling("patterns.results") }));

vi.mock("@/api/rotation", () => ({
  fetchRotationOverview: (...args: unknown[]) => ctl.fetchRotationOverview(...args),
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

function row(
  id: string,
  name: string,
  rs_pct: number,
  mom_pct: number,
  quadrant: RotationRow["quadrant"],
): RotationRow {
  return {
    id,
    name,
    kind: "sector",
    slug: null,
    category: "Technology",
    members: 12,
    covered: 12,
    returns: { "1D": 1, "1W": 2, "1M": 3, "3M": 4, "6M": 5, YTD: 6, "1Y": 7 },
    rs_1m: 60,
    rs_1w: 55,
    rs_pct,
    mom_pct,
    rank: 1,
    rank_delta: 0,
    breadth: 60,
    rel_volume: 1.1,
    quadrant,
    status: "heating",
    top_movers: [{ symbol: "TCS", change: 1.2 }],
  };
}

const RESPONSE = {
  market: "india",
  kind: "sector",
  period: "1M",
  benchmark: "NIFTY",
  last_updated: "2026-11-19T10:00:00Z",
  regime: {
    benchmark: "NIFTY",
    benchmark_change: 0.4,
    benchmark_1m: 1.2,
    vix: 14.2,
    vix_change: -0.3,
    breadth: 55,
    label: "ON",
  },
  counts: { booming: 1, heating: 1, cooling: 0, dumping: 0, neutral: 0 },
  rows: [
    row("sector-it", "Information Technology", 72, 74, "leading"),
    row("sector-metal", "Metals & Mining", 28, 26, "lagging"),
  ],
};

const CTX: Accessor<DockPanelContext> = () => ({ market: "india" });

// A row name appears in the plot label, the compact summary and the legend.
// The label and dot test ids pin each assertion to the intended surface.
const IT_LABEL = "rotation-rrg-label-sector-it";
const IT_DOT = "rotation-rrg-dot-sector-it";

function MountSpec() {
  const spec = getPanelSpec("sector.rotation");
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
  ctl.fetchRotationOverview.mockReset();
  ctl.fetchRotationOverview.mockResolvedValue(RESPONSE);
  ctl.dockOpen.mockClear();
});

afterEach(() => {
  cleanup();
});

function TwoRotations(props: { ctxs: Accessor<DockPanelContext>[] }) {
  return (
    <>
      {props.ctxs.map((ctx) => {
        const data = createMemo(() => getPanelSpec("sector.rotation")?.data?.(ctx));
        const spec = getPanelSpec("sector.rotation")!;
        return <span>{spec.mount(ctx, { data, commands: {} })}</span>;
      })}
    </>
  );
}

function renderTwoRotations(contexts: DockPanelContext[]) {
  return render(() => (
    <UIProvider>
      <TwoRotations ctxs={contexts.map((c) => () => c)} />
    </UIProvider>
  ));
}

describe("sector.rotation — two-window request count", () => {
  it("same market+kind: two windows join one rotation fetch", async () => {
    renderTwoRotations([{ market: "india" }, { market: "india" }]);

    await waitFor(() =>
      expect(screen.getAllByTestId("sector-rotation-panel")).toHaveLength(2),
    );
    await waitFor(() =>
      expect(screen.getAllByTestId(IT_LABEL)).toHaveLength(2),
    );
    expect(ctl.fetchRotationOverview).toHaveBeenCalledTimes(1);
  });

  it("different market: two windows fetch two rotations", async () => {
    renderTwoRotations([{ market: "india" }, { market: "america" }]);

    await waitFor(() =>
      expect(screen.getAllByTestId("sector-rotation-panel")).toHaveLength(2),
    );
    await waitFor(() =>
      expect(screen.getAllByTestId(IT_LABEL)).toHaveLength(2),
    );
    expect(ctl.fetchRotationOverview).toHaveBeenCalledTimes(2);
    expect(
      ctl.fetchRotationOverview.mock.calls.map((c) => c[0]?.market).sort(),
    ).toEqual(["america", "india"]);
  });
});

describe("sector.rotation window panel", () => {
  it("(a) renders a sector label from the mocked rotation response", async () => {
    renderPanel();

    await waitFor(() =>
      expect(screen.getByTestId(IT_LABEL)).toHaveTextContent("Information Technology"),
    );
    expect(screen.getByTestId("rotation-rrg-chart")).toBeInTheDocument();
    expect(screen.getByTestId(IT_DOT)).toHaveAttribute(
      "aria-label",
      expect.stringContaining("Information Technology"),
    );
    expect(WINDOW_PANEL_TYPES.has("sector.rotation")).toBe(true);
  });

  it("(b) the kind control changes the fetched param (assert the URL the mock received)", async () => {
    renderPanel();
    await waitFor(() =>
      expect(screen.getByTestId(IT_LABEL)).toHaveTextContent("Information Technology"),
    );

    const before = String(ctl.fetchRotationOverview.mock.calls[0]?.[0]?.kind ?? "");
    expect(before).toBe("sector");

    const kind = screen.getByTestId("sector-rotation-kind").querySelector("select")!;
    fireEvent.input(kind, { target: { value: "industry" } });

    await waitFor(() =>
      expect(ctl.fetchRotationOverview.mock.lastCall?.[0]?.kind).toBe("industry"),
    );
    expect(ctl.fetchRotationOverview.mock.calls.length).toBeGreaterThan(1);
  });

  it("(b2) the period control is typed from RotationPeriod and changes its selection", async () => {
    renderPanel();
    await waitFor(() =>
      expect(screen.getByTestId(IT_LABEL)).toHaveTextContent("Information Technology"),
    );

    const period = screen.getByTestId("sector-rotation-period").querySelector("select")!;
    expect(Array.from(period.options).some((o) => o.value === "3M")).toBe(true);
    fireEvent.input(period, { target: { value: "3M" } });
    expect(period.value).toBe("3M");
  });

  it("(c) loading renders a defined state, never a blank box", () => {
    let resolveLoad: (() => void) | undefined;
    ctl.fetchRotationOverview.mockImplementationOnce(
      () => new Promise((resolve) => { resolveLoad = () => resolve(RESPONSE); }),
    );

    renderPanel();

    expect(screen.getByTestId("sector-rotation-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("rotation-rrg-chart")).not.toBeInTheDocument();
    resolveLoad?.();
  });

  it("(c) empty renders a defined state", async () => {
    ctl.fetchRotationOverview.mockResolvedValueOnce({ ...RESPONSE, rows: [] });

    renderPanel();

    await waitFor(() => expect(screen.getByTestId("sector-rotation-empty")).toBeInTheDocument());
    expect(screen.queryByTestId("rotation-rrg-chart")).not.toBeInTheDocument();
  });

  it("(empty-action) the empty state offers an enabled Retry button", async () => {
    ctl.fetchRotationOverview.mockResolvedValueOnce({ ...RESPONSE, rows: [] });

    renderPanel();

    await waitFor(() => expect(screen.getByTestId("sector-rotation-empty")).toBeInTheDocument());
    expect(screen.getByTestId("sector-rotation-empty-retry")).toBeEnabled();
  });

  it("(c) a fetch failure renders its message", async () => {
    ctl.fetchRotationOverview.mockRejectedValueOnce(new Error("rotation feed exploded"));

    renderPanel();

    await waitFor(() =>
      expect(screen.getByTestId("sector-rotation-error")).toHaveTextContent("rotation feed exploded"),
    );
    expect(screen.queryByTestId("rotation-rrg-chart")).not.toBeInTheDocument();
  });

  it("(d) the chart container is flex-sized, never a fixed pixel height", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("rotation-rrg-chart")).toBeInTheDocument());

    const chart = screen.getByTestId("rotation-rrg-chart");
    expect(chart.className).toContain("flex-1");
    expect(chart.className).toContain("min-h-0");
    expect(chart.className).not.toMatch(/h-\[\d+px\]/);
    expect(chart.style.height).toBe("");

    const wrapper = chart.parentElement!.parentElement!;
    expect(wrapper.className).toContain("flex-1");
    expect(wrapper.className).toContain("min-h-0");
  });

  it("(e) a point click opens the symbol dock with the row's real top-mover symbol", async () => {
    renderPanel();
    await waitFor(() =>
      expect(screen.getByTestId(IT_LABEL)).toHaveTextContent("Information Technology"),
    );

    const dot = screen.getByTestId(IT_DOT);
    expect(dot).toHaveAttribute("aria-label", expect.stringContaining("Information Technology"));
    fireEvent.click(dot);

    expect(ctl.dockOpen).toHaveBeenCalledWith("TCS", "chart", "india");
  });
});
