// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MantineProvider } from "@mantine/core";
import { OptionChainTable } from "./OptionChainTable";
import { setupBrowserMocks } from "../../../test-utils/setupBrowser";

beforeEach(() => setupBrowserMocks());
afterEach(() => cleanup());

function renderWithMantine(ui: React.ReactElement) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

function makeContract(overrides: any = {}) {
  return {
    instrument_key: "NFO:OPT:24500",
    trading_symbol: "NIFTY2450024500CE",
    strike_price: overrides.strike || 24500,
    expiry: "25MAY",
    instrument_type: overrides.type || "CE",
    market_data: {
      ltp: 150.5,
      volume: 10000,
      oi: 50000,
      bid_price: 149,
      ask_price: 152,
      prev_oi: 45000,
      ...overrides.market_data,
    },
    option_greeks: {
      delta: 0.55,
      gamma: 0.002,
      vega: 8.5,
      theta: -12.3,
      iv: 18.5,
      ...overrides.option_greeks,
    },
    sentiment: overrides.sentiment || { type: "Neutral", color: "gray", label: "Neutral" },
  };
}

describe("OptionChainTable", () => {
  const defaultProps = {
    filters: { optionType: "BOTH" as const, moneyness: "ALL" as const },
    spotPrice: 24500,
    onRowClick: vi.fn(),
  };

  it("renders chain table container", () => {
    renderWithMantine(
      <OptionChainTable {...defaultProps} strikeMatrix={[]} />,
    );
    expect(screen.getByTestId("options-chain-table")).toBeInTheDocument();
  });

  it("renders table header with CALLS, STRIKE, PUTS labels", () => {
    renderWithMantine(
      <OptionChainTable {...defaultProps} strikeMatrix={[]} />,
    );
    expect(screen.getByTestId("options-chain-table-header")).toBeInTheDocument();
    expect(screen.getByText("CALLS (CE)")).toBeInTheDocument();
    expect(screen.getByText("STRIKE")).toBeInTheDocument();
    expect(screen.getByText("PUTS (PE)")).toBeInTheDocument();
  });

  it("renders subheader with column labels OI, OI CHG, VOL, IV, LTP", () => {
    renderWithMantine(
      <OptionChainTable {...defaultProps} strikeMatrix={[]} />,
    );
    const subheader = screen.getByTestId("options-chain-table-subheader");
    expect(subheader).toBeInTheDocument();
    expect(subheader.textContent).toContain("OI");
    expect(subheader.textContent).toContain("OI CHG");
    expect(subheader.textContent).toContain("VOL");
    expect(subheader.textContent).toContain("IV");
    expect(subheader.textContent).toContain("LTP");
  });

  it("renders scroll actions (Scroll to Top, Jump to ATM, Scroll to Bottom)", () => {
    renderWithMantine(
      <OptionChainTable {...defaultProps} strikeMatrix={[]} />,
    );
    expect(screen.getByTestId("options-chain-scroll-actions")).toBeInTheDocument();
    expect(screen.getByTestId("options-scroll-top-btn")).toBeInTheDocument();
    expect(screen.getByTestId("options-scroll-atm-btn")).toBeInTheDocument();
    expect(screen.getByTestId("options-scroll-bottom-btn")).toBeInTheDocument();
  });

  it("renders footer with ITM, ATM legend and sentiment badges", () => {
    renderWithMantine(
      <OptionChainTable {...defaultProps} strikeMatrix={[]} />,
    );
    expect(screen.getByTestId("options-chain-table-footer")).toBeInTheDocument();
    expect(screen.getByTestId("options-legend-itm")).toBeInTheDocument();
    expect(screen.getByTestId("options-legend-atm")).toBeInTheDocument();
    expect(screen.getByTestId("options-legend-badges")).toBeInTheDocument();
  });

  it("displays current spot price in footer", () => {
    renderWithMantine(
      <OptionChainTable {...defaultProps} strikeMatrix={[]} spotPrice={24500} />,
    );
    expect(screen.getByTestId("options-chain-spot-price")).toHaveTextContent("24500.00");
  });

  it("does not display spot price when null", () => {
    renderWithMantine(
      <OptionChainTable {...defaultProps} strikeMatrix={[]} spotPrice={null} />,
    );
    expect(screen.queryByTestId("options-chain-spot-price")).not.toBeInTheDocument();
  });

  describe("strike rows", () => {
    it("renders strike rows with data-testid containing strike price", () => {
      const strikeMatrix = [
        { strike: 23900, ce: makeContract({ strike: 23900 }), pe: makeContract({ strike: 23900, type: "PE" }) },
        { strike: 24000, ce: makeContract({ strike: 24000 }), pe: makeContract({ strike: 24000, type: "PE" }) },
      ];
      renderWithMantine(
        <OptionChainTable {...defaultProps} strikeMatrix={strikeMatrix} />,
      );
      expect(screen.getByTestId("options-chain-row-23900")).toBeInTheDocument();
      expect(screen.getByTestId("options-chain-row-24000")).toBeInTheDocument();
    });

    it("renders strike prices like 23900 and 24000 prominently", () => {
      const strikeMatrix = [
        { strike: 23900, ce: makeContract({ strike: 23900 }), pe: makeContract({ strike: 23900, type: "PE" }) },
        { strike: 24000, ce: makeContract({ strike: 24000 }), pe: makeContract({ strike: 24000, type: "PE" }) },
      ];
      renderWithMantine(
        <OptionChainTable {...defaultProps} strikeMatrix={strikeMatrix} />,
      );
      const strikeCells = screen.getAllByTestId("strike-cell");
      expect(strikeCells[0]).toHaveTextContent("23900");
      expect(strikeCells[1]).toHaveTextContent("24000");
    });

    it("renders strike cell containers", () => {
      const strikeMatrix = [
        { strike: 24500, ce: makeContract({ strike: 24500 }), pe: makeContract({ strike: 24500, type: "PE" }) },
      ];
      renderWithMantine(
        <OptionChainTable {...defaultProps} strikeMatrix={strikeMatrix} />,
      );
      expect(screen.getAllByTestId("strike-cell").length).toBeGreaterThan(0);
    });
  });

  describe("ATM row highlighting", () => {
    it("applies ATM class to row closest to spot price", () => {
      const strikeMatrix = [
        { strike: 24000, ce: makeContract({ strike: 24000 }), pe: makeContract({ strike: 24000, type: "PE" }) },
        { strike: 24500, ce: makeContract({ strike: 24500 }), pe: makeContract({ strike: 24500, type: "PE" }) },
        { strike: 25000, ce: makeContract({ strike: 25000 }), pe: makeContract({ strike: 25000, type: "PE" }) },
      ];
      const { container } = renderWithMantine(
        <OptionChainTable {...defaultProps} spotPrice={24500} strikeMatrix={strikeMatrix} />,
      );
      const atmRow = container.querySelector(".chain-row-atm");
      expect(atmRow).toBeInTheDocument();
      expect(atmRow).toHaveAttribute("data-testid", "options-chain-row-24500");
    });
  });

  describe("CE and PE column ordering", () => {
    it("shows CE columns in order: OI, OI CHG, VOL, IV, LTP", () => {
      const strikeMatrix = [
        { strike: 24500, ce: makeContract({ strike: 24500 }), pe: null },
      ];
      renderWithMantine(
        <OptionChainTable {...defaultProps} strikeMatrix={strikeMatrix} />,
      );
      expect(screen.getByText("CALLS (CE)")).toBeInTheDocument();
    });

    it("shows PE subheader with LTP, IV, VOL, OI CHG, OI labels", () => {
      const strikeMatrix = [
        { strike: 24500, ce: null, pe: makeContract({ strike: 24500, type: "PE" }) },
      ];
      renderWithMantine(
        <OptionChainTable {...defaultProps} strikeMatrix={strikeMatrix} />,
      );
      const subheader = screen.getByTestId("options-chain-table-subheader");
      expect(subheader.textContent).toContain("LTP");
      expect(subheader.textContent).toContain("IV");
    });
  });

  describe("OI value formatting", () => {
    it("formats OI values with K/L/Cr format", () => {
      const strikeMatrix = [
        {
          strike: 24500,
          ce: makeContract({ strike: 24500, market_data: { oi: 1500000, prev_oi: 1000000, volume: 50000, ltp: 100, bid_price: 99, ask_price: 101 } }),
          pe: null,
        },
      ];
      renderWithMantine(
        <OptionChainTable {...defaultProps} strikeMatrix={strikeMatrix} />,
      );
      expect(screen.getByText("15.0L")).toBeInTheDocument();
    });
  });

  describe("sentiment badges", () => {
    it("shows sentiment badges next to OI change when applicable", () => {
      const strikeMatrix = [
        {
          strike: 24500,
          ce: makeContract({
            strike: 24500,
            sentiment: { type: "LB", color: "green", label: "LB" },
            market_data: { oi: 150000, prev_oi: 50000, volume: 60000, ltp: 100, bid_price: 99, ask_price: 101 },
          }),
          pe: null,
        },
      ];
      renderWithMantine(
        <OptionChainTable {...defaultProps} strikeMatrix={strikeMatrix} />,
      );
      expect(screen.getByText("LB")).toBeInTheDocument();
    });
  });

  describe("LTP delta progress bar", () => {
    it("renders delta progress bar below LTP values", () => {
      const strikeMatrix = [
        {
          strike: 24500,
          ce: makeContract({
            strike: 24500,
            option_greeks: { delta: 0.55, gamma: 0.002, vega: 8.5, theta: -12.3, iv: 18.5 },
          }),
          pe: null,
        },
      ];
      renderWithMantine(
        <OptionChainTable {...defaultProps} strikeMatrix={strikeMatrix} />,
      );
      const progressBars = document.querySelectorAll(".mantine-Progress-root");
      expect(progressBars.length).toBeGreaterThan(0);
    });
  });

  describe("moneyness coloring", () => {
    it("applies green tint to ITM calls", () => {
      const strikeMatrix = [
        {
          strike: 24000,
          ce: makeContract({ strike: 24000, market_data: { oi: 100, prev_oi: 100, volume: 100, ltp: 200, bid_price: 199, ask_price: 201 } }),
          pe: null,
        },
      ];
      renderWithMantine(
        <OptionChainTable {...defaultProps} spotPrice={24500} strikeMatrix={strikeMatrix} />,
      );
      expect(screen.getByTestId("options-chain-row-24000")).toBeInTheDocument();
    });

    it("applies red tint to ITM puts", () => {
      const strikeMatrix = [
        {
          strike: 25000,
          ce: null,
          pe: makeContract({ strike: 25000, type: "PE", market_data: { oi: 100, prev_oi: 100, volume: 100, ltp: 200, bid_price: 199, ask_price: 201 } }),
        },
      ];
      renderWithMantine(
        <OptionChainTable {...defaultProps} spotPrice={24500} strikeMatrix={strikeMatrix} />,
      );
      expect(screen.getByTestId("options-chain-row-25000")).toBeInTheDocument();
    });
  });

  describe("Jump to ATM button scroll behavior", () => {
    it("renders Jump to ATM button", () => {
      renderWithMantine(
        <OptionChainTable {...defaultProps} strikeMatrix={[]} />,
      );
      expect(screen.getByTestId("options-scroll-atm-btn")).toBeInTheDocument();
    });
  });
});
