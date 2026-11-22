// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { UIProvider } from "@/ui";

// Hierarchy contract for the desk surface: the chart is the only stretched
// panel, the secondary data lives in the dock, and nothing scrolls the page.
// Heavy children are stubbed so the suite is about layout, not panel contents.
const [dockTab, setDockTab] = createSignal<string | null>(null);

const mockStore = {
  data: {
    error: () => null,
    report: () => ({ spot: 25_000, strikes: [], positioning: {}, gex: null }),
    loading: () => false,
    booted: () => true,
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
  walls: { data: () => null, openDrawer: () => {}, closeDrawer: () => {} },
  selection: { mode: () => "live", symbol: () => "NIFTY" },
  replay: { frameT: () => null },
  ui: {
    isDesk: () => true,
    setDeskOpen: () => {},
    deskOpen: () => false,
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
      <div data-testid="nifty-stat-spot" />
      <div data-testid="nifty-stat-pcr-oi" />
      <div data-testid="nifty-stat-max-pain" />
      <div data-testid="nifty-verdict-strip" />
    </div>
  ),
}));
vi.mock("./ReportStrips", () => ({
  ReportStrips: () => (
    <div data-testid="nifty-report-strips">
      <div data-testid="wall-erosion-board" />
      <div data-testid="nifty-walls-card" />
      <div data-testid="nifty-breadth-live-only" />
    </div>
  ),
}));
vi.mock("./ReportAnalytics", () => ({
  ReportAnalytics: () => (
    <div data-testid="nifty-tape-panel">
      <div data-testid="nifty-flow-row" />
      <div data-testid="nifty-vol-row" />
      <div data-testid="nifty-detail" />
    </div>
  ),
}));
vi.mock("./ReportOverlays", () => ({ ReportOverlays: () => null }));
vi.mock("./NiftyChartPanel", () => ({ NiftyChartPanel: () => <div data-testid="nifty-chart-panel" /> }));
vi.mock("./NiftyDeltaPositioning", () => ({ NiftyDeltaPositioning: () => null }));
vi.mock("./NiftyGexProfile", () => ({ NiftyGexProfile: () => null }));
vi.mock("./NiftyIvSkew", () => ({ NiftyIvSkew: () => null }));
vi.mock("./NiftyOiHeatmap", () => ({ NiftyOiHeatmap: () => null }));
vi.mock("./reportCells", () => ({
  NiftyOiChain: (props: any) => <div data-testid="nifty-oi-panel" ref={props.wrapRef} />,
  getNiftyOiColumns: () => [],
}));

const { NiftyReportShell } = await import("./NiftyReportShell");

function mount() {
  return render(() => (
    <UIProvider>
      <NiftyReportShell />
    </UIProvider>
  ));
}

afterEach(() => {
  cleanup();
  setDockTab(null);
});

describe("Index Report desk hierarchy", () => {
  test("the chart is the only stretched panel above the dock", async () => {
    mount();

    const content = screen.getByTestId("nifty-report-content");
    const main = await screen.findByTestId("nifty-main-row");
    expect(main.getAttribute("data-chart-primary")).toBe("true");
    expect(main.className).toContain("flex-1");
    // Explicit floor keeps the chart the largest block even on short screens;
    // the inner chart/side panels still use min-h-0 so they can shrink.
    expect(main.className).toContain("min-h-[300px]");
    expect(main.parentElement).toBe(content);

    const direct = Array.from(content.children).map((el) => el.getAttribute("data-testid"));
    expect(direct).toContain("nifty-stat-strip");
    expect(direct).toContain("nifty-main-row");
    expect(direct).not.toContain("nifty-report-strips");
    expect(direct).not.toContain("nifty-tape-panel");
  });

  test("every pre-existing metric stays reachable in the page tree, dock included", async () => {
    mount();

    for (const id of [
      "nifty-stat-spot",
      "nifty-stat-pcr-oi",
      "nifty-stat-max-pain",
      "nifty-verdict-strip",
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    for (const id of ["nifty-chart-panel", "nifty-oi-panel"]) {
      expect(await screen.findByTestId(id)).toBeInTheDocument();
    }

    expect(screen.queryByTestId("nifty-report-strips")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nifty-tape-panel")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("desk-dock-strips"));
    const strips = await screen.findByTestId("nifty-report-strips");
    expect(strips.closest('[data-testid="desk-dock-drawer"]')).not.toBeNull();
    for (const id of ["wall-erosion-board", "nifty-walls-card", "nifty-breadth-live-only"]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }

    fireEvent.click(screen.getByTestId("desk-dock-analytics"));
    const analytics = await screen.findByTestId("nifty-tape-panel");
    expect(analytics.closest('[data-testid="desk-dock-drawer"]')).not.toBeNull();
    for (const id of ["nifty-flow-row", "nifty-vol-row", "nifty-detail"]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }

    for (const id of ["desk-dock-flow", "desk-dock-setup", "desk-dock-market"]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });

  test("the report page root never scrolls", () => {
    mount();

    const panel = screen.getByTestId("nifty-report-panel");
    const content = screen.getByTestId("nifty-report-content");
    expect(panel.className).toContain("overflow-hidden");
    expect(content.className).toContain("overflow-hidden");
    expect(content.className).not.toMatch(/overflow-(auto|scroll)/);
  });
});
