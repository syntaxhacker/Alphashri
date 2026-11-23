// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test } from "vitest";
import { screen, within } from "@solidjs/testing-library";
import { renderWithProviders } from "@/test-utils/renderWithProviders";
import {
  computeTradeStats,
  formatCurrencySigned,
  TradeStatsGrid,
  type TradeStatsSummaryLike,
  type TradeStatsTradeLike,
} from "./TradeStatsGrid";

const trades: TradeStatsTradeLike[] = [
  { pnl: 100, net_pnl: 90 },
  { pnl: -50, net_pnl: -60 },
  { pnl: 0, net_pnl: 0 },
];

const summary: TradeStatsSummaryLike = {
  win_rate: 66.67,
  profit_factor: 1.8,
  net_pnl: 1234,
  winners: 4,
  losers: 2,
};

function statCard(label: string) {
  const labelEl = within(screen.getByTestId("stats")).getByText(label);
  const card = labelEl.closest('[data-compact-stat=""]') as HTMLElement;
  const lines = Array.from(card.querySelectorAll("p")).map((p) => p.textContent ?? "");
  expect(lines[0]).toBe(label);
  return { card, value: lines[1] ?? "" };
}

describe("computeTradeStats", () => {
  test("derives win rate, winners, losers and net P&L from trade rows when no summary exists", () => {
    expect(computeTradeStats(trades, null)).toEqual({
      winRate: (1 / 3) * 100,
      profitFactor: 0,
      netPnl: 30,
      winners: 1,
      losers: 2,
    });
  });

  test("counts a zero-P&L trade as a loser, and an empty book as all zeroes", () => {
    expect(computeTradeStats([{ pnl: 0, net_pnl: 0 }], null)).toEqual({
      winRate: 0,
      profitFactor: 0,
      netPnl: 0,
      winners: 0,
      losers: 1,
    });
    expect(computeTradeStats([], null)).toEqual({
      winRate: 0,
      profitFactor: 0,
      netPnl: 0,
      winners: 0,
      losers: 0,
    });
  });

  test("trusts an explicit summary, including a null replay profit factor", () => {
    expect(computeTradeStats(trades, summary)).toEqual({
      winRate: 66.67,
      profitFactor: 1.8,
      netPnl: 1234,
      winners: 4,
      losers: 2,
    });
    expect(computeTradeStats(trades, { ...summary, profit_factor: null }).profitFactor).toBe(0);
  });
});

describe("formatCurrencySigned", () => {
  test("signs non-zero INR values and leaves a zero unsigned", () => {
    expect(formatCurrencySigned(1234)).toBe("+₹1,234");
    expect(formatCurrencySigned(-1234)).toBe("-₹1,234");
    expect(formatCurrencySigned(0)).toBe("₹0");
  });
});

describe("TradeStatsGrid", () => {
  test("renders the computed stats with P&L semantics from the trade rows", () => {
    renderWithProviders(() =>
      <TradeStatsGrid trades={trades} summary={null} isRunning={false} emptyText="No trades" testId="stats" />,
    );

    expect(statCard("Total Trades").value).toBe("3");
    expect(statCard("Win Rate").value).toBe("33.3%");
    expect(statCard("Profit Factor").value).toBe("—");
    expect(statCard("Winners / Losers").value).toBe("1 / 2");
    const net = statCard("Net P&L");
    expect(net.value).toBe("+₹30");
    expect(within(net.card).getByText("+₹30")).toHaveClass("text-fin-positive");
    expect(within(statCard("Win Rate").card).getByText("33.3%")).toHaveClass("text-fin-negative");
  });

  test("renders a supplied summary and keeps extra stats in order before Progress", () => {
    renderWithProviders(() =>
      <TradeStatsGrid
        trades={trades}
        summary={summary}
        isRunning
        emptyText="No trades"
        testId="stats"
        extraStats={<span data-testid="extra">Extra</span>}
        progressStat={{ value: "12 / 20", hint: "filling" }}
        progressBar={{ percent: 60 }}
      />,
    );

    expect(statCard("Total Trades").value).toBe("3");
    expect(statCard("Win Rate").value).toBe("66.7%");
    expect(statCard("Profit Factor").value).toBe("1.80");
    expect(statCard("Net P&L").value).toBe("+₹1,234");
    expect(statCard("Winners / Losers").value).toBe("4 / 2");
    expect(within(statCard("Profit Factor").card).getByText("1.80")).toHaveClass("text-fin-positive");

    const progress = statCard("Progress");
    expect(progress.value).toBe("12 / 20");
    expect(progress.card).toHaveTextContent("filling");
    expect(screen.getByTestId("extra")).toBeInTheDocument();
    const bar = within(screen.getByTestId("stats")).getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "60");
  });

  test("shows a zero and a negative net P&L with the correct tone", () => {
    const empty = renderWithProviders(() =>
      <TradeStatsGrid
        trades={[{ pnl: 0, net_pnl: 0 }]}
        summary={null}
        isRunning={false}
        emptyText="No trades"
        testId="stats"
      />,
    );
    const zero = statCard("Net P&L");
    expect(zero.value).toBe("₹0");
    expect(within(zero.card).getByText("₹0")).toHaveClass("text-fin-positive");
    empty.unmount();

    renderWithProviders(() =>
      <TradeStatsGrid
        trades={[{ pnl: -25, net_pnl: -25 }]}
        summary={null}
        isRunning={false}
        emptyText="No trades"
        testId="stats"
      />,
    );
    const loss = statCard("Net P&L");
    expect(loss.value).toBe("-₹25");
    expect(within(loss.card).getByText("-₹25")).toHaveClass("text-fin-negative");
  });

  test("uses the empty slot only when there are no trades and nothing is running", () => {
    const idle = renderWithProviders(() =>
      <TradeStatsGrid trades={[]} summary={null} isRunning={false} emptyText="Nothing yet" testId="stats" />,
    );
    expect(screen.getByTestId("stats")).toHaveTextContent("Nothing yet");
    expect(screen.queryByText("Total Trades")).not.toBeInTheDocument();
    idle.unmount();

    renderWithProviders(() =>
      <TradeStatsGrid trades={[]} summary={null} isRunning emptyText="Nothing yet" testId="stats" />,
    );
    expect(statCard("Total Trades").value).toBe("0");
    expect(statCard("Net P&L").value).toBe("₹0");
    expect(screen.queryByText("Nothing yet")).not.toBeInTheDocument();
  });

  test("gates the Progress stat on a running job while an explicit bar stays caller-controlled", () => {
    renderWithProviders(() =>
      <TradeStatsGrid
        trades={trades}
        summary={null}
        isRunning={false}
        emptyText="No trades"
        testId="stats"
        progressStat={{ value: "12 / 20", hint: "filling" }}
        progressBar={{ percent: 60 }}
      />,
    );

    expect(screen.queryByText("Progress")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("stats")).getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "60",
    );
  });
});
