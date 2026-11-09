// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SimRunResult, SimStrategyResult, SimTrade } from "@/types/reportSim";
import type { NiftyOptionSide, NiftyReport } from "@/types/niftyReport";
import { fetchSimStrategies, runSim } from "@/api/reportSim";
import { SimDesk } from "./SimDesk";

vi.mock("@/api/reportSim", () => ({
  fetchSimStrategies: vi.fn(),
  runSim: vi.fn(),
}));

vi.mock("@/hooks/useECharts", () => ({
  useECharts: () => ({
    chartRef: { current: null },
    chartInstance: { current: null },
    setChartOption: vi.fn(),
  }),
}));

const mockRunSim = vi.mocked(runSim);
const mockFetchStrategies = vi.mocked(fetchSimStrategies);

const STRATEGY_ID = "sc-1";

function trade(): SimTrade {
  return {
    id: "t-1",
    strategyId: STRATEGY_ID,
    strategyName: "Long call",
    legs: [{ action: "BUY", opt: "CE", strike: 24900, lots: 1, qty: 75, entryPremium: 120 }],
    entryTime: "2026-11-09T09:35:00+05:30",
    exitTime: "2026-11-09T10:05:00+05:30",
    entrySpot: 24900,
    exitSpot: 24960,
    entryPremium: 120,
    exitPremium: 140,
    lots: 1,
    qty: 75,
    grossPnl: 1500,
    costs: 40,
    netPnl: 1460,
    points: 20,
    exitReason: "TP",
    holdMin: 30,
    priced: true,
  };
}

const EQUITY = [
  { t: "2026-11-09T09:35:00+05:30", pnl: 0 },
  { t: "2026-11-09T10:05:00+05:30", pnl: 1460 },
];

function strategyResult(): SimStrategyResult {
  return {
    id: STRATEGY_ID,
    name: "Long call",
    legs: [{ action: "BUY", opt: "CE", strike: 24900, lots: 1, qty: 75, entryPremium: 120 }],
    netDebit: 9000,
    maxProfit: 0,
    maxLoss: 9000,
    breakevens: [25020],
    marginEst: 0,
    trades: [trade()],
    open: [],
    realized: 1460,
    unrealized: 0,
    total: 1460,
    stats: { trades: 1, winRate: 100, profitFactor: 0, avgHoldMin: 30, maxDrawdown: 0 },
    equity: EQUITY,
    payoff: { spots: [24800, 24900, 25000], expiry: [-1000, 0, 1000] },
    skipped: null,
  };
}

function runResult(): SimRunResult {
  return {
    symbol: "NIFTY",
    date: "2026-11-09",
    expiry: "2026-11-12",
    dte: 3,
    asOf: "2026-11-09T10:05:00+05:30",
    spot: 24900,
    lotSize: 75,
    lotVerified: false,
    coverage: {
      frames: 120,
      first: "2026-11-09T09:15:00+05:30",
      last: "2026-11-09T10:05:00+05:30",
      gaps: 1,
    },
    strategies: [strategyResult()],
    combined: { realized: 1460, unrealized: 0, total: 1460, equity: EQUITY },
    tapeLagSec: 5,
    fillModel: "next-minute close · costs on · 0 slippage",
  };
}

function optionSide(): NiftyOptionSide {
  return {
    ltp: 100,
    close: 98,
    oi: 10_000,
    prevOi: 9_000,
    oiChange: 1_000,
    priceChange: 2,
    sentiment: "Bullish",
  };
}

function report(): NiftyReport {
  return {
    mode: "live",
    date: "2026-11-09",
    expiry: "2026-11-12",
    spot: 24900,
    ohlc: { open: 24850, high: 24980, low: 24820, close: 24900 },
    pcrOi: 1.1,
    pcrVol: 1.2,
    maxPain: 24900,
    walls: { calls: [], puts: [] },
    strikes: [
      { strike: 24850, ce: optionSide(), pe: optionSide() },
      { strike: 24900, ce: optionSide(), pe: optionSide() },
      { strike: 24950, ce: optionSide(), pe: optionSide() },
    ],
    timeline: [],
  };
}

function deskProps() {
  return {
    symbol: "NIFTY",
    mode: "live" as const,
    date: "2026-11-09",
    report: report(),
    replay: null,
    replayIndex: 0,
  };
}

async function openDesk(user: ReturnType<typeof userEvent.setup>) {
  render(<SimDesk {...deskProps()} />);
  await user.click(screen.getByTestId("sim-open"));
  await screen.findByTestId("panel-modal");
  await screen.findByTestId("sim-leg-0");
}

beforeEach(() => {
  mockRunSim.mockReset();
  mockFetchStrategies.mockReset();
  mockRunSim.mockResolvedValue(runResult());
  mockFetchStrategies.mockResolvedValue([]);
});

describe("SimDesk", () => {
  test("renders the SIM trigger with the strategy count", () => {
    render(<SimDesk {...deskProps()} />);
    expect(screen.getByTestId("sim-open")).toHaveTextContent("SIM · 1");
  });

  test("opens the desk and shows the long-call legs", async () => {
    const user = userEvent.setup();
    await openDesk(user);

    expect(screen.getByTestId("sim-leg-0-strike")).toHaveValue("ATM");
    expect(screen.getByTestId("sim-leg-0-resolved")).toHaveTextContent("24900");
    expect(screen.getByTestId("sim-context")).toHaveTextContent("LIVE");
    await waitFor(() => expect(mockRunSim).toHaveBeenCalled());
  });

  test("runs the selected strategies with costs on", async () => {
    const user = userEvent.setup();
    await openDesk(user);
    await waitFor(() => expect(mockRunSim).toHaveBeenCalledTimes(1));

    mockRunSim.mockClear();
    await user.click(screen.getByTestId("sim-run"));
    await waitFor(() => expect(mockRunSim).toHaveBeenCalledTimes(1));

    const request = mockRunSim.mock.calls[0][0];
    expect(request.symbol).toBe("NIFTY");
    expect(request.costs).toBe(true);
    expect(request.slippageTicks).toBe(0);
    expect(request.strategies).toHaveLength(1);
    expect(request.strategies[0].legs[0]).toMatchObject({
      action: "BUY",
      opt: "CE",
      strike: "ATM",
    });
  });

  test("shows the payoff and runs tabs", async () => {
    const user = userEvent.setup();
    await openDesk(user);

    await user.click(screen.getByText("PAYOFF"));
    expect(await screen.findByTestId("sim-payoff-debit")).toHaveTextContent("Net debit");
    expect(screen.getByTestId("sim-payoff-total")).toHaveTextContent("Total");

    await user.click(screen.getByText("RUNS"));
    expect(await screen.findByTestId("sim-trades-table")).toBeInTheDocument();
    expect(screen.getByText("Win rate")).toBeInTheDocument();
    expect(screen.getByText("Net")).toBeInTheDocument();
  });

  test("surfaces a failed run as an alert", async () => {
    mockRunSim.mockRejectedValue(new Error("tape unavailable"));
    const user = userEvent.setup();
    await openDesk(user);

    const alert = await screen.findByTestId("sim-error");
    expect(alert).toHaveTextContent("tape unavailable");
  });
});
