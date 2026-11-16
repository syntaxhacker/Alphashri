// @vitest-environment happy-dom
import type { JSX } from "solid-js";
import { describe, expect, test, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import { formatDateTimeHuman, formatDuration } from "../../utils/ui-helpers";
import { sortTrades, sortTradeRows, TradeHistoryTable } from "./TradeHistoryTable";
import type { Trade } from "../../types/backtest";
import { TINT_LOSS_ROW } from "../../config/colors";
import "@testing-library/jest-dom/vitest";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function Wrapper({ children }: { children: JSX.Element }) {
  return <UIProvider>{children}</UIProvider>;
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

/** Every sortable column has a distinct value so a wrong order is unambiguous. */
function sortingFixture(): Trade[] {
  return [
    makeTrade({
      entry_time: "2025-06-12T09:30:00Z", exit_time: "2025-06-12T10:00:00Z",
      side: "SHORT", quantity: 40, entry_price: 400, exit_price: 410,
      or_high: 900, or_low: 90, net_pnl: -20, net_pnl_pct: -2,
      hold_duration_minutes: 120, exit_reason: "TP",
    }),
    makeTrade({
      entry_time: "2025-06-10T09:30:00Z", exit_time: "2025-06-10T10:00:00Z",
      side: "LONG", quantity: 10, entry_price: 100, exit_price: 110,
      or_high: 100, or_low: 10, net_pnl: 100, net_pnl_pct: 5,
      hold_duration_minutes: 30, exit_reason: "SL",
    }),
    makeTrade({
      entry_time: "2025-06-14T09:30:00Z", exit_time: "2025-06-14T10:00:00Z",
      side: "SHORT", quantity: 25, entry_price: 250, exit_price: 260,
      or_high: 500, or_low: 50, net_pnl: 50, net_pnl_pct: 1,
      hold_duration_minutes: 60, exit_reason: "EOD",
    }),
    makeTrade({
      entry_time: "2025-06-11T09:30:00Z", exit_time: "2025-06-11T10:00:00Z",
      side: "LONG", quantity: 15, entry_price: 150, exit_price: 160,
      or_high: 300, or_low: 30, net_pnl: 10, net_pnl_pct: 0.5,
      hold_duration_minutes: 90, exit_reason: "TRAILING_STOP",
    }),
  ];
}

/** Stable 1-based trade numbers in the DOM's rendered row order. */
function renderedTradeNumbers(): number[] {
  const table = screen.getByTestId("trade-history-table");
  return Array.from(table.querySelectorAll<HTMLElement>("[data-trade-number]")).map((row) =>
    Number(row.getAttribute("data-trade-number")),
  );
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

describe("shared trade sort (external helper vs table-header path)", () => {
  const SORTABLE_COLUMNS = [
    "entry_time", "exit_time", "side", "quantity", "entry_price", "exit_price",
    "level_high", "level_low", "net_pnl", "net_pnl_pct", "hold_duration_minutes", "exit_reason",
  ];
  const noop = () => {};

  test.each(
    SORTABLE_COLUMNS.flatMap((column) =>
      (["asc", "desc"] as const).map((direction) => ({ column, direction })),
    ),
  )("$column/$direction: both sort paths agree and the table renders that order", ({ column, direction }) => {
    const trades = sortingFixture();
    const stableNumbers = (ordered: Trade[]) => ordered.map((t) => trades.indexOf(t) + 1);
    const expected = stableNumbers(sortTrades(trades, column, direction));

    expect(stableNumbers(sortTradeRows(trades, column, direction))).toEqual(expected);

    render(
      () => (
        <TradeHistoryTable
          symbol="TCS" trades={trades}
          sortColumn={column} sortDirection={direction}
          onSort={noop} onRowClick={noop} onClose={noop}
        />
      ),
      { wrapper: Wrapper },
    );
    expect(renderedTradeNumbers()).toEqual(expected);
  });

  test("null/undefined numeric values sort last in both directions", () => {
    const asNull = makeTrade({ net_pnl: null as unknown as number });
    const asUndefined = makeTrade({ net_pnl: undefined as unknown as number });
    const trades = [makeTrade({ net_pnl: 50 }), asNull, makeTrade({ net_pnl: -10 }), asUndefined];

    for (const direction of ["asc", "desc"] as const) {
      const viaHelper = sortTrades(trades, "net_pnl", direction);
      expect(sortTradeRows(trades, "net_pnl", direction)).toEqual(viaHelper);
      expect(viaHelper.slice(0, 2).map((t) => t.net_pnl)).toEqual(
        direction === "asc" ? [-10, 50] : [50, -10],
      );
      expect(viaHelper.slice(2)).toEqual(expect.arrayContaining([asNull, asUndefined]));
    }
  });

  test("level_high fallback uses the same field order in both paths", () => {
    // or_high → r1 → 52w_high → legacy 52w_high_entry → 0; each row pins a later rung.
    const viaR1 = makeTrade({ r1: 100, "52w_high": 900 });
    (viaR1 as any)["52w_high_entry"] = 950;
    const via52w = makeTrade({ "52w_high": 200 });
    (via52w as any)["52w_high_entry"] = 950;
    const viaLegacy = makeTrade();
    (viaLegacy as any)["52w_high_entry"] = 300;
    const noLevel = makeTrade();

    const trades = [viaLegacy, noLevel, via52w, viaR1];
    const expected = [noLevel, viaR1, via52w, viaLegacy]; // 0 → 100 → 200 → 300

    expect(sortTrades(trades, "level_high", "asc")).toEqual(expected);
    expect(sortTradeRows(trades, "level_high", "asc")).toEqual(expected);

    render(
      () => (
        <TradeHistoryTable
          symbol="TCS" trades={trades}
          sortColumn="level_high" sortDirection="asc"
          onSort={noop} onRowClick={noop} onClose={noop}
        />
      ),
      { wrapper: Wrapper },
    );
    expect(renderedTradeNumbers()).toEqual(expected.map((t) => trades.indexOf(t) + 1));
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
    render(() => <TradeHistoryTable symbol="TCS" trades={[]} {...defaultProps} />,
      { wrapper: Wrapper },
    );
    expect(screen.queryByTestId("trade-history-panel")).toBeNull();
  });

  test("renders nothing when trades null", () => {
    render(() => <TradeHistoryTable symbol="TCS" trades={null as unknown as Trade[]} {...defaultProps} />,
      { wrapper: Wrapper },
    );
    expect(screen.queryByTestId("trade-history-panel")).toBeNull();
  });

  test("header shows symbol name and trade count", () => {
    const trades = [makeTrade(), makeTrade()];
    render(() => <TradeHistoryTable symbol="TCS" trades={trades} {...defaultProps} />, {
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
    render(() => <TradeHistoryTable symbol="TCS" trades={trades} {...defaultProps} />, {
      wrapper: Wrapper,
    });
    expect(screen.getByTestId("trade-summary-pnl")).toBeInTheDocument();
    expect(screen.getByTestId("trade-summary-wr")).toBeInTheDocument();
    expect(screen.getByTestId("trade-summary-wins")).toBeInTheDocument();
    expect(screen.getByText(/Wins: 2\/3/)).toBeInTheDocument();
  });

  test("headers disambiguate Entry/Exit time and price columns", () => {
    const trades = [makeTrade()];
    render(() => <TradeHistoryTable symbol="TCS" trades={trades} {...defaultProps} />, {
      wrapper: Wrapper,
    });
    // scope to the table: the summary row also renders a "P&L" label
    const table = within(screen.getByTestId("trade-history-table"));
    expect(table.getAllByText("Entry Time")).toHaveLength(1);
    expect(table.getAllByText("Exit Time")).toHaveLength(1);
    expect(table.getAllByText("Entry Price")).toHaveLength(1);
    expect(table.getAllByText("Exit Price")).toHaveLength(1);
    expect(table.queryByText("Entry")).not.toBeInTheDocument();
    expect(table.queryByText("Exit")).not.toBeInTheDocument();
    expect(table.getByText("Side")).toBeInTheDocument();
    expect(table.getByText("Qty")).toBeInTheDocument();
    expect(table.getByText("Level Hi")).toBeInTheDocument();
    expect(table.getByText("P&L")).toBeInTheDocument();
    expect(table.getByText("Hold")).toBeInTheDocument();
    expect(table.getByText("Type")).toBeInTheDocument();
  });

  test("Level Hi column adapts to 52W data", () => {
    const trades = [makeTrade({ "52w_high": 500 })];
    render(() => <TradeHistoryTable symbol="TCS" trades={trades} {...defaultProps} />, {
      wrapper: Wrapper,
    });
    expect(screen.getByText("52W High")).toBeInTheDocument();
    expect(screen.queryByText("Level Hi")).not.toBeInTheDocument();
  });

  test("Level Hi column shows 'Level Hi' for ORB data", () => {
    const trades = [makeTrade({ or_high: 110 })];
    render(() => <TradeHistoryTable symbol="TCS" trades={trades} {...defaultProps} />, {
      wrapper: Wrapper,
    });
    expect(screen.getByText("Level Hi")).toBeInTheDocument();
  });

  test("Level Lo column only rendered for non-52W strategies", () => {
    const trades = [makeTrade({ or_low: 90 })];
    render(() => <TradeHistoryTable symbol="TCS" trades={trades} {...defaultProps} />, {
      wrapper: Wrapper,
    });
    expect(screen.getByText("Level Lo")).toBeInTheDocument();
  });

  test("Level Lo column hidden for 52W strategies", () => {
    const trades = [makeTrade({ "52w_high": 500 })];
    render(() => <TradeHistoryTable symbol="TCS" trades={trades} {...defaultProps} />, {
      wrapper: Wrapper,
    });
    expect(screen.queryByText("Level Lo")).not.toBeInTheDocument();
  });

  test("trade rows numbered (#)", () => {
    const trades = [makeTrade(), makeTrade({ net_pnl: 200 })];
    render(() => <TradeHistoryTable symbol="TCS" trades={trades} {...defaultProps} />, {
      wrapper: Wrapper,
    });
    expect(screen.getByTestId("trade-history-row-0")).toBeInTheDocument();
    expect(screen.getByTestId("trade-history-row-1")).toBeInTheDocument();
  });

  test("P&L color coded based on value", () => {
    const trades = [
      makeTrade({ net_pnl: 100 }),
      makeTrade({ net_pnl: -50 }),
    ];
    render(() => <TradeHistoryTable symbol="TCS" trades={trades} {...defaultProps} />, {
      wrapper: Wrapper,
    });
    // P&L cells carry a semantic data-pnl-sign (emotion classes are hashed,
    // so inline-style substring checks can't see the tone)
    const table = screen.getByTestId("trade-history-table");
    const cells = within(table).getAllByText(/^₹/);
    expect(cells.find((c) => c.getAttribute("data-pnl-sign") === "pos")).toBeInTheDocument();
    expect(cells.find((c) => c.getAttribute("data-pnl-sign") === "neg")).toBeInTheDocument();
  });

  test("% column shows sign (+/-)", () => {
    const trades = [
      makeTrade({ net_pnl_pct: 2.5 }),
      makeTrade({ net_pnl_pct: -1.3 }),
    ];
    render(() => <TradeHistoryTable symbol="TCS" trades={trades} {...defaultProps} />, {
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
    render(() => <TradeHistoryTable symbol="TCS" trades={trades} {...defaultProps} />, {
      wrapper: Wrapper,
    });
    const table = within(screen.getByTestId("trade-history-table"));
    expect(table.getByText("TP")).toBeInTheDocument();
    expect(table.getByText("SL")).toBeInTheDocument();
    expect(table.getByText("TRAILING_STOP")).toBeInTheDocument();
    expect(table.getByText("EOD")).toBeInTheDocument();
  });

  test("row click calls onRowClick", async () => {
    const trades = [makeTrade()];
    render(() => <TradeHistoryTable symbol="TCS" trades={trades} {...defaultProps} />, {
      wrapper: Wrapper,
    });
    const row = screen.getByTestId("trade-history-row-0");
    await fireEvent.click(row);
    expect(onRowClick).toHaveBeenCalledWith(1);
  });

  test("row background tinted red for losing trades", () => {
    const trades = [
      makeTrade({ net_pnl: 100 }),
      makeTrade({ net_pnl: -50 }),
    ];
    render(() => <TradeHistoryTable symbol="TCS" trades={trades} {...defaultProps} />, {
      wrapper: Wrapper,
    });
    const row0 = screen.getByTestId("trade-history-row-0");
    const row1 = screen.getByTestId("trade-history-row-1");
    expect(row0.getAttribute("style")).not.toContain(TINT_LOSS_ROW);
    expect(row1.getAttribute("style")).toContain(TINT_LOSS_ROW);
  });

  test("result filter narrows rows and updates the count", async () => {
    const trades = [makeTrade({ net_pnl: 100 }), makeTrade({ net_pnl: -50 })];
    render(() => <TradeHistoryTable symbol="TCS" trades={trades} {...defaultProps} />, {
      wrapper: Wrapper,
    });
    expect(screen.getByTestId("filter-count")).toHaveTextContent("2/2");

    await fireEvent.click(screen.getByRole("button", { name: "Win" }));

    expect(screen.getByTestId("filter-count")).toHaveTextContent("1/2");
    expect(screen.getByTestId("trade-history-row-0")).toBeInTheDocument();
    expect(screen.queryByTestId("trade-history-row-1")).toBeNull();
  });

  test("filters renumber-safely and clear resets them", async () => {
    const trades = [makeTrade({ net_pnl: -50 }), makeTrade({ net_pnl: 100 })];
    render(() => <TradeHistoryTable symbol="TCS" trades={trades} {...defaultProps} />, {
      wrapper: Wrapper,
    });
    await fireEvent.click(screen.getByRole("button", { name: "Win" }));
    // the surviving trade keeps its original stable number (#2), not #1
    expect(screen.getByTestId("trade-history-row-0")).toHaveAttribute("data-trade-number", "2");

    await fireEvent.click(screen.getByTestId("filter-clear"));
    expect(screen.getByTestId("filter-count")).toHaveTextContent("2/2");
    expect(screen.getByTestId("trade-history-row-1")).toBeInTheDocument();
  });

  test("empty filter result shows a message", async () => {
    const trades = [makeTrade({ net_pnl: 100 })];
    render(() => <TradeHistoryTable symbol="TCS" trades={trades} {...defaultProps} />, {
      wrapper: Wrapper,
    });
    await fireEvent.click(screen.getByRole("button", { name: "Loss" }));
    expect(screen.getByText("No trades match the current filters.")).toBeInTheDocument();
  });
});
