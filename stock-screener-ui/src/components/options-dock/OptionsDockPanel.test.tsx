// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";

const fetchUnderlying = vi.fn();
const fetchChain = vi.fn();
const fetchAnalytics = vi.fn();
const fetchDashboard = vi.fn();
const refreshAnalyticsSpy = vi.fn();
const suspendPollingSpy = vi.fn();
const resumePollingSpy = vi.fn();

// The contract chart is another lane's chunk; the dock is what these tests own.
vi.mock("./contract/ContractChartPanel", () => ({
  ContractChartPanel: (props: {
    selection: { strike: number; side: string };
    onBack: () => void;
  }) => (
    <div
      data-testid="contract-chart-stub"
      data-strike={props.selection.strike}
      data-side={props.selection.side}
    >
      <button type="button" data-testid="contract-chart-back" onClick={() => props.onBack()}>
        Back
      </button>
    </div>
  ),
}));

// Spy on the poll seams while keeping the real store behaviour for every other
// export the panel and these tests use.
vi.mock("../../state/optionsDock", async () => {
  const actual = await vi.importActual<typeof import("../../state/optionsDock")>(
    "../../state/optionsDock",
  );
  return {
    ...actual,
    suspendPolling: () => {
      suspendPollingSpy();
      actual.suspendPolling();
    },
    resumePolling: () => {
      resumePollingSpy();
      actual.resumePolling();
    },
  };
});

vi.mock("../../api/optionsAnalytics", async () => {
  const actual = await vi.importActual<typeof import("../../api/optionsAnalytics")>(
    "../../api/optionsAnalytics",
  );
  return {
    ...actual,
    fetchAnalytics: (...args: unknown[]) => fetchAnalytics(...args),
  };
});

vi.mock("../../api/optionsDock", async () => {
  const actual = await vi.importActual<typeof import("../../api/optionsDock")>("../../api/optionsDock");
  return {
    ...actual,
    fetchUnderlying: (...args: unknown[]) => fetchUnderlying(...args),
    fetchChain: (...args: unknown[]) => fetchChain(...args),
  };
});

vi.mock("../../api/optionsDashboard", async () => {
  const actual = await vi.importActual<typeof import("../../api/optionsDashboard")>(
    "../../api/optionsDashboard",
  );
  return { ...actual, fetchDashboard: (...args: unknown[]) => fetchDashboard(...args) };
});

// Keep the real store (loadAnalytics/abortAnalytics/state) and swap only the
// refresh entry point so the strip's callback can be asserted in isolation.
vi.mock("../../state/optionsAnalytics", async () => {
  const actual = await vi.importActual<typeof import("../../state/optionsAnalytics")>(
    "../../state/optionsAnalytics",
  );
  return {
    ...actual,
    refreshAnalytics: (...args: unknown[]) => refreshAnalyticsSpy(...args),
  };
});

// happy-dom has no 2D canvas: the real ECharts init throws from zrender.
const chartStub = {
  setOption: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
};
vi.mock("../../utils/loadEcharts", () => ({
  loadEcharts: vi.fn(async () => ({ init: vi.fn(() => chartStub) })),
}));

import { OptionDockError, type OptionDockChain, type UnderlyingInfo } from "../../api/optionsDock";
import {
  CHART_BAND_HEIGHT,
  OptionsDockPanel,
  PAYOFF_BAND_HEIGHT,
  bandHeight,
  expiryLabel,
} from "./OptionsDockPanel";
import { CHAIN_SCROLL_SETTLE_MS } from "./OptionChainTable";
import { buildPayoff } from "./PayoffPanel";
import { __resetOptionsDock, addLeg, open, optionsDockState, refresh, setExpiry, setOptionsDockState } from "../../state/optionsDock";
import {
  __analyticsCache,
  __resetAnalytics,
  optionsAnalyticsState,
  setOptionsAnalyticsState,
} from "../../state/optionsAnalytics";
import { __resetDashboard } from "../../state/optionsDashboard";
import { fullFixture } from "../options-dashboard/fixtures";

function listing(overrides: Partial<UnderlyingInfo> = {}): UnderlyingInfo {
  return {
    symbol: "NIFTY",
    exchange: "NSE",
    fno: true,
    instrumentKey: "NSE_INDEX|Nifty 50",
    spot: 24031.5,
    expiries: [
      { date: "2026-03-26", weekly: true, dteDays: 2, lotSize: 65, tickSize: 0.05 },
      { date: "2026-04-02", weekly: true, dteDays: 9, lotSize: 65, tickSize: 0.05 },
    ],
    defaultExpiry: "2026-03-26",
    marketState: "open",
    ...overrides,
  };
}

function leg(ltp: number, oi: number, iv: number | null, delta: number | null) {
  return {
    ltp,
    oi,
    prevOi: oi,
    volume: 0,
    iv,
    delta,
    gamma: null,
    theta: null,
    vega: null,
    pop: null,
    bid: null,
    ask: null,
    instrumentKey: "",
  };
}

function chain(expiry = "2026-03-26"): OptionDockChain {
  return {
    expiry,
    spot: 24031.5,
    pcr: 1.11,
    atmIv: 13.8,
    spotChangePct: 0.42,
    asOf: "2026-03-24T14:52:00+05:30",
    rows: [
      { strike: 23900, ce: leg(177.5, 5_200_000, 13.9, 0.71), pe: leg(46, 14_100_000, 13.9, -0.29) },
      { strike: 24000, ce: leg(114.4, 8_600_000, 13.8, 0.55), pe: leg(82.9, 10_200_000, 13.8, -0.45) },
      { strike: 24100, ce: leg(67.7, 12_400_000, 13.8, 0.39), pe: leg(136.2, 5_100_000, 13.8, -0.61) },
    ],
  };
}

function renderPanel() {
  return render(() => (
    <UIProvider>
      <OptionsDockPanel />
    </UIProvider>
  ));
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
  refreshAnalyticsSpy.mockResolvedValue(null);
  localStorage.clear();
  (window as any).__E2E_MOCK_MARKET_OPEN__ = false;
  __resetOptionsDock();
  __resetAnalytics();
  __resetDashboard();
  fetchUnderlying.mockResolvedValue(listing());
  fetchChain.mockImplementation(async (_symbol: string, expiry: string) => chain(expiry));
  fetchDashboard.mockImplementation(async (symbol: string) => ({
    ...fullFixture(),
    // DockPillarsView only paints a payload for the symbol it asked for.
    symbol: String(symbol ?? "NIFTY").toUpperCase(),
  }));
  fetchAnalytics.mockImplementation(async (symbol: string) => ({
    symbol: symbol.toUpperCase(),
    spot: 24031.5,
    asOf: null,
    quotesLive: true,
    expiries: [],
    term: [],
    surface: { strikes: [], expiries: [], iv: [], missing: [] },
    levels: {
      callWall: null,
      putWall: null,
      maxPain: 24000,
      gex: { support: null, resistance: null, fuelUp: null, fuelDown: null },
    },
    probability: {
      model: null,
      flatPop: null,
      skewPop: null,
      expectedPnl: null,
      sigma: null,
      density: [],
      quantiles: { p05: null, p25: null, p50: null, p75: null, p95: null },
      cone: [],
    },
    warnings: [],
  }));
});

afterEach(() => {
  cleanup();
  __resetOptionsDock();
  __resetAnalytics();
  __resetDashboard();
  delete (window as any).__E2E_MOCK_MARKET_OPEN__;
  vi.unstubAllGlobals();
});

function narrowViewport() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("max-width: 639px"),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

const columnIdsOf = () =>
  screen.getAllByRole("columnheader").map((header) => header.id.replace("paper-tanstack-header-", ""));

describe("expiryLabel", () => {
  // Freeze the clock at a weekday 10:00 IST, before the 15:40 derivatives
  // close, so the 0-DTE → EXPIRED boundary cannot flip with the real clock.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-16T10:00:00+05:30"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("labels a 0-DTE contract", () => {
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    expect(expiryLabel({ date: today, dteDays: 0 })).toContain("0-DTE");
  });

  test("labels a 1-DTE contract", () => {
    expect(expiryLabel({ date: "2026-11-17", dteDays: 1 })).toBe("17 NOV · 1d");
  });

  test("labels an expired contract", () => {
    // Yesterday's contract is expired at any time of day.
    expect(expiryLabel({ date: "2026-11-15", dteDays: 0 })).toBe("15 NOV · EXPIRED");

    // Today's contract flips to EXPIRED at the 15:40 derivatives close.
    vi.setSystemTime(new Date("2026-11-16T15:50:00+05:30"));
    expect(expiryLabel({ date: "2026-11-16", dteDays: 0 })).toBe("16 NOV · EXPIRED");
  });

  test("keeps the day count for a far expiry", () => {
    expect(expiryLabel({ date: "2099-03-26", dteDays: 2 })).toBe("26 MAR · 2d");
  });
});

