// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UIProvider } from "@/ui";
import { BROKER_AUTH_ACTION } from "@/components/common/BrokerAuthNotice";
import { fetchNiftyExpiries, fetchOptionsExpiries } from "@/api/reportNifty";
import type { DockPanelContext } from "../../dock/types";
import { WindowManager } from "../WindowManager";
import { WINDOW_PANELS } from "../panelRegistry";
import { HOME_PANELS } from "../../../pages/home/homePanels";

// The registry defers this module; load it so hoisted mocks are ready on first mount.
await import("./optionsAnalytics");

vi.mock("@/api/reportNifty", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/reportNifty")>();
  return {
    ...actual,
    fetchNiftyExpiries: vi.fn(),
    fetchOptionsExpiries: vi.fn(),
  };
});

const fetchNiftyExpiriesMock = vi.mocked(fetchNiftyExpiries);
const fetchOptionsExpiriesMock = vi.mocked(fetchOptionsExpiries);

/** Dates relative to today so "nearest" stays correct whenever CI runs. */
const isoAfter = (days: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const nearExpiry = () => isoAfter(3);
const farExpiry = () => isoAfter(21);
const expiriesFixture = () => [{ date: nearExpiry() }, { date: farExpiry() }];

const fetchAnalytics = vi.fn();
vi.mock("../../../api/optionsAnalytics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/optionsAnalytics")>();
  return { ...actual, fetchAnalytics: (...args: unknown[]) => fetchAnalytics(...args) };
});

const fetchChain = vi.fn();
vi.mock("../../../api/optionsDock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/optionsDock")>();
  return { ...actual, fetchChain: (...args: unknown[]) => fetchChain(...args) };
});

const chartStub = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() };
vi.mock("@/utils/loadEcharts", () => ({
  loadEcharts: vi.fn(async () => ({ init: vi.fn(() => chartStub) })),
}));

import type { AnalyticsExpiry, OptionsAnalytics } from "../../../api/optionsAnalytics";
import {
  OptionDockError,
  type ChainLeg,
  type ChainRow,
} from "../../../api/optionsDock";
import { __resetAnalytics } from "../../../state/optionsAnalytics";

type AnalyticsExpiryRow = AnalyticsExpiry;

function analyticsExpiry(date: string, dte: number, atmIv: number): AnalyticsExpiryRow {
  return {
    date,
    dte,
    atmIv,
    rr25: null,
    bf25: null,
    slope: null,
    fitR2: null,
    points: [
      { strike: 99, iv: atmIv + 0.4, delta: -0.25, oi: 100, moneyness: null },
      { strike: 100, iv: atmIv, delta: 0.5, oi: 120, moneyness: null },
      { strike: 101, iv: atmIv - 0.3, delta: 0.25, oi: 90, moneyness: null },
    ],
  };
}

