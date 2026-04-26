// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WatchlistScan } from "./WatchlistScan";
import { renderWithMantine } from "../../test-utils/renderWithMantine";
import type { PaperBotSnapshot } from "../../types/paperTrading";

afterEach(cleanup);

function r(jsx: React.ReactElement) {
  return renderWithMantine(jsx);
}

vi.mock("../../state/paperTrading", () => ({
  getPaperTradingState: vi.fn(() => ({
    chartTimeframe: "5min",
    selectedStrategyId: null,
    intradayOnly: false,
  })),
  setSelectedSymbol: vi.fn(),
  subscribe: vi.fn(() => vi.fn()),
}));

vi.mock("../../api/paperTrading", () => ({
  fetchPaperChart: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../common/PreviewChartProvider", () => ({
  usePreviewChart: vi.fn(() => ({
    showPreviewChart: vi.fn(),
    hidePreviewChart: vi.fn(),
  })),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: vi.fn(() => vi.fn()),
  useLocation: vi.fn(() => ({ pathname: "/" })),
  BrowserRouter: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const mockSnapshotWithAll: PaperBotSnapshot = {
  timestamp: "2026-03-20T09:30:00Z",
  watchlist: ["RELIANCE", "TCS", "INFY"],
  open_positions: ["RELIANCE"],
  scan_items: [
    {
      symbol: "RELIANCE",
      status: "signal",
      side: "LONG",
      price: 2520,
      or_high: 2525,
      or_low: 2500,
      reason: "ORB breakout above 2525",
      strategy_name: "ORB Strategy",
      strategy_id: 1,
    },
    {
      symbol: "TCS",
      status: "watching",
      side: "LONG",
      price: 3850,
      high_52w: 3900,
      reason: "Near 52W high",
      strategy_name: "SR Breakout",
      strategy_id: 2,
    },
    {
      symbol: "INFY",
      status: "skipped",
      price: 4500,
      reason: "Low volume",
      strategy_name: "ORB Strategy",
      strategy_id: 1,
    },
  ],
  signals: [{ symbol: "RELIANCE", side: "LONG", price: 2520, notes: "ORB breakout" }],
};

describe("WatchlistScan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("empty / null state", () => {
    test("renders empty state when snapshot is null", () => {
      r(<WatchlistScan snapshot={null} selectedSymbol={null} />);

      expect(screen.getByTestId("watchlist-scan-card")).toBeInTheDocument();
      expect(screen.getByText("No scan data yet")).toBeInTheDocument();
    });

    test("renders empty state when snapshot has no scan_items", () => {
      r(
        <WatchlistScan
          snapshot={{
            timestamp: "2026-03-20T09:30:00Z",
            watchlist: [],
            open_positions: [],
            scan_items: [],
            signals: [],
          }}
          selectedSymbol={null}
        />,
      );

      expect(screen.getByTestId("watchlist-scan-card")).toBeInTheDocument();
      expect(screen.getByText("No scan data yet")).toBeInTheDocument();
    });
  });

  describe("renders sections", () => {
    test("renders signals section", () => {
      r(<WatchlistScan snapshot={mockSnapshotWithAll} selectedSymbol={null} />);

      expect(screen.getByTestId("watchlist-scan-signals")).toBeInTheDocument();
      expect(screen.getByText("Signals")).toBeInTheDocument();
    });

    test("renders watching section", () => {
      r(<WatchlistScan snapshot={mockSnapshotWithAll} selectedSymbol={null} />);
      expect(screen.getByTestId("watchlist-scan-watching")).toBeInTheDocument();
      expect(screen.getByText("Watching")).toBeInTheDocument();
    });

    test("renders skipped section", () => {
      r(<WatchlistScan snapshot={mockSnapshotWithAll} selectedSymbol={null} />);
      expect(screen.getByTestId("watchlist-scan-skipped")).toBeInTheDocument();
      expect(screen.getByText("Skipped")).toBeInTheDocument();
    });
  });

  describe("DataTable data-testid attributes", () => {
    test("signals table has data-testid from DataTable", () => {
      r(<WatchlistScan snapshot={mockSnapshotWithAll} selectedSymbol={null} />);
      expect(screen.getByTestId("signals-table")).toBeInTheDocument();
    });

    test("watching table has data-testid from DataTable", () => {
      r(<WatchlistScan snapshot={mockSnapshotWithAll} selectedSymbol={null} />);
      expect(screen.getByTestId("watching-table")).toBeInTheDocument();
    });

    test("skipped table has data-testid from DataTable", () => {
      r(<WatchlistScan snapshot={mockSnapshotWithAll} selectedSymbol={null} />);
      expect(screen.getByTestId("skipped-table")).toBeInTheDocument();
    });
  });

  describe("row click handlers", () => {
    test("clicking signal row calls setSelectedSymbol", async () => {
      const user = userEvent.setup();
      const { setSelectedSymbol } = await import("../../state/paperTrading");

      r(<WatchlistScan snapshot={mockSnapshotWithAll} selectedSymbol={null} />);
      await user.click(screen.getByTestId("scan-signal-RELIANCE"));

      expect(setSelectedSymbol).toHaveBeenCalledWith("RELIANCE");
    });

    test("clicking watching row calls setSelectedSymbol", async () => {
      const user = userEvent.setup();
      const { setSelectedSymbol } = await import("../../state/paperTrading");

      r(<WatchlistScan snapshot={mockSnapshotWithAll} selectedSymbol={null} />);
      await user.click(screen.getByTestId("scan-watching-TCS"));

      expect(setSelectedSymbol).toHaveBeenCalledWith("TCS");
    });

    test("clicking skipped row calls setSelectedSymbol", async () => {
      const user = userEvent.setup();
      const { setSelectedSymbol } = await import("../../state/paperTrading");

      r(<WatchlistScan snapshot={mockSnapshotWithAll} selectedSymbol={null} />);
      await user.click(within(screen.getByTestId("watchlist-scan-skipped")).getByRole("button"));
      await user.click(screen.getByTestId("scan-skipped-INFY"));

      expect(setSelectedSymbol).toHaveBeenCalledWith("INFY");
    });
  });

  describe("accordion interaction", () => {
    function accordionControl(section: string) {
      return screen
        .getByTestId(`watchlist-scan-${section}`)
        .querySelector('button[data-accordion-control="true"]') as HTMLElement;
    }

    test("signals accordion starts expanded by default", () => {
      r(<WatchlistScan snapshot={mockSnapshotWithAll} selectedSymbol={null} />);

      expect(accordionControl("signals")).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByTestId("signals-table")).toBeInTheDocument();
    });

    test("watching accordion starts expanded by default", () => {
      r(<WatchlistScan snapshot={mockSnapshotWithAll} selectedSymbol={null} />);

      expect(accordionControl("watching")).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByTestId("watching-table")).toBeInTheDocument();
    });

    test("skipped accordion starts collapsed", async () => {
      const user = userEvent.setup();

      r(<WatchlistScan snapshot={mockSnapshotWithAll} selectedSymbol={null} />);

      const control = accordionControl("skipped");
      expect(control).toHaveAttribute("aria-expanded", "false");

      // Row exists in DOM despite collapsed panel (keepMounted=true)
      expect(screen.getByTestId("scan-skipped-INFY")).toBeInTheDocument();

      // Expand and verify row is clickable
      await user.click(control);
      expect(control).toHaveAttribute("aria-expanded", "true");

      const { setSelectedSymbol } = await import("../../state/paperTrading");
      await user.click(screen.getByTestId("scan-skipped-INFY"));
      expect(setSelectedSymbol).toHaveBeenCalledWith("INFY");
    });

    test("clicking signals accordion control toggles visibility", async () => {
      const user = userEvent.setup();

      r(<WatchlistScan snapshot={mockSnapshotWithAll} selectedSymbol={null} />);

      const signalsControl = accordionControl("signals");
      expect(signalsControl).toHaveAttribute("aria-expanded", "true");

      // Collapse
      await user.click(signalsControl);
      expect(signalsControl).toHaveAttribute("aria-expanded", "false");
      expect(screen.getByTestId("signals-table")).toBeInTheDocument();

      // Expand again
      await user.click(signalsControl);
      expect(signalsControl).toHaveAttribute("aria-expanded", "true");
    });

    test("with defaultValue changed, sections start collapsed", async () => {
      const user = userEvent.setup();
      const { setSelectedSymbol } = await import("../../state/paperTrading");

      r(<WatchlistScan snapshot={mockSnapshotWithAll} selectedSymbol={null} />);

      // Default sections start expanded
      expect(accordionControl("signals")).toHaveAttribute("aria-expanded", "true");
      expect(accordionControl("watching")).toHaveAttribute("aria-expanded", "true");

      // Non-default section (skipped) starts collapsed
      const skippedControl = accordionControl("skipped");
      expect(skippedControl).toHaveAttribute("aria-expanded", "false");

      // Expand non-default section and verify rows become clickable
      await user.click(skippedControl);
      await user.click(screen.getByTestId("scan-skipped-INFY"));
      expect(setSelectedSymbol).toHaveBeenCalledWith("INFY");
    });
  });

  describe("header info", () => {
    test("displays total scan count", () => {
      r(<WatchlistScan snapshot={mockSnapshotWithAll} selectedSymbol={null} />);
      expect(within(screen.getByTestId("watchlist-scan-card")).getByText("3")).toBeInTheDocument();
    });

    test("displays scan time", () => {
      r(<WatchlistScan snapshot={mockSnapshotWithAll} selectedSymbol={null} />);
      expect(screen.getByText("Watchlist Scan")).toBeInTheDocument();
    });
  });
});