describe("OptionsDockPanel", () => {
  test("root fills its flex parent with flex-1, never a percentage height", () => {
    renderPanel();

    const root = screen.getByTestId("options-dock");
    // A percentage height resolves against an auto-height outlet and lets the
    // content dictate the panel size; flex-1 fills the definite flex column.
    expect(root.className).toContain("flex-1");
    expect(root.className).not.toContain("h-full");
  });

  test("non-maximized root is the single scroll owner; maximized root is not scrollable", async () => {
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-chain-table")).toBeInTheDocument());

    const root = screen.getByTestId("options-dock");
    // The fixed-height sheet/rail wrappers clip, so the dock itself scrolls on
    // short heights. A fits-content sheet shows no bar (overflow-y-auto).
    expect(root.className).toContain("overflow-y-auto");
    expect(root.className).toContain("overflow-x-hidden");
    expect(root.className).not.toContain("h-full");

    await fireEvent.click(screen.getByTestId("options-maximize"));
    const maximizedRoot = screen.getByTestId("options-dock");
    expect(maximizedRoot.className).toContain("fixed inset-0");
    expect(maximizedRoot.className).toContain("overflow-hidden");
    expect(maximizedRoot.className).not.toContain("overflow-y-auto");
  });

  test("renders the chain with the ATM row tinted exactly once", async () => {
    open("NIFTY");
    renderPanel();

    await waitFor(() => expect(screen.getByTestId("options-chain-table")).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByTestId("options-chain-row-24000")).toBeInTheDocument(),
    );

    const atmRows = document.querySelectorAll('[data-atm="true"]');
    expect(atmRows).toHaveLength(1);
    expect(atmRows[0].getAttribute("data-testid")).toBe("options-chain-row-24000");
    // ATM tint is a theme token, never a hard-coded dark colour.
    expect((atmRows[0] as HTMLElement).style.backgroundColor).toContain("var(--");
  });

  test("clicking a CE price adds a buy leg and shift-click adds a sell leg", async () => {
    open("NIFTY");
    renderPanel();

    await waitFor(() => expect(screen.getByTestId("options-ce-24000")).toBeInTheDocument());
    await fireEvent.click(screen.getByTestId("options-ce-24000"));
    expect(optionsDockState.legs).toHaveLength(1);
    expect(optionsDockState.legs[0]).toMatchObject({ side: "buy", type: "CE", strike: 24000 });

    await fireEvent.click(screen.getByTestId("options-pe-24000"), { shiftKey: true });
    expect(optionsDockState.legs).toHaveLength(2);
    expect(optionsDockState.legs[1]).toMatchObject({ side: "sell", type: "PE", strike: 24000 });

    await waitFor(() => expect(screen.getByTestId("options-leg-chips")).toBeInTheDocument());
    expect(screen.getByTestId("options-leg-count")).toHaveTextContent("2/4");
  });

  test("adds no network request for a leg change", async () => {
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-ce-24000")).toBeInTheDocument());

    const before = fetchChain.mock.calls.length + fetchUnderlying.mock.calls.length;
    await fireEvent.click(screen.getByTestId("options-ce-24000"));

    expect(fetchChain.mock.calls.length + fetchUnderlying.mock.calls.length).toBe(before);
  });

  test("payoff renders a full 241-point curve for a four-leg condor", async () => {
    open("NIFTY");
    await flush();
    for (const [side, type, strike, premium] of [
      ["sell", "CE", 24200, 36.6],
      ["buy", "CE", 24500, 3.5],
      ["sell", "PE", 23800, 23.1],
      ["buy", "PE", 23500, 1.8],
    ] as const) {
      addLeg({ side, type, strike, premium });
    }
    renderPanel();

    await waitFor(() => expect(screen.getByTestId("options-pop")).toHaveTextContent("%"));
    expect(screen.getByTestId("options-breakevens")).toHaveTextContent("23,746");
    expect(screen.getByTestId("options-breakevens")).toHaveTextContent("24,254");
    expect(screen.getByTestId("options-net-premium")).toHaveTextContent("₹3.5K");

    const lastCall = chartStub.setOption.mock.calls.at(-1)?.[0] as {
      series?: { data?: unknown[] }[];
    };
    expect(lastCall?.series?.[0]?.data).toHaveLength(241);
  });

  test("the §4.1 condor prices at POP 69.7 % on a two-day T", () => {
    const legs = [
      { side: "sell", type: "CE", strike: 24200, premium: 36.6, lots: 1, lotSize: 65 },
      { side: "buy", type: "CE", strike: 24500, premium: 3.5, lots: 1, lotSize: 65 },
      { side: "sell", type: "PE", strike: 23800, premium: 23.1, lots: 1, lotSize: 65 },
      { side: "buy", type: "PE", strike: 23500, premium: 1.8, lots: 1, lotSize: 65 },
    ].map((leg) => ({
      ...leg,
      side: leg.side as "buy" | "sell",
      type: leg.type as "CE" | "PE",
      key: `${leg.type}|${leg.strike}`,
      expiry: "2026-03-26",
    })) as never;

    const snapshot = buildPayoff(legs, 24031.5, 0.138, 2 / 365);
    expect(snapshot!.pop).toBeCloseTo(0.697, 2);
    expect(snapshot!.maxProfit).toBeCloseTo(3536, 0);
    expect(snapshot!.maxLoss).toBeCloseTo(-15964, 0);
  });

  test("shows the non-F&O empty state and no chain table", async () => {
    fetchUnderlying.mockResolvedValue(listing({ fno: false, expiries: [], defaultExpiry: null }));
    open("RELIANCE");
    renderPanel();

    await waitFor(() => expect(screen.getByTestId("options-dock-empty")).toBeInTheDocument());
    expect(screen.getByTestId("options-dock-empty")).toHaveTextContent("No listed options for RELIANCE");
    expect(screen.queryByTestId("options-chain-table")).not.toBeInTheDocument();
  });

  test("401 shows the reconnect message plus Retry", async () => {
    fetchUnderlying.mockRejectedValue(new OptionDockError("auth", "Reconnect Upstox in Settings", 401));
    open("NIFTY");
    renderPanel();

    await waitFor(() => expect(screen.getByTestId("options-dock-error")).toBeInTheDocument());
    expect(screen.getByTestId("options-dock-error")).toHaveTextContent("Reconnect Upstox in Settings");
    expect(screen.getByTestId("options-dock-retry")).toBeInTheDocument();
    // The full-panel cold state never paints a chain, and only one error slot exists.
    expect(screen.queryByTestId("options-chain-table")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("options-dock-error")).toHaveLength(1);
  });

  test("a failed refresh with a painted chain shows the banner and Retry refreshes", async () => {
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-chain-table")).toBeInTheDocument());

    setOptionsDockState("error", { kind: "auth", message: "Reconnect Upstox in Settings" });

    const banner = screen.getByTestId("options-dock-error");
    expect(banner).toHaveTextContent("Reconnect Upstox in Settings");
    expect(screen.getAllByTestId("options-dock-error")).toHaveLength(1);
    // The last frame stays on screen behind the banner.
    expect(screen.getByTestId("options-ce-24000")).toBeInTheDocument();

    const before = fetchChain.mock.calls.length;
    await fireEvent.click(screen.getByTestId("options-dock-retry"));
    await waitFor(() => expect(fetchChain.mock.calls.length).toBeGreaterThan(before));
    await waitFor(() => expect(screen.queryByTestId("options-dock-error")).not.toBeInTheDocument());
  });

  test("a non-auth failure surfaces the raw error message", async () => {
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-chain-table")).toBeInTheDocument());

    setOptionsDockState("error", { kind: "upstream", message: "Upstox unavailable" });

    const banner = screen.getByTestId("options-dock-error");
    expect(banner).toHaveTextContent("Upstox unavailable");
    expect(banner).not.toHaveTextContent("Reconnect Upstox in Settings");
    expect(screen.getByTestId("options-chain-table")).toBeInTheDocument();
  });

  test("not_fno and rate failures use their dedicated banner messages", async () => {
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-chain-table")).toBeInTheDocument());

    setOptionsDockState("error", { kind: "not_fno", message: "raw not_fno detail" });
    expect(screen.getByTestId("options-dock-error")).toHaveTextContent("No listed options");

    setOptionsDockState("error", { kind: "rate_limited", message: "slow down" });
    expect(screen.getByTestId("options-dock-error")).toHaveTextContent("Refreshing paused");
  });

  test("no banner when the store has no error", async () => {
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-chain-table")).toBeInTheDocument());

    expect(optionsDockState.error).toBeNull();
    expect(screen.queryByTestId("options-dock-error")).not.toBeInTheDocument();
    expect(screen.queryByTestId("options-dock-retry")).not.toBeInTheDocument();
  });

  test("429 keeps the chain painted and shows the paused chip", async () => {
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-chain-table")).toBeInTheDocument());

    fetchChain.mockRejectedValueOnce(new OptionDockError("rate_limited", "slow down", 429, 8000));
    await refresh();

    await waitFor(() => expect(screen.getByTestId("options-refresh-paused")).toBeInTheDocument());
    expect(screen.getByTestId("options-chain-table")).toBeInTheDocument();
    expect(screen.getByTestId("options-refresh-paused")).toHaveTextContent("Refreshing paused");
  });

  test("header skeleton shows before the listing arrives", async () => {
    fetchUnderlying.mockImplementation(() => new Promise(() => undefined));
    open("NIFTY");
    renderPanel();

    await waitFor(() => expect(screen.getByTestId("options-dock-header-skeleton")).toBeInTheDocument());
  });

  test("summary strip derives PCR, max pain, sigma and total OI from the frame", async () => {
    open("NIFTY");
    renderPanel();

    await waitFor(() => expect(screen.getByTestId("options-summary")).toBeInTheDocument());
    expect(screen.getByTestId("options-stat-pcr")).toHaveTextContent("1.11");
    expect(screen.getByTestId("options-stat-max-pain")).toHaveTextContent("24,000");
    expect(screen.getByTestId("options-stat-atm-iv")).toHaveTextContent("13.8");
    expect(screen.getByTestId("options-stat-total-oi")).toHaveTextContent("Cr");
  });

  test("chain, strategy, legs and payoff carry their own titled section headers", async () => {
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-payoff-placeholder")).toBeInTheDocument());

    expect(screen.getByTestId("dock-section-chain")).toHaveTextContent(/CHAIN · NIFTY/);
    expect(screen.getByTestId("dock-section-chain")).toHaveTextContent(/\d{2} [A-Z]{3}/);
    expect(screen.getByTestId("dock-section-strategy")).toHaveTextContent("STRATEGY");
    expect(screen.getByTestId("dock-section-legs")).toHaveTextContent("LEGS");
    expect(screen.getByTestId("options-payoff-placeholder")).toHaveTextContent("PAYOFF");
  });

  test("the sections are siblings separated by a top hairline, and none is a nested card", async () => {
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("dock-section-strategy")).toBeInTheDocument());

    const sections = [
      screen.getByTestId("options-chain-section"),
      screen.getByTestId("options-strategy-row"),
      screen.getByTestId("options-legs"),
      screen.getByTestId("options-payoff-placeholder"),
    ];
    for (const section of sections) {
      expect(section).toHaveAttribute("data-dock-section");
      // One border per section: no rounded card chrome inside the column.
      expect(section.className).not.toContain("rounded");
    }
    // The chain opens the body (the summary strip already draws its own rule),
    // so only the three below it add a separator.
    expect(sections[0].className).not.toContain("border-t");
    for (const section of sections.slice(1)) {
      expect(section.className).toContain("border-t");
      expect(section.className).toContain("border-fin-border");
    }
    // Rendered in order, one after another in the same parent.
    const parent = sections[0].parentElement!;
    const order = Array.from(parent.querySelectorAll("[data-dock-section]"));
    expect(order).toEqual(sections);
  });

  test("sizes the chain section by flex fill with a shrink floor and scroll container", async () => {
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-chain-table")).toBeInTheDocument());

    const chainSection = screen.getByTestId("options-chain-section");
    // The chain fills the remaining column height so its table scrolls instead
    // of pushing STRATEGY/LEGS/PAYOFF past the viewport. A percentage cap
    // (`max-h-[calc(100%-...)]`) resolves against an auto-height parent and no-ops.
    expect(chainSection.className).not.toContain("max-h-[calc");
    // A short viewport keeps a floor so the table never collapses to nothing.
    expect(chainSection.className).toContain("min-h-[160px]");
    // fill still supplies flex-1 + min-h-0, which lets the table shrink and scroll.
    expect(chainSection.className).toContain("min-h-0");
    expect(chainSection.className).toContain("flex-1");

    // The table and its scroll container are still mounted.
    expect(screen.getByTestId("options-chain-table")).toBeInTheDocument();
    const table = screen.getByTestId("options-chain");
    expect(table).toBeInTheDocument();
    const scroller = table.closest(".paper-tanstack-scroll") as HTMLElement | null;
    expect(scroller).not.toBeNull();
    expect(scroller!.style.overflow).toBe("auto");
  });

  test("keeps payoff as a sibling after strategy and legs with four legs", async () => {
    open("NIFTY");
    await flush();
    for (const [side, type, strike, premium] of [
      ["sell", "CE", 24200, 36.6],
      ["buy", "CE", 24500, 3.5],
      ["sell", "PE", 23800, 23.1],
      ["buy", "PE", 23500, 1.8],
    ] as const) {
      addLeg({ side, type, strike, premium });
    }
    renderPanel();

    await waitFor(() => expect(screen.getByTestId("options-pop")).toBeInTheDocument());

    const parent = screen.getByTestId("options-chain-section").parentElement!;
    const directChild = (el: HTMLElement): HTMLElement => {
      let node = el;
      while (node.parentElement && node.parentElement !== parent) node = node.parentElement;
      return node;
    };
    const strategy = directChild(screen.getByTestId("options-strategy-row"));
    const legs = directChild(screen.getByTestId("options-legs"));
    const payoff = directChild(screen.getByTestId("options-pop"));

    // All four bands stay siblings in the same body, in visual order.
    const chain = screen.getByTestId("options-chain-section");
    const children = Array.from(parent.children);
    expect(children.indexOf(strategy)).toBeGreaterThan(children.indexOf(chain));
    expect(children.indexOf(legs)).toBeGreaterThan(children.indexOf(strategy));
    expect(children.indexOf(payoff)).toBeGreaterThan(children.indexOf(legs));
    // The payoff's fixed height is untouched by the chain cap.
    expect(payoff.style.height).toBe("206px");
  });

  test("the payoff band leads with the five-tab strip and keeps every payoff testid", async () => {
    open("NIFTY");
    await flush();
    addLeg({ side: "buy", type: "CE", strike: 24100, premium: 67.7 });
    renderPanel();

    await waitFor(() => expect(screen.getByTestId("analytics-tab-strip")).toBeInTheDocument());
    expect(screen.getAllByRole("tab")).toHaveLength(5);
    expect(screen.getByTestId("analytics-tab-payoff")).toHaveAttribute("aria-selected", "true");

    // The tab strip is the band's only 22px header: the embedded payoff panel
    // must not add a second one (and its hairline) on top of it.
    const band = screen.getByTestId("options-analytics-band");
    const headers = band.querySelectorAll('[data-testid^="dock-section-"]');
    expect(headers).toHaveLength(1);
    expect(headers[0]).toBe(screen.getByTestId("dock-section-analytics"));
    expect(screen.queryByTestId("dock-section-payoff")).not.toBeInTheDocument();

    expect(screen.getByTestId("options-payoff")).toBeInTheDocument();
    expect(screen.getByTestId("options-pop")).toBeInTheDocument();
    expect(screen.getByTestId("options-breakevens")).toBeInTheDocument();
    expect(screen.getByTestId("options-payoff-footer")).toBeInTheDocument();
  });

  test("opening, switching expiry and editing legs trigger no analytics request", async () => {
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-chain-table")).toBeInTheDocument());
    expect(fetchAnalytics).not.toHaveBeenCalled();

    setExpiry("2026-04-02");
    await flush();
    await fireEvent.click(screen.getByTestId("options-ce-24100"));
    await waitFor(() => expect(screen.getByTestId("analytics-tab-strip")).toBeInTheDocument());
    expect(fetchAnalytics).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByTestId("analytics-tab-smile"));
    await waitFor(() => expect(fetchAnalytics).toHaveBeenCalledTimes(1));
  });

  test("closing the dock aborts analytics while keeping the cache", async () => {
    open("NIFTY");
    await flush();
    addLeg({ side: "buy", type: "CE", strike: 24100, premium: 67.7 });
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("analytics-tab-strip")).toBeInTheDocument());

    await fireEvent.click(screen.getByTestId("analytics-tab-term"));
    await waitFor(() => expect(optionsAnalyticsState.status).toBe("ready"));
    expect(__analyticsCache.get("NIFTY")).toBeDefined();

    await fireEvent.click(screen.getByTestId("options-close"));
    expect(fetchAnalytics).toHaveBeenCalledTimes(1);
    expect(__analyticsCache.get("NIFTY")).toBeDefined();
  });

  test("the analytics shell shows persistent context and switches expiry in place", async () => {
    open("NIFTY");
    await flush();
    addLeg({ side: "buy", type: "CE", strike: 24100, premium: 67.7 });
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("analytics-tab-strip")).toBeInTheDocument());

    expect(screen.getByTestId("analytics-context")).toHaveTextContent(
      "NIFTY · 26 MAR · 2d · spot ₹24,031.5 · IV 13.8%",
    );
    expect(screen.getByTestId("analytics-expiry-2026-03-26")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // The band keeps its fixed height: the shell scrolls its chips, never wraps.
    const band = screen.getByTestId("options-analytics-band").parentElement!;
    expect(band.style.height).toBe("206px");

    await fireEvent.click(screen.getByTestId("analytics-expiry-2026-04-02"));
    expect(optionsDockState.expiry).toBe("2026-04-02");
    await waitFor(() =>
      expect(screen.getByTestId("analytics-expiry-2026-04-02")).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
  });

  test("sizes the chart tabs taller than PAYOFF so the smile chrome fits", async () => {
    open("NIFTY");
    await flush();
    addLeg({ side: "buy", type: "CE", strike: 24100, premium: 67.7 });
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("analytics-tab-strip")).toBeInTheDocument());

    const band = () => screen.getByTestId("options-analytics-band").parentElement!;
    expect(band().style.height).toBe(PAYOFF_BAND_HEIGHT);

    // Smile chrome is 58px and the plot needs its own room, so the chart tabs
    // take a taller band. happy-dom's CSS parser drops `clamp()`, so the branch
    // is asserted through the pure helper; the DOM carries the px payoff value.
    expect(CHART_BAND_HEIGHT).toBe("clamp(320px, 42vh, 400px)");
    expect(bandHeight("payoff")).toBe(PAYOFF_BAND_HEIGHT);
    for (const tab of ["smile", "term", "surface", "prob"] as const) {
      expect(bandHeight(tab)).toBe(CHART_BAND_HEIGHT);
      await fireEvent.click(screen.getByTestId(`analytics-tab-${tab}`));
      expect(band()).toBeInTheDocument();
    }

    await fireEvent.click(screen.getByTestId("analytics-tab-payoff"));
    expect(band().style.height).toBe(PAYOFF_BAND_HEIGHT);
  });

  test("maximized chart tabs drop the fixed band height and fill the dock", async () => {
    open("NIFTY");
    await flush();
    addLeg({ side: "buy", type: "CE", strike: 24100, premium: 67.7 });
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("analytics-tab-strip")).toBeInTheDocument());

    await fireEvent.click(screen.getByTestId("analytics-tab-smile"));
    await fireEvent.click(screen.getByTestId("options-maximize"));

    const band = screen.getByTestId("options-analytics-band").parentElement!;
    expect(band.style.height).toBe("");
    expect(band.className).toContain("flex-1");
  });
});