function analyticsPayload(expiries: AnalyticsExpiryRow[]): OptionsAnalytics {
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

const fullAnalytics = () =>
  analyticsPayload([analyticsExpiry("2026-11-19", 3, 12.4), analyticsExpiry("2026-11-26", 10, 11.9)]);

function chainLeg(iv: number): ChainLeg {
  return {
    ltp: 90,
    oi: 1000,
    prevOi: 0,
    volume: 10,
    iv,
    delta: 0.5,
    gamma: 0,
    theta: 0,
    vega: 0,
    pop: null,
    bid: null,
    ask: null,
    instrumentKey: "NSE_FO|TEST",
  };
}

function chainPayload(): {
  expiry: string;
  spot: number;
  pcr: number;
  atmIv: number;
  spotChangePct: number;
  rows: ChainRow[];
  asOf: string;
  levels: null;
} {
  return {
    expiry: "2026-11-26",
    spot: 100,
    pcr: 1,
    atmIv: 12.5,
    spotChangePct: 0.2,
    rows: [
      { strike: 99, ce: chainLeg(13), pe: chainLeg(14) },
      { strike: 100, ce: chainLeg(12.5), pe: chainLeg(12.8) },
      { strike: 101, ce: chainLeg(12), pe: chainLeg(11.5) },
    ],
    asOf: "2026-11-26T10:00:00Z",
    levels: null,
  };
}

function renderWindow(overrides: Partial<DockPanelContext> = {}) {
  const context = (): DockPanelContext => ({
    symbol: "NIFTY",
    market: "india",
    timeframe: "1m",
    expiry: "2026-11-26",
    ...overrides,
  });
  return render(() => (
    <UIProvider>
      <WindowManager
        layout={{
          name: "Main",
          windows: [
            {
              id: "analytics",
              type: "options.analytics",
              title: "OPTIONS ANALYTICS",
              x: 0,
              y: 0,
              w: 900,
              h: 520,
              z: 1,
            },
          ],
        }}
        context={context}
        onLayoutChange={() => {}}
        canvas={{ w: 1280, h: 800 }}
        specs={WINDOW_PANELS}
        lockedInitially
      />
    </UIProvider>
  ));
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  fetchAnalytics.mockReset();
  fetchChain.mockReset();
  fetchNiftyExpiriesMock.mockReset();
  fetchOptionsExpiriesMock.mockReset();
  fetchNiftyExpiriesMock.mockImplementation(async () => expiriesFixture());
  fetchOptionsExpiriesMock.mockImplementation(async () => [nearExpiry(), farExpiry()]);
  chartStub.setOption.mockClear();
  chartStub.dispose.mockClear();
  __resetAnalytics();
  fetchAnalytics.mockImplementation(async () => fullAnalytics());
  fetchChain.mockImplementation(async () => chainPayload());
});

afterEach(() => {
  cleanup();
  __resetAnalytics();
  vi.unstubAllGlobals();
});

describe("options.analytics window panel — real analytics", () => {
  it("(a) renders a real IV value from the analytics response, not a placeholder", async () => {
    renderWindow();

    await waitFor(() =>
      expect(screen.getByTestId("term-metric-front-value")).toHaveTextContent("12.4"),
    );
    expect(screen.getByTestId("term-metric-front")).toHaveTextContent("FRONT (19 NOV)");
    expect(screen.getByTestId("term-metric-back-value")).toHaveTextContent("11.9");
    expect(fetchAnalytics).toHaveBeenCalledWith("NIFTY", expect.any(AbortSignal));
    expect(fetchChain).toHaveBeenCalledWith(
      "NIFTY",
      "2026-11-26",
      expect.any(AbortSignal),
    );
  });

  it("(b) switching analytics tabs swaps the visible panel", async () => {
    renderWindow();
    await waitFor(() =>
      expect(screen.getByTestId("term-metric-front-value")).toHaveTextContent("12.4"),
    );
    expect(screen.getByTestId("analytics-term")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("analytics-tab-surface"));
    await waitFor(() => expect(screen.getByTestId("analytics-surface")).toBeInTheDocument());
    expect(screen.queryByTestId("analytics-term")).not.toBeInTheDocument();
    expect(screen.getByTestId("surface-metric-grid-value")).toHaveTextContent("3×2");
  });
});

