// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal, type JSX } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UIProvider } from "@/ui";
import type { DockPanelApi } from "../../components/dock/types";
import type { WallsPayload } from "@/api/reportNifty";
import { fetchIndexMovers, type IndexMoversResponse } from "@/api/indexMovers";
import type { NiftyTapeRow } from "@/types/niftyReport";
import type { NiftyReportStore } from "./niftyReportStore";
import type { ReportWindowContext } from "./reportWindowTypes";
import {
  ReportChartWindow,
  ReportFlowWindow,
  ReportMoversWindow,
  ReportWallsWindow,
  type ReportWindowContentProps,
} from "./reportWindowDeskContent";

// Canvas and network are the only boundaries mocked here. @/ui and every real
// report component are rendered as-is so a missing testid is a real regression.
vi.mock("@/components/chart/TradingViewChart", () => ({
  TradingViewChart: () => <div data-testid="tradingview-chart" />,
}));
vi.mock("./DepthChart", () => ({
  DepthChart: () => <div data-testid="nifty-depth-echarts" />,
}));
vi.mock("@/hooks/useFyersTickStream", () => ({
  useFyersTickStream: () => ({
    isLive: () => false,
    isReconnecting: () => false,
    isMarketClosed: () => false,
    isDisconnected: () => false,
    lastTick: () => null,
  }),
}));
vi.mock("@/api/indexMovers", () => ({ fetchIndexMovers: vi.fn() }));

const mockedMovers = vi.mocked(fetchIndexMovers);

const NO_STORE = "Report store not connected";
const PLACEHOLDER = /shell owns this panel/i;

function reportFixture() {
  return {
    mode: "live",
    date: "2026-11-24",
    expiry: "weekly",
    spot: 25_750,
    ohlc: { open: 25_600, high: 25_800, low: 25_550, close: 25_750 },
    pcrOi: 1.1,
    pcrVol: 0.9,
    maxPain: 25_700,
    walls: { calls: [{ strike: 25_800, oi: 5_000 }], puts: [{ strike: 25_600, oi: 6_000 }] },
    strikes: [],
    timeline: [],
    candles: [
      { time: "2026-11-24T09:15:00", open: 25_600, high: 25_650, low: 25_580, close: 25_620 },
      { time: "2026-11-24T09:16:00", open: 25_620, high: 25_680, low: 25_600, close: 25_640 },
    ],
  } as unknown as import("@/types/niftyReport").NiftyReport;
}

function wallsFixture() {
  const row = (strike: number, oi: number) => ({ strike, oi });
  return {
    symbol: "NIFTY",
    date: "2026-11-24",
    expiry: null,
    dte: 0,
    spot: 25_750,
    max_pain: 25_700,
    max_pain_drift: 0,
    atm: 25_750,
    net_gex: null,
    flip: null,
    gex_degraded: false,
    pin_distance_pts: 50,
    pin_distance_pct: 0.19,
    state: "QUIET",
    expiry_day: false,
    alert_eligible: false,
    alert: null,
    reasons: [],
    call_wall: { strike: 25_800, oi: 5_000 },
    put_wall: { strike: 25_600, oi: 6_000 },
    tracked_call_erosion_30m: null,
    tracked_call_erosion_5m: null,
    tracked_put_build_30m: null,
    near: false,
    cross: false,
    calls: [row(25_800, 5_000)],
    puts: [row(25_600, 6_000)],
    events: [],
    history: [],
    freshness: { last_t: "2026-11-24T09:16:00", age_sec: 0, stale: false, rows: 2, gaps: [] },
    window_min: 5,
    top: 2,
  } as unknown as WallsPayload;
}

function tapeRowsFixture(): NiftyTapeRow[] {
  return [
    {
      t: "2026-11-24T09:15:00+05:30",
      spot: 25_750,
      call_doi: 2_000_000,
      put_doi: 1_000_000,
      net: 1_000_000,
      net_pct: 0.4,
      net_gex: 10,
    },
    {
      t: "2026-11-24T09:16:00+05:30",
      spot: 25_760,
      call_doi: 4_500_000,
      put_doi: 1_200_000,
      net: 3_300_000,
      net_pct: 1.2,
      net_gex: -10,
    },
  ] as unknown as NiftyTapeRow[];
}