describe("OptionsDockPanel — analytics refresh", () => {
  const revealBand = async () => {
    open("NIFTY");
    await flush();
    addLeg({ side: "buy", type: "CE", strike: 24100, premium: 67.7 });
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("analytics-tab-strip")).toBeInTheDocument());
  };

  test("the analytics band renders a refresh control", async () => {
    await revealBand();
    const button = screen.getByTestId("analytics-refresh");
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("aria-label", "Refresh analytics");
  });

  test("clicking refresh calls refreshAnalytics exactly once", async () => {
    await revealBand();
    await fireEvent.click(screen.getByTestId("analytics-refresh"));
    expect(refreshAnalyticsSpy).toHaveBeenCalledTimes(1);
  });

  test("refreshing subscribes to the store and disables the control", async () => {
    await revealBand();
    const button = screen.getByTestId("analytics-refresh");
    expect(button).toBeEnabled();

    setOptionsAnalyticsState("refreshing", true);
    expect(button).toBeDisabled();

    setOptionsAnalyticsState("refreshing", false);
    expect(button).toBeEnabled();
  });
});

describe("OptionsDockPanel — narrow one-sided chain", () => {
  test("shows a CE-defaulted side control below sm with only the CE columns", async () => {
    narrowViewport();
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-chain-table")).toBeInTheDocument());

    expect(screen.getByRole("group", { name: "Option chain side" })).toBeInTheDocument();
    const ce = screen.getByTestId("options-chain-side-ce");
    const pe = screen.getByTestId("options-chain-side-pe");
    expect(ce).toHaveAttribute("aria-pressed", "true");
    expect(pe).toHaveAttribute("aria-pressed", "false");

    expect(columnIdsOf()).toEqual(["ce_oi", "ce_iv", "ce_delta", "ce_ltp", "strike"]);
    expect(screen.getByTestId("options-ce-24000")).toBeInTheDocument();
    expect(screen.queryByTestId("options-pe-24000")).not.toBeInTheDocument();
    expect(screen.getByTestId("options-atm-marker-24000")).toBeInTheDocument();
    expect((screen.getByTestId("options-chain") as HTMLElement).style.minWidth).toBe("262px");
  });

  test("switching to PE swaps the columns but keeps the strike/ATM row and selected legs", async () => {
    narrowViewport();
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-chain-side-pe")).toBeInTheDocument());

    await fireEvent.click(screen.getByTestId("options-ce-24000"));
    expect(optionsDockState.legs).toHaveLength(1);

    await fireEvent.click(screen.getByTestId("options-chain-side-pe"));

    expect(screen.getByTestId("options-chain-side-ce")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("options-chain-side-pe")).toHaveAttribute("aria-pressed", "true");
    expect(columnIdsOf()).toEqual(["strike", "pe_ltp", "pe_delta", "pe_iv", "pe_oi"]);
    expect(screen.getByTestId("options-pe-24000")).toBeInTheDocument();
    expect(screen.queryByTestId("options-ce-24000")).not.toBeInTheDocument();
    expect(screen.getByTestId("options-chain-row-24000")).toBeInTheDocument();
    expect(screen.getByTestId("options-atm-marker-24000")).toBeInTheDocument();
    // The leg picked before the switch is untouched.
    expect(optionsDockState.legs).toHaveLength(1);
    expect(optionsDockState.legs[0]).toMatchObject({ type: "CE", strike: 24000 });
  });

  test("hides the control and keeps all nine columns at ≥640px", async () => {
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-chain-table")).toBeInTheDocument());

    expect(screen.queryByTestId("options-chain-side-ce")).not.toBeInTheDocument();
    expect(screen.queryByTestId("options-chain-side-pe")).not.toBeInTheDocument();
    expect(columnIdsOf()).toHaveLength(9);
    expect((screen.getByTestId("options-chain") as HTMLElement).style.minWidth).toBe("452px");
    expect(screen.getByTestId("options-ce-24000")).toBeInTheDocument();
    expect(screen.getByTestId("options-pe-24000")).toBeInTheDocument();
  });
});

