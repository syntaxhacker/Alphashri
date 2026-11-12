// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@solidjs/testing-library";
import type { SimRunResult, SimStrategyResult, SimTrade } from "@/types/reportSim";
import type { NiftyOptionSide, NiftyReport } from "@/types/niftyReport";
import { fetchSimStrategies, runSim } from "@/api/reportSim";
import { isDerivativesOpenIst } from "@/utils/marketClock";
import { For } from "solid-js";
import { SimDesk } from "./SimDesk";

vi.mock("@/utils/marketClock", () => ({
  isDerivativesOpenIst: vi.fn(() => true),
}));

vi.mock("@/api/reportSim", () => ({
  fetchSimStrategies: vi.fn(),
  runSim: vi.fn(),
}));

// TanStackTable renders @/ui Box (broken at runtime). Stub it with a plain
// table that honors dataTestId / cell renderers / getRowTestId.
vi.mock("@/components/common/TanStackTable", () => ({
  TanStackTable: (props: any) => (
    <table data-testid={props.dataTestId}>
      <thead>
        <tr>
          {props.columns.map((col: any, j: number) => (
            <th key={j}>{typeof col.header === "string" ? col.header : null}</th>
          ))}
        </tr>
      </thead>
      <For each={props.data}>
        {(row: any, i) => (
          <tr data-testid={props.getRowTestId ? props.getRowTestId(row, i()) : undefined}>
            {props.columns.map((col: any, j: number) => (
              <td key={j}>{col.cell ? col.cell({ row: { original: row, index: i() }, column: col }) : null}</td>
            ))}
          </tr>
        )}
      </For>
    </table>
  ),
}));

vi.mock("../echartsSolid", () => ({
  createECharts: () => ({
    ref: () => {},
    setChartOption: vi.fn(),
  }),
}));

const mockRunSim = vi.mocked(runSim);
const mockFetchStrategies = vi.mocked(fetchSimStrategies);
const mockMarketOpen = vi.mocked(isDerivativesOpenIst);

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

async function openDesk() {
  render(() => <SimDesk {...deskProps()} />);
  fireEvent.click(screen.getByTestId("sim-open"));
  await screen.findByTestId("panel-modal");
  await screen.findByTestId("sim-leg-0");
}

beforeEach(() => {
  mockMarketOpen.mockReturnValue(true);
  mockRunSim.mockReset();
  mockFetchStrategies.mockReset();
  mockRunSim.mockResolvedValue(runResult());
  mockFetchStrategies.mockResolvedValue([]);
});

describe("SimDesk", () => {
  test("renders the SIM trigger with the strategy count", () => {
    render(() => <SimDesk {...deskProps()} />);
    expect(screen.getByTestId("sim-open")).toHaveTextContent("SIM · 1");
  });

  test("opens the desk and shows the long-call legs", async () => {
    await openDesk();

    expect(document.querySelector('[data-variant="drawer"]')).not.toBeNull();
    expect(screen.getByTestId("sim-leg-0-strike")).toHaveValue("ATM");
    expect(screen.getByTestId("sim-leg-0-resolved")).toHaveTextContent("24900");
    expect(screen.getByTestId("sim-context")).toHaveTextContent("LIVE");
    await waitFor(() => expect(mockRunSim).toHaveBeenCalled());
  });

  test("shows the preponed-expiry warning from the run", async () => {
    mockRunSim.mockResolvedValue({
      ...runResult(),
      expiryNote: "2026-11-09 was the 0-DTE expiry; the tape recorded 2026-11-17.",
    });
    await openDesk();

    expect(await screen.findByTestId("sim-expiry-note")).toHaveTextContent(
      "0-DTE",
    );
  });

  test("forces the EOD view after the close", async () => {
    mockMarketOpen.mockReturnValue(false);
    await openDesk();

    expect(screen.getByTestId("sim-context")).toHaveTextContent("EOD");
    expect(screen.getByTestId("sim-market-closed")).toBeInTheDocument();
    expect(screen.queryByTestId("sim-live")).toBeNull();
    await waitFor(() => expect(mockRunSim).toHaveBeenCalled());
    expect(mockRunSim.mock.calls[0][0].date).toBe("2026-11-09");
  });

  test("runs the selected strategies with costs on", async () => {
    await openDesk();
    await waitFor(() => expect(mockRunSim).toHaveBeenCalledTimes(1));

    mockRunSim.mockClear();
    fireEvent.click(screen.getByTestId("sim-run"));
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

  test("shows build, payoff and runs in one view", async () => {
    await openDesk();

    expect(screen.getByTestId("sim-builder")).toBeInTheDocument();
    expect(await screen.findByTestId("sim-payoff-debit")).toHaveTextContent("Net debit");
    expect(screen.getByTestId("sim-payoff-total")).toHaveTextContent("Total");
    expect(await screen.findByTestId("sim-trades-table")).toBeInTheDocument();
    expect(screen.getByText("Win rate")).toBeInTheDocument();
    expect(screen.getByText("Net")).toBeInTheDocument();
  });

  test("surfaces a failed run as an alert", async () => {
    mockRunSim.mockRejectedValue(new Error("tape unavailable"));
    await openDesk();

    const alert = await screen.findByTestId("sim-error");
    expect(alert).toHaveTextContent("tape unavailable");
  });
});
