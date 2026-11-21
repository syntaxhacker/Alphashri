// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { UIProvider } from "@/ui";
import { DeskDock } from "./DeskDock";
import type { DeskDockTab } from "./DeskDock";

// The five contracts behind the measured 1920x890 rects. happy-dom has no
// layout engine, so each test asserts the CSS contract that produces the
// measured geometry (real rects are reported in the lane write-up).
const [sideTab, setSideTab] = createSignal<string>("chain");
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
    sideTab,
    chartSize: () => "fill",
    heatMetric: () => "oi",
    deskOpen: () => false,
    setDeskOpen: () => {},
    handleChartTf: () => {},
    handleChartSize: () => {},
    openChartFull: () => {},
    setSideTab: (v: string) => setSideTab(v),
    setHeatMetric: () => {},
    setHeatExpand: () => {},
    openOiExpand: () => {},
    setGexOpen: () => {},
    setIvOpen: () => {},
    deskDockTab: dockTab,
    setDeskDockTab: (v: string | null) => setDockTab(v ?? null),
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
vi.mock("./NiftyWallErosionBoard", () => ({ NiftyWallErosionBoard: () => <div /> }));
vi.mock("./NiftyWallsCard", () => ({
  NiftyWallsCard: (props: any) => <div data-testid={props.testId ?? "nifty-walls-card"} />,
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
const { DESK_CHART_FLOOR_PX } = await import("./ReportWorkspace");

function pxOf(className: string, token: "h" | "min-h"): number | null {
  const match = new RegExp(`(?:^|\\s)${token}-\\[(\\d+(?:\\.\\d+)?)px\\]`).exec(className);
  return match ? Number(match[1]) : null;
}

afterEach(() => {
  cleanup();
  setSideTab("chain");
  setDockTab(null);
});

describe("Index Report layout bugs — measured contracts", () => {
  async function mountShell() {
    render(() => (
      <UIProvider>
        <NiftyReportShell />
      </UIProvider>
    ));
    return screen.findByTestId("nifty-main-row");
  }

  test("(a) the metric toggle row is at least as tall as its buttons (no header overlap)", async () => {
    setSideTab("heatmap");
    await mountShell();
    const row = await screen.findByTestId("nifty-heatmap-metric-toggle");
    const oi = await screen.findByTestId("nifty-heatmap-metric-oi");

    const rowH = pxOf(row.className, "h");
    const buttonH = pxOf(oi.className, "h");
    expect(rowH, "toggle row needs an explicit height").not.toBeNull();
    expect(buttonH, "sm buttons are 30px").toBe(30);
    // With items-center, a row shorter than the button pushes the button above
    // the row's top edge — exactly the 6px overlap that was measured.
    expect(rowH!, `row ${rowH}px must contain ${buttonH}px buttons`).toBeGreaterThanOrEqual(buttonH!);
    expect(row.className).toContain("items-center");
  });

  test("(b) the heatmap wrap cannot grow a scrollbar", async () => {
    setSideTab("heatmap");
    await mountShell();
    const wrap = await screen.findByTestId("nifty-heatmap-wrap");
    expect(wrap.className).toContain("overflow-hidden");
    expect(wrap.className).not.toContain("overflow-auto");
    // flex-1 min-h-0 lets the SVG shrink instead of overflowing the box.
    expect(wrap.className).toContain("flex-1");
    expect(wrap.className).toContain("min-h-0");
  });

  test("(c) opening the dock keeps the chart at or above the 420px floor", async () => {
    const main = await mountShell();
    expect(DESK_CHART_FLOOR_PX).toBeGreaterThanOrEqual(420);
    expect(main.getAttribute("data-chart-floor")).toBe(String(DESK_CHART_FLOOR_PX));
    const before = main.className;

    fireEvent.click(screen.getByTestId("desk-dock-strips"));
    const drawer = await screen.findByTestId("desk-dock-drawer");
    // Out of flow: an absolute overlay cannot shrink the flex-1 chart row.
    expect(drawer.className).toContain("absolute");
    expect(drawer.className).not.toContain("flex-1");
    expect(drawer.getAttribute("data-dock-mode")).toBe("overlay");
    expect(screen.getByTestId("nifty-main-row").className).toBe(before);
    expect(main.className).toContain("flex-1");
    expect(main.getAttribute("data-chart-chain")).toBe("flex-1 min-h-0");
  });

  test("(d) opening the dock still renders the active tab's panel", async () => {
    await mountShell();
    fireEvent.click(screen.getByTestId("desk-dock-strips"));
    const body = await screen.findByTestId("desk-dock-body-strips");
    const panel = await within(body).findByTestId("nifty-report-strips");
    expect(panel).toBeInTheDocument();
    expect(within(body).getByTestId("nifty-live-tape-disclosure")).toBeInTheDocument();
    expect(body.querySelector("[data-testid]")).not.toBeNull();
  });

  test("(e) the page never scrolls in either dock state", async () => {
    await mountShell();
    const panel = screen.getByTestId("nifty-report-panel");
    const content = screen.getByTestId("nifty-report-content");
    const closed = [panel, content].map((el) => `${el.className}|${el.style.overflow}`);
    expect(content.className).toContain("overflow-hidden");
    expect(content.style.overflow).toBe("hidden");

    fireEvent.click(screen.getByTestId("desk-dock-strips"));
    await screen.findByTestId("desk-dock-drawer");
    const open = [panel, content].map((el) => `${el.className}|${el.style.overflow}`);
    expect(open).toEqual(closed);
    expect(content.className).not.toMatch(/overflow-(auto|scroll)/);
  });
});

describe("desk dock overlay content", () => {
  test("every tab body is mounted with its content when active", () => {
    const tabs: DeskDockTab[] = [
      {
        key: "flow",
        label: "DELTA",
        summary: <span>balanced</span>,
        content: <div data-testid="flow-panel">flow</div>,
      },
    ];
    render(() => (
      <UIProvider>
        <DeskDock tabs={tabs} active="flow" onActiveChange={() => {}} />
      </UIProvider>
    ));
    const body = screen.getByTestId("desk-dock-body-flow");
    expect(within(body).getByTestId("flow-panel")).toBeInTheDocument();
    expect(screen.getByTestId("desk-dock-backdrop")).toBeInTheDocument();
  });
});
