// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import { createSignal } from "solid-js";

const fetchAnalytics = vi.fn();
vi.mock("../../../api/optionsAnalytics", async () => {
  const actual = await vi.importActual<typeof import("../../../api/optionsAnalytics")>(
    "../../../api/optionsAnalytics",
  );
  return {
    ...actual,
    fetchAnalytics: (...args: unknown[]) => fetchAnalytics(...args),
  };
});

const chartStub = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() };
vi.mock("@/utils/loadEcharts", () => ({
  loadEcharts: vi.fn(async () => ({ init: vi.fn(() => chartStub) })),
}));

import { OptionDockError, type AnalyticsExpiry, type OptionsAnalytics } from "../../../api/optionsAnalytics";
import { __analyticsCache, __resetAnalytics } from "../../../state/optionsAnalytics";
import { AnalyticsPanel, type AnalyticsContentTab } from "./AnalyticsPanel";

function expiry(date: string, dte: number, atmIv: number): AnalyticsExpiry {
  return {
    date,
    dte,
    atmIv,
    rr25: null,
    bf25: null,
    slope: null,
    fitR2: null,
    points: [
      { strike: 95, iv: 14, delta: -0.25, oi: 100, moneyness: null },
      { strike: 100, iv: atmIv, delta: 0.5, oi: 100, moneyness: null },
      { strike: 105, iv: 13, delta: 0.25, oi: 100, moneyness: null },
    ],
  };
}

function payload(expiries: AnalyticsExpiry[]): OptionsAnalytics {
  return {
    symbol: "NIFTY",
    spot: 100,
    asOf: null,
    quotesLive: true,
    expiries,
    term: [],
    surface: { strikes: [], expiries: [], iv: [], missing: [] },
    levels: {
      callWall: null,
      putWall: null,
      maxPain: 100,
      gex: { support: null, resistance: null, fuelUp: null, fuelDown: null },
    },
    probability: {
      model: "flat lognormal",
      flatPop: 0.6,
      skewPop: 0.58,
      expectedPnl: -10,
      sigma: 39,
      density: [],
      quantiles: { p05: null, p25: null, p50: null, p75: null, p95: null },
      cone: [],
    },
    warnings: [],
  };
}

let setTab!: (tab: AnalyticsContentTab) => void;
let setLegs!: (count: number) => void;

