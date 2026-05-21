// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithMantine } from "../../test-utils/renderWithMantine";
import { ActivityFeed } from "./ActivityFeed";
import * as paperTradingState from "../../state/paperTrading";

vi.mock("../../api/paperTrading", () => ({
  fetchActivityFeed: vi.fn().mockResolvedValue([]),
}));

describe("ActivityFeed", () => {
  beforeEach(() => {
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
});
