// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithMantine } from "../../test-utils/renderWithMantine";
import { AggregatedDashboard } from "./AggregatedDashboard";
import * as paperTradingState from "../../state/paperTrading";

vi.mock("../../api/paperTrading", () => ({
  fetchAggregatedDashboard: vi.fn().mockResolvedValue(null),
}));

describe("AggregatedDashboard", () => {
  beforeEach(() => {
    paperTradingState.resetPaperTradingState();
  });

  it("shows empty state when no bots", () => {
    renderWithMantine(<AggregatedDashboard />);
    expect(screen.getAllByText(/No bots configured/i).length).toBeGreaterThan(0);
  });

  it("renders bot cards when aggregated data available", () => {
    const mockData = {
      bots: [
        {
          id: "bot-1",
          name: "Swing Bot",
          running: true,
          pid: 12345,
          strategies: [{ id: 1, name: "52W Target Swing", strategy_type: "52W_TARGET" }],
          position_count: 2,
          daily_pnl: 150.0,
          unrealized_pnl: 200.0,
          positions: [],
        },
        {
          id: "bot-2",
          name: "ORB Bot",
          running: false,
          pid: null,
          strategies: [{ id: 2, name: "ORB", strategy_type: "ORB" }],
          position_count: 0,
          daily_pnl: 0.0,
          unrealized_pnl: 0.0,
          positions: [],
        },
      ],
      summary: {
        total_bots: 2,
        running_bots: 1,
        total_positions: 2,
        total_daily_pnl: 150,
        total_unrealized_pnl: 200,
        total_value: 50000,
      },
    };
    paperTradingState.setAggregatedData(mockData as any);
    renderWithMantine(<AggregatedDashboard />);
    expect(screen.getAllByText("Swing Bot").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ORB Bot").length).toBeGreaterThan(0);
  });
});
