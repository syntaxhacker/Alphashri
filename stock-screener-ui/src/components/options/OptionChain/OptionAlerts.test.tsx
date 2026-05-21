// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderWithMantine } from "../../../test-utils/renderWithMantine";
import { screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { OptionAlerts } from "./OptionAlerts";
import { setupBrowserMocks } from "../../../test-utils/setupBrowser";

beforeEach(() => setupBrowserMocks());
afterEach(() => cleanup());

function makeContract(overrides: any = {}) {
  return {
    market_data: {
      oi: 0,
      prev_oi: 0,
      volume: 0,
      ltp: 0,
      bid_price: 0,
      ask_price: 0,
      ...overrides,
    },
  };
}

describe("OptionAlerts", () => {
  it("renders LIVE SMART MONEY ALERTS header", () => {
    renderWithMantine(<OptionAlerts strikeMatrix={[]} spotPrice={24500} />);
    expect(screen.getByText("LIVE SMART MONEY ALERTS")).toBeInTheDocument();
  });

  it("shows Scanning Live status badge", () => {
    renderWithMantine(<OptionAlerts strikeMatrix={[]} spotPrice={24500} />);
    expect(screen.getByText("Scanning Live")).toBeInTheDocument();
  });

  it("shows empty state with waiting message when no alerts", () => {
    renderWithMantine(<OptionAlerts strikeMatrix={[]} spotPrice={24500} />);
    expect(screen.getByTestId("options-alerts-empty")).toBeInTheDocument();
    expect(screen.getByText("Waiting for unusual activity patterns...")).toBeInTheDocument();
  });

  it("shows empty state when spotPrice is null", () => {
    const strikeMatrix = [
      {
        strike: 24500,
        ce: makeContract({ oi: 100000, prev_oi: 50000, volume: 200000 }),
        pe: makeContract({ oi: 100000, prev_oi: 50000 }),
      },
    ];
    renderWithMantine(<OptionAlerts strikeMatrix={strikeMatrix} spotPrice={null} />);
    expect(screen.getByText("Waiting for unusual activity patterns...")).toBeInTheDocument();
  });

  it("renders profit tip box at bottom", () => {
    renderWithMantine(<OptionAlerts strikeMatrix={[]} spotPrice={24500} />);
    expect(screen.getByTestId("options-alerts-profit-tip")).toBeInTheDocument();
    expect(screen.getByText(/HOW TO PROFIT/)).toBeInTheDocument();
  });

  describe("Wall alert detection", () => {
    it("triggers Wall alert when OI change > 40% and change > 50000 contracts", () => {
      const strikeMatrix = [
        {
          strike: 24000,
          ce: makeContract({ oi: 150000, prev_oi: 50000, volume: 60000 }),
          pe: makeContract({ oi: 100, prev_oi: 100 }),
        },
      ];
      renderWithMantine(<OptionAlerts strikeMatrix={strikeMatrix} spotPrice={24500} />);
      expect(screen.getByText(/New CE Wall at 24000/)).toBeInTheDocument();
    });

    it("triggers Wall alert for PE side when conditions met", () => {
      const strikeMatrix = [
        {
          strike: 25000,
          ce: makeContract({ oi: 100, prev_oi: 100 }),
          pe: makeContract({ oi: 200000, prev_oi: 50000, volume: 60000 }),
        },
      ];
      renderWithMantine(<OptionAlerts strikeMatrix={strikeMatrix} spotPrice={24500} />);
      expect(screen.getByText(/New PE Wall at 25000/)).toBeInTheDocument();
    });

    it("does not trigger Wall when OI change is below 40%", () => {
      const strikeMatrix = [
        {
          strike: 24000,
          ce: makeContract({ oi: 65000, prev_oi: 50000, volume: 60000 }),
          pe: makeContract({ oi: 100, prev_oi: 100 }),
        },
      ];
      renderWithMantine(<OptionAlerts strikeMatrix={strikeMatrix} spotPrice={24500} />);
      expect(screen.queryByText(/New CE Wall at 24000/)).not.toBeInTheDocument();
      expect(screen.getByText("Waiting for unusual activity patterns...")).toBeInTheDocument();
    });

    it("does not trigger Wall when change is <= 50000", () => {
      const strikeMatrix = [
        {
          strike: 24000,
          ce: makeContract({ oi: 70001, prev_oi: 50000, volume: 60000 }),
          pe: makeContract({ oi: 100, prev_oi: 100 }),
        },
      ];
      renderWithMantine(<OptionAlerts strikeMatrix={strikeMatrix} spotPrice={24500} />);
      expect(screen.queryByText(/New/)).not.toBeInTheDocument();
    });
  });

  describe("Squeeze alert detection", () => {
    it("triggers Squeeze alert when price rises and CE OI drops > 20000 above spot", () => {
      const strikeMatrix = [
        {
          strike: 25000,
          ce: makeContract({ oi: 50000, prev_oi: 80000, volume: 30000, ltp: 150, bid_price: 100 }),
          pe: makeContract({ oi: 100, prev_oi: 100 }),
        },
      ];
      renderWithMantine(<OptionAlerts strikeMatrix={strikeMatrix} spotPrice={24500} />);
      expect(screen.getByText(/Call Squeeze Alert: 25000/)).toBeInTheDocument();
    });

    it("does not trigger Squeeze for PE contracts", () => {
      const strikeMatrix = [
        {
          strike: 25000,
          ce: makeContract({ oi: 100, prev_oi: 100 }),
          pe: makeContract({ oi: 50000, prev_oi: 80000, ltp: 150, bid_price: 100 }),
        },
      ];
      renderWithMantine(<OptionAlerts strikeMatrix={strikeMatrix} spotPrice={24500} />);
      expect(screen.queryByText(/Call Squeeze Alert/)).not.toBeInTheDocument();
    });
  });

  describe("Volume spike alert detection", () => {
    it("triggers Volume spike alert when volume > 100000 and OI change > 20%", () => {
      const strikeMatrix = [
        {
          strike: 24500,
          ce: makeContract({ oi: 150000, prev_oi: 100000, volume: 200000 }),
          pe: makeContract({ oi: 100, prev_oi: 100 }),
        },
      ];
      renderWithMantine(<OptionAlerts strikeMatrix={strikeMatrix} spotPrice={24500} />);
      expect(screen.getByText(/Aggressive CE Entry/)).toBeInTheDocument();
    });

    it("does not trigger Volume spike when volume is below threshold", () => {
      const strikeMatrix = [
        {
          strike: 24500,
          ce: makeContract({ oi: 130000, prev_oi: 100000, volume: 50000 }),
          pe: makeContract({ oi: 100, prev_oi: 100 }),
        },
      ];
      renderWithMantine(<OptionAlerts strikeMatrix={strikeMatrix} spotPrice={24500} />);
      expect(screen.queryByText(/Aggressive/)).not.toBeInTheDocument();
    });
  });

  describe("Alert sorting and capping", () => {
    it("sorts alerts with Squeeze type first", () => {
      const strikeMatrix = [
        {
          strike: 25000,
          ce: makeContract({
            oi: 50000, prev_oi: 80000, volume: 60000, ltp: 150, bid_price: 100,
          }),
          pe: makeContract({ oi: 100, prev_oi: 100 }),
        },
        {
          strike: 24000,
          ce: makeContract({
            oi: 200000, prev_oi: 50000, volume: 250000,
          }),
          pe: makeContract({ oi: 100, prev_oi: 100 }),
        },
      ];
      renderWithMantine(<OptionAlerts strikeMatrix={strikeMatrix} spotPrice={24500} />);
      const items = screen.getAllByTestId(/options-alert-item-/);
      expect(items[0]).toHaveTextContent(/Squeeze/);
    });

    it("caps alerts at 5 maximum", () => {
      const contract = (strike: number) => ({
        oi: 150000,
        prev_oi: 50000,
        volume: 60000,
        ltp: 100,
        bid_price: 50,
      });
      const strikeMatrix = Array.from({ length: 10 }, (_, i) => {
        const s = 24000 + i * 50;
        return {
          strike: s,
          ce: makeContract(contract(s)),
          pe: makeContract({ oi: 100, prev_oi: 100 }),
        };
      });
      renderWithMantine(<OptionAlerts strikeMatrix={strikeMatrix} spotPrice={24500} />);
      const items = screen.queryAllByTestId(/options-alert-item-/);
      expect(items.length).toBeLessThanOrEqual(5);
    });
  });

  describe("Timeline rendering", () => {
    it("renders Timeline when alerts exist", () => {
      const strikeMatrix = [
        {
          strike: 24000,
          ce: makeContract({ oi: 150000, prev_oi: 50000, volume: 60000 }),
          pe: makeContract({ oi: 100, prev_oi: 100 }),
        },
      ];
      renderWithMantine(<OptionAlerts strikeMatrix={strikeMatrix} spotPrice={24500} />);
      expect(screen.getByTestId("options-alerts-timeline")).toBeInTheDocument();
    });

    it("renders alert items with title, intensity badge, and description", () => {
      const strikeMatrix = [
        {
          strike: 24000,
          ce: makeContract({ oi: 150000, prev_oi: 50000, volume: 60000 }),
          pe: makeContract({ oi: 100, prev_oi: 100 }),
        },
      ];
      renderWithMantine(<OptionAlerts strikeMatrix={strikeMatrix} spotPrice={24500} />);
      expect(screen.getByTestId("options-alert-item-0")).toBeInTheDocument();
      expect(screen.getByText(/New CE Wall at 24000/)).toBeInTheDocument();
      expect(screen.getByText("High")).toBeInTheDocument();
    });
  });
});
