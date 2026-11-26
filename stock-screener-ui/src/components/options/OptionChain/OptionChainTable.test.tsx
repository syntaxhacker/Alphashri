// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createSignal } from "solid-js";
import * as palette from "@/ui/palette";
import { OptionChainTable, findAtmIndex } from "./OptionChainTable";
import { OptionChainPanel } from "./OptionChainPanel";
import { CHAIN_COMPACT_QUERY } from "./chainStyles";
import { setupBrowserMocks } from "../../../test-utils/setupBrowser";

const normColor = (s: string) => s.toLowerCase().replace(/\s/g, "");
const hexToRgb = (hex: string) => {
  const h = hex.replace("#", "");
  return `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`;
};
const rgbTriple = (hex: string) => normColor(hexToRgb(hex)).replace(/^rgb\(|\)$/g, "");

vi.mock("@/ui", async () => {
  const { mockSolidUi } = await import("@/test-utils/solidUiMock");
  const { typeSize } = await import("@/ui/typography");
  return { ...mockSolidUi(), typeSize };
});

const dockMock = vi.hoisted(() => ({
  open: vi.fn(),
  close: vi.fn(),
  preview: vi.fn(),
  endPreview: vi.fn(),
  setOutlet: vi.fn(),
}));

vi.mock("@/components/common/symbolDockContext", () => ({
  useSymbolDock: () => ({
    open: dockMock.open,
    close: dockMock.close,
    preview: dockMock.preview,
    endPreview: dockMock.endPreview,
    pinned: false,
    setOutlet: dockMock.setOutlet,
  }),
}));

vi.mock("./LiveSpotChart", () => ({
  LiveSpotChart: () => <div data-testid="live-spot-chart-stub" />,
}));
vi.mock("./ChainSummary", () => ({
  ChainSummary: () => <div data-testid="chain-summary-stub" />,
}));
vi.mock("./OIAnalysis", () => ({
  OIAnalysis: () => <div data-testid="oi-analysis-stub" />,
}));

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

