// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, test } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithMantine } from "../../test-utils/renderWithMantine";
import { ActivityFeed } from "./ActivityFeed";
import * as paperTradingState from "../../state/paperTrading";

vi.mock("../../api/paperTrading", () => ({
  fetchActivityFeed: vi.fn().mockResolvedValue([]),
}));

describe("ActivityFeed", () => {
  beforeEach(() => {
    cleanup();
    paperTradingState.resetPaperTradingState();
  });

  it("renders the activity feed panel", () => {
    renderWithMantine(<ActivityFeed />);
    expect(screen.getAllByText("Activity Feed").length).toBeGreaterThan(0);
  });

  it("shows empty state when no events", () => {
    paperTradingState.setActivityEvents([]);
    renderWithMantine(<ActivityFeed />);
    expect(screen.getAllByText(/No recent activity/i).length).toBeGreaterThan(0);
  });

  it("renders trade events", () => {
    const events = [
      {
        type: "trade_exit",
        timestamp: "2026-05-19T14:58:17",
        symbol: "GESHIP",
        side: "BUY",
        direction: "LONG",
        quantity: 29,
        entry_price: 1719.7,
        exit_price: 1723.6,
        pnl: 113.1,
        pnl_pct: 0.23,
        net_pnl: 60.14,
        exit_reason: "TRAILING_STOP",
        strategy_name: "52W Target Swing",
        hold_duration_minutes: 71,
        trade_id: "T1",
      },
    ];
    paperTradingState.setActivityEvents(events as any);
    renderWithMantine(<ActivityFeed />);
    expect(screen.getAllByText("GESHIP").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/52W Target Swing/i).length).toBeGreaterThan(0);
  });

  test("shows loading spinner when activityLoading is true and no events", () => {
    paperTradingState.setActivityLoading(true);
    const { container } = renderWithMantine(<ActivityFeed />);
    expect(screen.queryByText("Activity Feed")).not.toBeInTheDocument();
    expect(screen.queryByText(/No recent activity/i)).not.toBeInTheDocument();
    expect(container.querySelector(".mantine-Loader-root")).toBeInTheDocument();
  });

  const entryEvent = {
    type: "entry" as const,
    timestamp: "2026-05-19T09:30:00",
    symbol: "RELIANCE",
    side: "BUY",
    direction: "LONG",
    quantity: 50,
    entry_price: 2500,
    strategy_name: "ORB Strategy",
  };

  test("entry event renders ENTRY badge", () => {
    paperTradingState.setActivityEvents([entryEvent as any]);
    renderWithMantine(<ActivityFeed />);
    expect(screen.getByText("ENTRY")).toBeInTheDocument();
  });

  const exitEventProfit = {
    type: "trade_exit" as const,
    timestamp: "2026-05-19T14:30:00",
    symbol: "RELIANCE",
    side: "BUY",
    direction: "LONG",
    quantity: 50,
    entry_price: 2500,
    exit_price: 2600,
    pnl: 5000,
    pnl_pct: 2.0,
    net_pnl: 4950,
    exit_reason: "TAKE_PROFIT",
    strategy_name: "ORB Strategy",
    trade_id: "T1",
  };

  const exitEventLoss = {
    ...exitEventProfit,
    symbol: "TCS",
    exit_price: 2450,
    pnl: -2500,
    pnl_pct: -1.0,
    net_pnl: -2550,
    trade_id: "T2",
  };

  test("exit event with profit renders EXIT badge", () => {
    paperTradingState.setActivityEvents([exitEventProfit as any]);
    renderWithMantine(<ActivityFeed />);
    expect(screen.getByText("EXIT")).toBeInTheDocument();
  });

  test("exit event with loss renders EXIT badge", () => {
    paperTradingState.setActivityEvents([exitEventLoss as any]);
    renderWithMantine(<ActivityFeed />);
    expect(screen.getByText("EXIT")).toBeInTheDocument();
  });

  const signalEvent = {
    type: "signal" as const,
    timestamp: "2026-05-19T10:00:00",
    symbol: "INFY",
    side: "BUY",
    direction: "LONG",
    quantity: 0,
    entry_price: 0,
    strategy_name: "SR Breakout",
  };

  test("unknown event type renders uppercase badge", () => {
    paperTradingState.setActivityEvents([signalEvent as any]);
    renderWithMantine(<ActivityFeed />);
    expect(screen.getByText("SIGNAL")).toBeInTheDocument();
  });

  test("positive P&L shows plus prefix", () => {
    paperTradingState.setActivityEvents([exitEventProfit as any]);
    renderWithMantine(<ActivityFeed />);
    expect(screen.getByText(/\+₹4950/)).toBeInTheDocument();
  });

  test("negative P&L shows without plus prefix", () => {
    paperTradingState.setActivityEvents([exitEventLoss as any]);
    renderWithMantine(<ActivityFeed />);
    expect(screen.getByText(/₹-2550/)).toBeInTheDocument();
  });

  test("renders direction or side column", () => {
    paperTradingState.setActivityEvents([entryEvent as any]);
    renderWithMantine(<ActivityFeed />);
    expect(screen.getByText("LONG")).toBeInTheDocument();
  });

  test("renders quantity and entry price", () => {
    paperTradingState.setActivityEvents([entryEvent as any]);
    renderWithMantine(<ActivityFeed />);
    expect(screen.getByText(/50 @ ₹2500\.0/)).toBeInTheDocument();
  });

  test("exit price shown for exit events", () => {
    paperTradingState.setActivityEvents([exitEventProfit as any]);
    renderWithMantine(<ActivityFeed />);
    expect(screen.getByText(/→ ₹2600\.0/)).toBeInTheDocument();
  });

  test("exit price not shown for entry events", () => {
    paperTradingState.setActivityEvents([entryEvent as any]);
    renderWithMantine(<ActivityFeed />);
    expect(screen.queryByText(/→/)).not.toBeInTheDocument();
  });

  test("renders strategy name badge", () => {
    paperTradingState.setActivityEvents([exitEventProfit as any]);
    renderWithMantine(<ActivityFeed />);
    expect(screen.getByText("ORB Strategy")).toBeInTheDocument();
  });

  test("renders exit reason text", () => {
    paperTradingState.setActivityEvents([exitEventProfit as any]);
    renderWithMantine(<ActivityFeed />);
    expect(screen.getByText("TAKE_PROFIT")).toBeInTheDocument();
  });

  test("event with entry_price and no exit_price shows as ENTRY regardless of type", () => {
    paperTradingState.setActivityEvents([{ ...entryEvent, type: "order_fill" } as any]);
    renderWithMantine(<ActivityFeed />);
    expect(screen.getByText("ENTRY")).toBeInTheDocument();
  });

  test("multiple events render in order", () => {
    paperTradingState.setActivityEvents([entryEvent as any, exitEventProfit as any]);
    const { container } = renderWithMantine(<ActivityFeed />);
    const text = container.textContent || "";
    const entryPos = text.indexOf("ENTRY");
    const exitPos = text.indexOf("EXIT");
    expect(entryPos).toBeGreaterThan(0);
    expect(exitPos).toBeGreaterThan(entryPos);
  });
});
