// @vitest-environment happy-dom
import { describe, expect, test, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { formatDateTimeHuman, formatDuration } from "../../utils/ui-helpers";
import { sortTrades, TradeHistoryTable } from "./TradeHistoryTable";
import type { Trade } from "../../types/backtest";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);

function Wrapper({ children }: { children: React.ReactNode }) {
  return <MantineProvider>{children}</MantineProvider>;
}

function makeTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    entry_price: 100,
    exit_price: 110,
    entry_time: "2025-06-15T09:30:00Z",
    exit_time: "2025-06-15T10:45:00Z",
    quantity: 10,
    gross_pnl: 100,
    gross_pnl_pct: 1.0,
    trading_costs: 5,
    net_pnl: 95,
    net_pnl_pct: 0.95,
    exit_reason: "TP",
    hold_duration_minutes: 75,
    date: "2025-06-15",
    ...overrides,
  };
}

describe("formatDateTimeHuman", () => {
  test("formats ISO string with time", () => {
    const result = formatDateTimeHuman("2025-06-15T09:30:00Z");
    expect(result).toContain("15");
    expect(result).toContain("Jun");
    expect(result).toContain("09:30");
  });

  test("handles +05:30 timezone", () => {
    const result = formatDateTimeHuman("2025-06-15T15:00:00+05:30");
    expect(result).toContain("15");
    expect(result).toContain("15:00");
  });

  test("handles +00:00 timezone", () => {
    const result = formatDateTimeHuman("2025-06-15T09:30:00+00:00");
    expect(result).toContain("15");
    expect(result).toContain("09:30");
  });

  test("returns dash for empty string", () => {
    expect(formatDateTimeHuman("")).toBe("-");
  });

  test("formats ordinal suffixes correctly", () => {
    expect(formatDateTimeHuman("2025-01-01T09:00:00Z")).toContain("1st");
    expect(formatDateTimeHuman("2025-01-02T09:00:00Z")).toContain("2nd");
    expect(formatDateTimeHuman("2025-01-03T09:00:00Z")).toContain("3rd");
    expect(formatDateTimeHuman("2025-01-04T09:00:00Z")).toContain("4th");
    expect(formatDateTimeHuman("2025-01-21T09:00:00Z")).toContain("21st");
    expect(formatDateTimeHuman("2025-01-22T09:00:00Z")).toContain("22nd");
    expect(formatDateTimeHuman("2025-01-23T09:00:00Z")).toContain("23rd");
    expect(formatDateTimeHuman("2025-01-31T09:00:00Z")).toContain("31st");
  });

  test("handles string without time part", () => {
    const result = formatDateTimeHuman("2025-06-15");
    expect(result).toContain("15");
    expect(result).toContain("Jun");
  });
});

describe("formatDuration", () => {
  test("formats minutes only", () => {
    expect(formatDuration(45)).toBe("45m");
    expect(formatDuration(5)).toBe("5m");
    expect(formatDuration(1)).toBe("1m");
  });

  test("formats hours and minutes", () => {
    expect(formatDuration(90)).toBe("1h 30m");
    expect(formatDuration(125)).toBe("2h 5m");
    expect(formatDuration(60)).toBe("1h");
    expect(formatDuration(120)).toBe("2h");
  });

  test("handles zero minutes", () => {
    expect(formatDuration(0)).toBe("0m");
  });

  test("handles fractional minutes", () => {
    expect(formatDuration(90.5)).toBe("1h 30.5m");
  });
});