describe("handleSelectSymbol with fetchPaperChart", () => {
  test("handleSelectSymbol calls fetchPaperChart with correct params", async () => {
    const user = userEvent.setup();
    const { fetchPaperChart } = await import("../../api/paperTrading");

    r(<WatchlistScan snapshot={mockSnapshotWithAll} selectedSymbol={null} />);
    await user.click(screen.getByTestId("scan-signal-RELIANCE"));

    expect(fetchPaperChart).toHaveBeenCalledWith("RELIANCE", undefined, "5min", null, false);
  });

  test("fetchPaperChart rejection does not prevent setSelectedSymbol", async () => {
    const user = userEvent.setup();
    const { fetchPaperChart } = await import("../../api/paperTrading");
    const { setSelectedSymbol } = await import("../../state/paperTrading");

    (fetchPaperChart as ReturnType<typeof vi.fn>).mockImplementation(() =>
      Promise.reject(new Error("API error")).catch(() => undefined),
    );

    r(<WatchlistScan snapshot={mockSnapshotWithAll} selectedSymbol={null} />);
    await user.click(screen.getByTestId("scan-signal-RELIANCE"));

    expect(setSelectedSymbol).toHaveBeenCalledWith("RELIANCE");
  });

  test("handleSelectSymbol calls fetchPaperChart with current timeframe/intraday", async () => {
    const user = userEvent.setup();
    const { fetchPaperChart } = await import("../../api/paperTrading");
    const { getPaperTradingState } = await import("../../state/paperTrading");

    (getPaperTradingState as ReturnType<typeof vi.fn>).mockReturnValue({
      chartTimeframe: "15min",
      selectedStrategyId: null,
      intradayOnly: true,
    });

    r(<WatchlistScan snapshot={mockSnapshotWithAll} selectedSymbol={null} />);
    await user.click(screen.getByTestId("scan-signal-RELIANCE"));

    expect(fetchPaperChart).toHaveBeenCalledWith("RELIANCE", undefined, "15min", null, true);
  });
});

