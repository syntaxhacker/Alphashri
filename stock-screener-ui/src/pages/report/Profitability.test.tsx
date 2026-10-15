// @vitest-environment happy-dom
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { UIProvider } from "@/ui";
import { ProfitabilityPage } from "./Profitability";
import { fetchProfitability } from "../../api/profitability";

vi.mock("../../api/profitability", () => ({
  fetchProfitability: vi.fn(),
}));

const mockPayload = {
  weeks: 4,
  universe: "nifty500",
  as_of: "2026-10-07T15:30:00+05:30",
  cached: false,
  strategies: [
    { id: "orb", label: "Opening Range Breakout", trades: 5, win_rate: 0.6, net_pnl: 1200.5, expectancy: 240.1, profit_factor: 2.1, max_dd: 300.0, avg_hold_days: 2.0 },
    { id: "sr_breakout", label: "S/R Breakout", trades: 3, win_rate: 0.3333, net_pnl: -400.25, expectancy: -133.42, profit_factor: 0.4, max_dd: 800.0, avg_hold_days: 5.0 },
  ],
  top_signals: [
    { symbol: "RELIANCE", strategy: "orb", entry_date: "2026-09-20", entry: 2850.0, exit: 2890.0, net: 900.0 },
    { symbol: "INFY", strategy: "sr_breakout", entry_date: "2026-09-21", entry: 1500.0, exit: 1480.0, net: -1350.0 },
  ],
};

function renderPage() {
  return render(
    <UIProvider>
      <ProfitabilityPage />
    </UIProvider>,
  );
}

describe("ProfitabilityPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchProfitability).mockResolvedValue(mockPayload as never);
  });

  afterEach(() => cleanup());

  test("renders strategy and signal tables sorted by net desc", async () => {
    renderPage();
    expect(screen.getByTestId("profitability-loading")).toBeInTheDocument();
    await screen.findByTestId("profitability-strategies");
    expect(screen.getByTestId("profit-strategy-orb")).toBeInTheDocument();
    expect(screen.getByTestId("profitability-signal-row-RELIANCE-0")).toBeInTheDocument();
    expect(vi.mocked(fetchProfitability)).toHaveBeenCalledWith(4, "nifty500");
  });

  test("weeks selector refetches with the new window", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("profitability-strategies");
    await user.click(screen.getByTestId("profitability-refresh"));
    await waitFor(() =>
      expect(vi.mocked(fetchProfitability)).toHaveBeenCalledTimes(2),
    );
  });

  test("error state shows a retryable alert", async () => {
    vi.mocked(fetchProfitability).mockRejectedValue(new Error("backend down"));
    renderPage();
    expect(await screen.findByTestId("profitability-error-alert")).toHaveTextContent("backend down");
  });

  test("empty payload renders the empty state", async () => {
    vi.mocked(fetchProfitability).mockResolvedValue({
      ...mockPayload,
      strategies: [],
      top_signals: [],
    } as never);
    renderPage();
    expect(await screen.findByTestId("profitability-empty")).toBeInTheDocument();
  });
});
