// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { JSX } from "solid-js";
import { UIProvider } from "@/ui";
import type { DockPanelApi } from "../../components/dock/types";
import type {
  NiftyFutures,
  NiftyGex,
  NiftyItmPeFlow,
  NiftyPositioningBlock,
  NiftyReport,
  NiftyStrike,
} from "@/types/niftyReport";
import type { NiftyReportStore } from "./niftyReportStore";
import type { ReportWindowContext } from "./reportWindowTypes";
import { chainRow } from "./reportCells.fixtures";
import { ReportAnalyticsWindow, ReportChainWindow } from "./reportWindowMarketContent";

const chart = vi.hoisted(() => ({ setOption: vi.fn() }));
vi.mock("./echartsSolid", () => ({
  createECharts: () => ({ ref: () => {}, setChartOption: chart.setOption }),
}));

function mount(node: () => JSX.Element) {
  return render(node, { wrapper: UIProvider });
}

const api = (): DockPanelApi => ({ data: () => undefined, commands: {} });

const context = (store: NiftyReportStore | null): ReportWindowContext => ({
  symbol: "NIFTY",
  market: "india",
  timeframe: "1m",
  reportStore: store,
});

const storeWith = (
  report: NiftyReport | null,
  loading = false,
): NiftyReportStore =>
  ({
    data: {
      report: () => report,
      loading: () => loading,
      visibleStrikes: () => report?.strikes ?? [],
      atmStrike: () => 25_000,
      oiScale: () => ({ maxCeOiChange: 100, maxPeOiChange: 100 }),
      oiWalls: () => ({ calls: [], puts: [] }),
    },
  }) as unknown as NiftyReportStore;

function strikes(): NiftyStrike[] {
  return [24_900, 25_000, 25_100].map((strike) => ({
    ...chainRow(strike),
    ce: { ...chainRow(strike).ce, iv: 15, delta: 0.25 },
    pe: { ...chainRow(strike).pe, iv: 17, delta: -0.28 },
  }));
}

const futures = (): NiftyFutures => ({
  symbol: "NIFTY-FUT",
  instrument_key: "NSE_FO|NIFTY26NOVFUT",
  expiry: "2026-11-26",
  series: [
    { t: "2026-11-17T09:15:00+05:30", close: 25_980.5, oi: 11_200_000, volume: 1_200 },
    { t: "2026-11-17T09:30:00+05:30", close: 25_993.1, oi: 11_480_000, volume: 900 },
  ],
  change_pts: 12.6,
  oi_change: 280_000,
  regime: "long_buildup",
  as_of: "2026-11-17T09:30:00+05:30",
});

const itm = (): NiftyItmPeFlow => ({
  series: [
    {
      t: "2026-11-17T10:05:00+05:30",
      itm_pe_vol: 25_000,
      total_pe_vol: 100_000,
      share_pct: 25,
      spot: 25_000,
    },
  ],
  top: [{ strike: 25_000, volume: 30_000, oi: 120_000 }],
  as_of: "2026-11-17T10:05:00+05:30",
});

const positioning = (): NiftyPositioningBlock => ({
  verdict: "bullish",
  state: 120,
  flow: 30,
  initiated: 10,
  bullCr: 70,
  bearCr: 30,
  splitPct: 70,
  ceDoi: 100,
  peDoi: 40,
  lotSize: 75,
  deltaFlip: 25_000,
  strikes: [],
});

const gex = (): NiftyGex => ({
  strikes: [
    { strike: 24_900, callGex: 5, putGex: -3, netGex: -2 },
    { strike: 25_000, callGex: 1, putGex: 2, netGex: 12 },
  ],
  netTotal: 7.5,
  regime: "long",
  topPositive: [{ strike: 25_000, netGex: 12 }],
  topNegative: [{ strike: 24_900, netGex: -2 }],
  zeroCross: 24_950,
});

const analyticsReport = (): NiftyReport =>
  ({
    mode: "live",
    date: "2026-11-17",
    expiry: "2026-11-26",
    spot: 25_000,
    strikes: strikes(),
    futures: futures(),
    itm_pe_flow: itm(),
    positioning: positioning(),
    gex: gex(),
  }) as unknown as NiftyReport;

const chainReport = (): NiftyReport =>
  ({
    mode: "live",
    date: "2026-11-17",
    expiry: "2026-11-26",
    spot: 25_000,
    strikes: strikes(),
  }) as unknown as NiftyReport;

afterEach(cleanup);

