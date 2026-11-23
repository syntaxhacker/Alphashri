// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createSignal } from "solid-js";
import { UIProvider } from "@/ui";
import { DESK_CHART_FLOOR_PX } from "./ReportWorkspace";

// End-to-end layout contract for the desk surface: the chart keeps the whole
// stretched row, the page never scrolls, and the low-frequency tape bands are
// one disclosure click away inside the dock.
const [dockTab, setDockTab] = createSignal<string | null>(null);

const mockStore = {
  data: {
    error: () => null,
    report: () => ({ spot: 25_000, strikes: [], positioning: {}, gex: null }),
    loading: () => false,
    booted: () => true,
    breadth: () => ({
      available: true,
      count: 1,
      up: 1,
      rows: [{ label: "NIFTY", last: 25_000, close: 24_900, change_pct: 0.4 }],
    }),
    scorePoints: () => [],
    preMove: () => null,
    setup: () => null,
    preMoveHistory: () => [],
    metrics: () => null,
    sensex: () => null,
    oiScale: () => ({ maxCeOiChange: 1, maxPeOiChange: 1 }),
    atmStrike: () => null,
    oiWalls: () => null,
    visibleStrikes: () => [],
    effectiveBursts: () => [],
    tape: () => [],
    oiPoints: () => [],
    flipAt: () => null,
    tapeRows: () => [],
    intradayStart: () => null,
  },
  walls: {
    data: () => null,
    history: () => [],
    open: () => false,
    openDrawer: () => {},
    closeDrawer: () => {},
  },
  selection: { mode: () => "live", symbol: () => "NIFTY" },
  replay: { frameT: () => null, replay: () => null, index: () => 0, breakAt: () => {} },
  alerts: {
    toasts: () => [],
    trail: () => [],
    displayedTrail: () => [],
    criticalCount: () => 0,
    trailCursor: () => null,
    soundMuted: () => false,
    criticalOnly: () => false,
    dismissToast: () => {},
    toggleSound: () => {},
    toggleCriticalOnly: () => {},
    playTrail: () => {},
    clearTrail: () => {},
  },
  ui: {
    isDesk: () => true,
    sideTab: () => "chain",
    chartSize: () => "fill",
    heatMetric: () => "oi",
    deskOpen: () => false,
    setDeskOpen: () => {},
    handleChartTf: () => {},
    handleChartSize: () => {},
    openChartFull: () => {},
    setSideTab: () => {},
    setHeatMetric: () => {},
    setHeatExpand: () => {},
    openOiExpand: () => {},
    setGexOpen: () => {},
    setIvOpen: () => {},
    deskDockTab: dockTab,
    setDeskDockTab: setDockTab,
  },
};

vi.mock("./ReportContext", () => ({
  ReportProvider: (props: any) => props.children,
  useNiftyReport: () => mockStore,
}));
vi.mock("./ReportToolbar", () => ({ ReportToolbar: () => <div data-testid="nifty-toolbar" /> }));
vi.mock("./ReportDecisionStrip", () => ({
  ReportDecisionStrip: () => (
    <div data-testid="nifty-stat-strip">
      <div data-testid="nifty-verdict-strip" />
    </div>
  ),
}));
vi.mock("./ReportAnalytics", () => ({ ReportAnalytics: () => <div data-testid="nifty-tape-panel" /> }));
vi.mock("./ReportOverlays", () => ({ ReportOverlays: () => null }));
vi.mock("./NiftyChartPanel", () => ({
  NiftyChartPanel: (props: any) => (
    <div data-testid="nifty-chart-wrap" data-fill={props.fillContainer ? "true" : "false"} />
  ),
}));
vi.mock("./NiftyDeltaPositioning", () => ({ NiftyDeltaPositioning: () => null }));
vi.mock("./NiftyGexProfile", () => ({ NiftyGexProfile: () => null }));
vi.mock("./NiftyIvSkew", () => ({ NiftyIvSkew: () => null }));
vi.mock("./NiftyOiHeatmap", () => ({ NiftyOiHeatmap: () => null }));
vi.mock("./reportCells", () => ({
  NiftyOiChain: (props: any) => <div data-testid="nifty-oi-panel" ref={props.wrapRef} />,
  getNiftyOiColumns: () => [],
}));
vi.mock("./Nifty10sStrip", () => ({ Nifty10sStrip: () => <div data-testid="nifty-10s-strip" /> }));
vi.mock("./NiftySqueezeRadar", () => ({ NiftySqueezeRadar: () => null }));
vi.mock("./NiftyWallErosionBoard", () => ({ NiftyWallErosionBoard: () => <div data-testid="wall-erosion-board" /> }));
vi.mock("./NiftyWallsCard", () => ({
  NiftyWallsCard: (props: any) => (
    <div data-testid={props.testId ?? "nifty-walls-card"}>
      <div data-testid="nifty-walls-compact-summary" />
    </div>
  ),
}));
vi.mock("./NiftyWallsExpanded", () => ({ NiftyWallsExpanded: () => null }));
vi.mock("./NiftyPressureDesk", () => ({ NiftyPressureDesk: () => null }));
vi.mock("./NiftyDeskPlan", () => ({ NiftyDeskPlan: () => null }));
vi.mock("./LevelsInPlay", () => ({ LevelsInPlayContent: () => null }));
vi.mock("@/components/notifications/MarketAlertCard", () => ({
  MarketAlertStack: () => null,
  MarketAlertLog: () => null,
}));

