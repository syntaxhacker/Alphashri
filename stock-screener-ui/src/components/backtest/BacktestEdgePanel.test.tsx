// @vitest-environment happy-dom
import { describe, expect, test, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { UIProvider } from "@/ui";
import type { Trade } from "../../types/backtest";
import { BacktestEdgePanel } from "./BacktestEdgePanel";
import "@testing-library/jest-dom/vitest";

afterEach(() => cleanup());

function makeTrade(over: Partial<Trade> = {}): Trade {
  return {
    entry_price: 100,
    exit_price: 102,
    entry_time: "2026-02-16T09:30:00+05:30",
    exit_time: "2026-02-16T10:00:00+05:30",
    quantity: 10,
    gross_pnl: 20,
    gross_pnl_pct: 1,
    trading_costs: 2,
    net_pnl: 18,
    net_pnl_pct: 1.8,
    exit_reason: "TP",
    hold_duration_minutes: 30,
    date: "2026-02-16",
    ...over,
  } as Trade;
}

const Wrapper = ({ children }: { children: React.ReactNode }) => <UIProvider>{children}</UIProvider>;

describe("BacktestEdgePanel", () => {
  test("shows a prompt when there are no trades", () => {
    render(<BacktestEdgePanel symbol="NETWEB" trades={[]} />, { wrapper: Wrapper });
    expect(screen.queryByTestId("edge-panel")).toBeNull();
    expect(screen.getByText(/Select a symbol with trades/)).toBeInTheDocument();
  });

  test("renders every edge section", () => {
    const trades = [
      makeTrade({ entry_time: "2026-02-16T09:30:00+05:30", net_pnl: 30, exit_reason: "TP" }),
      makeTrade({ entry_time: "2026-02-17T13:30:00+05:30", net_pnl: -20, exit_reason: "SL", hold_duration_minutes: 200 }),
    ];
    render(<BacktestEdgePanel symbol="NETWEB" trades={trades} />, { wrapper: Wrapper });

    expect(screen.getByTestId("edge-panel")).toBeInTheDocument();
    expect(screen.getByTestId("edge-section-side")).toBeInTheDocument();
    expect(screen.getByTestId("edge-section-time-of-day")).toBeInTheDocument();
    expect(screen.getByTestId("edge-section-weekday")).toBeInTheDocument();
    expect(screen.getByTestId("edge-section-hold-duration")).toBeInTheDocument();
    expect(screen.getByTestId("edge-section-exit-reason")).toBeInTheDocument();
  });

  test("reports best and worst time-of-day windows", () => {
    const trades = [
      makeTrade({ entry_time: "2026-02-16T09:30:00+05:30", net_pnl: 30 }),
      makeTrade({ entry_time: "2026-02-16T13:30:00+05:30", net_pnl: -20 }),
    ];
    render(<BacktestEdgePanel symbol="NETWEB" trades={trades} />, { wrapper: Wrapper });
    expect(screen.getByTestId("edge-insight-best")).toHaveTextContent("09–10");
    expect(screen.getByTestId("edge-insight-worst")).toHaveTextContent("13–14");
  });
});