function moversFixture(): IndexMoversResponse {
  return {
    index: "NIFTY",
    as_of: "2026-11-24T09:16:00+05:30",
    stale: false,
    source: "test",
    gainers: [
      { symbol: "HDFCBANK", ltp: 1_750, change_pct: 1.92, contribution_pct: 0.2, volume: 10 },
    ],
    losers: [
      { symbol: "TCS", ltp: 3_450, change_pct: -2.52, contribution_pct: -0.1, volume: 10 },
    ],
    live_only: false,
  };
}

interface StoreOptions {
  mode?: "live" | "eod";
  loading?: boolean;
  booted?: boolean;
  report?: ReturnType<typeof reportFixture> | null;
  walls?: WallsPayload | null;
  rows?: NiftyTapeRow[];
}

function makeStore(options: StoreOptions = {}) {
  const [mode, setMode] = createSignal<"live" | "eod">(options.mode ?? "live");
  const [loading, setLoading] = createSignal(options.loading ?? false);
  const store = {
    selection: {
      mode,
      symbol: () => "NIFTY",
      index: () => "nifty",
    },
    data: {
      report: () => options.report ?? null,
      loading,
      booted: () => options.booted ?? true,
      tapeRows: () => options.rows ?? [],
      effectiveBursts: () => [],
      tape: () => null,
      oiPoints: () => [],
      flipAt: () => null,
    },
    ui: {
      view: () => "chart",
      chartTf: () => "1m",
      handleChartTf: () => {},
      handleChartSize: () => {},
      openChartFull: vi.fn(),
      openMovers: vi.fn(),
      setDeskOpen: vi.fn(),
    },
    walls: {
      data: () => options.walls ?? null,
      openDrawer: vi.fn(),
    },
    replay: { frameT: () => null },
  } as unknown as NiftyReportStore;
  return { store, setMode, setLoading };
}

function mountWindow(
  Window: (props: ReportWindowContentProps) => JSX.Element,
  store: NiftyReportStore | null,
) {
  const context: ReportWindowContext = {
    symbol: "NIFTY",
    market: "india",
    timeframe: "1m",
    reportStore: store,
  };
  const api: DockPanelApi = { data: () => undefined, commands: {} };
  return render(() => (
    <UIProvider>
      <Window context={context} api={api} />
    </UIProvider>
  ));
}

beforeEach(() => {
  mockedMovers.mockReset();
  mockedMovers.mockResolvedValue(moversFixture());
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.clearAllMocks();
});

const withData = () =>
  makeStore({
    report: reportFixture(),
    walls: wallsFixture(),
    rows: tapeRowsFixture(),
  }).store;

