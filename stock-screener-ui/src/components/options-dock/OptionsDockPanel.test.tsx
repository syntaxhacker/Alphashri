// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";

const fetchUnderlying = vi.fn();
const fetchChain = vi.fn();

vi.mock("../../api/optionsDock", async () => {
  const actual = await vi.importActual<typeof import("../../api/optionsDock")>("../../api/optionsDock");
  return {
    ...actual,
    fetchUnderlying: (...args: unknown[]) => fetchUnderlying(...args),
    fetchChain: (...args: unknown[]) => fetchChain(...args),
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
import { OptionsDockPanel, expiryLabel } from "./OptionsDockPanel";
import { buildPayoff } from "./PayoffPanel";
import { __resetOptionsDock, addLeg, open, optionsDockState, refresh } from "../../state/optionsDock";

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
  localStorage.clear();
  (window as any).__E2E_MOCK_MARKET_OPEN__ = false;
  __resetOptionsDock();
  fetchUnderlying.mockResolvedValue(listing());
  fetchChain.mockImplementation(async (_symbol: string, expiry: string) => chain(expiry));
});

afterEach(() => {
  cleanup();
  __resetOptionsDock();
  delete (window as any).__E2E_MOCK_MARKET_OPEN__;
});

describe("expiryLabel", () => {
  test("labels a 0-DTE contract", () => {
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    expect(expiryLabel({ date: today, dteDays: 0 })).toContain("0-DTE");
  });

  test("keeps the day count for a far expiry", () => {
    expect(expiryLabel({ date: "2099-03-26", dteDays: 2 })).toBe("26 MAR · 2d");
  });
});

describe("OptionsDockPanel", () => {
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
    // ATM tint comes from the palette, never a raw hex.
    expect((atmRows[0] as HTMLElement).style.backgroundColor).toBeTruthy();
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
});
