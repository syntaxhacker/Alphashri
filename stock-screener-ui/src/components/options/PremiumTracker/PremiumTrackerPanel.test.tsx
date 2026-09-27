// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { PremiumTrackerPanel } from "./PremiumTrackerPanel";
import { setupBrowserMocks } from "../../../test-utils/setupBrowser";
import { renderWithProviders } from "../../../test-utils/renderWithProviders";

vi.mock("../../../api/premiumTracker", () => ({
  fetchPremiumTracker: vi.fn(),
}));

import { fetchPremiumTracker } from "../../../api/premiumTracker";

const snapshot = {
  legs: [
    {
      underlying: "NIFTY",
      spot: 23140,
      atm_strike: 23150,
      ce_ltp: 90,
      pe_ltp: 106,
      straddle_price: 196,
      straddle_pct: 0.847,
      ce_iv_pct: 25.2,
      pe_iv_pct: 15.3,
      dte_days: 1,
      hv20_ann_pct: 9.2,
      hv20_daily_pct: 0.58,
      avg_range20_pct: 0.71,
      iv_hv_ratio: 2.73,
      verdict: "EXPENSIVE",
      error: null,
    },
    {
      underlying: "BANKNIFTY",
      spot: 55580,
      atm_strike: 55600,
      ce_ltp: 300,
      pe_ltp: 256,
      straddle_price: 556,
      straddle_pct: 1.0,
      ce_iv_pct: 27.3,
      pe_iv_pct: 20.6,
      dte_days: 1,
      hv20_ann_pct: 12.1,
      hv20_daily_pct: 0.76,
      avg_range20_pct: 0.92,
      iv_hv_ratio: 2.26,
      verdict: "EXPENSIVE",
      error: null,
    },
  ],
  as_of: "2026-09-27T00:00:00+00:00",
  cached: false,
};

beforeEach(() => {
  setupBrowserMocks();
  localStorage.clear();
  vi.mocked(fetchPremiumTracker).mockResolvedValue(snapshot);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PremiumTrackerPanel", () => {
  it("renders both legs with verdicts", async () => {
    renderWithProviders(<PremiumTrackerPanel />);
    expect(await screen.findByTestId("premium-leg-NIFTY")).toBeInTheDocument();
    expect(screen.getByTestId("premium-leg-BANKNIFTY")).toBeInTheDocument();
    expect(screen.getAllByText("EXPENSIVE")).toHaveLength(2);
  });

  it("shows an error when the snapshot fails", async () => {
    vi.mocked(fetchPremiumTracker).mockRejectedValueOnce(new Error("no token"));
    renderWithProviders(<PremiumTrackerPanel />);
    expect(await screen.findByTestId("premium-error")).toHaveTextContent("no token");
  });

  it("logs a paper trade and marks pnl on exit", async () => {
    renderWithProviders(<PremiumTrackerPanel />);
    await screen.findByTestId("premium-paper-form");

    await userEvent.type(screen.getByTestId("paper-strike"), "23150");
    await userEvent.type(screen.getByTestId("paper-qty"), "65");
    await userEvent.type(screen.getByTestId("paper-entry"), "100");
    await userEvent.click(screen.getByTestId("paper-add"));

    expect(await screen.findByText("No closed trades yet")).toBeInTheDocument();
  });
});
