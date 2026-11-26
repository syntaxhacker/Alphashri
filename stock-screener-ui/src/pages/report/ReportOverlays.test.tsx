// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { UIProvider } from "@/ui";

const [visualsOpen, setVisualsOpen] = createSignal(false);
const setOverlayOpen = vi.fn();
const setMoversOpen = vi.fn();

const mockStore = {
  ui: {
    visualsOpen,
    setVisualsOpen: (next: boolean) => setVisualsOpen(next),
    setOverlayOpen,
    moversOpen: () => false,
    setMoversOpen,
    planOpen: () => false,
    setPlanOpen: () => {},
    gammaOpen: () => false,
    setGammaOpen: () => {},
    chartFull: () => false,
    setChartFull: () => {},
    chartTf: () => "5m",
    handleChartTf: () => {},
    overlayOpen: () => false,
    oiExpand: () => false,
    setOiExpand: () => {},
    heatExpand: () => false,
    setHeatExpand: () => {},
    flowExpand: () => false,
    setFlowExpand: () => {},
    pressureExpand: () => false,
    setPressureExpand: () => {},
    flowChartExpand: () => false,
    setFlowChartExpand: () => {},
    ivOpen: () => false,
    setIvOpen: () => {},
    gexOpen: () => false,
    setGexOpen: () => {},
  },
  selection: { symbol: () => "NIFTY", mode: () => "live" },
  data: {
    report: () => null,
    effectiveBursts: () => [],
    tape: () => null,
    oiPoints: () => [],
    flipAt: () => null,
    oiScale: () => ({ maxCeOiChange: 1, maxPeOiChange: 1 }),
    atmStrike: () => null,
    oiWalls: () => null,
    visibleStrikes: () => [],
    tapeRows: () => [],
  },
  walls: { data: () => null },
  replay: { frameT: () => null },
};

vi.mock("./ReportContext", () => ({
  useNiftyReport: () => mockStore,
}));

// The overlays file mounts every report panel; only the visuals modal is under
// test here, so keep the rest inert.
vi.mock("./IndexMoversModal", () => ({ IndexMoversModal: () => null }));
vi.mock("./NiftyDeskPlan", () => ({ NiftyDeskPlan: () => null }));
vi.mock("./NiftyGammaStrip", () => ({ NiftyGammaStrip: () => null }));
vi.mock("./NiftyGexProfile", () => ({ NiftyGexProfile: () => null }));
vi.mock("./NiftyDeltaPositioning", () => ({ NiftyDeltaPositioning: () => null }));
vi.mock("./NiftyChartPanel", () => ({ NiftyChartPanel: () => null }));
vi.mock("./NiftyIvSkew", () => ({ NiftyIvSkew: () => null }));
vi.mock("./NiftyOiHeatmap", () => ({ NiftyOiHeatmap: () => null }));
vi.mock("./NiftyFlowStrip", () => ({ NiftyFlowStrip: () => null }));
vi.mock("./NiftyPressureLane", () => ({ NiftyPressureLane: () => null }));
vi.mock("./NiftyFlowChart", () => ({ NiftyFlowChart: () => null }));
vi.mock("./NiftyFuturesPanel", () => ({ NiftyFuturesPanel: () => null }));
vi.mock("./NiftyItmPeFlow", () => ({ NiftyItmPeFlowPanel: () => null }));
vi.mock("./reportCells", () => ({
  NiftyOiChain: () => null,
  getNiftyOiColumns: () => [],
}));

import { ReportOverlays } from "./ReportOverlays";

afterEach(() => {
  cleanup();
  setVisualsOpen(false);
  setOverlayOpen.mockClear();
});

describe("ReportOverlays visuals", () => {
  test("the V surface is a real shortcut grid, not a 'coming soon' stub", () => {
    render(() => <ReportOverlays />, { wrapper: UIProvider });
    setVisualsOpen(true);

    const grid = screen.getByTestId("nifty-visuals-stub");
    expect(grid.textContent).not.toMatch(/coming soon|stub/i);
    expect(screen.getByTestId("nifty-visuals-chart")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-visuals-heat")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-visuals-flowChart")).toBeInTheDocument();
  });

  test("choosing a visual closes the grid and opens the real panel", () => {
    render(() => <ReportOverlays />, { wrapper: UIProvider });
    setVisualsOpen(true);

    fireEvent.click(screen.getByTestId("nifty-visuals-flowChart"));
    expect(visualsOpen()).toBe(false);
    expect(setOverlayOpen).toHaveBeenCalledWith("flowChart", true);
  });
});
