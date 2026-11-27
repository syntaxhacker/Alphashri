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
    report: () => ({
      spot: 25_000,
      strikes: [],
      positioning: {},
      gex: null,
      futures: { series: [], regime: "neutral" },
      itm_pe_flow: { series: [], top: [] },
    }),
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
    reportView: () => "monitor",
    setReportView: () => {},
    handleReportViewChange: () => {},
    isWindowDesk: () => false,
    setSideTab: () => {},
    setHeatMetric: () => {},
    setHeatExpand: () => {},
    openOiExpand: () => {},
    setGexOpen: () => {},
    setIvOpen: () => {},
    deskDockTab: dockTab,
    setDeskDockTab: setDockTab,
    overlayOpen: () => focus(),
    setOverlayOpen: (_key: string, next: boolean) => setFocus(next),
  },
};

const [focus, setFocus] = createSignal(false);

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
vi.mock("./ReportKpiHero", () => ({ ReportKpiHero: () => <div data-testid="nifty-kpi-hero" /> }));
vi.mock("./NiftyFuturesPanel", () => ({
  NiftyFuturesPanel: () => <div data-testid="nifty-futures-panel" />,
}));
vi.mock("./NiftyItmPeFlow", () => ({
  NiftyItmPeFlowPanel: () => <div data-testid="nifty-itm-pe-panel" />,
}));
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
  setFocus(false);
});

describe("Index Report desk hierarchy", () => {
  test("the chart is the only stretched panel above the dock", async () => {
    mount();

    const content = screen.getByTestId("nifty-report-content");
    const main = await screen.findByTestId("nifty-main-row", {}, { timeout: 5000 });
    expect(main.getAttribute("data-chart-primary")).toBe("true");
    expect(main.className).toContain("flex-1");
    // The chart fills the shell; the dock drawer never steals its height.
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

    // Futures / ITM analytics moved out of the chart flow into the same dock.
    for (const id of ["desk-dock-futures", "desk-dock-itm"]) {
      expect(screen.getByTestId(id), id).toBeInTheDocument();
    }
    fireEvent.click(screen.getByTestId("desk-dock-futures"));
    expect(await screen.findByTestId("nifty-futures-panel")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("desk-dock-itm"));
    expect(await screen.findByTestId("nifty-itm-pe-panel")).toBeInTheDocument();

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

  test("the report content is the only scroll owner; the page root never scrolls", () => {
    mount();

    const panel = screen.getByTestId("nifty-report-panel");
    const content = screen.getByTestId("nifty-report-content");
    expect(panel.className).toContain("overflow-hidden");
    expect(panel.style.overflow).toBe("hidden");
    expect(content.className).toContain("overflow-y-auto");
    expect(content.style.overflowY).toBe("auto");
  });

  test("LEVEL 1 focus is an in-shell state; LEVEL 2 fullscreen stays separate", () => {
    mount();

    const panel = screen.getByTestId("nifty-report-panel");
    expect(panel).toHaveAttribute("data-chart-focus", "false");
    setFocus(true);
    expect(panel).toHaveAttribute("data-chart-focus", "true");
    expect(screen.getByTestId("nifty-main-row")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-chart-focus-exit")).toBeInTheDocument();
    screen.getByTestId("nifty-chart-focus-exit").click();
    expect(panel).toHaveAttribute("data-chart-focus", "false");
  });
});
