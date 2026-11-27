// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createSignal } from "solid-js";
import { REPORT_KPI_HERO_HEIGHT } from "./reportTokens";
import { UIProvider } from "@/ui";
import {
  REPORT_GUTTER,
  REPORT_SECTION_ALIGN,
  REPORT_SECTION_ATTR,
  REPORT_TOP_LEVEL_SECTIONS,
} from "./reportTokens";

// Layout contract for the single left vertical: the toolbar is inset by the
// same horizontal gutter as the content box, every top-level section hangs off
// that box, and the 8px rhythm leaves no dead band under the dock. Heavy
// children are stubbed so the suite is about geometry, not panel contents.
const [dockTab, setDockTab] = createSignal<string | null>(null);
const [focus, setFocus] = createSignal(false);

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
    sideTab: () => "chain",
    chartSize: () => "fill",
    heatMetric: () => "oi",
    deskOpen: () => false,
    setDeskOpen: () => {},
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

vi.mock("./ReportContext", () => ({
  ReportProvider: (props: any) => props.children,
  useNiftyReport: () => mockStore,
}));
vi.mock("./ReportToolbar", () => ({ ReportToolbar: () => <div data-testid="nifty-toolbar" /> }));
vi.mock("./ReportKpiHero", () => ({
  ReportKpiHero: () => <div data-testid="nifty-kpi-hero" style={{ height: `${REPORT_KPI_HERO_HEIGHT}px` }} />,
}));
vi.mock("./ReportDecisionStrip", () => ({
  ReportDecisionStrip: () => (
    <>
      <div data-testid="nifty-stat-strip" />
      <div data-testid="nifty-flow-windows" />
      <div data-testid="movers-strip" />
    </>
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
vi.mock("./NiftyWallsCard", () => ({
  NiftyWallsCard: (props: any) => <div data-testid={props.testId ?? "nifty-walls-card"} />,
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

describe("Index Report single left edge", () => {
  test("(a) every top-level section shares one left offset", async () => {
    mount();
    const content = screen.getByTestId("nifty-report-content");
    const toolbar = screen.getByTestId("nifty-toolbar");
    const toolbarWrap = toolbar.closest(`[${REPORT_SECTION_ATTR}]`);
    expect(toolbarWrap, "toolbar section marker").not.toBeNull();

    // One shared attribute on every section container this surface owns.
    for (const el of [
      toolbarWrap as HTMLElement,
      content,
      await screen.findByTestId("nifty-main-row"),
      screen.getByTestId("desk-insight-rail"),
    ]) {
      expect(el).toHaveAttribute("data-left-edge", String(REPORT_GUTTER.inline));
    }

    // Both owners inset by the same horizontal gutter from the panel edge, so
    // the toolbar box and the content sections land on the same vertical.
    expect((toolbarWrap as HTMLElement).style.paddingLeft).toBe(`${REPORT_GUTTER.inline}px`);
    expect(content.style.paddingLeft).toBe(`${REPORT_GUTTER.inline}px`);

    // The toolbar's own left pad would otherwise re-inset its first control on
    // top of the shared wrapper inset; the chart's body pad re-insets its plot.
    // Both are removed by the shared descendant rules, not by bespoke padding.
    expect(REPORT_SECTION_ALIGN.panel).toContain("[data-testid='nifty-toolbar']]:pl-0!");
    expect(REPORT_SECTION_ALIGN.content).toContain("[data-testid='nifty-chart-panel']]:border-l-0!");
    expect(REPORT_SECTION_ALIGN.content).toContain(">div:nth-child(2)]:p-0!");

    // Sections owned by other lanes are direct children of that same box and
    // carry no bespoke margin that could move them off the shared edge.
    for (const id of REPORT_TOP_LEVEL_SECTIONS) {
      const el = screen.getByTestId(id);
      expect(el, id).toBeInTheDocument();
      if (id === "nifty-toolbar") continue;
      if (id === "desk-dock-region") {
        const wrapper = el.parentElement;
        expect(wrapper, id).toHaveAttribute("data-testid", "desk-dock-overflow-wrap");
        expect(wrapper?.parentElement, id).toBe(content);
        continue;
      }
      expect(el.parentElement, id).toBe(content);
      expect(el.style.marginLeft, id).toBe("");
    }
  });

  test("(b) section gaps never exceed 8px", async () => {
    mount();
    const content = screen.getByTestId("nifty-report-content");
    expect(REPORT_GUTTER.section).toBe(8);
    expect(content.style.gap).toBe(`${REPORT_GUTTER.section}px`);
    expect(content.className).toContain("gap-2");
    // The top inset is one pixel shorter than the section gutter because the
    // toolbar keeps a 1px top hairline; measured gap is still exactly 8px.
    expect(content.style.paddingTop).toBe(`${REPORT_GUTTER.section - 1}px`);
    expect(content.style.paddingBottom).toBe(`${REPORT_GUTTER.section}px`);
    for (const child of Array.from(content.children) as HTMLElement[]) {
      expect(child.style.marginTop).toBe("");
      expect(child.style.marginBottom).toBe("");
    }
  });

  test("(c) the chart keeps its flex-1 min-h-0 chain", async () => {
    mount();
    const main = await screen.findByTestId("nifty-main-row");
    expect(main.getAttribute("data-chart-chain")).toBe("flex-1 min-h-0");
    expect(main.className).toContain("flex-1");
    expect(main.className).not.toMatch(/(^|\s)h-\[\d+px\]/);
    expect(main.style.height).toBe("");
    expect((await screen.findByTestId("nifty-chart-wrap")).getAttribute("data-fill")).toBe("true");
  });

  test("(d) the report content is the single scroll owner, the page never scrolls", async () => {
    mount();
    const panel = screen.getByTestId("nifty-report-panel");
    const content = screen.getByTestId("nifty-report-content");
    expect(panel.className).toContain("overflow-hidden");
    expect(panel.style.overflow).toBe("hidden");
    expect(content.className).toContain("overflow-y-auto");
    expect(content.style.overflowY).toBe("auto");
    // The single 56px decision band is owned by the strip inside the scroll
    // owner, so the shell paints no second pinned band above the chart.
    expect(screen.queryByTestId("nifty-kpi-hero")).not.toBeInTheDocument();
    expect(content.className).toContain(
      "min-[1200px]:grid-rows-[auto_minmax(0,1fr)_auto]",
    );
  });

  test("(e) chart focus keeps the chart mounted and exposes one exit affordance", async () => {
    mount();
    const panel = screen.getByTestId("nifty-report-panel");
    expect(panel).toHaveAttribute("data-chart-focus", "false");
    expect(screen.queryByTestId("nifty-chart-focus-exit")).not.toBeInTheDocument();
    setFocus(true);
    expect(panel).toHaveAttribute("data-chart-focus", "true");
    expect(await screen.findByTestId("nifty-main-row")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-chart-focus-exit")).toBeInTheDocument();
  });
});