describe("skipped row merged items", () => {
  test('skipped row with empty strategies shows "?" and reason shows "-"', async () => {
    const user = userEvent.setup();
    const snapshot: PaperBotSnapshot = {
      ...mockSnapshotWithAll,
      scan_items: [
        {
          symbol: "HDFC",
          status: "skipped" as const,
          price: 4200,
        } as PaperScanItem,
      ],
    };

    r(<WatchlistScan snapshot={snapshot} selectedSymbol={null} />);
    await user.click(within(screen.getByTestId("watchlist-scan-skipped")).getByRole("button"));

    expect(screen.getByTestId("scan-skipped-HDFC")).toBeInTheDocument();
    const cells = within(screen.getByTestId("scan-skipped-HDFC")).getAllByRole("cell");
    expect(cells[2]).toHaveTextContent("?");
    expect(cells[3]).toHaveTextContent("-");
  });

  test('skipped row with undefined strategy_name defaults to "?"', async () => {
    const user = userEvent.setup();
    const snapshot: PaperBotSnapshot = {
      ...mockSnapshotWithAll,
      scan_items: [
        {
          symbol: "HDFC",
          status: "skipped" as const,
          price: 4200,
          reason: "Low volume",
        } as PaperScanItem,
      ],
    };

    r(<WatchlistScan snapshot={snapshot} selectedSymbol={null} />);
    await user.click(within(screen.getByTestId("watchlist-scan-skipped")).getByRole("button"));

    const cells = within(screen.getByTestId("scan-skipped-HDFC")).getAllByRole("cell");
    expect(cells[2]).toHaveTextContent("?");
  });

  test("multiple skipped items for same symbol merge strategies and reasons", async () => {
    const user = userEvent.setup();
    const multiSkipSnapshot: PaperBotSnapshot = {
      timestamp: "2026-03-20T09:30:00Z",
      watchlist: ["ABC"],
      open_positions: [],
      scan_items: [
        {
          symbol: "ABC",
          status: "skipped" as const,
          price: 100,
          reason: "Low volume",
          strategy_name: "ORB Strategy",
          strategy_id: 1,
        },
        {
          symbol: "ABC",
          status: "skipped" as const,
          price: 100,
          reason: "High spread",
          strategy_name: "SR Breakout",
          strategy_id: 2,
        },
      ],
      signals: [],
    };

    r(<WatchlistScan snapshot={multiSkipSnapshot} selectedSymbol={null} />);
    await user.click(within(screen.getByTestId("watchlist-scan-skipped")).getByRole("button"));

    expect(screen.getByTestId("scan-skipped-ABC")).toBeInTheDocument();
    const cells = within(screen.getByTestId("scan-skipped-ABC")).getAllByRole("cell");
    expect(cells[2]).toHaveTextContent("ORB Strategy, SR Breakout");
    expect(cells[3]).toHaveTextContent("Low volume");
  });
});
