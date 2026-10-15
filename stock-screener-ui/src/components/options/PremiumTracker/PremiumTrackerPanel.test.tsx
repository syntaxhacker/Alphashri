// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { PremiumTrackerPanel } from "./PremiumTrackerPanel";
import { setupBrowserMocks } from "../../../test-utils/setupBrowser";
import { renderWithProviders } from "../../../test-utils/renderWithProviders";

vi.mock("../../../api/premiumTracker", () => ({
  fetchPremiumTracker: vi.fn(),
}));

vi.mock("./PayoffChart", () => ({
  PayoffChart: () => <div data-testid="mock-payoff-chart">chart</div>,
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
  ],
  as_of: "2026-09-27T00:00:00+00:00",
  cached: false,
};

const matrix = [
  { strike: 23150, ce: { market_data: { ltp: 95 } }, pe: { market_data: { ltp: 100 } } },
];

beforeEach(() => {
  setupBrowserMocks();
  localStorage.clear();
  vi.mocked(fetchPremiumTracker).mockResolvedValue(snapshot);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PremiumTrackerPanel v2", () => {
  it("renders snapshot, both strategy rows, and diary", async () => {
    renderWithProviders(<PremiumTrackerPanel strikeMatrix={matrix} selectedUnderlying="NIFTY" />);
    expect(await screen.findByTestId("premium-leg-NIFTY")).toBeInTheDocument();
    expect(screen.getByTestId("strategy-row-BUY")).toBeInTheDocument();
    expect(screen.getByTestId("strategy-row-SELL")).toBeInTheDocument();
    expect(screen.getByTestId("diary-strip")).toBeInTheDocument();
  });

  it("adds a setup and paper-fills it into the diary", async () => {
    const { container } = renderWithProviders(
      <PremiumTrackerPanel strikeMatrix={matrix} selectedUnderlying="NIFTY" />,
    );
    await screen.findByTestId("strategy-row-BUY");
    await userEvent.click(screen.getByTestId("strategy-row-add-BUY"));
    await waitFor(() => {
      expect(container.querySelector("[data-testid^='setup-card-']")).toBeInTheDocument();
    });
    const fillBtn = container.querySelector("[data-testid^='setup-fill-']");
    expect(fillBtn).toBeInTheDocument();
    await userEvent.click(fillBtn as Element);
    expect(await screen.findByText("No closed trades yet")).toBeInTheDocument();
  });

  it("shows an error when the snapshot fails", async () => {
    vi.mocked(fetchPremiumTracker).mockRejectedValueOnce(new Error("no token"));
    renderWithProviders(<PremiumTrackerPanel />);
    expect(await screen.findByTestId("premium-error")).toHaveTextContent("no token");
  });
});