const { NiftyReportShell } = await import("./NiftyReportShell");

afterEach(() => {
  cleanup();
  setDockTab(null);
});

describe("Index Report desktop chart/dock share", () => {
  test("the chart row is a bounded fraction of the viewport via grid classes", async () => {
    render(() => (
      <UIProvider>
        <NiftyReportShell />
      </UIProvider>
    ));

    const main = await screen.findByTestId("nifty-main-row");
    const content = screen.getByTestId("nifty-report-content");
    expect(main.getAttribute("data-chart-row-share")).toBe("0.56");
    expect(main.className).toContain("min-[1200px]:max-h-[58vh]");
    expect(content.className).toContain(
      "min-[1200px]:grid-rows-[auto_minmax(0,70fr)_minmax(0,30fr)]",
    );
  });

  test("the chart keeps its flex-1 min-h-0 chain and no fixed height", async () => {
    render(() => (
      <UIProvider>
        <NiftyReportShell />
      </UIProvider>
    ));

    const main = await screen.findByTestId("nifty-main-row");
    expect(main.className).toContain("flex-1");
    expect(main.getAttribute("data-chart-chain")).toBe("flex-1 min-h-0");
    expect(main.className).not.toMatch(/(^|\s)h-\[\d+px\]/);
    expect(main.style.height).toBe("");
    expect((await screen.findByTestId("nifty-chart-wrap")).getAttribute("data-fill")).toBe(
      "true",
    );
  });
});

describe("Index Report desktop desk rail (chart + numbers coexist)", () => {
  async function mountDesk() {
    render(() => (
      <UIProvider>
        <NiftyReportShell />
      </UIProvider>
    ));
    return screen.findByTestId("nifty-main-row");
  }

  test("(b) opening the dock never reduces the chart below its stated floor", async () => {
    const main = await mountDesk();
    expect(main.getAttribute("data-chart-floor")).toBe(String(DESK_CHART_FLOOR_PX));
    const before = main.className;

    fireEvent.click(screen.getByTestId("desk-dock-strips"));
    const drawer = await screen.findByTestId("desk-dock-drawer");
    // The drawer is an absolute overlay outside the flex column, so the chart
    // row's box/class cannot change when a tab opens.
    expect(drawer.getAttribute("data-dock-mode")).toBe("overlay");
    expect(drawer.className).toContain("absolute");
    expect(drawer.className).not.toContain("flex-1");
    expect(screen.getByTestId("nifty-main-row").className).toBe(before);
    expect(screen.getByTestId("nifty-main-row").getAttribute("data-chart-floor")).toBe(
      String(DESK_CHART_FLOOR_PX),
    );
    expect(within(screen.getByTestId("desk-insight-rail")).getByTestId("nifty-walls-card-rail")).toBeInTheDocument();
  });

  test("(c) the chart keeps its flex-1 min-h-0 chain", async () => {
    const main = await mountDesk();
    expect(main.getAttribute("data-chart-chain")).toBe("flex-1 min-h-0");
    expect(main.className).toContain("flex-1");
    expect(main.className).toContain("min-h-[300px]");
    expect(main.className).not.toMatch(/(^|\s)h-\[\d+px\]/);
    expect(main.style.height).toBe("");
    expect((await screen.findByTestId("nifty-chart-wrap")).getAttribute("data-fill")).toBe("true");
  });
});