describe("sortTrades", () => {
  const trades: Trade[] = [
    makeTrade({
      net_pnl: 200,
      entry_price: 100,
      quantity: 10,
      entry_time: "2025-06-15T09:30:00Z",
      exit_time: "2025-06-15T10:45:00Z",
      hold_duration_minutes: 75,
      exit_reason: "TP",
    }),
    makeTrade({
      net_pnl: -50,
      entry_price: 200,
      quantity: 5,
      entry_time: "2025-06-14T09:30:00Z",
      exit_time: "2025-06-14T10:00:00Z",
      hold_duration_minutes: 30,
      exit_reason: "SL",
    }),
    makeTrade({
      net_pnl: 100,
      entry_price: 150,
      quantity: 8,
      entry_time: "2025-06-16T09:30:00Z",
      exit_time: "2025-06-16T11:00:00Z",
      hold_duration_minutes: 90,
      exit_reason: "TP",
    }),
  ];

  test("sorts by net_pnl ascending", () => {
    const sorted = sortTrades(trades, "net_pnl", "asc");
    expect(sorted[0].net_pnl).toBe(-50);
    expect(sorted[1].net_pnl).toBe(100);
    expect(sorted[2].net_pnl).toBe(200);
  });

  test("sorts by net_pnl descending", () => {
    const sorted = sortTrades(trades, "net_pnl", "desc");
    expect(sorted[0].net_pnl).toBe(200);
    expect(sorted[1].net_pnl).toBe(100);
    expect(sorted[2].net_pnl).toBe(-50);
  });

  test("sorts by entry_price ascending", () => {
    const sorted = sortTrades(trades, "entry_price", "asc");
    expect(sorted[0].entry_price).toBe(100);
    expect(sorted[2].entry_price).toBe(200);
  });

  test("sorts by quantity ascending", () => {
    const sorted = sortTrades(trades, "quantity", "asc");
    expect(sorted[0].quantity).toBe(5);
    expect(sorted[2].quantity).toBe(10);
  });

  test("sorts by entry_time ascending (string)", () => {
    const sorted = sortTrades(trades, "entry_time", "asc");
    expect(sorted[0].entry_time).toBe("2025-06-14T09:30:00Z");
    expect(sorted[2].entry_time).toBe("2025-06-16T09:30:00Z");
  });

  test("sorts by exit_time ascending", () => {
    const sorted = sortTrades(trades, "exit_time", "asc");
    expect(sorted[0].exit_time).toBe("2025-06-14T10:00:00Z");
    expect(sorted[2].exit_time).toBe("2025-06-16T11:00:00Z");
  });

  test("sorts by exit_time descending", () => {
    const sorted = sortTrades(trades, "exit_time", "desc");
    expect(sorted[0].exit_time).toBe("2025-06-16T11:00:00Z");
    expect(sorted[2].exit_time).toBe("2025-06-14T10:00:00Z");
  });

  test("sorts by side ascending", () => {
    const tradesWithSides = [
      makeTrade({ exit_time: "2025-06-15T09:30:00Z" }),
      makeTrade({ exit_time: "2025-06-14T09:30:00Z" }),
    ];
    (tradesWithSides[0] as any).side = "SHORT";
    (tradesWithSides[1] as any).side = "LONG";
    const sorted = sortTrades(tradesWithSides, "side", "asc");
    expect((sorted[0] as any).side).toBe("LONG");
    expect((sorted[1] as any).side).toBe("SHORT");
  });

  test("sorts by exit_price ascending", () => {
    const tradesWithPrices = [
      makeTrade({ exit_price: 150 }),
      makeTrade({ exit_price: 100 }),
      makeTrade({ exit_price: 200 }),
    ];
    const sorted = sortTrades(tradesWithPrices, "exit_price", "asc");
    expect(sorted[0].exit_price).toBe(100);
    expect(sorted[2].exit_price).toBe(200);
  });

  test("sorts by exit_price descending", () => {
    const tradesWithPrices = [
      makeTrade({ exit_price: 150 }),
      makeTrade({ exit_price: 100 }),
      makeTrade({ exit_price: 200 }),
    ];
    const sorted = sortTrades(tradesWithPrices, "exit_price", "desc");
    expect(sorted[0].exit_price).toBe(200);
    expect(sorted[2].exit_price).toBe(100);
  });

  test("sorts by exit_reason ascending (string)", () => {
    const sorted = sortTrades(trades, "exit_reason", "asc");
    expect(sorted[0].exit_reason).toBe("SL");
    expect(sorted[1].exit_reason).toBe("TP");
    expect(sorted[2].exit_reason).toBe("TP");
  });

  test("sorts by hold_duration_minutes ascending", () => {
    const sorted = sortTrades(trades, "hold_duration_minutes", "asc");
    expect(sorted[0].hold_duration_minutes).toBe(30);
    expect(sorted[2].hold_duration_minutes).toBe(90);
  });

  test("returns empty array for empty input", () => {
    expect(sortTrades([], "net_pnl", "asc")).toEqual([]);
  });

  test("does not mutate original array", () => {
    const original = [...trades];
    sortTrades(trades, "net_pnl", "desc");
    expect(trades).toEqual(original);
  });

  test("returns original order for unknown column", () => {
    const sorted = sortTrades(trades, "unknown_column", "asc");
    expect(sorted.map((t) => t.net_pnl)).toEqual(trades.map((t) => t.net_pnl));
  });

  test("sorts by net_pnl_pct when net_pnl_pct is provided", () => {
    const tradesWithPct: Trade[] = [
      makeTrade({ net_pnl_pct: 2.0 }),
      makeTrade({ net_pnl_pct: -1.0 }),
      makeTrade({ net_pnl_pct: 0.5 }),
    ];
    const sorted = sortTrades(tradesWithPct, "net_pnl_pct", "asc");
    expect(sorted[0].net_pnl_pct).toBe(-1.0);
    expect(sorted[2].net_pnl_pct).toBe(2.0);
  });

  test("sorts by level_high using or_high fallback", () => {
    const tradesWithLevels: Trade[] = [
      makeTrade({ or_high: 300 }),
      makeTrade({ or_high: 100 }),
      makeTrade({ or_high: 200 }),
    ];
    const sorted = sortTrades(tradesWithLevels, "level_high", "asc");
    expect(sorted[0].or_high).toBe(100);
    expect(sorted[2].or_high).toBe(300);
  });

  test("sorts by level_low using or_low fallback", () => {
    const tradesWithLevels: Trade[] = [
      makeTrade({ or_low: 50 }),
      makeTrade({ or_low: 80 }),
      makeTrade({ or_low: 30 }),
    ];
    const sorted = sortTrades(tradesWithLevels, "level_low", "asc");
    expect(sorted[0].or_low).toBe(30);
    expect(sorted[2].or_low).toBe(80);
  });
});

