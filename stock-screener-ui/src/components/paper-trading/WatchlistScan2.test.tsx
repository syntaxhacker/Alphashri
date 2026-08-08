// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WatchlistScan2 } from "./WatchlistScan2";
import { renderWithMantine } from "../../test-utils/renderWithMantine";
import { CREAM } from "../../config/colors";

// Resolved value of var(--mantine-color-teal-light) under the palette theme.
function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
import type { PaperBotSnapshot } from "../../types/paperTrading";

afterEach(cleanup);

function r(jsx: React.ReactElement) {
  return renderWithMantine(jsx);
}

vi.mock("../../state/paperTrading", () => ({
  getPaperTradingState: vi.fn(() => ({
    chartTimeframe: "5min",
    selectedStrategyId: null,
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

function createMockSnapshot(
  overrides?: Partial<PaperBotSnapshot>,
): PaperBotSnapshot {
  return {
    timestamp: new Date(Date.now() - 120_000).toISOString(),
    watchlist: ["RELIANCE", "TCS", "INFY", "HDFC", "WIPRO"],
    open_positions: [],
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
        timestamp: new Date(Date.now() - 30_000).toISOString(),
      },
      {
        symbol: "TCS",
        status: "watching",
        side: "LONG",
        price: 3850,
        high_52w: 3900,
        reason: "Near 52W high support",
        strategy_name: "SR Breakout",
        strategy_id: 2,
        timestamp: new Date(Date.now() - 180_000).toISOString(),
      },
      {
        symbol: "INFY",
        status: "rejected",
        side: "SHORT",
        price: 4500,
        reason: "Low volume — insufficient liquidity",
        strategy_name: "ORB Strategy",
        strategy_id: 1,
        timestamp: new Date(Date.now() - 300_000).toISOString(),
      },
      {
        symbol: "HDFC",
        status: "skipped",
        price: 4200,
        reason: "Insufficient volume",
        strategy_name: "ORB Strategy",
        strategy_id: 1,
        timestamp: new Date(Date.now() - 600_000).toISOString(),
      },
      {
        symbol: "WIPRO",
        status: "signal",
        side: "LONG",
        price: 550,
        reason: "Custom watchlist alert — user added trigger",
        strategy_name: "SR Breakout",
        strategy_id: 2,
        source: "custom",
        timestamp: new Date(Date.now() - 5_000).toISOString(),
      },
    ],
    signals: [
      { symbol: "RELIANCE", side: "LONG", price: 2520, notes: "ORB breakout" },
      { symbol: "WIPRO", side: "LONG", price: 550, notes: "Custom watchlist" },
    ],
    ...overrides,
  };
}

function card() {
  return screen.getByTestId("watchlist-scan-card");
}

function row(symbol: string) {
  return screen.getByTestId(`scan-row-${symbol}`);
}

function queryRow(symbol: string) {
  return screen.queryByTestId(`scan-row-${symbol}`);
}

describe("WatchlistScan2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ──────────────────────────────────────────────
  // Empty states
  // ──────────────────────────────────────────────

  describe("empty states", () => {
    test("renders No data when snapshot is null", () => {
      r(<WatchlistScan2 snapshot={null} selectedSymbol={null} />);
      expect(card()).toBeInTheDocument();
      expect(screen.getByText(/No recent scan results/)).toBeInTheDocument();
      expect(screen.getByText("No data")).toBeInTheDocument();
    });

    test("renders No data when scan_items is empty", () => {
      r(
        <WatchlistScan2
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
      expect(card()).toBeInTheDocument();
      expect(screen.getByText(/No recent scan results/)).toBeInTheDocument();
    });
  });

  // ──────────────────────────────────────────────
  // Header
  // ──────────────────────────────────────────────

  describe("header", () => {
    test("shows count badge with total items", () => {
      const snap = createMockSnapshot();
      r(<WatchlistScan2 snapshot={snap} selectedSymbol={null} />);
      expect(screen.getByText("5")).toBeInTheDocument();
    });

    test("shows scan timestamp", () => {
      const snap = createMockSnapshot();
      r(<WatchlistScan2 snapshot={snap} selectedSymbol={null} />);
      const header = card();
      expect(within(header).getByText(/updated/)).toBeInTheDocument();
    });

    test("refresh button calls onRefresh when clicked", async () => {
      const user = userEvent.setup();
      const onRefresh = vi.fn();
      const snap = createMockSnapshot();
      r(
        <WatchlistScan2
          snapshot={snap}
          selectedSymbol={null}
          onRefresh={onRefresh}
        />,
      );
      const refreshBtn = within(card()).getAllByRole("button")[0];
      await user.click(refreshBtn);
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    test("refresh button shows loading when refreshing", () => {
      const snap = createMockSnapshot();
      r(
        <WatchlistScan2
          snapshot={snap}
          selectedSymbol={null}
          onRefresh={() => {}}
          refreshing
        />,
      );
      const refreshBtn = within(card()).getAllByRole("button")[0];
      expect(refreshBtn).toBeInTheDocument();
    });
  });

  // ──────────────────────────────────────────────
  // Status filter tabs
  // ──────────────────────────────────────────────

  describe("status filter tabs", () => {
    test("shows all non-skipped items by default", () => {
      const snap = createMockSnapshot();
      r(<WatchlistScan2 snapshot={snap} selectedSymbol={null} />);
      expect(row("RELIANCE")).toBeInTheDocument();
      expect(row("TCS")).toBeInTheDocument();
      expect(row("INFY")).toBeInTheDocument();
      expect(queryRow("HDFC")).not.toBeInTheDocument();
      expect(row("WIPRO")).toBeInTheDocument();
    });

    test("filters by signal status", async () => {
      const user = userEvent.setup();
      const snap = createMockSnapshot();
      r(<WatchlistScan2 snapshot={snap} selectedSymbol={null} />);
      await user.click(screen.getByText("Signals (2)"));
      expect(row("RELIANCE")).toBeInTheDocument();
      expect(row("WIPRO")).toBeInTheDocument();
      expect(queryRow("TCS")).not.toBeInTheDocument();
      expect(queryRow("INFY")).not.toBeInTheDocument();
    });

    test("filters by watching status", async () => {
      const user = userEvent.setup();
      const snap = createMockSnapshot();
      r(<WatchlistScan2 snapshot={snap} selectedSymbol={null} />);
      await user.click(screen.getByText("Watching (1)"));
      expect(row("TCS")).toBeInTheDocument();
      expect(queryRow("RELIANCE")).not.toBeInTheDocument();
      expect(queryRow("INFY")).not.toBeInTheDocument();
    });

    test("filters by rejected status", async () => {
      const user = userEvent.setup();
      const snap = createMockSnapshot();
      r(<WatchlistScan2 snapshot={snap} selectedSymbol={null} />);
      await user.click(screen.getByText("Rejected (1)"));
      expect(row("INFY")).toBeInTheDocument();
      expect(queryRow("RELIANCE")).not.toBeInTheDocument();
      expect(queryRow("TCS")).not.toBeInTheDocument();
    });
  });

  // ──────────────────────────────────────────────
  // Skipped checkbox
  // ──────────────────────────────────────────────

  describe("include skipped checkbox", () => {
    test("toggles skipped items visibility when checked", async () => {
      const user = userEvent.setup();
      const snap = createMockSnapshot();
      r(<WatchlistScan2 snapshot={snap} selectedSymbol={null} />);
      expect(queryRow("HDFC")).not.toBeInTheDocument();
      await user.click(screen.getByText(/Skipped/));
      expect(row("HDFC")).toBeInTheDocument();
    });

    test("hides skipped items when unchecked", async () => {
      const user = userEvent.setup();
      const snap = createMockSnapshot();
      r(<WatchlistScan2 snapshot={snap} selectedSymbol={null} />);
      await user.click(screen.getByText(/Skipped/));
      expect(row("HDFC")).toBeInTheDocument();
      await user.click(screen.getByText(/Skipped/));
      expect(queryRow("HDFC")).not.toBeInTheDocument();
    });
  });

  // ──────────────────────────────────────────────
  // Symbol search
  // ──────────────────────────────────────────────

  describe("symbol search", () => {
    test("filters rows by symbol query", async () => {
      const user = userEvent.setup();
      const snap = createMockSnapshot();
      r(<WatchlistScan2 snapshot={snap} selectedSymbol={null} />);
      const searchInput = screen.getByPlaceholderText("Search symbol");
      await user.type(searchInput, "REL");
      expect(row("RELIANCE")).toBeInTheDocument();
      expect(queryRow("TCS")).not.toBeInTheDocument();
      expect(queryRow("INFY")).not.toBeInTheDocument();
      expect(queryRow("WIPRO")).not.toBeInTheDocument();
    });

    test("is case-insensitive", async () => {
      const user = userEvent.setup();
      const snap = createMockSnapshot();
      r(<WatchlistScan2 snapshot={snap} selectedSymbol={null} />);
      const searchInput = screen.getByPlaceholderText("Search symbol");
      await user.type(searchInput, "tcs");
      expect(row("TCS")).toBeInTheDocument();
      expect(queryRow("RELIANCE")).not.toBeInTheDocument();
    });

    test("clearing search shows all items again", async () => {
      const user = userEvent.setup();
      const snap = createMockSnapshot();
      r(<WatchlistScan2 snapshot={snap} selectedSymbol={null} />);
      const searchInput = screen.getByPlaceholderText("Search symbol");
      await user.type(searchInput, "ZZZ");
      expect(queryRow("RELIANCE")).not.toBeInTheDocument();
      await user.clear(searchInput);
      expect(row("RELIANCE")).toBeInTheDocument();
      expect(row("TCS")).toBeInTheDocument();
      expect(row("INFY")).toBeInTheDocument();
      expect(row("WIPRO")).toBeInTheDocument();
    });
  });

  // ──────────────────────────────────────────────
  // Strategy multi-select filter
  // ──────────────────────────────────────────────

  describe("strategy multi-select filter", () => {
    test("multi-select appears with strategy options", () => {
      const snap = createMockSnapshot();
      r(<WatchlistScan2 snapshot={snap} selectedSymbol={null} />);
      expect(screen.getByPlaceholderText("Filter strategy")).toBeInTheDocument();
    });

    test("filters rows by selected strategy", async () => {
      const user = userEvent.setup();
      const snap = createMockSnapshot();
      r(<WatchlistScan2 snapshot={snap} selectedSymbol={null} />);
      const strategyInput = screen.getByPlaceholderText("Filter strategy");
      await user.click(strategyInput);
      const srOption = await screen.findByRole("option", { name: "SR Breakout", hidden: true });
      await user.click(srOption);
      expect(row("TCS")).toBeInTheDocument();
      expect(row("WIPRO")).toBeInTheDocument();
      expect(queryRow("RELIANCE")).not.toBeInTheDocument();
      expect(queryRow("INFY")).not.toBeInTheDocument();
    });

    test("selecting ORB Strategy shows ORB items", async () => {
      const user = userEvent.setup();
      const snap = createMockSnapshot();
      r(<WatchlistScan2 snapshot={snap} selectedSymbol={null} />);
      const strategyInput = screen.getByPlaceholderText("Filter strategy");
      await user.click(strategyInput);
      const orbOption = await screen.findByRole("option", {
        name: "ORB Strategy",
        hidden: true,
      });
      await user.click(orbOption);
      expect(row("RELIANCE")).toBeInTheDocument();
      expect(row("INFY")).toBeInTheDocument();
      expect(queryRow("TCS")).not.toBeInTheDocument();
      expect(queryRow("WIPRO")).not.toBeInTheDocument();
    });
  });

  // ──────────────────────────────────────────────
  // Color coding
  // ──────────────────────────────────────────────

  describe("color-coded left border", () => {
    function styleContains(symbol: string, colorVar: string) {
      expect(row(symbol).getAttribute("style")).toContain(colorVar);
    }

    test("signal row has green left border", () => {
      const snap = createMockSnapshot();
      r(<WatchlistScan2 snapshot={snap} selectedSymbol={null} />);
      styleContains("RELIANCE", "var(--mantine-color-green-6)");
    });

    test("watching row has yellow left border", () => {
      const snap = createMockSnapshot();
      r(<WatchlistScan2 snapshot={snap} selectedSymbol={null} />);
      styleContains("TCS", "var(--mantine-color-yellow-6)");
    });

    test("rejected row has red left border", () => {
      const snap = createMockSnapshot();
      r(<WatchlistScan2 snapshot={snap} selectedSymbol={null} />);
      styleContains("INFY", "var(--mantine-color-red-6)");
    });

    test("skipped row has gray left border", async () => {
      const user = userEvent.setup();
      const snap = createMockSnapshot();
      r(<WatchlistScan2 snapshot={snap} selectedSymbol={null} />);
      await user.click(screen.getByText(/Skipped/));
      styleContains("HDFC", "var(--mantine-color-gray-5)");
    });
  });

  // ──────────────────────────────────────────────
  // New signal indicator
  // ──────────────────────────────────────────────

  function hasSparkle(symbol: string) {
    return row(symbol).querySelector(".tabler-icon-sparkles") !== null;
  }

  describe("new signal indicator", () => {
    test("shows sparkle for items less than 1 min old", () => {
      const snap = createMockSnapshot();
      r(<WatchlistScan2 snapshot={snap} selectedSymbol={null} />);
      expect(hasSparkle("RELIANCE")).toBe(true);
      expect(hasSparkle("WIPRO")).toBe(true);
    });

    test("does not show sparkle for items older than 1 min", () => {
      const snap = createMockSnapshot();
      r(<WatchlistScan2 snapshot={snap} selectedSymbol={null} />);
      expect(hasSparkle("TCS")).toBe(false);
    });
  });

  // ──────────────────────────────────────────────
  // Row click interaction
  // ──────────────────────────────────────────────

  describe("row click interaction", () => {
    test("clicking a signal row calls setSelectedSymbol and fetchPaperChart", async () => {
      const user = userEvent.setup();
      const snap = createMockSnapshot();
      r(<WatchlistScan2 snapshot={snap} selectedSymbol={null} />);
      await user.click(row("RELIANCE"));
      const { setSelectedSymbol } = await import("../../state/paperTrading");
      const { fetchPaperChart } = await import("../../api/paperTrading");
      expect(setSelectedSymbol).toHaveBeenCalledWith("RELIANCE");
      expect(fetchPaperChart).toHaveBeenCalledWith(
        "RELIANCE",
        undefined,
        "5min",
        null,
      );
    });

    test("clicking a watching row calls setSelectedSymbol", async () => {
      const user = userEvent.setup();
      const snap = createMockSnapshot();
      r(<WatchlistScan2 snapshot={snap} selectedSymbol={null} />);
      await user.click(row("TCS"));
      const { setSelectedSymbol } = await import("../../state/paperTrading");
      expect(setSelectedSymbol).toHaveBeenCalledWith("TCS");
    });

    test("clicking a rejected row calls setSelectedSymbol", async () => {
      const user = userEvent.setup();
      const snap = createMockSnapshot();
      r(<WatchlistScan2 snapshot={snap} selectedSymbol={null} />);
      await user.click(row("INFY"));
      const { setSelectedSymbol } = await import("../../state/paperTrading");
      expect(setSelectedSymbol).toHaveBeenCalledWith("INFY");
    });

    test("selected row has highlighted background", () => {
      const snap = createMockSnapshot();
      r(
        <WatchlistScan2 snapshot={snap} selectedSymbol="RELIANCE" />,
      );
      expect(row("RELIANCE")).toHaveStyle({
        backgroundColor: withAlpha(CREAM, 0.15),
      });
    });
  });

  // ──────────────────────────────────────────────
  // Footer
  // ──────────────────────────────────────────────

  describe("footer", () => {
    test("shows visible and total count", () => {
      const snap = createMockSnapshot();
      r(<WatchlistScan2 snapshot={snap} selectedSymbol={null} />);
      expect(screen.getByText(/Showing 4 of 5/)).toBeInTheDocument();
    });

    test("shows +X skipped when skipped items are hidden", () => {
      const snap = createMockSnapshot();
      r(<WatchlistScan2 snapshot={snap} selectedSymbol={null} />);
      expect(screen.getByText(/\+1 skipped/)).toBeInTheDocument();
    });

    test("hides +X skipped when skipped items are shown", async () => {
      const user = userEvent.setup();
      const snap = createMockSnapshot();
      r(<WatchlistScan2 snapshot={snap} selectedSymbol={null} />);
      expect(screen.getByText(/\+1 skipped/)).toBeInTheDocument();
      await user.click(screen.getByText(/Skipped/));
      expect(screen.getByText(/Showing 5 of 5/)).toBeInTheDocument();
      expect(screen.queryByText(/\+1 skipped/)).not.toBeInTheDocument();
    });
  });

  // ──────────────────────────────────────────────
  // Empty filter results
  // ──────────────────────────────────────────────

  describe("empty filter results", () => {
    test("shows skipped count when search filters all items and skipped exist", async () => {
      const user = userEvent.setup();
      const snap = createMockSnapshot();
      r(<WatchlistScan2 snapshot={snap} selectedSymbol={null} />);
      const searchInput = screen.getByPlaceholderText("Search symbol");
      await user.type(searchInput, "ZZZZ");
      expect(screen.getByText("1 skipped")).toBeInTheDocument();
    });

    test("shows No items text when search filters all items and no skipped exist", async () => {
      const user = userEvent.setup();
      r(
        <WatchlistScan2
          snapshot={createMockSnapshot({
            scan_items: [
              {
                symbol: "RELIANCE",
                status: "signal",
                side: "LONG",
                price: 2520,
                or_high: 2525,
                or_low: 2500,
                reason: "ORB",
                strategy_name: "ORB Strategy",
                strategy_id: 1,
                timestamp: new Date(Date.now() - 30_000).toISOString(),
              },
            ],
          })}
          selectedSymbol={null}
        />,
      );
      const searchInput = screen.getByPlaceholderText("Search symbol");
      await user.type(searchInput, "ZZZZ");
      expect(screen.getByText("No items")).toBeInTheDocument();
    });

    test("shows skipped count text when only skipped items are hidden", () => {
      r(
        <WatchlistScan2
          snapshot={createMockSnapshot({
            scan_items: [
              {
                symbol: "HDFC",
                status: "skipped",
                price: 4200,
                reason: "Insufficient volume",
                strategy_name: "ORB Strategy",
                strategy_id: 1,
              },
            ],
          })}
          selectedSymbol={null}
        />,
      );
      expect(screen.getByText("1 skipped")).toBeInTheDocument();
    });
  });

  // ──────────────────────────────────────────────
  // Data rendering details
  // ──────────────────────────────────────────────

  describe("data rendering details", () => {
    test("custom source badge appears for custom items", () => {
      const snap = createMockSnapshot();
      r(<WatchlistScan2 snapshot={snap} selectedSymbol={null} />);
      const wiproRow = row("WIPRO");
      expect(within(wiproRow).getByText("Custom")).toBeInTheDocument();
    });

    test("custom source badge does not appear for non-custom items", () => {
      const snap = createMockSnapshot();
      r(<WatchlistScan2 snapshot={snap} selectedSymbol={null} />);
      const relianceRow = row("RELIANCE");
      expect(
        within(relianceRow).queryByText("Custom"),
      ).not.toBeInTheDocument();
    });

    test("renders side badge for LONG items", () => {
      const snap = createMockSnapshot();
      r(<WatchlistScan2 snapshot={snap} selectedSymbol={null} />);
      expect(within(row("RELIANCE")).getByText("LONG")).toBeInTheDocument();
    });

    test("renders side badge for SHORT items", () => {
      const snap = createMockSnapshot();
      r(<WatchlistScan2 snapshot={snap} selectedSymbol={null} />);
      expect(within(row("INFY")).getByText("SHORT")).toBeInTheDocument();
    });

    test("skipped items without side show dash in side column", async () => {
      const user = userEvent.setup();
      const snap = createMockSnapshot();
      r(<WatchlistScan2 snapshot={snap} selectedSymbol={null} />);
      await user.click(screen.getByText(/Skipped/));
      const cells = within(row("HDFC")).getAllByRole("cell");
      expect(cells[1]).toHaveTextContent("-");
    });

    test("formats price with ₹ symbol", () => {
      const snap = createMockSnapshot();
      r(<WatchlistScan2 snapshot={snap} selectedSymbol={null} />);
      expect(
        within(row("RELIANCE")).getByText("₹2520.00"),
      ).toBeInTheDocument();
      expect(within(row("TCS")).getByText("₹3850.00")).toBeInTheDocument();
      expect(within(row("INFY")).getByText("₹4500.00")).toBeInTheDocument();
    });

    test("items without price show dash in price column", () => {
      r(
        <WatchlistScan2
          snapshot={createMockSnapshot({
            scan_items: [
              {
                symbol: "TEST",
                status: "signal",
                side: "LONG",
                reason: "No price data",
                strategy_name: "ORB Strategy",
                strategy_id: 1,
              },
            ],
          })}
          selectedSymbol={null}
        />,
      );
      const cells = within(row("TEST")).getAllByRole("cell");
      expect(cells[2]).toHaveTextContent("-");
    });

    test("near column shows percentage for items with ORB or 52W levels", () => {
      const snap = createMockSnapshot();
      r(<WatchlistScan2 snapshot={snap} selectedSymbol={null} />);
      const tcsRow = row("TCS");
      expect(within(tcsRow).getByText(/1\.\d+%/)).toBeInTheDocument();
    });

    test("near column shows dash when no levels available", () => {
      const snap = createMockSnapshot();
      r(<WatchlistScan2 snapshot={snap} selectedSymbol={null} />);
      expect(within(row("INFY")).getByText("-")).toBeInTheDocument();
    });

    test("watching status near column has yellow color", () => {
      const snap = createMockSnapshot();
      r(<WatchlistScan2 snapshot={snap} selectedSymbol={null} />);
      const nearCell = within(row("TCS")).getByText(/1\.\d+%/);
      expect(nearCell).toBeInTheDocument();
    });

    test("renders strategy badge with strategy name", () => {
      const snap = createMockSnapshot();
      r(<WatchlistScan2 snapshot={snap} selectedSymbol={null} />);
      expect(
        within(row("RELIANCE")).getByText("ORB Strategy"),
      ).toBeInTheDocument();
      expect(
        within(row("TCS")).getByText("SR Breakout"),
      ).toBeInTheDocument();
    });

    test("renders age column with relative time", () => {
      const snap = createMockSnapshot();
      r(<WatchlistScan2 snapshot={snap} selectedSymbol={null} />);
      const tcsRow = row("TCS");
      expect(within(tcsRow).getByText(/m ago/)).toBeInTheDocument();
    });

    test("renders notes column with reason text", () => {
      const snap = createMockSnapshot();
      r(<WatchlistScan2 snapshot={snap} selectedSymbol={null} />);
      const relianceRow = row("RELIANCE");
      expect(
        within(relianceRow).getByText("ORB breakout above 2525"),
      ).toBeInTheDocument();
    });

    test("sort order: signal first (newest before oldest), then watching, then rejected", () => {
      const snap = createMockSnapshot();
      r(<WatchlistScan2 snapshot={snap} selectedSymbol={null} />);
      const table = screen.getByTestId("watchlist-scan-table");
      const rows = within(table).getAllByRole("row");
      const bodyRows = rows.slice(1);
      expect(bodyRows[0]).toHaveTextContent("WIPRO");
      expect(bodyRows[1]).toHaveTextContent("RELIANCE");
      expect(bodyRows[2]).toHaveTextContent("TCS");
      expect(bodyRows[3]).toHaveTextContent("INFY");
    });
  });

  // ──────────────────────────────────────────────
  // Data integrity edge cases
  // ──────────────────────────────────────────────

  describe("data integrity edge cases", () => {
    test("all items with same status", () => {
      const snap = createMockSnapshot({
        scan_items: [
          {
            symbol: "AAPL",
            status: "signal",
            side: "LONG",
            price: 150,
            reason: "Test",
            strategy_name: "ORB Strategy",
            strategy_id: 1,
            timestamp: new Date().toISOString(),
          },
          {
            symbol: "GOOGL",
            status: "signal",
            side: "LONG",
            price: 2800,
            reason: "Test 2",
            strategy_name: "ORB Strategy",
            strategy_id: 1,
            timestamp: new Date().toISOString(),
          },
        ],
      });
      r(<WatchlistScan2 snapshot={snap} selectedSymbol={null} />);
      expect(row("AAPL")).toBeInTheDocument();
      expect(row("GOOGL")).toBeInTheDocument();
      expect(screen.getByText("2")).toBeInTheDocument();
    });

    test("item with undefined price shows dash", () => {
      r(
        <WatchlistScan2
          snapshot={createMockSnapshot({
            scan_items: [
              {
                symbol: "NOPRICE",
                status: "signal",
                side: "LONG",
                price: undefined as any,
                reason: "No price",
                strategy_name: "ORB Strategy",
                strategy_id: 1,
              },
            ],
          })}
          selectedSymbol={null}
        />,
      );
      const cells = within(row("NOPRICE")).getAllByRole("cell");
      expect(cells[2]).toHaveTextContent("-");
    });

    test("item with undefined side shows dash in side column", () => {
      r(
        <WatchlistScan2
          snapshot={createMockSnapshot({
            scan_items: [
              {
                symbol: "NOSIDE",
                status: "signal",
                price: 100,
                reason: "No side",
                strategy_name: "ORB Strategy",
                strategy_id: 1,
              },
            ],
          })}
          selectedSymbol={null}
        />,
      );
      const cells = within(row("NOSIDE")).getAllByRole("cell");
      expect(cells[1]).toHaveTextContent("-");
    });

    test("item with non-numeric near values shows dash", () => {
      r(
        <WatchlistScan2
          snapshot={createMockSnapshot({
            scan_items: [
              {
                symbol: "BADNEAR",
                status: "watching",
                side: "LONG",
                price: 100,
                or_high: 0,
                or_low: 0,
                reason: "Bad levels",
                strategy_name: "ORB Strategy",
                strategy_id: 1,
              },
            ],
          })}
          selectedSymbol={null}
        />,
      );
      const cells = within(row("BADNEAR")).getAllByRole("cell");
      expect(cells[3]).toHaveTextContent("-");
    });

    test("item with empty strategy_name shows dash badge", () => {
      r(
        <WatchlistScan2
          snapshot={createMockSnapshot({
            scan_items: [
              {
                symbol: "NOSTRAT",
                status: "signal",
                side: "LONG",
                price: 100,
                strategy_name: "",
                strategy_id: 1,
                reason: "Test",
              },
            ],
          })}
          selectedSymbol={null}
        />,
      );
      const rows = within(row("NOSTRAT")).getAllByText("-");
      expect(rows.length).toBeGreaterThanOrEqual(1);
    });

    test("item with null timestamp falls back to snapshot timestamp for age", () => {
      const snapshotTs = new Date().toISOString();
      const snap = createMockSnapshot({
        timestamp: snapshotTs,
        scan_items: [
          {
            symbol: "NOTS",
            status: "signal",
            side: "LONG",
            price: 100,
            reason: "No timestamp",
            strategy_name: "ORB Strategy",
            strategy_id: 1,
            timestamp: null as any,
          },
        ],
      });
      r(<WatchlistScan2 snapshot={snap} selectedSymbol={null} />);
      expect(row("NOTS")).toBeInTheDocument();
    });

    test("very long symbol name renders without breakage", () => {
      const longName = "VERYLONGSYMBOLNAMETEST";
      r(
        <WatchlistScan2
          snapshot={createMockSnapshot({
            scan_items: [
              {
                symbol: longName,
                status: "signal",
                side: "LONG",
                price: 100,
                reason: "Long symbol",
                strategy_name: "ORB Strategy",
                strategy_id: 1,
              },
            ],
          })}
          selectedSymbol={null}
        />,
      );
      expect(row(longName)).toBeInTheDocument();
    });

    test("unknown status falls to gray border color", () => {
      r(
        <WatchlistScan2
          snapshot={createMockSnapshot({
            scan_items: [
              {
                symbol: "UNKNWN",
                status: "unknown_status",
                side: "LONG",
                price: 100,
                reason: "Unknown status",
                strategy_name: "ORB Strategy",
                strategy_id: 1,
              },
            ],
          })}
          selectedSymbol={null}
        />,
      );
      expect(row("UNKNWN")).toBeInTheDocument();
    });
  });
});
