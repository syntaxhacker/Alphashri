// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { UIProvider } from "@/ui";

// Browser-measured at 390×844: the stacked SESSION/WINDOWS flow band is 144px.
// Collapsing it behind the one existing disclosure gives the flex-1 chart row
// that height back (111px → ~254px chart body) with no page scroll.
const flowReport = {
  spot: 25_000,
  flow_window: {
    as_of: "2026-11-19T11:25:14+05:30",
    "15m": { from: "", ce: 3_316_105, pe: -852_670, net: 4_168_775 },
    "5m": { from: "", ce: -952_185, pe: 646_815, net: -1_599_000 },
  },
  control: {
    verdict: "call_buyers",
    flow_bias: 2656.63,
    ce_doi: 1,
    pe_doi: 1,
    atm_ce_iv: 1,
    atm_pe_iv: 1,
    skew: 1,
    gex_regime: "short",
  },
  strikes: [],
  walls: null,
  wallsNear: null,
  maxPain: 24_900,
  gex: null,
  positioning: null,
  regime: null,
  ohlc: null,
  intraday: [],
  candles: [],
};

const mockStore = {
  data: {
    report: () => flowReport,
    loading: () => false,
    booted: () => true,
    error: () => null,
    flowReport: () => flowReport,
    tapeRows: () => [],
    metrics: () => null,
    setup: () => ({ state: "quiet", gates: [] }),
    preMove: () => ({ state: "quiet" }),
    preMoveHistory: () => [],
    sensex: () => null,
    breadth: () => ({ available: true, count: 0, up: 0, rows: [] }),
    scorePoints: () => [],
    oiScale: () => ({ maxCeOiChange: 1, maxPeOiChange: 1 }),
    atmStrike: () => null,
    oiWalls: () => null,
    visibleStrikes: () => [],
    effectiveBursts: () => [],
    tape: () => null,
    oiPoints: () => [],
    flipAt: () => null,
    intradayStart: () => null,
    tapeSpeed: () => null,
    lastFlip: () => null,
  },
  selection: { mode: () => "live", symbol: () => "NIFTY", expiry: () => "nearest", date: () => null },
  replay: { replay: () => null, index: () => 0, frameT: () => null, breakAt: () => {} },
  walls: { data: () => null, history: () => [], open: () => false, openDrawer: () => {}, closeDrawer: () => {} },
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
    heatMetric: () => "oi",
    chartSize: () => "fill",
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
    deskDockTab: () => null,
    setDeskDockTab: () => {},
    openPlanReasons: () => {},
    setGammaOpen: () => {},
    reportView: () => "monitor",
    setReportView: () => {},
    handleReportViewChange: () => {},
    isWindowDesk: () => false,
  },
};

