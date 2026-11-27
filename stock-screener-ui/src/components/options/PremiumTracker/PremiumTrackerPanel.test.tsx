// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { PremiumTrackerPanel } from "./PremiumTrackerPanel";
import { setupBrowserMocks } from "../../../test-utils/setupBrowser";

vi.mock("@/ui", async () => {
  const { mockSolidUi } = await import("@/test-utils/solidUiMock");
  const { typeSize } = await import("@/ui/typography");
  return { ...mockSolidUi(), typeSize };
});

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
    render(() => <PremiumTrackerPanel strikeMatrix={matrix} selectedUnderlying="NIFTY" />);
    expect(await screen.findByTestId("premium-leg-NIFTY")).toBeInTheDocument();
    expect(screen.getByTestId("strategy-row-BUY")).toBeInTheDocument();
    expect(screen.getByTestId("strategy-row-SELL")).toBeInTheDocument();
    expect(screen.getByTestId("diary-strip")).toBeInTheDocument();
  });

  it("adds a setup and paper-fills it into the diary", async () => {
    const { container } = render(() => (
      <PremiumTrackerPanel strikeMatrix={matrix} selectedUnderlying="NIFTY" />
    ));
    await screen.findByTestId("strategy-row-BUY");
    fireEvent.click(screen.getByTestId("strategy-row-add-BUY"));
    await waitFor(() => {
      expect(container.querySelector("[data-testid^='setup-card-']")).toBeInTheDocument();
    });
    const fillBtn = container.querySelector("[data-testid^='setup-fill-']");
    expect(fillBtn).toBeInTheDocument();
    fireEvent.click(fillBtn as Element);
    expect(await screen.findByText("No closed trades yet")).toBeInTheDocument();
  });

  it("keeps the snapshot time and risk caveat, drops the how-to-read wall", async () => {
    render(() => <PremiumTrackerPanel strikeMatrix={matrix} selectedUnderlying="NIFTY" />);
    await screen.findByTestId("premium-leg-NIFTY");

    expect(screen.getByText("Snapshot 27 Sep, 05:30 IST")).toBeInTheDocument();
    expect(screen.getByText("Long premium — max loss is the debit you pay")).toBeInTheDocument();
    expect(screen.getByText("Short premium, always hedged — never naked")).toBeInTheDocument();
    expect(screen.queryByText(/Straddle vs avg range/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Buying rows bet the run/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Pick a day, set exits/)).not.toBeInTheDocument();
  });

  it("shows an error when the snapshot fails", async () => {
    vi.mocked(fetchPremiumTracker).mockRejectedValueOnce(new Error("no token"));
    render(() => <PremiumTrackerPanel />);
    expect(await screen.findByTestId("premium-error")).toHaveTextContent("no token");
  });
});
