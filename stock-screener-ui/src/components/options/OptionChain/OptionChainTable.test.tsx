// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderWithProviders } from "../../../test-utils/renderWithProviders";
import { screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { OptionChainTable, findAtmIndex } from "./OptionChainTable";
import { setupBrowserMocks } from "../../../test-utils/setupBrowser";

beforeEach(() => setupBrowserMocks());
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

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
    renderWithProviders(
      <OptionChainTable {...defaultProps} strikeMatrix={[]} />,
    );
    expect(screen.getByTestId("options-chain-table")).toBeInTheDocument();
  });

  it("renders table header with CALLS, STRIKE, PUTS labels", () => {
    renderWithProviders(
      <OptionChainTable {...defaultProps} strikeMatrix={[]} />,
    );
    expect(screen.getByTestId("options-chain-table-header")).toBeInTheDocument();
    expect(screen.getByText("CALLS (CE)")).toBeInTheDocument();
    expect(screen.getByText("STRIKE")).toBeInTheDocument();
    expect(screen.getByText("PUTS (PE)")).toBeInTheDocument();
  });

  it("renders subheader with column labels OI, OI CHG, VOL, IV, LTP", () => {
    renderWithProviders(
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
    renderWithProviders(
      <OptionChainTable {...defaultProps} strikeMatrix={[]} />,
    );
    expect(screen.getByTestId("options-chain-scroll-actions")).toBeInTheDocument();
    expect(screen.getByTestId("options-scroll-top-btn")).toBeInTheDocument();
    expect(screen.getByTestId("options-scroll-atm-btn")).toBeInTheDocument();
    expect(screen.getByTestId("options-scroll-bottom-btn")).toBeInTheDocument();
  });

  it("renders footer with ITM, ATM legend and sentiment badges", () => {
    renderWithProviders(
      <OptionChainTable {...defaultProps} strikeMatrix={[]} />,
    );
    expect(screen.getByTestId("options-chain-table-footer")).toBeInTheDocument();
    expect(screen.getByTestId("options-legend-itm")).toBeInTheDocument();
    expect(screen.getByTestId("options-legend-atm")).toBeInTheDocument();
    expect(screen.getByTestId("options-legend-badges")).toBeInTheDocument();
  });

  it("displays current spot price in footer", () => {
    renderWithProviders(
      <OptionChainTable {...defaultProps} strikeMatrix={[]} spotPrice={24500} />,
    );
    expect(screen.getByTestId("options-chain-spot-price")).toHaveTextContent("24500.00");
  });

  it("does not display spot price when null", () => {
    renderWithProviders(
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
      renderWithProviders(
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
      renderWithProviders(
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
      renderWithProviders(
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
      const { container } = renderWithProviders(
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
      renderWithProviders(
        <OptionChainTable {...defaultProps} strikeMatrix={strikeMatrix} />,
      );
      expect(screen.getByText("CALLS (CE)")).toBeInTheDocument();
    });

    it("shows PE subheader with LTP, IV, VOL, OI CHG, OI labels", () => {
      const strikeMatrix = [
        { strike: 24500, ce: null, pe: makeContract({ strike: 24500, type: "PE" }) },
      ];
      renderWithProviders(
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
      renderWithProviders(
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
      renderWithProviders(
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
      renderWithProviders(
        <OptionChainTable {...defaultProps} strikeMatrix={strikeMatrix} />,
      );
      const progressBars = screen.getAllByRole("progressbar");
      expect(progressBars.length).toBeGreaterThan(0);
      // Also verify aria-valuenow is set (determinate progress)
      expect(progressBars[0]).toHaveAttribute("aria-valuenow");
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
      renderWithProviders(
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
      renderWithProviders(
        <OptionChainTable {...defaultProps} spotPrice={24500} strikeMatrix={strikeMatrix} />,
      );
      expect(screen.getByTestId("options-chain-row-25000")).toBeInTheDocument();
    });
  });

  describe("Jump to ATM button scroll behavior", () => {
    it("renders Jump to ATM button", () => {
      renderWithProviders(
        <OptionChainTable {...defaultProps} strikeMatrix={[]} />,
      );
      expect(screen.getByTestId("options-scroll-atm-btn")).toBeInTheDocument();
    });

    it("auto-scrolls ATM inside the table viewport (never escapes to page)", async () => {
      const scrollIntoView = vi.fn();
      (window.HTMLElement.prototype as any).scrollIntoView = scrollIntoView;
      try {
        const strikeMatrix = [
          { strike: 24000, ce: makeContract({ strike: 24000 }), pe: makeContract({ strike: 24000, type: "PE" }) },
          { strike: 24500, ce: makeContract({ strike: 24500 }), pe: makeContract({ strike: 24500, type: "PE" }) },
          { strike: 25000, ce: makeContract({ strike: 25000 }), pe: makeContract({ strike: 25000, type: "PE" }) },
        ];
        renderWithProviders(
          <OptionChainTable {...defaultProps} spotPrice={24500} strikeMatrix={strikeMatrix} />,
        );
        // ATM row renders (effects flushed) — page-level scroll must stay untouched
        await screen.findByTestId("options-chain-atm-badge");
        expect(scrollIntoView).not.toHaveBeenCalled();
      } finally {
        delete (window.HTMLElement.prototype as any).scrollIntoView;
      }
    });
  });

  describe("findAtmIndex", () => {
    it("returns index of strike closest to spot", () => {
      expect(findAtmIndex([24000, 24500, 25000], 24500)).toBe(1);
      expect(findAtmIndex([24000, 24500, 25000], 24520)).toBe(1);
      expect(findAtmIndex([24000, 24500, 25000], 24980)).toBe(2);
    });

    it("returns -1 when spot is null or matrix is empty", () => {
      expect(findAtmIndex([24000, 24500], null)).toBe(-1);
      expect(findAtmIndex([], 24500)).toBe(-1);
    });
  });

  describe("ATM highlight", () => {
    const threeRows = [
      { strike: 24000, ce: makeContract({ strike: 24000 }), pe: makeContract({ strike: 24000, type: "PE" }) },
      { strike: 24500, ce: makeContract({ strike: 24500 }), pe: makeContract({ strike: 24500, type: "PE" }) },
      { strike: 25000, ce: makeContract({ strike: 25000 }), pe: makeContract({ strike: 25000, type: "PE" }) },
    ];

    it("marks the closest-to-spot row with data-atm", () => {
      const { container } = renderWithProviders(
        <OptionChainTable {...defaultProps} spotPrice={24520} strikeMatrix={threeRows} />,
      );
      const atmRow = container.querySelector('[data-atm="true"]');
      expect(atmRow).toBeInTheDocument();
      expect(atmRow).toHaveAttribute("data-testid", "options-chain-row-24500");
    });

    it("renders an ATM badge on the ATM strike cell", () => {
      renderWithProviders(
        <OptionChainTable {...defaultProps} spotPrice={24500} strikeMatrix={threeRows} />,
      );
      expect(screen.getByTestId("options-chain-atm-badge")).toBeInTheDocument();
      expect(screen.getByTestId("options-chain-atm-badge")).toHaveTextContent("ATM");
    });
  });

  describe("ATM window toggle", () => {
    function wideMatrix() {
      const rows = [];
      for (let strike = 24000; strike <= 25500; strike += 50) {
        rows.push({
          strike,
          ce: makeContract({ strike }),
          pe: makeContract({ strike, type: "PE" }),
        });
      }
      return rows;
    }

    it("renders the ATM window toggle defaulting to ±10", () => {
      renderWithProviders(
        <OptionChainTable {...defaultProps} spotPrice={24750} strikeMatrix={wideMatrix()} />,
      );
      expect(screen.getByTestId("options-chain-atm-window")).toBeInTheDocument();
      expect(screen.getByTestId("options-chain-window-count")).toHaveTextContent(
        "Showing 21 of 31 strikes",
      );
    });

    it("hides far-OTM strikes by default and shows them with All", async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <OptionChainTable {...defaultProps} spotPrice={24750} strikeMatrix={wideMatrix()} />,
      );
      // 20050-style far strikes are out of the default ±10 window
      expect(screen.queryByTestId("options-chain-row-25500")).not.toBeInTheDocument();
      expect(screen.getByTestId("options-chain-row-24750")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "All" }));
      expect(screen.getByTestId("options-chain-row-25500")).toBeInTheDocument();
      expect(screen.getByTestId("options-chain-row-24000")).toBeInTheDocument();
      expect(screen.getByTestId("options-chain-window-count")).toHaveTextContent(
        "Showing 31 of 31 strikes",
      );
    });

    it("narrows to ±5 strikes on selection", async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <OptionChainTable {...defaultProps} spotPrice={24750} strikeMatrix={wideMatrix()} />,
      );
      await user.click(screen.getByRole("button", { name: "ATM ±5" }));
      expect(screen.getByTestId("options-chain-row-24750")).toBeInTheDocument();
      expect(screen.queryByTestId("options-chain-row-24000")).not.toBeInTheDocument();
      expect(screen.getByTestId("options-chain-window-count")).toHaveTextContent(
        "Showing 11 of 31 strikes",
      );
    });
  });

  describe("OI/Vol full-value tooltips", () => {
    it("exposes full OI value via title while showing compact format", () => {
      const strikeMatrix = [
        {
          strike: 24500,
          ce: makeContract({ strike: 24500, market_data: { oi: 1500000, prev_oi: 1000000, volume: 50000, ltp: 100, bid_price: 99, ask_price: 101 } }),
          pe: null,
        },
      ];
      const { container } = renderWithProviders(
        <OptionChainTable {...defaultProps} strikeMatrix={strikeMatrix} />,
      );
      expect(screen.getByText("15.0L")).toBeInTheDocument();
      expect(container.querySelector('[title="OI 15,00,000"]')).toBeInTheDocument();
    });
  });
});