function harness(initial: AnalyticsContentTab, symbol = "NIFTY") {
  return render(() => {
    const [tab, select] = createSignal<AnalyticsContentTab>(initial);
    const [legCount, changeLegs] = createSignal(1);
    setTab = select;
    setLegs = (count: number) => changeLegs(count);
    return (
      <UIProvider>
        <AnalyticsPanel
          tab={tab()}
          symbol={symbol}
          rows={[]}
          spot={100}
          atmIv={12.5}
          legs={Array.from({ length: legCount() }, (_, index) => ({
            key: `CE|${105 + index}`,
            expiry: "2026-11-19",
            side: "buy" as const,
            type: "CE" as const,
            strike: 105 + index,
            premium: 3,
            lots: 1,
            lotSize: 75,
          }))}
          selectedExpiry="2026-11-26"
          dteYears={7 / 365}
        />
      </UIProvider>
    );
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetAnalytics();
  fetchAnalytics.mockImplementation(async () =>
    payload([expiry("2026-11-19", 3, 12.4), expiry("2026-11-26", 10, 11.9)]),
  );
});

afterEach(() => {
  cleanup();
  __resetAnalytics();
});

describe("AnalyticsPanel", () => {
  test("fetches once on the first analytics tab and never again on a tab switch", async () => {
    harness("smile");
    await waitFor(() => expect(fetchAnalytics).toHaveBeenCalledTimes(1));

    for (const tab of ["term", "surface", "prob", "smile"] as AnalyticsContentTab[]) {
      setTab(tab);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(fetchAnalytics).toHaveBeenCalledTimes(1);
    expect(__analyticsCache.get("NIFTY")).toBeDefined();
  });

  test("a repeated mount of the same symbol costs no request", async () => {
    harness("term");
    await waitFor(() => expect(fetchAnalytics).toHaveBeenCalledTimes(1));
    cleanup();
    harness("surface");
    await waitFor(() => expect(screen.getByTestId("analytics-panel")).toBeInTheDocument());
    expect(fetchAnalytics).toHaveBeenCalledTimes(1);
  });

  test("renders a skeleton while the request is in flight", async () => {
    fetchAnalytics.mockImplementation(() => new Promise(() => undefined));
    harness("term");
    await waitFor(() => expect(screen.getByTestId("analytics-loading")).toBeInTheDocument());
    expect(screen.getByTestId("analytics-loading")).toHaveTextContent("Loading analytics");
  });

  test("paints SMILE and PROB from the chain while analytics is still loading", async () => {
    fetchAnalytics.mockImplementation(() => new Promise(() => undefined));
    harness("smile");
    await waitFor(() => expect(screen.getByTestId("analytics-smile")).toBeInTheDocument());
    expect(screen.queryByTestId("analytics-loading")).not.toBeInTheDocument();

    setTab("prob");
    await waitFor(() => expect(screen.getByTestId("analytics-prob")).toBeInTheDocument());
    expect(screen.queryByTestId("analytics-loading")).not.toBeInTheDocument();
  });

  test("shows an error banner and Retry issues one more request", async () => {
    fetchAnalytics
      .mockRejectedValueOnce(new OptionDockError("upstream", "Analytics unavailable", 503))
      .mockImplementationOnce(async () => payload([]));
    harness("term");
    await waitFor(() => expect(screen.getByTestId("analytics-error")).toHaveTextContent("Analytics unavailable"));

    await fireEvent.click(screen.getByTestId("analytics-retry"));
    await waitFor(() => expect(fetchAnalytics).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId("analytics-error")).not.toBeInTheDocument());
  });

  test("each tab has its own empty state", async () => {
    fetchAnalytics.mockImplementation(async () => payload([]));
    harness("term");
    await waitFor(() =>
      expect(screen.getByTestId("term-chart-empty")).toHaveTextContent(
        "Need at least two expiries with valid ATM IV",
      ),
    );

    setTab("surface");
    await waitFor(() => expect(screen.getByTestId("surface-chart-empty")).toHaveTextContent("No surface grid"));

    setTab("smile");
    await waitFor(() => expect(screen.getByTestId("smile-chart-empty")).toHaveTextContent("No IV quotes"));

    setLegs(0);
    setTab("prob");
    await waitFor(() => expect(screen.getByTestId("prob-empty")).toHaveTextContent("Add a leg to see probability"));
  });

  test("disposes the previous chart when the tab changes", async () => {
    harness("term");
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());
    chartStub.dispose.mockClear();

    setTab("surface");
    await waitFor(() => expect(chartStub.dispose).toHaveBeenCalled());
  });

  test("hands the strip the dock context, verdicts and expiry selector", async () => {
    const onSelectExpiry = vi.fn<(date: string) => void>();
    render(() => (
      <UIProvider>
        <AnalyticsPanel
          tab="term"
          symbol="NIFTY"
          rows={[]}
          spot={2980}
          atmIv={79.7}
          legs={[]}
          selectedExpiry="2026-11-26"
          dteYears={7 / 365}
          context={{
            symbol: "NIFTY",
            expiry: { date: "2026-11-26", dteDays: 6 },
            spot: 2980,
            atmIv: 79.7,
            marketState: "closed",
          }}
          maxPain={2950}
          expiryOptions={[{ date: "2026-11-26", dteDays: 6 }]}
          onSelectExpiry={onSelectExpiry}
        />
      </UIProvider>
    ));

    await waitFor(() => expect(fetchAnalytics).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("analytics-context")).toHaveTextContent(
      "NIFTY · 26 NOV · 6d · spot ₹2,980 · IV 79.7% · CLOSED",
    );
    expect(screen.getByTestId("analytics-chip-maxpain")).toHaveTextContent("₹2,950");

    fireEvent.click(screen.getByTestId("analytics-expiry-2026-11-26"));
    expect(onSelectExpiry).toHaveBeenCalledWith("2026-11-26");
  });
});