describe("TradeHistoryTable rendering", () => {
  const onSort = vi.fn();
  const onRowClick = vi.fn();
  const onClose = vi.fn();

  const defaultProps = {
    sortColumn: "entry_time",
    sortDirection: "asc" as const,
    onSort,
    onRowClick,
    onClose,
  };

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("renders nothing when trades empty", () => {
    render(
      <TradeHistoryTable symbol="TCS" trades={[]} {...defaultProps} />,
      { wrapper: Wrapper },
    );
    expect(screen.queryByTestId("trade-history-panel")).toBeNull();
  });

  test("renders nothing when trades null", () => {
    render(
      <TradeHistoryTable symbol="TCS" trades={null as unknown as Trade[]} {...defaultProps} />,
      { wrapper: Wrapper },
    );
    expect(screen.queryByTestId("trade-history-panel")).toBeNull();
  });

  test("header shows symbol name and trade count", () => {
    const trades = [makeTrade(), makeTrade()];
    render(<TradeHistoryTable symbol="TCS" trades={trades} {...defaultProps} />, {
      wrapper: Wrapper,
    });
    const header = screen.getByTestId("trade-history-header");
    expect(header).toHaveTextContent(/TCS/);
    expect(header).toHaveTextContent(/2/);
  });

  test("summary row shows P&L, WR, Wins/Total", () => {
    const trades = [
      makeTrade({ net_pnl: 100 }),
      makeTrade({ net_pnl: -50 }),
      makeTrade({ net_pnl: 30 }),
    ];
    render(<TradeHistoryTable symbol="TCS" trades={trades} {...defaultProps} />, {
      wrapper: Wrapper,
    });
    expect(screen.getByTestId("trade-summary-pnl")).toBeInTheDocument();
    expect(screen.getByTestId("trade-summary-wr")).toBeInTheDocument();
    expect(screen.getByTestId("trade-summary-wins")).toBeInTheDocument();
    expect(screen.getByText(/Wins: 2\/3/)).toBeInTheDocument();
  });

  test("sortable headers for Entry, Exit, Side, Qty, Entry Price, Level Hi, Exit, P&L, %, Hold, Type", () => {
    const trades = [makeTrade()];
    render(<TradeHistoryTable symbol="TCS" trades={trades} {...defaultProps} />, {
      wrapper: Wrapper,
    });
    expect(screen.getAllByText("Entry")).toHaveLength(2);
    expect(screen.getAllByText("Exit")).toHaveLength(2);
    expect(screen.getByText("Side")).toBeInTheDocument();
    expect(screen.getByText("Qty")).toBeInTheDocument();
    expect(screen.getByText("Level Hi")).toBeInTheDocument();
    expect(screen.getByText("P&L")).toBeInTheDocument();
    expect(screen.getByText("Hold")).toBeInTheDocument();
    expect(screen.getByText("Type")).toBeInTheDocument();
    expect(screen.getByTestId("th-pnl-pct")).toBeInTheDocument();
    expect(screen.getByTestId("th-hold-duration")).toBeInTheDocument();
    expect(screen.getByTestId("th-exit-reason")).toBeInTheDocument();
  });

  test("Level Hi column adapts to 52W data", () => {
    const trades = [makeTrade({ "52w_high": 500 })];
    render(<TradeHistoryTable symbol="TCS" trades={trades} {...defaultProps} />, {
      wrapper: Wrapper,
    });
    expect(screen.getByText("52W High")).toBeInTheDocument();
    expect(screen.queryByText("Level Hi")).not.toBeInTheDocument();
  });

  test("Level Hi column shows 'Level Hi' for ORB data", () => {
    const trades = [makeTrade({ or_high: 110 })];
    render(<TradeHistoryTable symbol="TCS" trades={trades} {...defaultProps} />, {
      wrapper: Wrapper,
    });
    expect(screen.getByText("Level Hi")).toBeInTheDocument();
  });

  test("Level Lo column only rendered for non-52W strategies", () => {
    const trades = [makeTrade({ or_low: 90 })];
    render(<TradeHistoryTable symbol="TCS" trades={trades} {...defaultProps} />, {
      wrapper: Wrapper,
    });
    expect(screen.getByText("Level Lo")).toBeInTheDocument();
  });

  test("Level Lo column hidden for 52W strategies", () => {
    const trades = [makeTrade({ "52w_high": 500 })];
    render(<TradeHistoryTable symbol="TCS" trades={trades} {...defaultProps} />, {
      wrapper: Wrapper,
    });
    expect(screen.queryByText("Level Lo")).not.toBeInTheDocument();
  });

  test("trade rows numbered (#)", () => {
    const trades = [makeTrade(), makeTrade({ net_pnl: 200 })];
    render(<TradeHistoryTable symbol="TCS" trades={trades} {...defaultProps} />, {
      wrapper: Wrapper,
    });
    const tbody = screen.getByTestId("trade-history-tbody");
    const rows = tbody.querySelectorAll("tr");
    expect(rows[0].getAttribute("data-trade-number")).toBe("1");
    expect(rows[1].getAttribute("data-trade-number")).toBe("2");
  });

  test("P&L color coded based on value", () => {
    const trades = [
      makeTrade({ net_pnl: 100 }),
      makeTrade({ net_pnl: -50 }),
    ];
    render(<TradeHistoryTable symbol="TCS" trades={trades} {...defaultProps} />, {
      wrapper: Wrapper,
    });
    const cells = screen.getAllByText(/^₹/);
    const greenCell = cells.find((c) => c.getAttribute("style")?.includes("green"));
    const redCell = cells.find((c) => c.getAttribute("style")?.includes("red"));
    expect(greenCell || redCell).toBeTruthy();
  });

  test("% column shows sign (+/-)", () => {
    const trades = [
      makeTrade({ net_pnl_pct: 2.5 }),
      makeTrade({ net_pnl_pct: -1.3 }),
    ];
    render(<TradeHistoryTable symbol="TCS" trades={trades} {...defaultProps} />, {
      wrapper: Wrapper,
    });
    expect(screen.getByText("+2.50%")).toBeInTheDocument();
    expect(screen.getByText("-1.30%")).toBeInTheDocument();
  });

  test("exit reason badge color coded (TP green, SL red, TRAILING_STOP orange, other gray)", () => {
    const trades = [
      makeTrade({ exit_reason: "TP" }),
      makeTrade({ exit_reason: "SL" }),
      makeTrade({ exit_reason: "TRAILING_STOP" }),
      makeTrade({ exit_reason: "EOD" }),
    ];
    render(<TradeHistoryTable symbol="TCS" trades={trades} {...defaultProps} />, {
      wrapper: Wrapper,
    });
    expect(screen.getByText("TP")).toBeInTheDocument();
    expect(screen.getByText("SL")).toBeInTheDocument();
    expect(screen.getByText("TRAILING_STOP")).toBeInTheDocument();
    expect(screen.getByText("EOD")).toBeInTheDocument();
  });

  test("row click calls onRowClick", () => {
    const trades = [makeTrade()];
    render(<TradeHistoryTable symbol="TCS" trades={trades} {...defaultProps} />, {
      wrapper: Wrapper,
    });
    const row = screen.getByTestId("trade-history-tbody").querySelector("tr")!;
    row.click();
    expect(onRowClick).toHaveBeenCalledWith(0);
  });

  test("row background tinted red for losing trades", () => {
    const trades = [
      makeTrade({ net_pnl: 100 }),
      makeTrade({ net_pnl: -50 }),
    ];
    render(<TradeHistoryTable symbol="TCS" trades={trades} {...defaultProps} />, {
      wrapper: Wrapper,
    });
    const rows = screen.getByTestId("trade-history-tbody").querySelectorAll("tr");
    expect(rows[0].getAttribute("style")).toBeNull();
    expect(rows[1].getAttribute("style")).toContain("rgba(255, 0, 0, 0.05)");
  });
});
