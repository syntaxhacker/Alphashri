// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { UIProvider } from "@/ui";

// The workspace is a pure grid-layout contract here: every heavy panel is
// stubbed so the test only sees the grid's direct element children. The report
// signal drives the empty/populated states without any network or timers.
const [report, setReport] = createSignal<any>(null);
const [desk, setDesk] = createSignal(false);
const [mode, setMode] = createSignal("live");

const mockStore = {
  data: {
    report,
    breadth: () => ({ available: true, count: 1, up: 1, rows: [{ label: "NIFTY", last: 25_000, close: 24_900, change_pct: 0.4 }] }),
    oiScale: () => ({ maxCeOiChange: 1, maxPeOiChange: 1 }),
    atmStrike: () => null,
    oiWalls: () => null,
    visibleStrikes: () => [],
    effectiveBursts: () => [],
    tape: () => [],
    oiPoints: () => [],
    flipAt: () => null,
    tapeRows: () => [],
    metrics: () => null,
    intradayStart: () => null,
  },
  walls: { data: () => null },
  selection: { mode, symbol: () => "NIFTY" },
  replay: { frameT: () => null },
  ui: {
    isDesk: desk,
    sideTab: () => "chain",
    chartSize: () => "fill",
    heatMetric: () => "oi",
    handleChartTf: () => {},
    handleChartSize: () => {},
    openChartFull: () => {},
    setSideTab: () => {},
    setHeatMetric: () => {},
    setHeatExpand: () => {},
    openOiExpand: () => {},
    setGexOpen: () => {},
    setIvOpen: () => {},
    deskDockTab: () => "flow",
    setDeskDockTab: () => {},
  },
};

vi.mock("./ReportContext", () => ({ useNiftyReport: () => mockStore }));
vi.mock("./NiftyChartPanel", () => ({
  NiftyChartPanel: (props: any) => (
    <div data-testid="chart-stub" data-fill={props.fillContainer ? "true" : "false"} />
  ),
}));
vi.mock("./DeskDock", () => ({ DeskDock: () => null }));
vi.mock("./NiftyDeltaPositioning", () => ({
  NiftyDeltaPositioning: () => <div data-testid="delta-stub" />,
}));
vi.mock("./NiftyGexProfile", () => ({ NiftyGexProfile: () => <div data-testid="gex-stub" /> }));
vi.mock("./NiftyIvSkew", () => ({ NiftyIvSkew: () => <div data-testid="iv-stub" /> }));
vi.mock("./NiftyOiHeatmap", () => ({ NiftyOiHeatmap: () => <div data-testid="heatmap-stub" /> }));
vi.mock("./reportCells", () => ({
  NiftyOiChain: (props: any) => <div data-testid="oi-chain-stub" ref={props.wrapRef} />,
  getNiftyOiColumns: () => [],
}));

const { ReportWorkspace, DESK_CHART_FLOOR_PX } = await import("./ReportWorkspace");

function mount() {
  return render(() => (
    <UIProvider>
      <ReportWorkspace />
    </UIProvider>
  ));
}

afterEach(() => {
  cleanup();
  setReport(null);
  setDesk(false);
  setMode("live");
});

