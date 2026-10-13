// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderWithProviders } from "../../../test-utils/renderWithProviders";
import { screen, cleanup, within, act, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { OptionChainTable, findAtmIndex } from "./OptionChainTable";
import { useChainLivePolling, CHAIN_POLL_INTERVAL_MS } from "../../../hooks/useChainLivePolling";
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

  describe("inline tick flash", () => {
    const matrix = (ltp: number, oi = 50000) => [
      { strike: 24500, ce: makeContract({ market_data: { ltp, oi, prev_oi: 45000 } }), pe: makeContract({ type: "PE", market_data: { ltp: 100, oi: 40000, prev_oi: 40000 } }) },
    ];

    it("no flash classes on first mount", () => {
      const { container } = renderWithProviders(
        <OptionChainTable {...defaultProps} strikeMatrix={matrix(150.5)} />,
      );
      expect(container.querySelector(".price-flash-up,.price-flash-down,.price-flash-chg")).toBeNull();
    });

    it("flashes LTP up green / down red on tick", () => {
      const { container, rerender } = renderWithProviders(
        <OptionChainTable {...defaultProps} strikeMatrix={matrix(150.5)} />,
      );
      rerender(<OptionChainTable {...defaultProps} strikeMatrix={matrix(152.0)} />);
      expect(container.querySelector(".price-flash-up")).not.toBeNull();
      rerender(<OptionChainTable {...defaultProps} strikeMatrix={matrix(149.0)} />);
      expect(container.querySelector(".price-flash-down")).not.toBeNull();
    });

    it("pulses OI cells neutrally on OI change without LTP move", () => {
      const { container, rerender } = renderWithProviders(
        <OptionChainTable {...defaultProps} strikeMatrix={matrix(150.5, 50000)} />,
      );
      rerender(<OptionChainTable {...defaultProps} strikeMatrix={matrix(150.5, 60000)} />);
      expect(container.querySelector(".price-flash-chg")).not.toBeNull();
      expect(container.querySelector(".price-flash-up,.price-flash-down")).toBeNull();
    });
  });

  describe("findAtmIndex", () => {    it("returns index of strike closest to spot", () => {
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

    // Heavy render (31 strikes × tooltip groups); generous timeout under load.
    it("hides far-OTM strikes by default and shows them with All", { timeout: 15_000 }, async () => {
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

  describe("in-cell OI/VOL bars", () => {
    function twoRowMatrix() {
      return [
        {
          strike: 24400,
          ce: makeContract({ strike: 24400, market_data: { oi: 100000, prev_oi: 90000, volume: 20000, ltp: 120, bid_price: 119, ask_price: 121 } }),
          pe: makeContract({ strike: 24400, type: "PE", market_data: { oi: 40000, prev_oi: 38000, volume: 8000, ltp: 60, bid_price: 59, ask_price: 61 } }),
        },
        {
          strike: 24500,
          ce: makeContract({ strike: 24500, market_data: { oi: 50000, prev_oi: 45000, volume: 10000, ltp: 100, bid_price: 99, ask_price: 101 } }),
          pe: makeContract({ strike: 24500, type: "PE", market_data: { oi: 20000, prev_oi: 19000, volume: 4000, ltp: 80, bid_price: 79, ask_price: 81 } }),
        },
      ];
    }

    it("renders an OI bar behind every OI value, scaled to the visible column max", () => {
      renderWithProviders(
        <OptionChainTable {...defaultProps} spotPrice={24500} strikeMatrix={twoRowMatrix()} />,
      );
      // Column max CE OI = 100000 → 24400 fills, 24500 is half
      expect(screen.getByTestId("options-oi-bar-CE-24400")).toHaveAttribute(
        "title",
        "OI 100% of column max",
      );
      expect(screen.getByTestId("options-oi-bar-CE-24500")).toHaveAttribute(
        "title",
        "OI 50% of column max",
      );
      // PE column max = 40000
      expect(screen.getByTestId("options-oi-bar-PE-24400")).toHaveAttribute(
        "title",
        "OI 100% of column max",
      );
      expect(screen.getByTestId("options-oi-bar-PE-24500")).toHaveAttribute(
        "title",
        "OI 50% of column max",
      );
    });

    it("renders a VOL bar behind every volume value, scaled to the visible column max", () => {
      renderWithProviders(
        <OptionChainTable {...defaultProps} spotPrice={24500} strikeMatrix={twoRowMatrix()} />,
      );
      expect(screen.getByTestId("options-vol-bar-CE-24400")).toHaveAttribute(
        "title",
        "Volume 100% of column max",
      );
      expect(screen.getByTestId("options-vol-bar-CE-24500")).toHaveAttribute(
        "title",
        "Volume 50% of column max",
      );
      expect(screen.getByTestId("options-vol-bar-PE-24400")).toBeInTheDocument();
      expect(screen.getByTestId("options-vol-bar-PE-24500")).toBeInTheDocument();
    });

    it("keeps the tabular-nums OI value readable on top of the bar", () => {
      renderWithProviders(
        <OptionChainTable {...defaultProps} spotPrice={24500} strikeMatrix={twoRowMatrix()} />,
      );
      expect(screen.getByText("1.0L")).toBeInTheDocument();
      expect(screen.getByText("50.0K")).toBeInTheDocument();
    });
  });

  describe("CE-vs-PE dominance micro-bar", () => {
    it("renders a stacked green/red split of strike OI in the strike cell", () => {
      const strikeMatrix = [
        {
          strike: 24500,
          ce: makeContract({ strike: 24500, market_data: { oi: 75000, prev_oi: 70000, volume: 10000, ltp: 100, bid_price: 99, ask_price: 101 } }),
          pe: makeContract({ strike: 24500, type: "PE", market_data: { oi: 25000, prev_oi: 24000, volume: 5000, ltp: 80, bid_price: 79, ask_price: 81 } }),
        },
      ];
      renderWithProviders(
        <OptionChainTable {...defaultProps} spotPrice={24500} strikeMatrix={strikeMatrix} />,
      );
      const bar = screen.getByTestId("options-dominance-24500");
      expect(bar).toBeInTheDocument();
      expect(bar).toHaveAttribute("title", "CE 75% / PE 25% of strike OI");
      // Two stacked segments: CE share then PE share
      expect(bar.children).toHaveLength(2);
    });

    it("falls back to an even split when a strike has no OI", () => {
      const strikeMatrix = [
        {
          strike: 24500,
          ce: makeContract({ strike: 24500, market_data: { oi: 0, prev_oi: 0, volume: 0, ltp: 100, bid_price: 99, ask_price: 101 } }),
          pe: null,
        },
      ];
      renderWithProviders(
        <OptionChainTable {...defaultProps} spotPrice={24500} strikeMatrix={strikeMatrix} />,
      );
      expect(screen.getByTestId("options-dominance-24500")).toHaveAttribute(
        "title",
        "CE 50% / PE 50% of strike OI",
      );
    });
  });

  describe("ITM zones", () => {
    const threeRows = [
      { strike: 24000, ce: makeContract({ strike: 24000 }), pe: makeContract({ strike: 24000, type: "PE" }) },
      { strike: 24500, ce: makeContract({ strike: 24500 }), pe: makeContract({ strike: 24500, type: "PE" }) },
      { strike: 25000, ce: makeContract({ strike: 25000 }), pe: makeContract({ strike: 25000, type: "PE" }) },
    ];

    it("marks strikes below spot as ITM on the call side", () => {
      renderWithProviders(
        <OptionChainTable {...defaultProps} spotPrice={24500} strikeMatrix={threeRows} />,
      );
      expect(screen.getByTestId("options-chain-row-24000")).toHaveAttribute("data-ce-itm", "true");
      expect(screen.getByTestId("options-chain-row-24000")).not.toHaveAttribute("data-pe-itm");
    });

    it("marks strikes above spot as ITM on the put side", () => {
      renderWithProviders(
        <OptionChainTable {...defaultProps} spotPrice={24500} strikeMatrix={threeRows} />,
      );
      expect(screen.getByTestId("options-chain-row-25000")).toHaveAttribute("data-pe-itm", "true");
      expect(screen.getByTestId("options-chain-row-25000")).not.toHaveAttribute("data-ce-itm");
    });

    it("keeps the ATM warning outline as the strongest signal", () => {
      const { container } = renderWithProviders(
        <OptionChainTable {...defaultProps} spotPrice={24500} strikeMatrix={threeRows} />,
      );
      const atmRow = container.querySelector(".chain-row-atm");
      expect(atmRow).toBeInTheDocument();
      expect(atmRow).toHaveAttribute("data-testid", "options-chain-row-24500");
      expect(screen.getByTestId("options-chain-atm-badge")).toBeInTheDocument();
    });
  });

  describe("OI change direction glyphs", () => {
    it("prefixes gains with ▲ and losses with ▼", () => {
      const strikeMatrix = [
        {
          strike: 24400,
          ce: makeContract({ strike: 24400, market_data: { oi: 50000, prev_oi: 45000, volume: 10000, ltp: 120, bid_price: 119, ask_price: 121 } }),
          pe: makeContract({ strike: 24400, type: "PE", market_data: { oi: 40000, prev_oi: 50000, volume: 8000, ltp: 60, bid_price: 59, ask_price: 61 } }),
        },
      ];
      renderWithProviders(
        <OptionChainTable {...defaultProps} spotPrice={24500} strikeMatrix={strikeMatrix} />,
      );
      const row = screen.getByTestId("options-chain-row-24400");
      expect(within(row).getByText("▲ 5.0K")).toBeInTheDocument();
      expect(within(row).getByText("▼ 10.0K")).toBeInTheDocument();
    });

    it("shows no glyph when OI is unchanged", () => {
      const strikeMatrix = [
        {
          strike: 24500,
          ce: makeContract({ strike: 24500, market_data: { oi: 50000, prev_oi: 50000, volume: 10000, ltp: 100, bid_price: 99, ask_price: 101 } }),
          pe: null,
        },
      ];
      renderWithProviders(
        <OptionChainTable {...defaultProps} spotPrice={24500} strikeMatrix={strikeMatrix} />,
      );
      const row = screen.getByTestId("options-chain-row-24500");
      expect(within(row).getByText("0")).toBeInTheDocument();
      expect(within(row).queryByText(/▲/)).not.toBeInTheDocument();
    });
  });

  describe("chain live polling (useChainLivePolling)", () => {
    const hiddenDescriptor = Object.getOwnPropertyDescriptor(document, "hidden");

    function PollHarness({
      refresh,
      timestamp,
    }: {
      refresh: () => void | Promise<unknown>;
      timestamp?: string;
    }) {
      const { liveState, manualRefresh } = useChainLivePolling(refresh, timestamp, {
        intervalMs: CHAIN_POLL_INTERVAL_MS,
      });
      return (
        <div>
          <span data-testid="harness-live">{liveState.label}</span>
          <button data-testid="harness-manual" onClick={manualRefresh} type="button">
            manual
          </button>
        </div>
      );
    }

    function setHidden(value: boolean) {
      Object.defineProperty(document, "hidden", { value, configurable: true });
    }

    beforeEach(() => {
      vi.useFakeTimers();
      setHidden(false);
    });

    afterEach(() => {
      if (hiddenDescriptor) {
        Object.defineProperty(document, "hidden", hiddenDescriptor);
      }
      vi.useRealTimers();
    });

    it("refetches on the 15s cadence", async () => {
      const refresh = vi.fn();
      render(<PollHarness refresh={refresh} timestamp={new Date().toISOString()} />);
      expect(refresh).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(CHAIN_POLL_INTERVAL_MS);
      });
      expect(refresh).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(CHAIN_POLL_INTERVAL_MS);
      });
      expect(refresh).toHaveBeenCalledTimes(2);
    });

    it("pauses while the document is hidden and catches up on visible", async () => {
      const refresh = vi.fn();
      render(<PollHarness refresh={refresh} timestamp={new Date().toISOString()} />);
      setHidden(true);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(CHAIN_POLL_INTERVAL_MS * 3);
      });
      expect(refresh).not.toHaveBeenCalled();
      setHidden(false);
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("never overlaps in-flight fetches", async () => {
      let release!: () => void;
      const refresh = vi.fn(
        () => new Promise<void>((resolve) => { release = resolve; }),
      );
      render(<PollHarness refresh={refresh} timestamp={new Date().toISOString()} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(CHAIN_POLL_INTERVAL_MS);
      });
      expect(refresh).toHaveBeenCalledTimes(1);
      // Two more ticks while the first fetch is still in flight → skipped
      await act(async () => {
        await vi.advanceTimersByTimeAsync(CHAIN_POLL_INTERVAL_MS * 2);
      });
      expect(refresh).toHaveBeenCalledTimes(1);
      await act(async () => {
        release();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(CHAIN_POLL_INTERVAL_MS);
      });
      expect(refresh).toHaveBeenCalledTimes(2);
    });

    it("manual refresh fetches immediately and resets the timer", async () => {
      const refresh = vi.fn();
      render(<PollHarness refresh={refresh} timestamp={new Date().toISOString()} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(refresh).not.toHaveBeenCalled();
      // Direct dispatch: userEvent.click deadlocks under fake timers.
      await act(async () => {
        screen.getByTestId("harness-manual").click();
      });
      expect(refresh).toHaveBeenCalledTimes(1);
      // Timer restarted: 10s more is not enough, 15s is
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(refresh).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(refresh).toHaveBeenCalledTimes(2);
    });
  });
});