describe("OptionsDockPanel — chain sort reset", () => {
  const rowOrder = () =>
    Array.from(document.querySelectorAll('[data-testid^="options-chain-row-"]')).map((el) =>
      el.getAttribute("data-testid"),
    );

  const oiHeader = () =>
    screen.getAllByRole("columnheader").find((h) => h.id === "paper-tanstack-header-ce_oi")!;

  test("starts in strike order with no reset control", async () => {
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-chain-table")).toBeInTheDocument());

    expect(rowOrder()).toEqual([
      "options-chain-row-23900",
      "options-chain-row-24000",
      "options-chain-row-24100",
    ]);
    expect(screen.queryByTestId("options-chain-reset-sort")).not.toBeInTheDocument();
  });

  test("clicking a metric header reorders the ladder, reset restores strike order", async () => {
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-chain-table")).toBeInTheDocument());

    fireEvent.click(oiHeader());
    // CE OI: 24,100 (12.4M) > 24,000 (8.6M) > 23,900 (5.2M).
    expect(rowOrder()).toEqual([
      "options-chain-row-24100",
      "options-chain-row-24000",
      "options-chain-row-23900",
    ]);

    const reset = screen.getByTestId("options-chain-reset-sort");
    expect(reset).toHaveAttribute("aria-label", "Reset to strike order");
    await fireEvent.click(reset);

    expect(screen.queryByTestId("options-chain-reset-sort")).not.toBeInTheDocument();
    expect(rowOrder()).toEqual([
      "options-chain-row-23900",
      "options-chain-row-24000",
      "options-chain-row-24100",
    ]);
  });

  test("the strike column header still cycles the sort under control", async () => {
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-chain-table")).toBeInTheDocument());

    const strike = screen.getAllByRole("columnheader").find((h) => h.id.endsWith("strike"))!;
    expect(strike).toHaveAttribute("aria-sort", "ascending");
    // First click leaves strike order (numeric columns clear on the first click);
    // the reset must surface, proving the click reached the controlled signal.
    fireEvent.click(strike);
    expect(strike).toHaveAttribute("aria-sort", "none");
    expect(screen.getByTestId("options-chain-reset-sort")).toBeInTheDocument();

    await fireEvent.click(screen.getByTestId("options-chain-reset-sort"));
    expect(strike).toHaveAttribute("aria-sort", "ascending");
    expect(screen.queryByTestId("options-chain-reset-sort")).not.toBeInTheDocument();
  });

  test("reset keeps selected legs and the ATM row intact", async () => {
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-ce-24000")).toBeInTheDocument());

    await fireEvent.click(screen.getByTestId("options-ce-24000"));
    expect(optionsDockState.legs).toHaveLength(1);

    fireEvent.click(oiHeader());
    await fireEvent.click(screen.getByTestId("options-chain-reset-sort"));

    expect(optionsDockState.legs).toHaveLength(1);
    expect(optionsDockState.legs[0]).toMatchObject({ type: "CE", strike: 24000 });
    expect(screen.getByTestId("options-chain-row-24000")).toHaveAttribute("data-atm", "true");
    expect(screen.getByTestId("options-atm-marker-24000")).toBeInTheDocument();
  });

  test("narrow layout keeps the reset reachable, icon-only, and never wraps the header", async () => {
    narrowViewport();
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-chain-table")).toBeInTheDocument());

    fireEvent.click(oiHeader());
    const reset = screen.getByTestId("options-chain-reset-sort");
    expect(reset).toHaveAttribute("aria-label", "Reset to strike order");
    // The label text collapses below sm; the icon button stays tappable.
    const label = reset.querySelector("span")!;
    expect(label).toHaveTextContent("Strike");
    expect(label.className).toContain("hidden");
    expect(label.className).toContain("sm:inline");

    // DockSection's header stays a single non-wrapping row; the reset shrinks to
    // an icon rather than forcing a second line at 390px.
    const header = screen.getByTestId("dock-section-chain");
    expect(header.className).not.toContain("flex-wrap");
    expect(reset.className).toContain("shrink-0");
    expect(reset.className).not.toContain("w-full");

    await fireEvent.click(reset);
    expect(screen.queryByTestId("options-chain-reset-sort")).not.toBeInTheDocument();
    expect(rowOrder()[0]).toBe("options-chain-row-23900");
  });
});

