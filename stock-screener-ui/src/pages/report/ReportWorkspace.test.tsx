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

const mockStore = {
  data: {
    report,
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
  selection: { mode: () => "live", symbol: () => "NIFTY" },
  replay: { frameT: () => null },
  ui: {
    isDesk: () => false,
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
vi.mock("./NiftyChartPanel", () => ({ NiftyChartPanel: () => <div data-testid="chart-stub" /> }));
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

const { ReportWorkspace } = await import("./ReportWorkspace");

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
});