describe("ReportWorkspace grid", () => {
  test("side column stays in the right track while the report is absent", () => {
    setReport(null);
    mount();

    const grid = screen.getByTestId("nifty-main-row");
    const side = screen.getByTestId("nifty-side-col");
    expect(screen.getByTestId("nifty-chart-placeholder")).toBeInTheDocument();
    // The placeholder is the first grid child; the side column is the second.
    expect(Array.from(grid.children)).toHaveLength(2);
    expect(Array.from(grid.children)[1]).toBe(side);
    expect(grid.className).toContain("624px");
  });

  test("side column stays second with two column tracks after the report loads", async () => {
    setReport({ spot: 25_000, strikes: [], positioning: {}, gex: null });
    mount();

    const grid = screen.getByTestId("nifty-main-row");
    const side = screen.getByTestId("nifty-side-col");
    expect(Array.from(grid.children)[1]).toBe(side);
    expect(grid.className).toContain("minmax(0,1fr)");
    expect(grid.className).toContain("624px");
    expect(await screen.findByTestId("chart-stub")).toBeInTheDocument();
    expect(screen.queryByTestId("nifty-chart-placeholder")).not.toBeInTheDocument();
  });

  test("the chart row carries the phone order marker and the compact chain track", () => {
    setReport({ spot: 25_000, strikes: [], positioning: {}, gex: null });
    mount();

    const grid = screen.getByTestId("nifty-main-row");
    expect(grid).toHaveAttribute("data-report-order", "chart");
    // The shell owns the single phone order slot for the chart; a local order
    // here would tie with the shell rule and re-open the old preview ambiguity.
    expect(grid.className).not.toContain("max-[600px]:order-");
    expect(grid.className).toContain("max-[600px]:grid-rows-[minmax(0,1fr)_minmax(0,156px)]!");
    // Grid children and their testids are unchanged by the reorder.
    expect(Array.from(grid.children)[1]).toBe(screen.getByTestId("nifty-side-col"));
    expect(screen.getByTestId("oi-chain-stub")).toBeInTheDocument();
  });

  test("the 1600 desk side column has no unoccupied flex remainder", () => {
    // No matchMedia is registered here, so useMediaQuery reports non-mobile:
    // the 1600 desk case. Both panels mount in the same 420px column.
    setDesk(true);
    setReport({ spot: 25_000, strikes: [], positioning: {}, gex: null });
    mount();

    const side = screen.getByTestId("nifty-side-col");
    expect(side).toHaveAttribute("data-side-secondary", "heatmap");
    // The stubbed chain keeps its wrapper slot (real app: nifty-oi-panel).
    expect(screen.getByTestId("oi-chain-stub")).toBeInTheDocument();
    expect(screen.getByTestId("desk-insight-rail")).toBeInTheDocument();

    const chainSlot = side.querySelector('[data-side-slot="chain"]') as HTMLElement;
    const heatSlot = side.querySelector('[data-side-slot="heatmap"]') as HTMLElement;
    expect(chainSlot).not.toBeNull();
    expect(heatSlot).toBe(screen.getByTestId("nifty-chart-side-heatmap"));

    // The chain hugs its five rows; only the heatmap grows into the remainder.
    expect(chainSlot.className).toContain("shrink-0");
    expect(chainSlot.className).not.toContain("flex-auto");
    expect(heatSlot.className).toContain("flex-auto");
    expect(heatSlot.className).toContain("min-h-0");

    // One instance of every side testid: the secondary does not duplicate the
    // chain or the tab controls.
    expect(screen.getAllByTestId("nifty-heatmap-metric-toggle")).toHaveLength(1);
    expect(screen.getAllByTestId("nifty-heatmap-wrap")).toHaveLength(1);
    expect(screen.getAllByTestId("nifty-side-tabs")).toHaveLength(1);
  });

  test("the desk main row flex-fills with no floor or viewport cap", async () => {
    setDesk(true);
    setReport({ spot: 25_000, strikes: [], positioning: {}, gex: null });
    mount();

    const grid = screen.getByTestId("nifty-main-row");
    expect(grid).toHaveAttribute("data-chart-primary", "true");
    expect(grid).toHaveAttribute("data-chart-row-share", "1");
    expect(grid).toHaveAttribute("data-chart-chain", "flex-1 min-h-0");
    expect(grid).toHaveAttribute("data-chart-floor", String(DESK_CHART_FLOOR_PX));
    expect(grid.className).toContain("flex-1");
    expect(grid.className).toContain("min-h-0");
    expect(grid.className).not.toContain("min-h-[300px]");
    expect(grid.className).not.toContain("max-h-[58vh]");
    expect(grid.style.height).toBe("");
    expect(grid.style.maxHeight).toBe("");
    expect(await screen.findByTestId("chart-stub")).toHaveAttribute("data-fill", "true");
  });

  test("the fill contract holds in live, EOD and replay modes", () => {
    setDesk(true);
    setReport({ spot: 25_000, strikes: [], positioning: {}, gex: null });
    for (const sessionMode of ["live", "eod", "replay"]) {
      setMode(sessionMode);
      mount();
      const grid = screen.getByTestId("nifty-main-row");
      expect(grid).toHaveAttribute("data-chart-primary", "true");
      expect(grid.className).toContain("flex-1");
      expect(grid.className).not.toContain("min-h-[300px]");
      expect(grid.className).not.toContain("max-h-[58vh]");
      cleanup();
    }
  });
});
