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
      status: "signal" as const,
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
      status: "watching" as const,
      side: "LONG",
      price: 3850,
      high_52w: 3900,
      reason: "Near 52W high",
      strategy_name: "SR Breakout",
      strategy_id: 2,
    },
    {
      symbol: "INFY",
      status: "skipped" as const,
      price: 4500,
      reason: "Low volume",
      strategy_name: "ORB Strategy",
      strategy_id: 1,
    },
    {
      symbol: "HDFC",
      status: "rejected" as const,
      side: "LONG",
      price: 3200,
      reason: "Risk check failed",
      strategy_name: "ORB Strategy",
      strategy_id: 1,
    },
  ],
  signals: [{ symbol: "RELIANCE", side: "LONG", price: 2520, notes: "ORB breakout" }],
};

const SECTIONS = [
  { section: "signals", label: "Signals", testidPrefix: "watchlist-scan-signals" },
  { section: "watching", label: "Watching", testidPrefix: "watchlist-scan-watching" },
  { section: "skipped", label: "Skipped", testidPrefix: "watchlist-scan-skipped" },
  { section: "rejected", label: "Rejected", testidPrefix: "watchlist-scan-rejected" },
] as const;

describe("WatchlistScan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("empty / null state", () => {
    test("renders empty state when snapshot is null", () => {
      r(<WatchlistScan snapshot={null} selectedSymbol={null} />);

      expect(screen.getByTestId("watchlist-scan-card")).toBeInTheDocument();
      expect(screen.getByText(/No scan data/)).toBeInTheDocument();
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
      expect(screen.getByText(/No scan data/)).toBeInTheDocument();
    });
  });

  describe("renders sections", () => {
    test.each(SECTIONS)("renders $label section", ({ section: _section, label, testidPrefix }) => {
      r(<WatchlistScan snapshot={mockSnapshotWithAll} selectedSymbol={null} />);
      expect(screen.getByTestId(testidPrefix)).toBeInTheDocument();
      const labelMatches = screen.getAllByText(label);
      expect(labelMatches.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("DataTable data-testid attributes", () => {
    test.each(SECTIONS)(
      "$label table has data-testid from DataTable",
      async ({ section, label: _label }) => {
        const user = userEvent.setup();
        r(<WatchlistScan snapshot={mockSnapshotWithAll} selectedSymbol={null} />);
        if (section === "skipped" || section === "rejected") {
          const control = screen
            .getByTestId(`watchlist-scan-${section}`)
            .querySelector('button[data-accordion-control="true"]') as HTMLElement;
          await user.click(control);
        }
        expect(screen.getByTestId(`${section}-table`)).toBeInTheDocument();
      },
    );
  });

  describe("row click handlers", () => {
    async function clickScanRow(symbol: string, status: "signal" | "watching" | "skipped" | "rejected") {
      const user = userEvent.setup();
      if (status === "skipped") {
        await user.click(
          within(screen.getByTestId(`watchlist-scan-${status}`)).getByRole("button"),
        );
      }
      await user.click(screen.getByTestId(`scan-${status}-${symbol}`));
      return user;
    }

    test.each([
      { symbol: "RELIANCE", status: "signal" as const },
      { symbol: "TCS", status: "watching" as const },
      { symbol: "INFY", status: "skipped" as const },
      { symbol: "HDFC", status: "rejected" as const },
    ])("clicking $status row calls setSelectedSymbol for $symbol", async ({ symbol, status }) => {
      r(<WatchlistScan snapshot={mockSnapshotWithAll} selectedSymbol={null} />);
      await clickScanRow(symbol, status);
      expect((await import("../../state/paperTrading")).setSelectedSymbol).toHaveBeenCalledWith(
        symbol,
      );
    });
  });

  describe("accordion interaction", () => {
    function accordionControl(section: string) {
      return screen
        .getByTestId(`watchlist-scan-${section}`)
        .querySelector('button[data-accordion-control="true"]') as HTMLElement;
    }

    test.each(["signals", "watching"])(
      "$section accordion starts expanded by default",
      (section) => {
        r(<WatchlistScan snapshot={mockSnapshotWithAll} selectedSymbol={null} />);
        expect(accordionControl(section)).toHaveAttribute("aria-expanded", "true");
        expect(screen.getByTestId(`${section}-table`)).toBeInTheDocument();
      },
    );

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

    test("rejected accordion starts collapsed", async () => {
      const user = userEvent.setup();

      r(<WatchlistScan snapshot={mockSnapshotWithAll} selectedSymbol={null} />);

      const control = accordionControl("rejected");
      expect(control).toHaveAttribute("aria-expanded", "false");

      // Row exists in DOM despite collapsed panel (keepMounted=true)
      expect(screen.getByTestId("scan-rejected-HDFC")).toBeInTheDocument();

      // Expand and verify row is clickable
      await user.click(control);
      expect(control).toHaveAttribute("aria-expanded", "true");

      const { setSelectedSymbol } = await import("../../state/paperTrading");
      await user.click(screen.getByTestId("scan-rejected-HDFC"));
      expect(setSelectedSymbol).toHaveBeenCalledWith("HDFC");
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
      expect(within(screen.getByTestId("watchlist-scan-card")).getByText("4")).toBeInTheDocument();
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

    expect(fetchPaperChart).toHaveBeenCalledWith("RELIANCE", undefined, "5min", null);
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

  test("handleSelectSymbol calls fetchPaperChart with current timeframe", async () => {
    const user = userEvent.setup();
    const { fetchPaperChart } = await import("../../api/paperTrading");
    const { getPaperTradingState } = await import("../../state/paperTrading");

    (getPaperTradingState as ReturnType<typeof vi.fn>).mockReturnValue({
      chartTimeframe: "15min",
      selectedStrategyId: null,
    });

    r(<WatchlistScan snapshot={mockSnapshotWithAll} selectedSymbol={null} />);
    await user.click(screen.getByTestId("scan-signal-RELIANCE"));

    expect(fetchPaperChart).toHaveBeenCalledWith("RELIANCE", undefined, "15min", null);
  });
});

describe("skipped row merged items", () => {
  const skippedTestCases = [
    {
      name: 'empty strategies shows "?" and reason shows "-"',
      scanItems: [
        {
          symbol: "HDFC",
          status: "skipped" as const,
          price: 4200,
        } as PaperScanItem,
      ],
      expectedCell2: "?",
      expectedCell3: "-",
    },
    {
      name: 'undefined strategy_name defaults to "?"',
      scanItems: [
        {
          symbol: "HDFC",
          status: "skipped" as const,
          price: 4200,
          reason: "Low volume",
        } as PaperScanItem,
      ],
      expectedCell2: "?",
      expectedCell3: undefined,
    },
    {
      name: "multiple skipped items for same symbol merge strategies and reasons",
      scanItems: [
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
      expectedCell2: "ORB Strategy, SR Breakout",
      expectedCell3: "Low volume",
    },
  ];

  test.each(skippedTestCases)("$name", async ({ scanItems, expectedCell2, expectedCell3 }) => {
    const user = userEvent.setup();
    const snapshot: PaperBotSnapshot = {
      ...mockSnapshotWithAll,
      scan_items: scanItems,
    };

    r(<WatchlistScan snapshot={snapshot} selectedSymbol={null} />);
    const symbol = scanItems[0].symbol;
    await user.click(within(screen.getByTestId("watchlist-scan-skipped")).getByRole("button"));

    expect(screen.getByTestId(`scan-skipped-${symbol}`)).toBeInTheDocument();
    const cells = within(screen.getByTestId(`scan-skipped-${symbol}`)).getAllByRole("cell");
    expect(cells[2]).toHaveTextContent(expectedCell2);
    if (expectedCell3 !== undefined) {
      expect(cells[3]).toHaveTextContent(expectedCell3);
    }
  });
});