describe("OptionsDockPanel — maximize a11y", () => {
  const renderWithChain = async () => {
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-chain-table")).toBeInTheDocument());
  };

  test("maximize locks body scroll, sets aria-modal and focuses the restore button", async () => {
    await renderWithChain();

    await fireEvent.click(screen.getByTestId("options-maximize"));

    expect(document.body.style.overflow).toBe("hidden");
    expect(screen.getByTestId("options-dock")).toHaveAttribute("aria-modal", "true");
    expect(document.activeElement).toBe(screen.getByTestId("options-maximize"));
  });

  test("restore unlocks body scroll, removes aria-modal and restores focus", async () => {
    await renderWithChain();

    const refresh = screen.getByTestId("options-refresh");
    refresh.focus();
    expect(document.activeElement).toBe(refresh);

    await fireEvent.click(screen.getByTestId("options-maximize"));
    expect(document.body.style.overflow).toBe("hidden");
    expect(screen.getByTestId("options-dock")).toHaveAttribute("aria-modal", "true");

    await fireEvent.click(screen.getByTestId("options-maximize")); // restore

    expect(document.body.style.overflow).not.toBe("hidden");
    expect(screen.getByTestId("options-dock")).not.toHaveAttribute("aria-modal");
    expect(document.activeElement).toBe(refresh);
  });

  test("close unlocks body scroll and removes aria-modal", async () => {
    await renderWithChain();

    await fireEvent.click(screen.getByTestId("options-maximize"));
    expect(document.body.style.overflow).toBe("hidden");

    await fireEvent.click(screen.getByTestId("options-close"));

    expect(document.body.style.overflow).not.toBe("hidden");
    expect(screen.getByTestId("options-dock")).not.toHaveAttribute("aria-modal");
  });

  test("unmount while maximized restores body scroll", async () => {
    await renderWithChain();

    await fireEvent.click(screen.getByTestId("options-maximize"));
    expect(document.body.style.overflow).toBe("hidden");

    cleanup();

    expect(document.body.style.overflow).not.toBe("hidden");
  });
});