describe("report window desk content adapters", () => {
  it("chart window mounts the real NiftyChartPanel with store data", () => {
    mountWindow(ReportChartWindow, withData());
    expect(screen.getByTestId("nifty-chart-panel")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-chart-wrap")).toBeInTheDocument();
    expect(screen.getByTestId("tradingview-chart")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(PLACEHOLDER);
  });

  it("walls window mounts the real NiftyWallsCard with store data", () => {
    mountWindow(ReportWallsWindow, withData());
    expect(screen.getByTestId("nifty-walls-card")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(PLACEHOLDER);
  });

  it("flow window mounts the real strip and the separate flow chart with store data", () => {
    mountWindow(ReportFlowWindow, withData());
    expect(screen.getByTestId("nifty-flowstrip")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-flow-tick")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-flowchart")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(PLACEHOLDER);
  });

  it("movers window mounts the real IndexMoversStrip with live data", async () => {
    mountWindow(ReportMoversWindow, withData());
    await waitFor(() => expect(screen.getByText("HDFCBANK")).toBeInTheDocument());
    expect(screen.getByTestId("movers-strip")).toHaveTextContent("TCS");
    expect(mockedMovers).toHaveBeenCalledWith("NIFTY", 5, expect.anything());
    expect(document.body.textContent).not.toMatch(PLACEHOLDER);
  });

  it.each([
    ["chart", ReportChartWindow, "chart-empty", "nifty-chart-panel"],
    ["walls", ReportWallsWindow, "walls-empty", "nifty-walls-card"],
    ["flow", ReportFlowWindow, "flow-empty", "nifty-flowstrip"],
    ["movers", ReportMoversWindow, "movers-empty", "movers-strip"],
  ] as const)("%s window names the missing-store state instead of crashing", (_key, Window, emptyId, realId) => {
    mountWindow(Window, null);
    const state = screen.getByTestId(emptyId);
    expect(state).toHaveAttribute("data-state", "empty");
    expect(state).toHaveTextContent(NO_STORE);
    expect(screen.queryByTestId(realId)).toBeNull();
    expect(document.body.textContent).not.toMatch(PLACEHOLDER);
  });

  it("chart window shows a named loading state before the first report arrives", () => {
    mountWindow(ReportChartWindow, makeStore({ loading: true, booted: false }).store);
    const state = screen.getByTestId("chart-loading");
    expect(state).toHaveAttribute("data-state", "loading");
    expect(state).toHaveTextContent("Loading index report");
    expect(screen.queryByTestId("nifty-chart-panel")).toBeNull();
  });

  it("movers window names replay as the reason instead of faking a live strip", () => {
    mountWindow(ReportMoversWindow, makeStore({ mode: "eod", report: reportFixture() }).store);
    expect(screen.getByTestId("movers-empty")).toHaveTextContent("Not captured in replay");
    expect(screen.queryByTestId("movers-strip")).toBeNull();
    expect(mockedMovers).not.toHaveBeenCalled();
  });

  it("flow window names replay when the tape has no flow prints", () => {
    mountWindow(ReportFlowWindow, makeStore({ mode: "eod", report: reportFixture() }).store);
    expect(screen.getByTestId("flow-empty")).toHaveTextContent("Not captured in replay");
    expect(screen.queryByTestId("nifty-flowstrip")).toBeNull();
  });

  it("suppresses the chart panel's own title so the window titlebar is the only heading", () => {
    mountWindow(ReportChartWindow, withData());

    const body = screen.getByTestId("report-chart-window");
    expect(body.className).toContain("[&_[data-header-role='title']]:hidden");
    expect(screen.getByTestId("nifty-chart-title")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-chart-panel")).toBeInTheDocument();
  });

  it("suppresses the walls card's own heading while keeping its data and controls", () => {
    mountWindow(ReportWallsWindow, withData());

    const body = screen.getByTestId("report-walls-window");
    expect(body.className).toContain("[&_[data-compact-card-header]>span:first-child]:hidden");
    expect(screen.getByTestId("nifty-walls-card")).toHaveTextContent("WALLS");
  });

  it("keeps one scroll owner — the window frame, not a wrapper inside the body", () => {
    mountWindow(ReportChartWindow, withData());

    const body = screen.getByTestId("report-chart-window");
    expect(body).toHaveAttribute("data-scroll-owner", "frame");
    expect([...body.children].some((el) => el.className.includes("overflow-y-auto"))).toBe(false);
  });

  it("wraps the empty-state reason on narrow panels instead of truncating it", () => {
    mountWindow(ReportMoversWindow, makeStore({ mode: "eod", report: reportFixture() }).store);

    const state = screen.getByTestId("movers-empty");
    expect(state.className).not.toMatch(/(^|\s)h-7(\s|$)/);
    const reason = screen.getByTestId("movers-empty-reason");
    expect(reason).toHaveTextContent("Not captured in replay");
    expect(reason.className).toContain("whitespace-normal");
    expect(reason.className).not.toContain("truncate");
  });
});
