// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import type { SimStrategyResult } from "@/types/reportSim";
import type { StrategyView } from "./simView";
import { SimPayoff } from "./SimPayoff";

const setChartOptionMock = vi.fn().mockResolvedValue(undefined);

vi.mock("../echartsSolid", () => ({
  createECharts: () => ({
    ref: () => {},
    setChartOption: setChartOptionMock,
  }),
}));

import { createECharts } from "../echartsSolid";

// Captures the same mock the factory installs; vi.mocked types it for the
// toHaveBeenCalled assertions below.
const setChartOption = vi.mocked(createECharts().setChartOption);

function strategy(): SimStrategyResult {
  return {
    id: "sc-1",
    name: "Long call",
    legs: [{ action: "BUY", opt: "CE", strike: 25000, lots: 1, qty: 65, entryPremium: 100 }],
    netDebit: 6500,
    maxProfit: 0,
    maxLoss: -6500,
    breakevens: [25100],
    marginEst: 0,
    trades: [],
    open: [],
    realized: 0,
    unrealized: 0,
    total: 0,
    stats: { trades: 0, winRate: 0, profitFactor: 0, avgHoldMin: 0, maxDrawdown: 0 },
    equity: [],
    payoff: { spots: [24900, 25000, 25100], expiry: [-6500, 0, 6500] },
  };
}

function openTrade() {
  return {
    id: "t-1",
    strategyId: "sc-1",
    strategyName: "Long call",
    legs: [],
    entryTime: "2026-11-09T09:35:00+05:30",
    exitTime: "",
    entrySpot: 25000,
    exitSpot: 25000,
    entryPremium: 100,
    exitPremium: 100,
    lots: 1,
    qty: 65,
    grossPnl: 1234,
    costs: 0,
    netPnl: 1234,
    points: 19,
    exitReason: "OPEN",
    holdMin: 25,
    priced: true,
  };
}

function view(overrides: Partial<StrategyView> = {}): StrategyView {
  return {
    equity: [{ t: "2026-11-09T10:00:00+05:30", pnl: 1234 }],
    trades: [openTrade()],
    realized: 0,
    unrealized: 1234,
    total: 1234,
    stats: { trades: 1, winRate: 0, profitFactor: 0, avgHoldMin: 0, maxDrawdown: 0 },
    ...overrides,
  };
}

function markEntryOf(
  option: { series: unknown[] },
  mark: number,
): unknown {
  const payoff = option.series.find(
    (s) => (s as { name?: string }).name === "payoff",
  ) as { markLine?: { data: unknown[] } } | undefined;
  return payoff?.markLine?.data.find(
    (entry) => (entry as { yAxis?: number }).yAxis === mark,
  );
}

describe("SimPayoff", () => {
  beforeEach(() => {
    setChartOptionMock.mockClear();
  });

  test("draws the expiry payoff chart", () => {
    render(() => <SimPayoff strategy={strategy()} view={view()} spot={25000} />);
    expect(setChartOption).toHaveBeenCalledTimes(1);

    const option = setChartOption.mock.lastCall?.[0] as {
      series: unknown[];
    } | undefined;
    const scatter = option?.series.find(
      (s) => (s as { name?: string }).name === "mark",
    ) as { data: unknown[][] } | undefined;
    expect(scatter?.data).toEqual([[25000, 1234]]);
    expect(markEntryOf(option as { series: unknown[] }, 1234)).toBeDefined();
  });

  test("redraws the mark when the playhead moves", () => {
    const [viewSig, setViewSig] = createSignal(view());
    render(() => <SimPayoff strategy={strategy()} view={viewSig()} spot={25000} />);
    expect(setChartOption).toHaveBeenCalledTimes(1);

    setViewSig(view({
      equity: [{ t: "2026-11-09T11:00:00+05:30", pnl: 2222 }],
      unrealized: 2222,
      total: 2222,
    }));
    expect(setChartOption).toHaveBeenCalledTimes(2);

    const option = setChartOption.mock.lastCall?.[0] as {
      series: unknown[];
    } | undefined;
    expect(option).toBeDefined();

    const entry = markEntryOf(option as { series: unknown[] }, 2222);
    expect(entry).toBeDefined();
    expect(
      (entry as { label: { formatter: string } }).label.formatter,
    ).toContain("11:00");

    const scatter = option?.series.find(
      (s) => (s as { name?: string }).name === "mark",
    ) as { data: unknown[][]; symbolSize?: number; z?: number } | undefined;
    expect(scatter?.data).toEqual([[25000, 2222]]);
    expect(scatter?.symbolSize).toBe(9);
    expect(scatter?.z).toBe(6);
  });

  test("shows the plan, not the entry structure, before the fill", () => {
    render(() => (
      <SimPayoff
        strategy={strategy()}
        view={view({
          equity: [{ t: "2026-11-09T09:15:00+05:30", pnl: 0 }],
          trades: [],
          realized: 0,
          unrealized: 0,
          total: 0,
        })}
        planLegs={[{ action: "SELL", opt: "CE", strike: "ATM+2", lots: 1 }]}
        entryTime="09:35"
        spot={25000}
      />
    ));

    expect(screen.getByTestId("sim-payoff-not-entered")).toBeInTheDocument();
    expect(screen.queryByTestId("sim-payoff-debit")).toBeNull();
    expect(screen.queryByTestId("sim-payoff-max-profit")).toBeNull();
    expect(screen.queryByTestId("sim-payoff-max-loss")).toBeNull();
    expect(screen.getByTestId("sim-payoff-total")).toHaveTextContent("₹0");
    expect(screen.getByText(/SELL CE ATM\+2/)).toBeInTheDocument();
    expect(setChartOption).not.toHaveBeenCalled();
  });

  test("shows the empty state until the desk runs", () => {
    render(() => <SimPayoff strategy={null} view={undefined} spot={25000} />);
    expect(screen.getByTestId("sim-payoff-empty")).toBeInTheDocument();
    expect(
      screen.getByText("Run the desk to see the expiry payoff"),
    ).toBeInTheDocument();
    expect(setChartOption).not.toHaveBeenCalled();
  });
});