describe("ReportChainWindow — report-native chain", () => {
  test("mounts the real monitor chain with OI/sign columns and its own scroll", () => {
    mount(() => <ReportChainWindow context={context(storeWith(chainReport()))} api={api()} />);

    // Distinctive testids of NiftyOiChain, not a registry placeholder.
    expect(screen.getByTestId("nifty-oi-panel")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-oi-wrap")).toBeInTheDocument();
    const table = screen.getByTestId("nifty-oi-table");
    expect(table).toBeInTheDocument();
    expect(table).toHaveTextContent("CE ΔOI");
    expect(table).toHaveTextContent("CE SIG");
    expect(table).toHaveTextContent("PE SIG");
    expect(table).toHaveTextContent("PE ΔOI");
    expect(screen.getByTestId("nifty-strike-row-24900")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-strike-atm")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-oi-wrap")).toHaveAttribute("data-chain-scroll", "1");
  });

  test("never renders the global registry Upstox notice", () => {
    mount(() => <ReportChainWindow context={context(storeWith(chainReport()))} api={api()} />);

    expect(screen.queryByTestId("broker-auth-message")).not.toBeInTheDocument();
    expect(screen.queryByText(/Upstox connection required/i)).not.toBeInTheDocument();
  });

  test("a missing report store paints the named empty state", () => {
    mount(() => <ReportChainWindow context={context(null)} api={api()} />);

    const empty = screen.getByTestId("report-chain-window-empty");
    expect(empty).toHaveAttribute("data-state", "empty");
    expect(empty).toHaveTextContent("Report store not connected");
    expect(screen.queryByTestId("nifty-oi-table")).not.toBeInTheDocument();
    expect(screen.queryByTestId("broker-auth-message")).not.toBeInTheDocument();
  });

  test("a pending first snapshot paints the named loading state", () => {
    const emptyReport = { ...chainReport(), strikes: [] } as NiftyReport;
    mount(() => <ReportChainWindow context={context(storeWith(emptyReport, true))} api={api()} />);

    const loadingState = screen.getByTestId("report-chain-window-loading");
    expect(loadingState).toHaveAttribute("data-state", "loading");
    expect(loadingState).toHaveTextContent("Waiting for the report's first OI snapshot");
    expect(screen.queryByTestId("nifty-oi-table")).not.toBeInTheDocument();
  });
});

describe("ReportAnalyticsWindow — report-native analytics", () => {
  test("mounts all five real report panels behind tabs", () => {
    mount(() => (
      <ReportAnalyticsWindow context={context(storeWith(analyticsReport()))} api={api()} />
    ));

    expect(screen.getByTestId("nifty-futures-panel")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-futures-regime")).toHaveTextContent("LONG BUILDUP");

    fireEvent.click(screen.getByTestId("report-analytics-tab-itm"));
    expect(screen.getByTestId("nifty-itm-pe-panel")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-itm-pe-vol")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("report-analytics-tab-positioning"));
    expect(screen.getByTestId("nifty-positioning-panel")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-positioning-verdict")).toHaveTextContent("BULLISH");

    fireEvent.click(screen.getByTestId("report-analytics-tab-gex"));
    expect(screen.getByTestId("nifty-gex-profile-panel")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("report-analytics-tab-iv"));
    expect(screen.getByTestId("nifty-iv-skew-panel")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-iv-skew-atm")).toHaveTextContent("%");
  });

  test("never renders the global registry Upstox notice", () => {
    mount(() => (
      <ReportAnalyticsWindow context={context(storeWith(analyticsReport()))} api={api()} />
    ));

    for (const key of ["futures", "itm", "positioning", "gex", "iv"]) {
      fireEvent.click(screen.getByTestId(`report-analytics-tab-${key}`));
      expect(screen.queryByTestId("broker-auth-message")).not.toBeInTheDocument();
      expect(screen.queryByText(/Upstox connection required/i)).not.toBeInTheDocument();
      expect(screen.queryByTestId("options-analytics-chain-error")).not.toBeInTheDocument();
    }
  });

  test("a missing report store paints the named empty state", () => {
    mount(() => <ReportAnalyticsWindow context={context(null)} api={api()} />);

    const empty = screen.getByTestId("report-analytics-window-empty");
    expect(empty).toHaveAttribute("data-state", "empty");
    expect(empty).toHaveTextContent("Report store not connected");
    expect(screen.queryByTestId("nifty-futures-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("broker-auth-message")).not.toBeInTheDocument();
  });

  test("a pending positioning payload paints the named loading state", () => {
    mount(() => (
      <ReportAnalyticsWindow
        context={context(storeWith({ ...chainReport(), strikes: [] } as NiftyReport, true))}
        api={api()}
      />
    ));

    const loadingState = screen.getByTestId("report-analytics-window-loading");
    expect(loadingState).toHaveAttribute("data-state", "loading");
    expect(loadingState).toHaveTextContent("Waiting for the report's positioning payload");
    expect(screen.queryByTestId("nifty-futures-panel")).not.toBeInTheDocument();
  });
});

describe("window adapters — one title per window", () => {
  test("the chain window suppresses its inner option-chain heading but keeps the real panel", () => {
    mount(() => <ReportChainWindow context={context(storeWith(chainReport()))} api={api()} />);

    expect(screen.getByTestId("report-chain-window").className).toContain(
      "[&_[data-compact-header]>div:first-child]:hidden",
    );
    expect(screen.getByTestId("nifty-oi-panel")).toHaveTextContent("Option-chain OI");
    expect(screen.getByTestId("nifty-oi-table")).toBeInTheDocument();
  });

  test("the analytics window keeps its tabs while demoting every active panel heading", () => {
    mount(() => (
      <ReportAnalyticsWindow context={context(storeWith(analyticsReport()))} api={api()} />
    ));

    const frame = screen.getByTestId("report-analytics-window");
    expect(frame.className).toContain("[&_[data-compact-header]>div:first-child]:hidden");
    expect(frame.className).toContain("[&_[data-compact-card-header]>span:first-child]:hidden");
    expect(frame.className).toContain(
      "[&_[data-testid='nifty-positioning-panel']>div:first-child]:hidden",
    );
    expect(screen.getByTestId("report-analytics-tabs")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("report-analytics-tab-gex"));
    expect(screen.getByTestId("nifty-gex-profile-panel")).toHaveTextContent("GEX profile");

    fireEvent.click(screen.getByTestId("report-analytics-tab-positioning"));
    expect(screen.getByTestId("nifty-positioning-panel")).toBeInTheDocument();
  });
});