describe("OptionsDockPanel — spot tone", () => {
  test("paints the spot change with theme tokens, not palette hexes", async () => {
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-dock-change")).toBeInTheDocument());

    const change = screen.getByTestId("options-dock-change") as HTMLElement;
    // A hex here is illegible in light mode (3.10:1); the token flips with theme.
    expect(change.style.color).toContain("var(--color-fin-positive)");
    expect(change.style.color).not.toMatch(/#[0-9a-f]{6}/i);
  });
});

describe("OptionsDockPanel — rate-limit countdown", () => {
  test("the banner countdown decreases by four seconds", async () => {
    vi.useFakeTimers();
    try {
      open("NIFTY");
      renderPanel();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);
      expect(screen.getByTestId("options-chain-table")).toBeInTheDocument();

      setOptionsDockState("paused", {
        retryAfterMs: 8000,
        retryAt: Date.now() + 8000,
        reason: "rate_limited",
      });
      setOptionsDockState("error", { kind: "rate_limited", message: "slow down" });
      await vi.advanceTimersByTimeAsync(0);

      expect(screen.getByTestId("options-dock-error")).toHaveTextContent("retry in 8 s");

      await vi.advanceTimersByTimeAsync(4000);
      expect(screen.getByTestId("options-dock-error")).toHaveTextContent("retry in 4 s");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("OptionsDockPanel — Escape ownership", () => {
  const renderWithClose = (onClose: () => void) =>
    render(() => (
      <UIProvider>
        <OptionsDockPanel onClose={onClose} />
      </UIProvider>
    ));

  test("Escape inside a form control does not close the dock", async () => {
    const onClose = vi.fn();
    open("NIFTY");
    renderWithClose(onClose);
    await waitFor(() => expect(screen.getByTestId("options-expiry-select")).toBeInTheDocument());

    const select = screen.getByTestId("options-expiry-select");
    select.focus();
    await fireEvent.keyDown(select, { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
  });

  test("Escape on the panel itself closes the dock", async () => {
    const onClose = vi.fn();
    open("NIFTY");
    renderWithClose(onClose);
    await waitFor(() => expect(screen.getByTestId("options-dock")).toBeInTheDocument());

    await fireEvent.keyDown(screen.getByTestId("options-dock"), { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("Escape on the panel restores from maximize before closing", async () => {
    const onClose = vi.fn();
    open("NIFTY");
    renderWithClose(onClose);
    await waitFor(() => expect(screen.getByTestId("options-maximize")).toBeInTheDocument());

    await fireEvent.click(screen.getByTestId("options-maximize"));
    expect(screen.getByTestId("options-dock")).toHaveAttribute("aria-modal", "true");

    await fireEvent.keyDown(screen.getByTestId("options-dock"), { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("options-dock")).not.toHaveAttribute("aria-modal");
  });
});

describe("OptionsDockPanel — center on ATM", () => {
  test("the Center button re-enables follow after a manual scroll", async () => {
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-chain-table")).toBeInTheDocument());

    const center = screen.getByTestId("options-chain-center");
    expect(center).toHaveAttribute("aria-label", "Center on at-the-money strike");
    const host = screen.getByTestId("options-chain-table");
    expect(host).toHaveAttribute("data-following", "true");

    const scroller = screen.getByTestId("options-chain").closest(".paper-tanstack-scroll")!;
    await new Promise((resolve) => setTimeout(resolve, CHAIN_SCROLL_SETTLE_MS + 40));
    await fireEvent.scroll(scroller);
    expect(host).toHaveAttribute("data-following", "false");

    await fireEvent.click(center);
    await waitFor(() => expect(host).toHaveAttribute("data-following", "true"));
  });

  test("stays reachable in the narrow one-sided header", async () => {
    narrowViewport();
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-chain-center")).toBeInTheDocument());

    expect(screen.getByTestId("options-chain-center")).toHaveAttribute(
      "aria-label",
      "Center on at-the-money strike",
    );
    const header = screen.getByTestId("dock-section-chain");
    expect(header.className).not.toContain("flex-wrap");
  });
});

describe("OptionsDockPanel — in-dock pillars", () => {
  // The pillars chunk pulls ECharts and four panel modules: a cold import costs
  // ~2.8s here, well past waitFor's 1s default.
  const PILLARS_WAIT = { timeout: 5_000 };

  const renderWithLeg = async () => {
    open("NIFTY");
    await flush();
    addLeg({ side: "buy", type: "CE", strike: 24100, premium: 67.7 });
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-chain-table")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("analytics-pillars-open")).toBeInTheDocument());
  };

  test("the pillars button renders the four pillars in the dock and never navigates", async () => {
    const hrefBefore = window.location.href;
    await renderWithLeg();

    await fireEvent.click(screen.getByTestId("analytics-pillars-open"));
    await waitFor(() => expect(screen.getByTestId("pillar-volatility")).toBeInTheDocument(), PILLARS_WAIT);

    // No route hop: the dock stays the surface.
    expect(window.location.href).toBe(hrefBefore);
    expect(screen.queryByTestId("analytics-dashboard-link")).not.toBeInTheDocument();

    for (const key of ["volatility", "positioning", "dealer", "liquidity"]) {
      expect(screen.getByTestId(`dock-pillar-tab-${key}`)).toBeInTheDocument();
    }

    // Chain / strategy / legs / payoff make room for the charts.
    expect(screen.queryByTestId("options-chain-section")).not.toBeInTheDocument();
    expect(screen.queryByTestId("options-strategy")).not.toBeInTheDocument();
    expect(screen.queryByTestId("options-leg-count")).not.toBeInTheDocument();
    expect(screen.queryByTestId("options-analytics-band")).not.toBeInTheDocument();

    // Opened for chart room: the dock auto-maximizes.
    expect(screen.getByTestId("options-dock").className).toContain("fixed inset-0");
  });

  test("one dashboard read per open, zero when reopened from the cache", async () => {
    await renderWithLeg();

    await fireEvent.click(screen.getByTestId("analytics-pillars-open"));
    await waitFor(() => expect(screen.getByTestId("pillar-volatility")).toBeInTheDocument(), PILLARS_WAIT);
    expect(fetchDashboard).toHaveBeenCalledTimes(1);

    await fireEvent.click(screen.getByTestId("dock-pillars-back"));
    await waitFor(() => expect(screen.getByTestId("options-chain-table")).toBeInTheDocument());

    await fireEvent.click(screen.getByTestId("analytics-pillars-open"));
    await waitFor(() => expect(screen.getByTestId("pillar-volatility")).toBeInTheDocument(), PILLARS_WAIT);
    // The store's LRU already holds NIFTY: the second open is free.
    expect(fetchDashboard).toHaveBeenCalledTimes(1);
  });

  test("Back returns to the chain and restores the dock size", async () => {
    await renderWithLeg();

    await fireEvent.click(screen.getByTestId("analytics-pillars-open"));
    await waitFor(() => expect(screen.getByTestId("dock-pillars-back")).toBeInTheDocument(), PILLARS_WAIT);

    await fireEvent.click(screen.getByTestId("dock-pillars-back"));

    await waitFor(() => expect(screen.getByTestId("options-chain-table")).toBeInTheDocument());
    expect(screen.queryByTestId("dock-pillars")).not.toBeInTheDocument();
    const root = screen.getByTestId("options-dock");
    expect(root.className).toContain("overflow-y-auto");
    expect(root.className).not.toContain("fixed inset-0");
  });

  test("the strip and the four pillars are reachable with zero legs", async () => {
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-payoff-placeholder")).toBeInTheDocument());

    // The placeholder keeps its testid and caption; the strip sits above it, so
    // market analytics do not require a position.
    const placeholder = screen.getByTestId("options-payoff-placeholder");
    const strip = screen.getByTestId("analytics-tab-strip");
    expect(placeholder.contains(strip)).toBe(true);
    expect(placeholder).toHaveTextContent("add a leg to see the payoff");
    expect(screen.getByTestId("analytics-tab-payoff")).toHaveAttribute("aria-selected", "true");

    // A chain-only tab needs no leg…
    await fireEvent.click(screen.getByTestId("analytics-tab-smile"));
    await waitFor(() => expect(screen.getByTestId("smile-chart")).toBeInTheDocument());

    // …and the pillars open from the same strip with zero legs.
    await fireEvent.click(screen.getByTestId("analytics-pillars-open"));
    await waitFor(() => expect(screen.getByTestId("pillar-volatility")).toBeInTheDocument(), PILLARS_WAIT);
  });

  test("the header maximize toggle is disabled while the pillars are open", async () => {
    await renderWithLeg();
    await fireEvent.click(screen.getByTestId("analytics-pillars-open"));
    await waitFor(() => expect(screen.getByTestId("dock-pillars-back")).toBeInTheDocument(), PILLARS_WAIT);

    const toggle = screen.getByTestId("options-maximize");
    expect(toggle).toBeDisabled();

    // Even a forced activation cannot shrink the charts out from under them.
    await fireEvent.click(toggle);
    expect(screen.getByTestId("options-dock").className).toContain("fixed inset-0");
  });

  test("Back returns focus to the strip button that opened the pillars", async () => {
    await renderWithLeg();
    const opener = screen.getByTestId("analytics-pillars-open");
    opener.focus();
    expect(document.activeElement).toBe(opener);

    await fireEvent.click(opener);
    await waitFor(() => expect(screen.getByTestId("dock-pillars-back")).toBeInTheDocument(), PILLARS_WAIT);

    await fireEvent.click(screen.getByTestId("dock-pillars-back"));
    await waitFor(() => expect(screen.getByTestId("options-chain-table")).toBeInTheDocument());
    // Not `<body>`: the button that opened the view owns focus again.
    expect(document.activeElement).toBe(screen.getByTestId("analytics-pillars-open"));
  });

  test("the maximized dock is a labelled dialog that locks both scrollers", async () => {
    const main = document.createElement("div");
    main.id = "app-main";
    document.body.appendChild(main);

    try {
      open("NIFTY");
      renderPanel();
      await waitFor(() => expect(screen.getByTestId("options-chain-table")).toBeInTheDocument());

      await fireEvent.click(screen.getByTestId("options-maximize"));
      const root = screen.getByTestId("options-dock");
      expect(root).toHaveAttribute("role", "dialog");
      expect(root).toHaveAttribute("aria-label", "Options dock");
      expect(root).toHaveAttribute("aria-modal", "true");
      // `<body>` alone is not the page scroller.
      expect(document.body.style.overflow).toBe("hidden");
      expect(main.style.overflow).toBe("hidden");

      await fireEvent.click(screen.getByTestId("options-maximize"));
      expect(root).not.toHaveAttribute("role", "dialog");
      expect(root).not.toHaveAttribute("aria-modal");
      expect(document.body.style.overflow).not.toBe("hidden");
      expect(main.style.overflow).not.toBe("hidden");
    } finally {
      main.remove();
    }
  });

  test("no chain fetch fires while the pillars are open, and Back only re-arms", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      (window as any).__E2E_MOCK_MARKET_OPEN__ = true;
      open("NIFTY");
      renderPanel();
      await waitFor(() => expect(screen.getByTestId("options-chain-table")).toBeInTheDocument());

      const before = fetchChain.mock.calls.length;
      await fireEvent.click(screen.getByTestId("analytics-pillars-open"));
      await waitFor(() => expect(screen.getByTestId("dock-pillars-back")).toBeInTheDocument(), PILLARS_WAIT);

      // Six cadences' worth of time with the chain off screen.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fetchChain.mock.calls.length).toBe(before);

      // Back costs nothing: the last frame is already the truth on screen, and
      // the timer is the next thing that reads the chain.
      await fireEvent.click(screen.getByTestId("dock-pillars-back"));
      await waitFor(() => expect(screen.getByTestId("options-chain-table")).toBeInTheDocument());
      expect(fetchChain.mock.calls.length).toBe(before);

      await vi.advanceTimersByTimeAsync(10_000);
      await waitFor(() => expect(fetchChain.mock.calls.length).toBe(before + 1));
    } finally {
      vi.useRealTimers();
    }
  });

  test("an expiry picked in the pillars is the one the chain lands on", async () => {
    // The dock's listing owns 26 MAR / 02 APR; make the dashboard payload list
    // the same contracts so the controlled expiry is a real choice.
    fetchDashboard.mockImplementation(async (symbol: string) => {
      const base = fullFixture();
      return {
        ...base,
        symbol: String(symbol ?? "NIFTY").toUpperCase(),
        expiries: base.expiries.map((entry, index) => ({
          ...entry,
          date: index === 0 ? "2026-03-26" : "2026-04-02",
        })),
      };
    });

    await renderWithLeg();
    await fireEvent.click(screen.getByTestId("analytics-pillars-open"));
    await waitFor(() => expect(screen.getByTestId("pillar-volatility")).toBeInTheDocument(), PILLARS_WAIT);

    // The far contract is picked inside the pillars.
    await fireEvent.click(screen.getByTestId("dock-pillars-expiry-2026-04-02"));
    expect(optionsDockState.expiry).toBe("2026-04-02");

    await fireEvent.click(screen.getByTestId("dock-pillars-back"));
    await waitFor(() => expect(screen.getByTestId("options-expiry-select")).toBeInTheDocument());
    expect(screen.getByTestId("options-expiry-select")).toHaveValue("2026-04-02");

    // Re-entering keeps the same contract selected instead of resetting to front.
    await fireEvent.click(screen.getByTestId("analytics-pillars-open"));
    await waitFor(
      () => expect(screen.getByTestId("dock-pillars-expiry-2026-04-02")).toBeInTheDocument(),
      PILLARS_WAIT,
    );
    expect(screen.getByTestId("dock-pillars-expiry-2026-04-02")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("dock-pillars-expiry-2026-03-26")).toHaveAttribute("aria-pressed", "false");
  });
});

describe("OptionsDockPanel — per-contract chart", () => {
  const renderWithChain = async () => {
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-chain-table")).toBeInTheDocument());
  };

  const openChart = async (testId = "options-ce-24000-chart") => {
    await renderWithChain();
    await fireEvent.click(screen.getByTestId(testId));
    await waitFor(() => expect(screen.getByTestId("options-contract-chart")).toBeInTheDocument());
  };

  const rowOrder = () =>
    Array.from(document.querySelectorAll('[data-testid^="options-chain-row-"]')).map((el) =>
      el.getAttribute("data-testid"),
    );

  test("a chart click covers the chain and hands the contract to the panel", async () => {
    await openChart();

    // The chain stays mounted (its scroll survives) but is off screen.
    expect((screen.getByTestId("options-dock-body") as HTMLElement).style.display).toBe("none");
    const stub = screen.getByTestId("contract-chart-stub");
    expect(stub).toHaveAttribute("data-strike", "24000");
    expect(stub).toHaveAttribute("data-side", "CE");
    // Opened for chart room, and no leg was added on the way in.
    expect(screen.getByTestId("options-dock").className).toContain("fixed inset-0");
    expect(optionsDockState.legs).toHaveLength(0);
  });

  test("Back restores the chain scroll offset", async () => {
    await renderWithChain();
    const scroller = screen.getByTestId("options-chain").closest(".paper-tanstack-scroll") as HTMLElement;
    scroller.scrollTop = 120;

    await fireEvent.click(screen.getByTestId("options-ce-24000-chart"));
    await waitFor(() => expect(screen.getByTestId("contract-chart-stub")).toBeInTheDocument());
    await fireEvent.click(screen.getByTestId("contract-chart-back"));
    await waitFor(() => expect(screen.getByTestId("options-chain-table")).toBeInTheDocument());

    expect(scroller.scrollTop).toBe(120);
  });

  test("Back restores the chain with the expiry, legs and sort untouched", async () => {
    await renderWithChain();
    await fireEvent.click(screen.getByTestId("options-ce-24100"));
    const oiHeader = screen
      .getAllByRole("columnheader")
      .find((h) => h.id === "paper-tanstack-header-ce_oi")!;
    fireEvent.click(oiHeader);
    await waitFor(() => expect(rowOrder()[0]).toBe("options-chain-row-24100"));

    setExpiry("2026-04-02");
    await waitFor(() => expect(screen.getByTestId("options-chain-table")).toBeInTheDocument());
    await waitFor(() => expect(rowOrder()[0]).toBe("options-chain-row-24100"));

    await fireEvent.click(screen.getByTestId("options-pe-24000-chart"));
    await waitFor(() => expect(screen.getByTestId("contract-chart-stub")).toBeInTheDocument());

    await fireEvent.click(screen.getByTestId("contract-chart-back"));
    await waitFor(() => expect(screen.getByTestId("options-chain-table")).toBeInTheDocument());
    expect((screen.getByTestId("options-dock-body") as HTMLElement).style.display).not.toBe("none");

    expect(optionsDockState.expiry).toBe("2026-04-02");
    expect(optionsDockState.legs).toHaveLength(1);
    expect(screen.getByTestId("options-expiry-select")).toHaveValue("2026-04-02");
    // Still in the CE-OI order the user chose, not back to the strike ladder.
    expect(rowOrder()[0]).toBe("options-chain-row-24100");
    // Back to the dock size the chart inherited from.
    expect(screen.getByTestId("options-dock").className).toContain("overflow-y-auto");
  });

  test("Back returns focus to the chart button that opened it", async () => {
    await openChart();
    await fireEvent.click(screen.getByTestId("contract-chart-back"));
    await waitFor(() => expect(screen.getByTestId("options-chain-table")).toBeInTheDocument());

    expect(document.activeElement).toBe(screen.getByTestId("options-ce-24000-chart"));
  });

  test("Escape closes the chart before the dock", async () => {
    const onClose = vi.fn();
    open("NIFTY");
    render(() => (
      <UIProvider>
        <OptionsDockPanel onClose={onClose} />
      </UIProvider>
    ));
    await waitFor(() => expect(screen.getByTestId("options-ce-24000-chart")).toBeInTheDocument());
    await fireEvent.click(screen.getByTestId("options-ce-24000-chart"));
    await waitFor(() => expect(screen.getByTestId("contract-chart-stub")).toBeInTheDocument());

    await fireEvent.keyDown(screen.getByTestId("options-dock"), { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByTestId("options-contract-chart")).not.toBeInTheDocument();
    expect(screen.getByTestId("options-chain-table")).toBeInTheDocument();

    await fireEvent.keyDown(screen.getByTestId("options-dock"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("suspends the chain poll on open and resumes it once on Back", async () => {
    await openChart();
    expect(suspendPollingSpy).toHaveBeenCalledTimes(1);
    expect(resumePollingSpy).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByTestId("contract-chart-back"));
    await waitFor(() => expect(screen.getByTestId("options-chain-table")).toBeInTheDocument());
    expect(resumePollingSpy).toHaveBeenCalledTimes(1);
  });

  test("unmounting with the chart open does not leave the chain suspended", async () => {
    await openChart();
    expect(suspendPollingSpy).toHaveBeenCalledTimes(1);

    cleanup();
    expect(resumePollingSpy).toHaveBeenCalledTimes(1);
  });

  test("narrow opens the active side's contract", async () => {
    narrowViewport();
    await renderWithChain();
    expect(screen.getByTestId("options-chain-side-ce")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("options-ce-24000-chart")).toBeInTheDocument();
    expect(screen.queryByTestId("options-pe-24000-chart")).not.toBeInTheDocument();

    await fireEvent.click(screen.getByTestId("options-chain-side-pe"));
    await fireEvent.click(screen.getByTestId("options-pe-24000-chart"));
    await waitFor(() => expect(screen.getByTestId("contract-chart-stub")).toBeInTheDocument());
    expect(screen.getByTestId("contract-chart-stub")).toHaveAttribute("data-side", "PE");
  });

  test("no chain fetch fires while the chart is open, and the poll resumes after Back", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      (window as any).__E2E_MOCK_MARKET_OPEN__ = true;
      await openChart();
      const before = fetchChain.mock.calls.length;

      await vi.advanceTimersByTimeAsync(60_000);
      expect(fetchChain.mock.calls.length).toBe(before);

      await fireEvent.click(screen.getByTestId("contract-chart-back"));
      await waitFor(() => expect(screen.getByTestId("options-chain-table")).toBeInTheDocument());
      await vi.advanceTimersByTimeAsync(10_000);
      await waitFor(() => expect(fetchChain.mock.calls.length).toBe(before + 1));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("OptionsDockPanel — type scale and spacing guard", () => {
  const FILES = [
    "OptionsDockPanel.tsx",
    "DockSection.tsx",
    "LegBuilder.tsx",
    "chain.columns.tsx",
    "OptionChainTable.tsx",
  ];
  const sourceOf = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");

  test("the dock shell, chain and legs use token type sizes only", () => {
    for (const file of FILES) {
      const src = sourceOf(file);
      expect(src, `${file} still has a private pixel class`).not.toMatch(/text-\[\d+px\]/);
      expect(src, `${file} still has a private font-size`).not.toMatch(/"font-size":\s*"\d+px"/);
    }
    for (const file of ["OptionsDockPanel.tsx", "LegBuilder.tsx", "chain.columns.tsx"]) {
      expect(sourceOf(file), `${file} is missing token type classes`).toMatch(/text-ui-micro|typeSize\(/);
    }
  });

  test("no banned 2px/6px gaps or off-scale paddings and rails remain", () => {
    const banned = [
      "gap-0.5", "gap-1", "gap-1.5", "py-1.5", "py-[1px]", "ml-0.5",
      "border-l-[3px]", "h-[26px]", 'border-radius": "4px"',
    ];
    for (const file of FILES) {
      const src = sourceOf(file);
      for (const token of banned) {
        expect(src, `${file} still has ${token}`).not.toContain(token);
      }
    }
  });

  test("inner section separators use the semantic subtle border token", () => {
    expect(sourceOf("DockSection.tsx")).toContain("border-fin-border-subtle");
  });
});

describe("OptionsDockPanel — 11px controls and 8px gaps", () => {
  test("header uses 8px control gaps, 12px padding and an 11px expiry control", async () => {
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-expiry-select")).toBeInTheDocument());

    const header = screen.getByTestId("options-dock-header");
    expect(header.className).toContain("gap-2");
    expect(header.className).toContain("px-3");
    expect(header.className).not.toContain("gap-1");

    const select = screen.getByTestId("options-expiry-select");
    expect(select.className).toContain("text-ui-micro");
    expect(select.className).toContain("rounded-fin");
  });

  test("positions chip and narrow side toggle render on the type scale with 8px gaps", async () => {
    narrowViewport();
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-chain-side-ce")).toBeInTheDocument());

    const chip = screen.getByTestId("options-positions-chip");
    expect(chip.className).toContain("text-ui-micro");
    expect(chip.className).toContain("gap-2");
    expect(chip.className).toContain("rounded-fin");

    const toggle = screen.getByTestId("options-chain-side-ce");
    expect(toggle.className).toContain("text-ui-micro");
    expect(toggle.parentElement?.className).toContain("rounded-fin");
    expect(toggle.parentElement?.className).not.toContain("border-radius");
  });

  test("empty and cold-error states use the shared EmptyState with a reserved slot", async () => {
    fetchUnderlying.mockResolvedValue(listing({ fno: false, expiries: [], defaultExpiry: null }));
    open("RELIANCE");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-dock-empty")).toBeInTheDocument());

    const empty = screen.getByTestId("options-dock-empty");
    expect(empty).toHaveAttribute("data-empty-kind", "no-data");
    expect(empty.className).toContain("flex-1");
    expect(empty.className).toContain("min-h-[160px]");
    expect(empty).toHaveTextContent("No listed options for RELIANCE");
  });
});

describe("OptionsDockPanel — local state survives a 10s chain poll", () => {
  const simulatePoll = async () => {
    fetchChain.mockImplementationOnce(async (symbol: string, expiry: string) => {
      const frame = chain(expiry);
      frame.spot = 24100;
      frame.rows[0].ce.oi = 6_000_000;
      return frame;
    });
    await refresh();
  };

  test("the strategy popover stays open across a poll", async () => {
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-strategy")).toBeInTheDocument());

    await fireEvent.click(screen.getByTestId("options-strategy"));
    expect(screen.getByTestId("options-strategy-menu")).toBeInTheDocument();

    await simulatePoll();
    expect(screen.getByTestId("options-strategy-menu")).toBeInTheDocument();
    expect(screen.getByTestId("options-strategy")).toHaveAttribute("aria-expanded", "true");
  });

  test("the analytics help popover stays open across a poll", async () => {
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("analytics-help")).toBeInTheDocument());

    await fireEvent.click(screen.getByTestId("analytics-help"));
    expect(screen.getByTestId("analytics-help-popover")).toBeInTheDocument();

    await simulatePoll();
    expect(screen.getByTestId("analytics-help-popover")).toBeInTheDocument();
  });

  test("the selected analytics tab survives a poll", async () => {
    open("NIFTY");
    await flush();
    addLeg({ side: "buy", type: "CE", strike: 24100, premium: 67.7 });
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("analytics-tab-smile")).toBeInTheDocument());

    await fireEvent.click(screen.getByTestId("analytics-tab-smile"));
    expect(screen.getByTestId("analytics-tab-smile")).toHaveAttribute("aria-selected", "true");

    await simulatePoll();
    expect(screen.getByTestId("analytics-tab-smile")).toHaveAttribute("aria-selected", "true");
  });

  test("the maximized flag survives a poll", async () => {
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-maximize")).toBeInTheDocument());

    await fireEvent.click(screen.getByTestId("options-maximize"));
    expect(screen.getByTestId("options-dock").className).toContain("fixed inset-0");

    await simulatePoll();
    expect(screen.getByTestId("options-dock").className).toContain("fixed inset-0");
  });

  test("the narrow chain side survives a poll", async () => {
    narrowViewport();
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-chain-side-pe")).toBeInTheDocument());

    await fireEvent.click(screen.getByTestId("options-chain-side-pe"));
    expect(screen.getByTestId("options-chain-side-pe")).toHaveAttribute("aria-pressed", "true");

    await simulatePoll();
    expect(screen.getByTestId("options-chain-side-pe")).toHaveAttribute("aria-pressed", "true");
  });

  test("the chosen chain sort survives a poll", async () => {
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-chain-table")).toBeInTheDocument());

    const oiHeader = () =>
      screen.getAllByRole("columnheader").find((h) => h.id === "paper-tanstack-header-ce_oi")!;
    fireEvent.click(oiHeader());
    const rowOrder = () =>
      Array.from(document.querySelectorAll('[data-testid^="options-chain-row-"]')).map((el) =>
        el.getAttribute("data-testid"),
      );
    expect(rowOrder()[0]).toBe("options-chain-row-24100");

    await simulatePoll();
    expect(rowOrder()[0]).toBe("options-chain-row-24100");
    expect(screen.getByTestId("options-chain-reset-sort")).toBeInTheDocument();
  });

  test("a poll does not remount the payoff chart or dispose its ECharts instance", async () => {
    open("NIFTY");
    await flush();
    addLeg({ side: "buy", type: "CE", strike: 24100, premium: 67.7 });
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-payoff")).toBeInTheDocument());
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());

    const payoff = screen.getByTestId("options-payoff");
    const chart = screen.getByTestId("options-payoff-chart");
    chartStub.dispose.mockClear();
    chartStub.setOption.mockClear();

    await simulatePoll();

    expect(screen.getByTestId("options-payoff")).toBe(payoff);
    expect(screen.getByTestId("options-payoff-chart")).toBe(chart);
    expect(chartStub.dispose).not.toHaveBeenCalled();
  });

  test("a poll does not remount the smile chart instance", async () => {
    open("NIFTY");
    await flush();
    addLeg({ side: "buy", type: "CE", strike: 24100, premium: 67.7 });
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("analytics-tab-smile")).toBeInTheDocument());
    await fireEvent.click(screen.getByTestId("analytics-tab-smile"));
    await waitFor(() => expect(screen.getByTestId("smile-chart")).toBeInTheDocument());
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());

    const chart = screen.getByTestId("smile-chart");
    chartStub.dispose.mockClear();

    await simulatePoll();

    expect(screen.getByTestId("smile-chart")).toBe(chart);
    expect(chartStub.dispose).not.toHaveBeenCalled();
  });

  test("the help popover survives adding a leg", async () => {
    open("NIFTY");
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("options-payoff-placeholder")).toBeInTheDocument());

    await fireEvent.click(screen.getByTestId("analytics-help"));
    expect(screen.getByTestId("analytics-help-popover")).toBeInTheDocument();

    await fireEvent.click(screen.getByTestId("options-ce-24100"));
    await waitFor(() => expect(screen.getByTestId("options-payoff")).toBeInTheDocument());

    expect(screen.getByTestId("analytics-help-popover")).toBeInTheDocument();
  });

  test("the help popover survives an analytics tab swap", async () => {
    open("NIFTY");
    await flush();
    addLeg({ side: "buy", type: "CE", strike: 24100, premium: 67.7 });
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("analytics-help")).toBeInTheDocument());

    await fireEvent.click(screen.getByTestId("analytics-help"));
    expect(screen.getByTestId("analytics-help-popover")).toBeInTheDocument();

    // The payoff strip is replaced by the lazy panel's strip on a chart tab.
    await fireEvent.click(screen.getByTestId("analytics-tab-smile"));
    await waitFor(() => expect(screen.getByTestId("analytics-smile")).toBeInTheDocument());

    expect(screen.getByTestId("analytics-help-popover")).toBeInTheDocument();
  });
});