describe("options.analytics window panel — states", () => {
  it("(c) loading shows the analytics skeleton and a chain loading cue", () => {
    fetchAnalytics.mockImplementation(() => new Promise(() => undefined));
    fetchChain.mockImplementation(() => new Promise(() => undefined));
    renderWindow();

    expect(screen.getByTestId("analytics-loading")).toHaveTextContent("Loading analytics");
    expect(screen.getByTestId("options-analytics-chain-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("analytics-error")).not.toBeInTheDocument();
  });

  it("(c) an empty analytics frame and empty chain show distinct empty states", async () => {
    fetchAnalytics.mockImplementation(async () => analyticsPayload([]));
    fetchChain.mockImplementation(async () => ({
      ...chainPayload(),
      rows: [],
    }));
    renderWindow();

    await waitFor(() =>
      expect(screen.getByTestId("options-analytics-chain-empty")).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getByTestId("term-chart-empty")).toHaveTextContent(
        "Need at least two expiries with valid ATM IV",
      ),
    );
    expect(screen.queryByTestId("analytics-error")).not.toBeInTheDocument();
  });

  it("(empty-action) empty states offer enabled actions", async () => {
    fetchChain.mockImplementation(async () => ({ ...chainPayload(), rows: [] }));
    renderWindow();

    await waitFor(() =>
      expect(screen.getByTestId("options-analytics-chain-empty")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("options-analytics-chain-empty-retry")).toBeEnabled();

    fireEvent.input(screen.getByTestId("options-analytics-symbol-input"), { target: { value: "" } });
    expect(screen.getByTestId("options-analytics-empty-symbol")).toBeInTheDocument();
    expect(screen.getByTestId("options-analytics-empty-action")).toBeEnabled();
  });

  it("(c) an analytics failure surfaces the typed error with a retry", async () => {
    fetchAnalytics
      .mockRejectedValueOnce(new OptionDockError("upstream", "Analytics unavailable", 503))
      .mockImplementationOnce(async () => fullAnalytics());
    renderWindow();

    await waitFor(() =>
      expect(screen.getByTestId("analytics-error")).toHaveTextContent("Analytics unavailable"),
    );
    await fireEvent.click(screen.getByTestId("analytics-retry"));
    await waitFor(() =>
      expect(screen.getByTestId("term-metric-front-value")).toHaveTextContent("12.4"),
    );
    expect(fetchAnalytics).toHaveBeenCalledTimes(2);
  });
});

describe("options.analytics failure behaviour", () => {
  it("(a) a chain 500 renders the error state, not the empty state", async () => {
    fetchChain.mockImplementation(() =>
      Promise.reject(new OptionDockError("upstream", "Options service error", 500)),
    );
    renderWindow();

    const error = await screen.findByTestId("options-analytics-chain-error");
    expect(error).toHaveAttribute("data-kind", "upstream");
    expect(error).toHaveTextContent("Options service error");
    expect(screen.queryByTestId("options-analytics-chain-empty")).not.toBeInTheDocument();
  });

  it("(b) a failed chain refresh marks already-loaded analytics as stale", async () => {
    renderWindow();
    await waitFor(() =>
      expect(screen.getByTestId("term-metric-front-value")).toHaveTextContent("12.4"),
    );
    expect(screen.queryByTestId("options-analytics-stale")).not.toBeInTheDocument();

    fetchChain.mockImplementation(() =>
      Promise.reject(new OptionDockError("upstream", "Options service error", 500)),
    );
    const expiryInput = screen.getByTestId("options-analytics-expiry-input");
    fireEvent.input(within(expiryInput).getByRole("combobox"), {
      target: { value: farExpiry() },
    });

    await screen.findByTestId("options-analytics-chain-error");
    expect(screen.getByTestId("options-analytics-stale")).toHaveTextContent(
      "showing last available analytics",
    );
    expect(screen.getByTestId("term-metric-front-value")).toHaveTextContent("12.4");
  });

  it("(c) an aborted superseded chain fetch renders no error flash", async () => {
    let rejectFirst!: (reason: unknown) => void;
    fetchChain.mockImplementationOnce(
      () => new Promise((_resolve, reject) => { rejectFirst = reject; }),
    );
    fetchChain.mockImplementation(async () => chainPayload());
    renderWindow();

    expect(screen.getByTestId("options-analytics-chain-loading")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        within(screen.getByTestId("options-analytics-expiry-input")).getByRole("combobox"),
      ).toBeEnabled(),
    );
    fireEvent.input(within(screen.getByTestId("options-analytics-expiry-input")).getByRole("combobox"), {
      target: { value: farExpiry() },
    });
    rejectFirst(new DOMException("Aborted", "AbortError"));

    await waitFor(() =>
      expect(screen.queryByTestId("options-analytics-chain-loading")).not.toBeInTheDocument(),
    );
    expect(screen.queryByTestId("options-analytics-chain-error")).not.toBeInTheDocument();
  });

  it("(d) a 401 offers the broker-connect action", async () => {
    fetchChain.mockImplementation(() =>
      Promise.reject(new OptionDockError("auth", "Reconnect Upstox in Settings", 401)),
    );
    renderWindow();

    const connect = await screen.findByTestId("options-analytics-connect");
    expect(connect).toHaveTextContent(BROKER_AUTH_ACTION);
    expect(connect).toHaveAttribute("href", "/settings");
    expect(screen.getByTestId("options-analytics-chain-error")).toHaveAttribute("data-kind", "auth");
  });

  it("(e) a 429 shows the wait and disables immediate retry", async () => {
    fetchChain.mockImplementation(() =>
      Promise.reject(new OptionDockError("rate_limited", "Rate limited", 429, 8000)),
    );
    renderWindow();

    const error = await screen.findByTestId("options-analytics-chain-error");
    expect(error).toHaveAttribute("data-kind", "rate_limited");
    expect(error).toHaveTextContent("retry in 8s");
    const retry = within(error).getByRole("button", { name: /retry/i });
    expect(retry).toBeDisabled();
    expect(retry).toHaveTextContent("Retry in 8s");
  });
});

describe("options.analytics window panel — controls and sizing", () => {
  it("(d) the chart container is flex-sized, never a fixed-height box", async () => {
    renderWindow();
    await waitFor(() =>
      expect(screen.getByTestId("term-metric-front-value")).toHaveTextContent("12.4"),
    );

    const chart = screen.getByTestId("term-chart");
    const container = chart.parentElement;
    expect(container).toHaveClass("min-h-0");
    expect(container).toHaveClass("flex-1");
    expect(container).not.toHaveAttribute("style");
  });

  it("(e) symbol and expiry controls live inside the window", async () => {
    renderWindow({ expiry: undefined });
    const body = screen.getByTestId("window-body-analytics");
    const symbolInput = within(body).getByTestId("options-analytics-symbol-input");
    const expiryInput = within(body).getByTestId("options-analytics-expiry-input");

    expect(body).toContainElement(symbolInput);
    expect(body).toContainElement(expiryInput);
    expect(screen.queryByTestId("home-expiry-input")).not.toBeInTheDocument();

    fetchChain.mockImplementation(async () => chainPayload());
    await waitFor(() =>
      expect(
        within(screen.getByTestId("options-analytics-expiry-input")).getByRole("combobox"),
      ).toBeEnabled(),
    );
    fireEvent.input(within(screen.getByTestId("options-analytics-expiry-input")).getByRole("combobox"), {
      target: { value: farExpiry() },
    });
    await waitFor(() =>
      expect(fetchChain).toHaveBeenCalledWith(
        "NIFTY",
        farExpiry(),
        expect.any(AbortSignal),
      ),
    );
  });

  it("(e) the panel is registered in the window picker and the window registry", () => {
    expect(WINDOW_PANELS.map((spec) => spec.id)).toContain("options.analytics");
    expect(HOME_PANELS.map((spec) => spec.id)).toContain("options.analytics");
  });
});

describe("options.analytics — expiry picker", () => {
  it("(a) the select is populated from listings and defaults to nearest", async () => {
    renderWindow({ expiry: undefined });
    const picker = await screen.findByTestId("options-analytics-expiry-picker");
    await waitFor(() =>
      expect(within(picker).getAllByRole("option")).toHaveLength(2),
    );
    expect(within(picker).getByRole("combobox")).toHaveValue(nearExpiry());
    expect(fetchNiftyExpiriesMock).toHaveBeenCalledTimes(1);
  });

  it("(e) a context expiry is honoured over the nearest default", async () => {
    renderWindow({ expiry: farExpiry() });
    const picker = await screen.findByTestId("options-analytics-expiry-picker");
    await waitFor(() => expect(within(picker).getAllByRole("option")).toHaveLength(2));
    expect(within(picker).getByRole("combobox")).toHaveValue(farExpiry());
  });

  it("(d) a failed expiries request shows Retry, not an empty select", async () => {
    fetchNiftyExpiriesMock.mockRejectedValueOnce(new Error("expiry service down"));
    renderWindow({ expiry: undefined });
    const error = await screen.findByTestId("options-analytics-expiry-error");
    expect(error).toHaveTextContent(/expiry service down/i);
    expect(within(error).getByRole("button", { name: /retry/i })).toBeEnabled();
  });

  it("(f) no expiries renders an explanatory state", async () => {
    fetchNiftyExpiriesMock.mockResolvedValue([]);
    renderWindow({ expiry: undefined });
    expect(await screen.findByTestId("options-analytics-expiry-empty")).toHaveTextContent(
      /no expiries listed/i,
    );
  });
});
