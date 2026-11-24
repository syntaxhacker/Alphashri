// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createSignal } from "solid-js";
import { UIProvider } from "@/ui";
import { DESK_DOCK_OPEN_MIN_HEIGHT } from "./DeskDock";

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

describe("Index Report vertical budget", () => {
  test("the chart row keeps its full stretch while the tape bands collapse in the dock", async () => {
    render(() => (
      <UIProvider>
        <NiftyReportShell />
      </UIProvider>
    ));

    const main = await screen.findByTestId("nifty-main-row");
    expect(main.getAttribute("data-chart-primary")).toBe("true");
    expect(main.className).toContain("flex-1");
    expect(main.className).toContain("min-h-[300px]");
    expect(main.style.maxHeight).toBe("");
    expect((await screen.findByTestId("nifty-chart-wrap")).getAttribute("data-fill")).toBe("true");

    fireEvent.click(screen.getByTestId("desk-dock-strips"));
    const disclosure = await screen.findByTestId("nifty-live-tape-disclosure", undefined, {
      timeout: 5000,
    });
    expect(disclosure.closest('[data-testid="desk-dock-drawer"]')).not.toBeNull();
    expect(screen.getByTestId("nifty-live-tape-toggle")).toHaveAttribute("aria-expanded", "false");
    for (const id of ["nifty-breadth-strip", "nifty-10s-strip", "wall-erosion-board", "nifty-walls-card"]) {
      expect(screen.getAllByTestId(id).length).toBeGreaterThan(0);
    }
  });

  test("the page root still does not scroll with the disclosure mounted", async () => {
    render(() => (
      <UIProvider>
        <NiftyReportShell />
      </UIProvider>
    ));

    const panel = screen.getByTestId("nifty-report-panel");
    const content = screen.getByTestId("nifty-report-content");
    expect(panel.className).toContain("overflow-hidden");
    expect(content.className).toContain("overflow-hidden");
    expect(content.className).not.toMatch(/overflow-(auto|scroll)/);
    expect(content.style.overflow).toBe("hidden");

    fireEvent.click(screen.getByTestId("desk-dock-strips"));
    expect(
      await screen.findByTestId("nifty-live-tape-disclosure", undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(content.className).not.toMatch(/overflow-(auto|scroll)/);
  });
});

describe("Index Report desktop chart/dock share", () => {
  test("the dock bay has a usable minimum height when open", async () => {
    render(() => (
      <UIProvider>
        <NiftyReportShell />
      </UIProvider>
    ));

    expect(screen.getByTestId("desk-dock-idle")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("desk-dock-strips"));
    const drawer = await screen.findByTestId("desk-dock-drawer");
    expect(drawer.getAttribute("data-dock-min-height")).toBe(
      String(DESK_DOCK_OPEN_MIN_HEIGHT),
    );
    expect(drawer.className).toContain("min-h-[180px]");
    expect(screen.queryByTestId("desk-dock-idle")).not.toBeInTheDocument();
  });

  test("no strip or dock testid was lost when the bay took the reclaimed space", async () => {
    render(() => (
      <UIProvider>
        <NiftyReportShell />
      </UIProvider>
    ));

    for (const id of [
      "nifty-toolbar",
      "nifty-stat-strip",
      "nifty-main-row",
      "nifty-chart-wrap",
      "nifty-side-col",
      "desk-dock",
      "desk-dock-flow",
      "desk-dock-setup",
      "desk-dock-market",
      "desk-dock-strips",
      "desk-dock-analytics",
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    fireEvent.click(screen.getByTestId("desk-dock-strips"));
    for (const id of [
      "nifty-live-tape-disclosure",
      "nifty-breadth-strip",
      "nifty-10s-strip",
      "wall-erosion-board",
      "nifty-walls-card",
    ]) {
      expect((await screen.findAllByTestId(id, undefined, { timeout: 5000 })).length).toBeGreaterThan(0);
    }
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

  test("(a) walls and breadth are visible before any dock tab is opened", async () => {
    await mountDesk();
    const rail = screen.getByTestId("desk-insight-rail");
    expect(within(rail).getByTestId("nifty-walls-card-rail")).toBeInTheDocument();
    expect(within(rail).getByTestId("nifty-walls-compact-summary")).toBeInTheDocument();
    expect(within(rail).getByTestId("nifty-breadth-strip")).toBeInTheDocument();
    expect(screen.queryByTestId("desk-dock-drawer")).not.toBeInTheDocument();
    expect(screen.getByTestId("desk-dock-idle")).toBeInTheDocument();
  });

  test("(d) every previously reachable testid is still reachable", async () => {
    await mountDesk();
    for (const id of [
      "nifty-toolbar",
      "nifty-stat-strip",
      "nifty-main-row",
      "nifty-chart-wrap",
      "nifty-side-col",
      "nifty-oi-panel",
      "desk-dock",
      "desk-dock-flow",
      "desk-dock-setup",
      "desk-dock-market",
      "desk-dock-strips",
      "desk-dock-analytics",
      "desk-insight-rail",
      "nifty-walls-card-rail",
    ]) {
      expect(screen.getByTestId(id), id).toBeInTheDocument();
    }
    fireEvent.click(screen.getByTestId("desk-dock-analytics"));
    expect(await screen.findByTestId("nifty-tape-panel")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("desk-dock-strips"));
    expect(await screen.findByTestId("nifty-live-tape-disclosure")).toBeInTheDocument();
  });

  test("(e) the page still never scrolls with the rail mounted", async () => {
    await mountDesk();
    const panel = screen.getByTestId("nifty-report-panel");
    const content = screen.getByTestId("nifty-report-content");
    expect(panel.className).toContain("overflow-hidden");
    expect(content.className).toContain("overflow-hidden");
    expect(content.className).not.toMatch(/overflow-(auto|scroll)/);
    expect(content.style.overflow).toBe("hidden");
  });
});