vi.mock("./ReportContext", () => ({
  ReportProvider: (props: any) => props.children,
  useNiftyReport: () => mockStore,
}));
vi.mock("./ReportToolbar", () => ({ ReportToolbar: () => <div data-testid="nifty-toolbar" /> }));
vi.mock("./ReportAnalytics", () => ({ ReportAnalytics: () => null }));
vi.mock("./ReportOverlays", () => ({ ReportOverlays: () => null }));
vi.mock("./NiftyChartPanel", () => ({ NiftyChartPanel: () => <div data-testid="nifty-chart-panel" /> }));
vi.mock("./NiftyDeltaPositioning", () => ({ NiftyDeltaPositioning: () => null }));
vi.mock("./NiftyGexProfile", () => ({ NiftyGexProfile: () => null }));
vi.mock("./NiftyIvSkew", () => ({ NiftyIvSkew: () => null }));
vi.mock("./NiftyOiHeatmap", () => ({ NiftyOiHeatmap: () => null }));
vi.mock("./reportCells", () => ({
  NiftyOiChain: () => null,
  getNiftyOiColumns: () => [],
  DecisionCell: (props: any) => <div data-testid={props.testId} />,
  ContextCell: (props: any) => <div data-testid={props.testId} />,
  DecisionChip: (props: any) => <div data-testid={props.testId} />,
  NiftySpotValue: () => <span />,
  formatOiCr: () => "",
  formatSignedPoints: () => "",
}));
vi.mock("./NiftyVerdictStrip", () => ({
  NiftyVerdictStrip: () => <div data-testid="nifty-verdict-strip" />,
  controlLabel: () => "SESSION FLOW · CALL BUYING",
  resolveRegimeLabel: () => "—",
  regimeAccent: () => "currentColor",
  regimeDetail: () => "",
}));
vi.mock("./IndexMoversStrip", () => ({ IndexMoversStrip: () => <div data-testid="movers-strip" /> }));
vi.mock("./NiftyIntelStrip", () => ({ NiftyIntelStrip: () => null }));
vi.mock("./NiftyGammaStrip", () => ({ NiftyGammaStrip: () => null }));
vi.mock("./SetupRadarStrip", () => ({ SetupRadarStrip: () => null }));
vi.mock("./niftyGex", () => ({ gexFlipAtSpot: () => null }));
vi.mock("./deskPlan", () => ({
  buildDeskPlan: () => ({
    bias: "bullish",
    spot: 25_000,
    bull: { action: "", entryTrigger: "", stop: "", target: "", rr: 1, reasons: [] },
    bear: { action: "", entryTrigger: "", stop: "", target: "", rr: 1, reasons: [] },
    reasons: [],
  }),
}));
vi.mock("./deskPlanSummary", () => ({
  summarizeDeskPlan: () => ({ headline: "BULLISH", action: "", confidence: 60, tone: "positive" }),
}));
vi.mock("./niftyPin", () => ({ pinHint: () => "", pinRisk: () => null }));
vi.mock("./niftyWallsFormat", () => ({ resolveWallBoard: () => null }));

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("max-width: 600px"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

const { NiftyReportShell } = await import("./NiftyReportShell");

// L1 makes desk content the single scroll owner; until it lands, clipping is
// safe only because the row no longer caps its height.
function expectReachableDeskContent(panel: HTMLElement, content: HTMLElement, main: HTMLElement) {
  expect(panel.className).toContain("overflow-hidden");
  const scrollsVertically = (el: HTMLElement) =>
    /(?:^|\s)overflow-y-auto(?:\s|$)/.test(el.className) || el.style.overflowY === "auto";
  const isScroller = scrollsVertically(content) || content.style.overflow === "auto";
  if (isScroller) {
    expect(scrollsVertically(panel)).toBe(false);
    expect(content.style.overflow).not.toBe("hidden");
  } else {
    expect(["", "hidden"]).toContain(content.style.overflow);
    expect(main.className).not.toContain("min-h-[300px]");
    expect(main.className).not.toContain("max-h-[58vh]");
  }
}

afterEach(cleanup);

function mount() {
  return render(() => (
    <UIProvider>
      <NiftyReportShell />
    </UIProvider>
  ));
}

describe("Index Report mobile vertical budget (390 × 844)", () => {
  test("the flow band collapses by default and every metric stays in the DOM", async () => {
    mount();

    const disclosure = await screen.findByTestId("nifty-flow-windows-disclosure", undefined, { timeout: 5000 });
    expect(disclosure).toHaveAttribute("data-open", "false");
    const content = within(disclosure).getByTestId("nifty-live-tape-content");
    expect(content.style.display).toBe("none");
    for (const id of ["nifty-flow-windows", "flow-session", "flow-15m", "flow-5m", "flow-legend"]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }

    const verdict = screen.getByTestId("nifty-verdict-disclosure");
    expect(verdict).toHaveAttribute("data-open", "false");
    expect(within(verdict).getByTestId("nifty-live-tape-content").style.display).toBe("none");
    expect(screen.getByTestId("nifty-verdict-wrap")).toBeInTheDocument();
  });

  test("the one disclosure reopens on click and the metrics remain reachable", async () => {
    mount();

    const disclosure = await screen.findByTestId("nifty-flow-windows-disclosure", undefined, { timeout: 5000 });
    const toggle = within(disclosure).getByTestId("nifty-live-tape-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(disclosure).toHaveAttribute("data-open", "true");
    expect(within(disclosure).getByTestId("nifty-live-tape-content").style.display).toBe("flex");
    expect(screen.getByTestId("flow-5m")).toBeInTheDocument();
  });

  test("the page root never scrolls with the flow band collapsed", async () => {
    mount();

    const panel = screen.getByTestId("nifty-report-panel");
    const content = screen.getByTestId("nifty-report-content");
    const main = await screen.findByTestId("nifty-main-row", undefined, { timeout: 5000 });
    expectReachableDeskContent(panel, content, main);

    expect(main.className).toContain("flex-1");
    // Grows into the reclaimed flow-band height; no floor and no vh cap.
    expect(main.className).toContain("min-h-0");
    expect(main.className).not.toContain("min-h-[300px]");
    expect(main.className).not.toContain("max-h-[58vh]");
    expect(main.style.height).toBe("");
    expect(main.style.maxHeight).toBe("");
  });
});