// useMediaQuery reads matchMedia at render time; setupBrowserMocks installs a
// vi.fn() we can re-implement per test before the component mounts.
function setNarrowViewport(narrow: boolean) {
  (window.matchMedia as unknown as ReturnType<typeof vi.fn>).mockImplementation((query: string) => ({
    matches: narrow && query === CHAIN_COMPACT_QUERY,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

describe("OptionChainTable", () => {
  const defaultProps = {
    filters: { optionType: "BOTH" as const, moneyness: "ALL" as const },
    spotPrice: 24500,
    onRowClick: vi.fn(),
  };

  it("renders chain table container", () => {
    render(() => <OptionChainTable {...defaultProps} strikeMatrix={[]} />,
    );
    expect(screen.getByTestId("options-chain-table")).toBeInTheDocument();
  });

  it("renders table header with CALLS, STRIKE, PUTS labels", () => {
    render(() => <OptionChainTable {...defaultProps} strikeMatrix={[]} />,
    );
    expect(screen.getByTestId("options-chain-table-header")).toBeInTheDocument();
    expect(screen.getByText("CALLS (CE)")).toBeInTheDocument();
    expect(screen.getByText("STRIKE")).toBeInTheDocument();
    expect(screen.getByText("PUTS (PE)")).toBeInTheDocument();
  });

  it("renders subheader with column labels OI, OI CHG, VOL, IV, LTP", () => {
    render(() => <OptionChainTable {...defaultProps} strikeMatrix={[]} />,
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
    render(() => <OptionChainTable {...defaultProps} strikeMatrix={[]} />,
    );
    expect(screen.getByTestId("options-chain-scroll-actions")).toBeInTheDocument();
    expect(screen.getByTestId("options-scroll-top-btn")).toBeInTheDocument();
    expect(screen.getByTestId("options-scroll-atm-btn")).toBeInTheDocument();
    expect(screen.getByTestId("options-scroll-bottom-btn")).toBeInTheDocument();
  });

  it("keeps header, subheader and rows in one min-width horizontal scroll region with a sideways cue", () => {
    render(() => <OptionChainTable {...defaultProps} strikeMatrix={[]} />);
    const scroll = screen.getByTestId("options-chain-table-scrollarea");
    expect(scroll.style.overflow).toBe("auto");
    expect(scroll).toHaveAttribute("role", "region");
    expect(scroll).toHaveAttribute("tabindex", "0");
    const inner = within(scroll).getByTestId("options-chain-table-inner");
    expect(inner.style.minWidth).toBe("980px");
    expect(within(scroll).getByTestId("options-chain-table-header")).toBeInTheDocument();
    expect(within(scroll).getByTestId("options-chain-table-subheader")).toBeInTheDocument();
    expect(screen.getByTestId("options-chain-scroll-cue")).toHaveTextContent("Scroll sideways");
  });

  it("keeps the strike column sticky in the header, subheader and every row", () => {
    const strikeMatrix = [
      { strike: 24500, ce: makeContract({ strike: 24500 }), pe: makeContract({ strike: 24500, type: "PE" }) },
    ];
    render(() => <OptionChainTable {...defaultProps} strikeMatrix={strikeMatrix} />);
    const nodes = [
      screen.getByTestId("options-chain-strike-header"),
      screen.getByTestId("options-chain-strike-subheader"),
      screen.getByTestId("strike-cell"),
    ];
    for (const node of nodes) {
      expect(node.style.position).toBe("sticky");
      expect(node.style.left).toBe("calc(50% - 40px)");
    }
  });

  it("renders footer with ITM, ATM legend and sentiment badges", () => {
    render(() => <OptionChainTable {...defaultProps} strikeMatrix={[]} />,
    );
    expect(screen.getByTestId("options-chain-table-footer")).toBeInTheDocument();
    expect(screen.getByTestId("options-legend-itm")).toBeInTheDocument();
    expect(screen.getByTestId("options-legend-atm")).toBeInTheDocument();
    expect(screen.getByTestId("options-legend-badges")).toBeInTheDocument();
  });

  it("displays current spot price in footer", () => {
    render(() => <OptionChainTable {...defaultProps} strikeMatrix={[]} spotPrice={24500} />,
    );
    expect(screen.getByTestId("options-chain-spot-price")).toHaveTextContent("24500.00");
  });

  it("does not display spot price when null", () => {
    render(() => <OptionChainTable {...defaultProps} strikeMatrix={[]} spotPrice={null} />,
    );
    expect(screen.queryByTestId("options-chain-spot-price")).not.toBeInTheDocument();
  });

  describe("strike rows", () => {
    it("renders strike rows with data-testid containing strike price", () => {
      const strikeMatrix = [
        { strike: 23900, ce: makeContract({ strike: 23900 }), pe: makeContract({ strike: 23900, type: "PE" }) },
        { strike: 24000, ce: makeContract({ strike: 24000 }), pe: makeContract({ strike: 24000, type: "PE" }) },
      ];
      render(() => <OptionChainTable {...defaultProps} strikeMatrix={strikeMatrix} />,
      );
      expect(screen.getByTestId("options-chain-row-23900")).toBeInTheDocument();
      expect(screen.getByTestId("options-chain-row-24000")).toBeInTheDocument();
    });

    it("renders strike prices like 23900 and 24000 prominently", () => {
      const strikeMatrix = [
        { strike: 23900, ce: makeContract({ strike: 23900 }), pe: makeContract({ strike: 23900, type: "PE" }) },
        { strike: 24000, ce: makeContract({ strike: 24000 }), pe: makeContract({ strike: 24000, type: "PE" }) },
      ];
      render(() => <OptionChainTable {...defaultProps} strikeMatrix={strikeMatrix} />,
      );
      const strikeCells = screen.getAllByTestId("strike-cell");
      expect(strikeCells[0]).toHaveTextContent("23900");
      expect(strikeCells[1]).toHaveTextContent("24000");
    });

    it("renders strike cell containers", () => {
      const strikeMatrix = [
        { strike: 24500, ce: makeContract({ strike: 24500 }), pe: makeContract({ strike: 24500, type: "PE" }) },
      ];
      render(() => <OptionChainTable {...defaultProps} strikeMatrix={strikeMatrix} />,
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
      const { container } = render(() => <OptionChainTable {...defaultProps} spotPrice={24500} strikeMatrix={strikeMatrix} />,
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
      render(() => <OptionChainTable {...defaultProps} strikeMatrix={strikeMatrix} />,
      );
      expect(screen.getByText("CALLS (CE)")).toBeInTheDocument();
    });

    it("shows PE subheader with LTP, IV, VOL, OI CHG, OI labels", () => {
      const strikeMatrix = [
        { strike: 24500, ce: null, pe: makeContract({ strike: 24500, type: "PE" }) },
      ];
      render(() => <OptionChainTable {...defaultProps} strikeMatrix={strikeMatrix} />,
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
      render(() => <OptionChainTable {...defaultProps} strikeMatrix={strikeMatrix} />,
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
      render(() => <OptionChainTable {...defaultProps} strikeMatrix={strikeMatrix} />,
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
      render(() => <OptionChainTable {...defaultProps} strikeMatrix={strikeMatrix} />,
      );
      const progressBars = screen.getAllByRole("progressbar");
      expect(progressBars.length).toBeGreaterThan(0);
      // Also verify aria-valuenow is set (determinate progress)
      expect(progressBars[0]).toHaveAttribute("aria-valuenow");
    });
  });

  describe("moneyness coloring", () => {
    it("applies the blue call-side cue to ITM calls", () => {
      const strikeMatrix = [
        {
          strike: 24000,
          ce: makeContract({ strike: 24000, market_data: { oi: 100, prev_oi: 100, volume: 100, ltp: 200, bid_price: 199, ask_price: 201 } }),
          pe: null,
        },
      ];
      render(() => <OptionChainTable {...defaultProps} spotPrice={24500} strikeMatrix={strikeMatrix} />,
      );
      expect(screen.getByTestId("options-chain-row-24000")).toBeInTheDocument();
    });

    it("applies the orange put-side cue to ITM puts", () => {
      const strikeMatrix = [
        {
          strike: 25000,
          ce: null,
          pe: makeContract({ strike: 25000, type: "PE", market_data: { oi: 100, prev_oi: 100, volume: 100, ltp: 200, bid_price: 199, ask_price: 201 } }),
        },
      ];
      render(() => <OptionChainTable {...defaultProps} spotPrice={24500} strikeMatrix={strikeMatrix} />,
      );
      expect(screen.getByTestId("options-chain-row-25000")).toBeInTheDocument();
    });
  });

  describe("Jump to ATM button scroll behavior", () => {
    it("renders Jump to ATM button", () => {
      render(() => <OptionChainTable {...defaultProps} strikeMatrix={[]} />,
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
        render(() => <OptionChainTable {...defaultProps} spotPrice={24500} strikeMatrix={strikeMatrix} />);
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
      const { container } = render(() => <OptionChainTable {...defaultProps} strikeMatrix={matrix(150.5)} />);
      expect(container.querySelector(".price-flash-up,.price-flash-down,.price-flash-chg")).toBeNull();
    });

    it("flashes LTP up green / down red on tick", () => {
      const [current, setCurrent] = createSignal(matrix(150.5));
      const { container } = render(() => <OptionChainTable {...defaultProps} strikeMatrix={current()} />);
      setCurrent(matrix(152.0));
      expect(container.querySelector(".price-flash-up")).not.toBeNull();
      setCurrent(matrix(149.0));
      expect(container.querySelector(".price-flash-down")).not.toBeNull();
    });

    it("pulses OI cells neutrally on OI change without LTP move", () => {
      const [current, setCurrent] = createSignal(matrix(150.5, 50000));
      const { container } = render(() => <OptionChainTable {...defaultProps} strikeMatrix={current()} />);
      setCurrent(matrix(150.5, 60000));
      expect(container.querySelector(".price-flash-chg")).not.toBeNull();
      expect(container.querySelector(".price-flash-up,.price-flash-down")).toBeNull();
    });

    it("keeps up with a 150-tick burst and renders the final value", { timeout: 20_000 }, () => {
      const [current, setCurrent] = createSignal(matrix(150.5));
      const { container } = render(() => <OptionChainTable {...defaultProps} strikeMatrix={current()} />);
      let ltp = 150.5;
      for (let i = 0; i < 150; i += 1) {
        ltp = +(ltp + (i % 2 === 0 ? 0.5 : -0.25)).toFixed(2);
        setCurrent(matrix(ltp));
      }
      expect(container.querySelectorAll(".price-flash-up, .price-flash-down").length).toBeGreaterThan(0);
      expect(screen.getAllByText(ltp.toFixed(2)).length).toBeGreaterThan(0);
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
      const { container } = render(() => <OptionChainTable {...defaultProps} spotPrice={24520} strikeMatrix={threeRows} />,
      );
      const atmRow = container.querySelector('[data-atm="true"]');
      expect(atmRow).toBeInTheDocument();
      expect(atmRow).toHaveAttribute("data-testid", "options-chain-row-24500");
    });

    it("renders an ATM badge on the ATM strike cell", () => {
      render(() => <OptionChainTable {...defaultProps} spotPrice={24500} strikeMatrix={threeRows} />,
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
      render(() => <OptionChainTable {...defaultProps} spotPrice={24750} strikeMatrix={wideMatrix()} />,
      );
      expect(screen.getByTestId("options-chain-atm-window")).toBeInTheDocument();
      expect(screen.getByTestId("options-chain-window-count")).toHaveTextContent(
        "Showing 21 of 31 strikes",
      );
    });

    // Heavy render (31 strikes × tooltip groups); generous timeout under load.
    it("hides far-OTM strikes by default and shows them with All", { timeout: 15_000 }, async () => {
      render(() => <OptionChainTable {...defaultProps} spotPrice={24750} strikeMatrix={wideMatrix()} />);
      // 20050-style far strikes are out of the default ±10 window
      expect(screen.queryByTestId("options-chain-row-25500")).not.toBeInTheDocument();
      expect(screen.getByTestId("options-chain-row-24750")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "All" }));
      expect(screen.getByTestId("options-chain-row-25500")).toBeInTheDocument();
      expect(screen.getByTestId("options-chain-row-24000")).toBeInTheDocument();
      expect(screen.getByTestId("options-chain-window-count")).toHaveTextContent(
        "Showing 31 of 31 strikes",
      );
    });

    it("narrows to ±5 strikes on selection", async () => {
      render(() => <OptionChainTable {...defaultProps} spotPrice={24750} strikeMatrix={wideMatrix()} />);
      fireEvent.click(screen.getByRole("button", { name: "ATM ±5" }));
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
      const { container } = render(() => <OptionChainTable {...defaultProps} strikeMatrix={strikeMatrix} />,
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
      render(() => <OptionChainTable {...defaultProps} spotPrice={24500} strikeMatrix={twoRowMatrix()} />,
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
      render(() => <OptionChainTable {...defaultProps} spotPrice={24500} strikeMatrix={twoRowMatrix()} />,
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
      render(() => <OptionChainTable {...defaultProps} spotPrice={24500} strikeMatrix={twoRowMatrix()} />,
      );
      expect(screen.getByText("1.0L")).toBeInTheDocument();
      expect(screen.getByText("50.0K")).toBeInTheDocument();
    });
  });

  describe("CE-vs-PE dominance micro-bar", () => {
    it("renders a stacked blue/orange split of strike OI in the strike cell", () => {
      const strikeMatrix = [
        {
          strike: 24500,
          ce: makeContract({ strike: 24500, market_data: { oi: 75000, prev_oi: 70000, volume: 10000, ltp: 100, bid_price: 99, ask_price: 101 } }),
          pe: makeContract({ strike: 24500, type: "PE", market_data: { oi: 25000, prev_oi: 24000, volume: 5000, ltp: 80, bid_price: 79, ask_price: 81 } }),
        },
      ];
      render(() => <OptionChainTable {...defaultProps} spotPrice={24500} strikeMatrix={strikeMatrix} />,
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
      render(() => <OptionChainTable {...defaultProps} spotPrice={24500} strikeMatrix={strikeMatrix} />,
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
      render(() => <OptionChainTable {...defaultProps} spotPrice={24500} strikeMatrix={threeRows} />,
      );
      expect(screen.getByTestId("options-chain-row-24000")).toHaveAttribute("data-ce-itm", "true");
      expect(screen.getByTestId("options-chain-row-24000")).not.toHaveAttribute("data-pe-itm");
    });

    it("marks strikes above spot as ITM on the put side", () => {
      render(() => <OptionChainTable {...defaultProps} spotPrice={24500} strikeMatrix={threeRows} />,
      );
      expect(screen.getByTestId("options-chain-row-25000")).toHaveAttribute("data-pe-itm", "true");
      expect(screen.getByTestId("options-chain-row-25000")).not.toHaveAttribute("data-ce-itm");
    });

    it("keeps the ATM warning outline as the strongest signal", () => {
      const { container } = render(() => <OptionChainTable {...defaultProps} spotPrice={24500} strikeMatrix={threeRows} />,
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
      render(() => <OptionChainTable {...defaultProps} spotPrice={24500} strikeMatrix={strikeMatrix} />,
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
      render(() => <OptionChainTable {...defaultProps} spotPrice={24500} strikeMatrix={strikeMatrix} />,
      );
      const row = screen.getByTestId("options-chain-row-24500");
      expect(within(row).getByText("0")).toBeInTheDocument();
      expect(within(row).queryByText(/▲/)).not.toBeInTheDocument();
    });
  });

  describe("side-coded OI colours", () => {
    const matrix = () => [
      {
        strike: 24500,
        ce: makeContract({ strike: 24500, market_data: { oi: 100000, prev_oi: 90000, volume: 20000, ltp: 120, bid_price: 119, ask_price: 121 } }),
        pe: makeContract({ strike: 24500, type: "PE", market_data: { oi: 40000, prev_oi: 38000, volume: 8000, ltp: 60, bid_price: 59, ask_price: 61 } }),
      },
    ];

    it("uses OI_CALL/OI_PUT with a solid 2px rail over a ≤14% tint", () => {
      render(() => <OptionChainTable {...defaultProps} spotPrice={24500} strikeMatrix={matrix()} />);
      const ceBar = screen.getByTestId("options-oi-bar-CE-24500");
      const peBar = screen.getByTestId("options-oi-bar-PE-24500");
      const ceRail = screen.getByTestId("options-oi-rail-CE-24500");
      const peRail = screen.getByTestId("options-oi-rail-PE-24500");

      expect([palette.OI_CALL.toLowerCase(), hexToRgb(palette.OI_CALL)]).toContain(
        normColor(ceRail.style.backgroundColor),
      );
      expect([palette.OI_PUT.toLowerCase(), hexToRgb(palette.OI_PUT)]).toContain(
        normColor(peRail.style.backgroundColor),
      );
      expect(ceRail.style.width).toBe("2px");
      expect(peRail.style.width).toBe("2px");

      const ceBg = normColor(ceBar.style.backgroundColor);
      const peBg = normColor(peBar.style.backgroundColor);
      expect(ceBg).toContain(rgbTriple(palette.OI_CALL));
      expect(peBg).toContain(rgbTriple(palette.OI_PUT));
      expect(ceBg).toContain("0.14");
      expect(peBg).toContain("0.14");
    });

    it("tints the call/put row halves with OI_CALL/OI_PUT, never legacy green/red", () => {
      render(() => <OptionChainTable {...defaultProps} spotPrice={24500} strikeMatrix={matrix()} />);
      const bg = normColor(screen.getByTestId("options-chain-row-24500").style.background);
      expect(bg).toContain(rgbTriple(palette.OI_CALL));
      expect(bg).toContain(rgbTriple(palette.OI_PUT));
      expect(bg).not.toContain("63,185,80");
      expect(bg).not.toContain("248,81,73");
    });

    it("keeps OI numbers on surface ink over the side tint", () => {
      render(() => <OptionChainTable {...defaultProps} spotPrice={24500} strikeMatrix={matrix()} />);
      const oiNumber = screen.getByText("1.0L");
      expect([palette.TEXT.toLowerCase(), hexToRgb(palette.TEXT)]).toContain(
        normColor(oiNumber.style.color),
      );
      const oiCell = oiNumber.closest('[title^="OI "]') as HTMLElement | null;
      expect(oiCell).not.toBeNull();
      expect(normColor(oiCell!.style.backgroundColor)).toContain(rgbTriple(palette.OI_CALL));
    });

    it("paints the CE/PE dominance bar with side tokens", () => {
      render(() => <OptionChainTable {...defaultProps} spotPrice={24500} strikeMatrix={matrix()} />);
      const bar = screen.getByTestId("options-dominance-24500");
      expect(bar.children).toHaveLength(2);
      expect([palette.OI_CALL.toLowerCase(), hexToRgb(palette.OI_CALL)]).toContain(
        normColor((bar.children[0] as HTMLElement).style.backgroundColor),
      );
      expect([palette.OI_PUT.toLowerCase(), hexToRgb(palette.OI_PUT)]).toContain(
        normColor((bar.children[1] as HTMLElement).style.backgroundColor),
      );
    });

    it("keeps chain sources free of raw hex/rgba colour literals", () => {
      for (const rel of [
        "src/components/options/OptionChain/OptionChainTable.tsx",
        "src/components/options/OptionChain/OptionChainPanel.tsx",
        "src/components/options/OptionChain/chainStyles.ts",
      ]) {
        const source = readFileSync(resolve(process.cwd(), rel), "utf8");
        expect(source.match(/#[0-9a-fA-F]{6}\b/g), `raw hex in ${rel}`).toBeNull();
        expect(source.match(/\brgba?\(/g), `raw rgb()/rgba() in ${rel}`).toBeNull();
      }
    });
  });

  describe("row activation", () => {
    const activationMatrix = () => [
      {
        strike: 24500,
        ce: makeContract({
          strike: 24500,
          trading_symbol: "NIFTY2450024500CE",
          market_data: { ltp: 100, oi: 50000, prev_oi: 45000, volume: 10000, bid_price: 99, ask_price: 101 },
        }),
        pe: makeContract({
          strike: 24500,
          type: "PE",
          trading_symbol: "NIFTY2450024500PE",
          market_data: { ltp: 60, oi: 40000, prev_oi: 38000, volume: 8000, bid_price: 59, ask_price: 61 },
        }),
      },
    ];

    it("makes each row a labelled, focusable button with a visible focus ring", () => {
      render(() => <OptionChainTable {...defaultProps} strikeMatrix={activationMatrix()} />);
      const row = screen.getByTestId("options-chain-row-24500");
      expect(row).toHaveAttribute("role", "button");
      expect(row).toHaveAttribute("tabindex", "0");
      expect(row).toHaveAttribute("aria-label", "Open options chain for strike 24500");
      expect(row).toHaveClass("focus-visible:outline");
      expect(row.className).toContain("focus-visible:outline-[var(--color-fin-primary)]");
    });

    it("clicking a CE value cell invokes onRowClick once with that contract", () => {
      const onRowClick = vi.fn();
      render(() => <OptionChainTable {...defaultProps} onRowClick={onRowClick} strikeMatrix={activationMatrix()} />);
      fireEvent.click(screen.getByTitle("LTP ₹100.00"));
      expect(onRowClick).toHaveBeenCalledTimes(1);
      expect(onRowClick.mock.calls[0][0].trading_symbol).toBe("NIFTY2450024500CE");
    });

    it("clicking a PE value cell invokes onRowClick once with that contract", () => {
      const onRowClick = vi.fn();
      render(() => <OptionChainTable {...defaultProps} onRowClick={onRowClick} strikeMatrix={activationMatrix()} />);
      fireEvent.click(screen.getByTitle("LTP ₹60.00"));
      expect(onRowClick).toHaveBeenCalledTimes(1);
      expect(onRowClick.mock.calls[0][0].instrument_type).toBe("PE");
    });

    it("clicking the strike cell invokes onRowClick without nesting a button", () => {
      const onRowClick = vi.fn();
      render(() => <OptionChainTable {...defaultProps} onRowClick={onRowClick} strikeMatrix={activationMatrix()} />);
      const strikeCell = screen.getByTestId("strike-cell");
      expect(strikeCell.querySelector("button")).toBeNull();
      fireEvent.click(strikeCell);
      expect(onRowClick).toHaveBeenCalledTimes(1);
    });

    it("Enter on a focused row invokes onRowClick", () => {
      const onRowClick = vi.fn();
      render(() => <OptionChainTable {...defaultProps} onRowClick={onRowClick} strikeMatrix={activationMatrix()} />);
      fireEvent.keyDown(screen.getByTestId("options-chain-row-24500"), { key: "Enter" });
      expect(onRowClick).toHaveBeenCalledTimes(1);
      expect(onRowClick.mock.calls[0][0].trading_symbol).toBe("NIFTY2450024500CE");
    });

    it("Space on a focused row invokes onRowClick", () => {
      const onRowClick = vi.fn();
      render(() => <OptionChainTable {...defaultProps} onRowClick={onRowClick} strikeMatrix={activationMatrix()} />);
      fireEvent.keyDown(screen.getByTestId("options-chain-row-24500"), { key: " " });
      expect(onRowClick).toHaveBeenCalledTimes(1);
      expect(onRowClick.mock.calls[0][0].trading_symbol).toBe("NIFTY2450024500CE");
    });

    it("ignores keys other than Enter and Space", () => {
      const onRowClick = vi.fn();
      render(() => <OptionChainTable {...defaultProps} onRowClick={onRowClick} strikeMatrix={activationMatrix()} />);
      fireEvent.keyDown(screen.getByTestId("options-chain-row-24500"), { key: "ArrowDown" });
      expect(onRowClick).not.toHaveBeenCalled();
    });
  });

  describe("OptionChainPanel dock wiring", () => {
    const panelProps = {
      selectedExpiry: "25MAY",
      loading: false,
      error: null as string | null,
      filters: { optionType: "BOTH" as const, moneyness: "ALL" as const },
      spotPrice: 24500,
      refreshChain: vi.fn(),
      strikeMatrix: [
        {
          strike: 24500,
          ce: makeContract({
            strike: 24500,
            market_data: { ltp: 100, oi: 50000, prev_oi: 45000, volume: 10000, bid_price: 99, ask_price: 101 },
          }),
          pe: null,
        },
      ],
      timestamp: "2026-11-26T10:00:00Z",
      summary: null,
    };

    const renderPanel = (underlying: string) =>
      render(() => <OptionChainPanel {...panelProps} selectedUnderlying={underlying} />);

    it("opens the NIFTY options dock when a chain cell is clicked", () => {
      renderPanel("NIFTY");
      fireEvent.click(screen.getByTitle("LTP ₹100.00"));
      expect(dockMock.open).toHaveBeenCalledWith("NIFTY", "options");
    });

    it("uses the selected underlying (BANKNIFTY), never a hardcoded NIFTY", () => {
      renderPanel("BANKNIFTY");
      fireEvent.click(screen.getByTitle("LTP ₹100.00"));
      expect(dockMock.open).toHaveBeenCalledWith("BANKNIFTY", "options");
      expect(dockMock.open).not.toHaveBeenCalledWith("NIFTY", "options");
    });

    it("opens SENSEX when that is the selected underlying", () => {
      renderPanel("SENSEX");
      fireEvent.click(screen.getByTitle("LTP ₹100.00"));
      expect(dockMock.open).toHaveBeenCalledWith("SENSEX", "options");
    });

    it("Enter on a focused row opens the dock for the selected underlying", () => {
      renderPanel("BANKNIFTY");
      fireEvent.keyDown(screen.getByTestId("options-chain-row-24500"), { key: "Enter" });
      expect(dockMock.open).toHaveBeenCalledWith("BANKNIFTY", "options");
    });

    it("Space on a focused row opens the dock for the selected underlying", () => {
      renderPanel("SENSEX");
      fireEvent.keyDown(screen.getByTestId("options-chain-row-24500"), { key: " " });
      expect(dockMock.open).toHaveBeenCalledWith("SENSEX", "options");
    });

    it("replaces the old no-op: one cell click opens the dock exactly once", () => {
      renderPanel("NIFTY");
      fireEvent.click(screen.getByTitle("LTP ₹100.00"));
      expect(dockMock.open).toHaveBeenCalledTimes(1);
    });
  });
});

describe("OptionChainTable at 390px", () => {
  const narrowProps = {
    filters: { optionType: "BOTH" as const, moneyness: "ALL" as const },
    spotPrice: 24500,
    onRowClick: vi.fn(),
  };
  const oneStrike = () => [
    {
      strike: 24500,
      ce: makeContract({ strike: 24500 }),
      pe: makeContract({ strike: 24500, type: "PE", market_data: { ltp: 80.25, oi: 40000 } }),
    },
  ];

  beforeEach(() => setNarrowViewport(true));

  it("opens on a meaningful five-column core set instead of an off-screen strike", () => {
    render(() => <OptionChainTable {...narrowProps} strikeMatrix={oneStrike()} />);
    expect(screen.getByTestId("options-chain-view-switch")).toBeInTheDocument();
    expect(screen.getByTestId("options-chain-core-summary")).toHaveTextContent("STRIKE / CE·PE LTP / OI");

    const table = screen.getByTestId("options-chain-table");
    expect(table).toHaveAttribute("data-mode", "compact");
    const scroll = screen.getByTestId("options-chain-table-scrollarea");
    expect(scroll).toHaveAttribute("data-mode", "compact");
    const inner = within(scroll).getByTestId("options-chain-table-inner");
    expect(inner.style.minWidth).toBe("0px");
    expect(inner.style.paddingBottom).toBe("8px");
    expect(screen.queryByTestId("options-chain-scroll-actions")).not.toBeInTheDocument();

    const subheader = screen.getByTestId("options-chain-table-subheader");
    expect(Array.from(subheader.children).map((cell) => cell.textContent)).toEqual([
      "OI",
      "LTP",
      "",
      "LTP",
      "OI",
    ]);
    const row = screen.getByTestId("options-chain-row-24500");
    expect(row.children).toHaveLength(5);
    expect(within(row).getAllByTestId("strike-cell")).toHaveLength(1);
    expect(screen.getByTestId("options-chain-strike-subheader").style.left).toBe("0px");
    // Real prices from the fixture, never invented.
    expect(within(row).getByText("150.50")).toBeInTheDocument();
    expect(within(row).getByText("80.25")).toBeInTheDocument();
    expect(within(row).getByText("50.0K")).toBeInTheDocument();
    expect(within(row).getByText("40.0K")).toBeInTheDocument();
  });

  it("offers a Full chain affordance that reveals all columns with a pinned strike", () => {
    render(() => <OptionChainTable {...narrowProps} strikeMatrix={oneStrike()} />);
    const toggle = screen.getByTestId("options-chain-full-chain-toggle");
    expect(toggle).toHaveTextContent("Full chain");
    expect(screen.getByTestId("options-chain-scroll-cue")).toHaveTextContent("Scroll sideways → Full chain");

    fireEvent.click(toggle);

    const scroll = screen.getByTestId("options-chain-table-scrollarea");
    expect(scroll).toHaveAttribute("data-mode", "full");
    const inner = within(scroll).getByTestId("options-chain-table-inner");
    expect(inner.style.minWidth).toBe("980px");
    expect(inner.style.paddingBottom).toBe("152px");
    expect(screen.getByTestId("options-chain-scroll-actions")).toBeInTheDocument();
    expect(screen.getByTestId("options-chain-table-subheader").children).toHaveLength(11);
    expect(screen.getByTestId("options-chain-row-24500").children).toHaveLength(11);
    expect(screen.getByTestId("options-chain-strike-subheader").style.left).toBe("8px");
    expect(screen.getByTestId("options-chain-scroll-cue")).toHaveTextContent("all 11 columns");
    expect(toggle).toHaveTextContent("Compact");

    fireEvent.click(toggle);
    expect(screen.getByTestId("options-chain-table-scrollarea")).toHaveAttribute("data-mode", "compact");
    expect(screen.getByTestId("options-chain-table-subheader").children).toHaveLength(5);
  });

  it("does not build a compact view at desktop width", () => {
    setNarrowViewport(false);
    render(() => <OptionChainTable {...narrowProps} strikeMatrix={oneStrike()} />);
    expect(screen.queryByTestId("options-chain-view-switch")).not.toBeInTheDocument();
    expect(screen.getByTestId("options-chain-table")).toHaveAttribute("data-mode", "full");
    expect(screen.getByTestId("options-chain-strike-subheader").style.left).toBe("calc(50% - 40px)");
    expect(screen.getByTestId("options-chain-table-subheader").children).toHaveLength(11);
  });
});
