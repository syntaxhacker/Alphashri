// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { createSignal } from "solid-js";
import { UIProvider } from "@/ui";

const env = vi.hoisted(() => ({
  mobile: false,
  setHeatMetric: vi.fn(),
  setHeatExpand: vi.fn(),
  setSideTab: vi.fn(),
}));

const [report] = createSignal<any>({ spot: 25_000, strikes: [] });

const mockStore = {
  data: {
    report,
    breadth: () => ({ available: true, count: 1, up: 1, rows: [{ label: "NIFTY", last: 25_000, close: 24_900, change_pct: 0.4 }] }),
    oiScale: () => ({ maxCeOiChange: 1, maxPeOiChange: 1 }),
    atmStrike: () => null,
    oiWalls: () => null,
    visibleStrikes: () => [],
    effectiveBursts: () => [],
    tape: () => null,
    oiPoints: () => [],
    flipAt: () => null,
    tapeRows: () => [],
    metrics: () => null,
    intradayStart: () => null,
  },
  walls: { data: () => null, openDrawer: () => {}, closeDrawer: () => {} },
  selection: { mode: () => "live", symbol: () => "NIFTY" },
  replay: { frameT: () => null },
  ui: {
    isDesk: () => true,
    setDeskOpen: () => {},
    deskOpen: () => false,
    sideTab: () => "heatmap",
    chartSize: () => "fill",
    heatMetric: () => "oi",
    setHeatMetric: env.setHeatMetric,
    setHeatExpand: env.setHeatExpand,
    setSideTab: env.setSideTab,
    handleChartTf: () => {},
    handleChartSize: () => {},
    openChartFull: () => {},
    openOiExpand: () => {},
    setGexOpen: () => {},
    setIvOpen: () => {},
    deskDockTab: () => "flow",
    setDeskDockTab: () => {},
    view: () => "chart",
    chartTf: () => "1m",
  },
};

vi.mock("./ReportContext", () => ({ useNiftyReport: () => mockStore }));
vi.mock("./NiftyChartPanel", () => ({ NiftyChartPanel: () => <div data-testid="chart-stub" /> }));
vi.mock("./DeskDock", () => ({ DeskDock: () => null }));
vi.mock("./NiftyDeltaPositioning", () => ({ NiftyDeltaPositioning: () => null }));
vi.mock("./NiftyGexProfile", () => ({ NiftyGexProfile: () => null }));
vi.mock("./NiftyIvSkew", () => ({ NiftyIvSkew: () => null }));
vi.mock("./NiftyOiHeatmap", () => ({ NiftyOiHeatmap: () => <div data-testid="heatmap-stub" /> }));
vi.mock("./reportCells", () => ({
  NiftyOiChain: () => null,
  getNiftyOiColumns: () => [],
}));

const { ReportWorkspace } = await import("./ReportWorkspace");

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: query.includes("max-width: 600px") ? env.mobile : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
});

afterEach(() => {
  cleanup();
  env.mobile = false;
  vi.clearAllMocks();
});

function mount() {
  return render(() => (
    <UIProvider>
      <ReportWorkspace />
    </UIProvider>
  ));
}

describe("ReportWorkspace — mobile heatmap disclosure (390px)", () => {
  test("the 57px treemap is not rendered; a collapsed disclosure stands in for it", () => {
    env.mobile = true;
    mount();

    const disclosure = screen.getByTestId("nifty-heatmap-mobile-disclosure");
    expect(disclosure).toHaveAttribute("data-open", "false");
    expect(within(disclosure).getByTestId("nifty-live-tape-content")).toHaveStyle({
      display: "none",
    });
    expect(screen.queryByTestId("nifty-heatmap-wrap")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nifty-heatmap-read")).not.toBeInTheDocument();
    expect(screen.getByTestId("nifty-heatmap-metric-toggle")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-heatmap-metric-volume")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-heatmap-expand")).toBeInTheDocument();
  });

  test("the disclosure opens, switches metric and hands off to the full-view drawer", () => {
    env.mobile = true;
    mount();

    const disclosure = screen.getByTestId("nifty-heatmap-mobile-disclosure");
    fireEvent.click(within(disclosure).getByTestId("nifty-live-tape-toggle"));
    expect(disclosure).toHaveAttribute("data-open", "true");
    expect(screen.getByTestId("nifty-heatmap-expand")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("nifty-heatmap-metric-volume"));
    expect(env.setHeatMetric).toHaveBeenCalledWith("volume");
    fireEvent.click(screen.getByTestId("nifty-heatmap-expand"));
    expect(env.setHeatExpand).toHaveBeenCalledWith(true);
  });

  test("mobile gives the reclaimed side-row height back to the chart", () => {
    env.mobile = true;
    mount();
    expect(screen.getByTestId("nifty-main-row").className).toContain(
      "max-[600px]:grid-rows-[minmax(0,1fr)_minmax(0,56px)]",
    );
  });

  test("desktop keeps the inline heatmap and its original grid row", async () => {
    env.mobile = false;
    mount();
    expect(screen.queryByTestId("nifty-heatmap-mobile-disclosure")).not.toBeInTheDocument();
    expect(screen.getByTestId("nifty-heatmap-wrap")).toBeInTheDocument();
    expect(await screen.findByTestId("heatmap-stub")).toBeInTheDocument();
    // The stub keeps the heatmap markup out of this test; the real component's
    // read line is covered by its own suite. Here we only guard the grid.
    expect(screen.getByTestId("nifty-main-row").className).toContain(
      "max-[600px]:grid-rows-[minmax(0,1fr)_minmax(0,96px)]",
    );
  });
});
