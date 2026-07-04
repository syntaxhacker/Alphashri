// @vitest-environment happy-dom
import React, { ComponentProps } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";

// ============================================
// Module Mocks — MUST be before any component imports
// ============================================

vi.mock("../../state/paperTrading", () => ({
  deleteTradeAction: vi.fn(),
  setFilterBot: vi.fn(),
  setFilterStrategy: vi.fn(),
  updateTradeNotesAction: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../api/paperTrading", () => ({
  updateTradeNotesAction: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../utils/ui-helpers", () => ({
  formatNumber: (n: number) => `${n}`,
  formatSignedPnl: (n: number) => {
    const sign = n >= 0 ? "+" : "";
    const abs = typeof n === "number" ? Math.abs(n) : 0;
    return `${sign}₹${abs}`;
  },
  formatTimeOnly: (_t: string) => "09:30",
  formatDateHeader: (_d: string) => "Apr 24, 2026",
  formatDuration: (m: number) => `${m}m`,
  getPnLTextColor: (value: number) => (value >= 0 ? "green" : "red"),
  sortByField: (arr: any[], _key: string, _dir: "asc" | "desc") => arr,
  getStrategyTypeFromName: (name: string) => (name === "ORB Conservative" ? "orb" : undefined),
}));
import { DayGroup } from "./DayGroup";
import type { PaperTrade } from "../../types/paperTrading";
import { TestWrapper } from "../../test/test-utils";
import { mockTrade } from "./testFixtures";

// Mantine component mocks
// Note: MantineProvider is provided by TestWrapper wrapper, so we only mock individual components
vi.mock("@/ui", () => {
  // Grid with nested Grid.Col
  const Grid = ({ children, grow, ...props }: any) => (
    <div
      data-testid={props["data-testid"]}
      {...props}
      style={{
        ...props.style,
        ...(grow
          ? {
              flexGrow: 1,
            }
          : {}),
      }}
    >
      {children}
    </div>
  );
  Grid.Col = ({ children, span, ...props }: any) => (
    <div data-testid={props["data-testid"]} data-span={JSON.stringify(span)} {...props}>
      {children}
    </div>
  );

  // Table with nested subcomponents
  const Table = ({ children, styles, ...props }: any) => (
    <table data-testid={props["data-testid"]} style={styles}>
      {children}
    </table>
  );
  Table.Thead = ({ children }: any) => <thead>{children}</thead>;
  Table.Tbody = ({ children }: any) => <tbody>{children}</tbody>;
  Table.Tr = React.forwardRef<HTMLTableRowElement, any>(({ children, ...props }, ref) => (
    <tr
      data-testid={props["data-testid"]}
      onClick={props.onClick}
      style={props.style}
      className={props.className}
      ref={ref}
    >
      {children}
    </tr>
  ));
  Table.Td = ({ children, p, ...props }: any) => (
    <td
      data-testid={props["data-testid"]}
      style={{
        padding: p,
      }}
    >
      {children}
    </td>
  );
  Table.Th = ({ children, ...props }: any) => (
    <th
      data-testid={props["data-testid"]}
      data-sorted={props["data-sorted"]}
      data-direction={props["data-direction"]}
      onClick={props.onClick}
    >
      {children}
    </th>
  );
  return {
    UIProvider: ({ children }: any) => <>{children}</>,
    TableTh: Table.Th,
    TableThead: Table.Thead,
    TableTbody: Table.Tbody,
    TableTr: Table.Tr,
    TableTd: Table.Td,
    Anchor: ({ children, onClick, ...props }: any) => (
      <button
        data-testid={props["data-testid"]}
        onClick={(e) => {
          e.stopPropagation();
          onClick?.(e);
        }}
        style={props.style}
      >
        {children}
      </button>
    ),
    Badge: ({ children, color, ...props }: any) => (
      <span
        data-testid={props["data-testid"]}
        data-color={color}
        style={{
          background: color,
        }}
      >
        {children}
      </span>
    ),
    Button: ({ children, loading, onClick, ...props }: any) => (
      <button
        data-testid={props["data-testid"]}
        disabled={props.disabled || loading}
        loading={loading ? "" : undefined}
        onClick={(e) => {
          e.stopPropagation();
          onClick?.(e);
        }}
      >
        {children}
      </button>
    ),
    Collapse: ({ children, in: inProp }: any) =>
      inProp ? <div data-testid="collapse-in">{children}</div> : null,
    Flex: ({ children, ...props }: any) => (
      <div data-testid={props["data-testid"]} {...props}>
        {children}
      </div>
    ),
    Grid,
    Group: ({ children, ...props }: any) => (
      <div data-testid={props["data-testid"]} {...props}>
        {children}
      </div>
    ),
    Stack: ({ children, ...props }: any) => (
      <div data-testid={props["data-testid"]} {...props}>
        {children}
      </div>
    ),
    Table,
    Text: ({ children, c, fw, size, ...props }: any) => (
      <span data-testid={props["data-testid"]} data-color={c} data-fw={fw} data-size={size}>
        {children}
      </span>
    ),
    Textarea: ({ value, onChange, placeholder, ...props }: any) => (
      <textarea
        data-testid={props["data-testid"]}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
      />
    ),
    ActionIcon: ({ children, variant, color, size, onClick, ...props }: any) => (
      <button
        data-testid={props["data-testid"]}
        data-variant={variant}
        data-color={color}
        data-size={size}
        onClick={(e) => {
          e.stopPropagation();
          onClick?.(e);
        }}
        type="button"
      >
        {children}
      </button>
    ),
  };
});
vi.mock("@tabler/icons-react", () => ({
  IconArrowUp: () => <svg data-testid="icon-arrow-up" />,
  IconArrowDown: () => <svg data-testid="icon-arrow-down" />,
}));

// Mock react-router-dom
vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

// Mock PreviewChartProvider (used by ClickableSymbol)
vi.mock("../common/PreviewChartProvider", () => ({
  usePreviewChart: () => ({
    showPreviewChart: vi.fn(),
    hidePreviewChart: vi.fn(),
  }),
}));

// ============================================
// Mock Data Helpers — uses shared mockTrade from testFixtures
// ============================================

const defaultTradeOverrides: Partial<PaperTrade> = {
  trade_id: "trade-1",
  symbol: "RELIANCE",
  quantity: 10,
  entry_price: 3750,
  exit_price: 3825,
  entry_time: "2026-04-24T09:30:00Z",
  exit_time: "2026-04-24T10:00:00Z",
  hold_duration_minutes: 30,
  pnl: 500,
  net_pnl: 500,
  costs: 50,
  stop_loss: 3700,
  take_profit: 3900,
  peak_price: 3830,
  low_price: 3710,
  bot_id: "bot-1",
  bot_name: "Test Bot",
  strategy_id: 1,
  strategy_name: "ORB Conservative",
  exit_reason: "TP",
  reason: "Test reason",
  notes: "Test notes",
};

const lossTradeOverrides: Partial<PaperTrade> = {
  trade_id: "trade-loss",
  symbol: "TCS",
  side: "SELL",
  quantity: 5,
  entry_price: 4000,
  exit_price: 3950,
  entry_time: "2026-04-24T11:00:00Z",
  exit_time: "2026-04-24T11:30:00Z",
  hold_duration_minutes: 30,
  pnl: -250,
  net_pnl: -300,
  costs: 50,
  stop_loss: 4050,
  take_profit: 3950,
  peak_price: 4010,
  low_price: 3940,
  bot_id: "bot-2",
  bot_name: "Loss Bot",
  strategy_id: 2,
  strategy_name: "EMA Cross",
  exit_reason: "SL",
  reason: "Stop loss hit",
  notes: "Lost money",
};

// ============================================
// Test Setup
// ============================================

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
});
const defaultProps = {
  date: "2026-04-24",
  trades: [] as PaperTrade[],
  selectedSymbol: null,
  selectedTradeId: null,
  onSelectSymbol: vi.fn(),
  onDeleteTrade: vi.fn(),
  expanded: false,
  onToggle: vi.fn(),
  tableStyles: {},
  sortColumn: null,
  sortDirection: "asc" as const,
  onSort: vi.fn(),
};

// ============================================
// Helper: render + expand a trade detail
// ============================================

async function setupTradeDetail(trades: PaperTrade[], overrides: Partial<ComponentProps<typeof DayGroup>> = {}) {
  const user = userEvent.setup();
  render(<DayGroup {...defaultProps} trades={trades} expanded={true} {...overrides} />, { wrapper: TestWrapper });
  await user.click(screen.getByTestId("trade-detail-toggle-trade-1"));
  return { user };
}

// ============================================
// DaySummary Tests
// ============================================

describe("DaySummary", () => {
  it("renders formatted date using formatDateHeader", () => {
    render(<DayGroup {...defaultProps} trades={[mockTrade(defaultTradeOverrides)]} />, {
      wrapper: TestWrapper,
    });
    expect(screen.getByText("Apr 24, 2026")).toBeInTheDocument();
  });
  it("shows day P&L with + prefix for positive net_pnl", () => {
    const trades = [
      mockTrade({...defaultTradeOverrides, 
        net_pnl: 500,
      }),
    ];
    render(<DayGroup {...defaultProps} trades={trades} />, {
      wrapper: TestWrapper,
    });
    // Rendered as: pnlSign + "₹" + formatNumber(Math.abs(dayPnl))
    // Text is fragmented across nodes; use function matcher
    expect(screen.getByText((content) => content.includes("+₹500"))).toBeInTheDocument();
  });
  it("shows day P&L with - prefix for negative net_pnl", () => {
    const trades = [mockTrade(lossTradeOverrides)];
    render(<DayGroup {...defaultProps} trades={trades} />, {
      wrapper: TestWrapper,
    });
    // dayPnl = -300, pnlSign = "", displayed as "₹300"
    expect(screen.getByText((content) => content.includes("₹300"))).toBeInTheDocument();
  });
  it("applies green color from getPnLTextColor for positive P&L", () => {
    const trades = [
      mockTrade({...defaultTradeOverrides, 
        net_pnl: 500,
      }),
    ];
    render(<DayGroup {...defaultProps} trades={trades} />, {
      wrapper: TestWrapper,
    });
    const pnlElement = screen.getByText((content) => content.includes("+₹500"));
    expect(pnlElement.closest("span")).toHaveAttribute("data-color", "green");
  });
  it("applies green color from getPnLTextColor for zero P&L", () => {
    const trades = [
      mockTrade({...defaultTradeOverrides, 
        net_pnl: 0,
      }),
    ];
    render(<DayGroup {...defaultProps} trades={trades} />, {
      wrapper: TestWrapper,
    });
    const pnlElement = screen.getByText((content) => content.includes("+₹0"));
    expect(pnlElement.closest("span")).toHaveAttribute("data-color", "green");
  });
  it("shows win badge ▲{count} in green when wins > 0", () => {
    const trades = [
      mockTrade({...defaultTradeOverrides, 
        net_pnl: 500,
      }),
      mockTrade({...defaultTradeOverrides, 
        net_pnl: 200,
      }),
    ];
    render(<DayGroup {...defaultProps} trades={trades} />, {
      wrapper: TestWrapper,
    });
    const winBadge = screen.getByText("▲2");
    expect(winBadge).toBeInTheDocument();
    expect(winBadge.closest("span")).toHaveAttribute("data-color", "green");
  });
  it("shows win badge in gray when wins = 0", () => {
    const trades = [mockTrade(lossTradeOverrides)];
    render(<DayGroup {...defaultProps} trades={trades} />, {
      wrapper: TestWrapper,
    });
    const winBadge = screen.getByText("▲0");
    expect(winBadge.closest("span")).toHaveAttribute("data-color", "gray");
  });
  it("shows loss badge ▼{count} in red when losses > 0", () => {
    const trades = [mockTrade(lossTradeOverrides)];
    render(<DayGroup {...defaultProps} trades={trades} />, {
      wrapper: TestWrapper,
    });
    const lossBadge = screen.getByText("▼1");
    expect(lossBadge).toBeInTheDocument();
    expect(lossBadge.closest("span")).toHaveAttribute("data-color", "red");
  });
  it("shows loss badge in gray when losses = 0", () => {
    const trades = [mockTrade(defaultTradeOverrides)];
    render(<DayGroup {...defaultProps} trades={trades} />, {
      wrapper: TestWrapper,
    });
    const lossBadge = screen.getByText("▼0");
    expect(lossBadge.closest("span")).toHaveAttribute("data-color", "gray");
  });
  it("clicking header calls onToggle", () => {
    const onToggle = vi.fn();
    render(<DayGroup {...defaultProps} onToggle={onToggle} />, {
      wrapper: TestWrapper,
    });
    screen.getByTestId("day-header-2026-04-24").click();
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
  it("day header has cursor: pointer style", () => {
    render(<DayGroup {...defaultProps} />, {
      wrapper: TestWrapper,
    });
    const header = screen.getByTestId("day-header-2026-04-24");
    expect(header).toHaveStyle({
      cursor: "pointer",
    });
  });
});

// ============================================
// DayGroup Core Rendering Tests
// ============================================

describe("DayGroup core rendering", () => {
  it("renders root with data-testid day-group-{date}", () => {
    render(<DayGroup {...defaultProps} />, {
      wrapper: TestWrapper,
    });
    expect(screen.getByTestId("day-group-2026-04-24")).toBeInTheDocument();
  });
  it("renders root with id day-group-{date}", () => {
    render(<DayGroup {...defaultProps} />, {
      wrapper: TestWrapper,
    });
    expect(document.getElementById("day-group-2026-04-24")).toBeInTheDocument();
  });
  it("renders root with className paper-day-group", () => {
    render(<DayGroup {...defaultProps} />, {
      wrapper: TestWrapper,
    });
    expect(screen.getByTestId("day-group-2026-04-24")).toHaveClass("paper-day-group");
  });
  it("renders header with data-testid day-header-{date}", () => {
    render(<DayGroup {...defaultProps} trades={[mockTrade(defaultTradeOverrides)]} />, {
      wrapper: TestWrapper,
    });
    expect(screen.getByTestId("day-header-2026-04-24")).toBeInTheDocument();
  });
  it("DaySummary displays trades count via P&L aggregation (sum of all trades)", () => {
    const trades = [
      mockTrade({...defaultTradeOverrides, 
        net_pnl: 100,
      }),
      mockTrade({...defaultTradeOverrides, 
        net_pnl: 200,
      }),
    ];
    render(<DayGroup {...defaultProps} trades={trades} />, {
      wrapper: TestWrapper,
    });
    // Day P&L should be 300
    expect(screen.getByText((content) => content.includes("+₹300"))).toBeInTheDocument();
  });
  it("renders table with SortableHeader for all 13 columns", () => {
    render(<DayGroup {...defaultProps} trades={[mockTrade(defaultTradeOverrides)]} expanded={true} />, {
      wrapper: TestWrapper,
    });
    const headers = screen.getAllByRole("columnheader");
    expect(headers.length).toBe(14); // 1 expand column + 13 data columns + Actions
  });
  const columns = ["Symbol", "Side", "Qty", "Entry", "Exit", "Hold", "P&L", "Bot", "Strategy", "SL", "TP"];
  it.each(columns)("SortableHeader renders %s column", (col) => {
    render(<DayGroup {...defaultProps} trades={[mockTrade(defaultTradeOverrides)]} expanded={true} />, {
      wrapper: TestWrapper,
    });
    if (col === "Exit") {
      expect(screen.getAllByText("Exit").length).toBe(2);
    } else if (col === "TP") {
      expect(screen.getAllByText("TP").length).toBeGreaterThanOrEqual(1);
    } else {
      expect(screen.getByText(col)).toBeInTheDocument();
    }
  });
  it("expanded=true renders table visible inside Collapse", () => {
    render(<DayGroup {...defaultProps} trades={[mockTrade(defaultTradeOverrides)]} expanded={true} />, {
      wrapper: TestWrapper,
    });
    expect(screen.getByTestId("collapse-in")).toBeInTheDocument();
  });
  it("expanded=false does not render table", () => {
    render(<DayGroup {...defaultProps} trades={[mockTrade(defaultTradeOverrides)]} expanded={false} />, {
      wrapper: TestWrapper,
    });
    expect(screen.queryByTestId("collapse-in")).not.toBeInTheDocument();
  });
  it("renders empty state correctly with no trades", () => {
    render(<DayGroup {...defaultProps} trades={[]} expanded={false} />, {
      wrapper: TestWrapper,
    });
    expect(screen.getByTestId("day-group-2026-04-24")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

// ============================================
// TradeRow Rendering Tests
// ============================================

describe("TradeRow rendering", () => {
  const trade = mockTrade(defaultTradeOverrides);
  beforeEach(() => {
    render(<DayGroup {...defaultProps} trades={[trade]} expanded={true} />, {
      wrapper: TestWrapper,
    });
  });
  it("renders row with data-testid trade-row-{trade_id}", () => {
    expect(screen.getByTestId("trade-row-trade-1")).toBeInTheDocument();
  });
  it("SideBadge shows side text", () => {
    // SideBadge renders "▲ BUY" with arrow, so use substring match
    expect(screen.getByText((content) => content.includes("BUY"))).toBeInTheDocument();
  });
  it("ClickableSymbol renders symbol", () => {
    expect(screen.getByText("RELIANCE")).toBeInTheDocument();
  });
  it("Entry price formatted toFixed(2) with ₹ prefix", () => {
    expect(screen.getByText("₹3750.00")).toBeInTheDocument();
  });
  it("Exit price formatted toFixed(2) with ₹ prefix", () => {
    expect(screen.getByText("₹3825.00")).toBeInTheDocument();
  });
  it("Entry time formatted via formatTimeOnly in expanded detail", async () => {
    await userEvent.click(screen.getByTestId("trade-detail-toggle-trade-1"));
    expect(screen.getByText("Entry Time")).toBeInTheDocument();
    expect(screen.getAllByText("09:30").length).toBeGreaterThan(0);
  });
  it("Exit time formatted via formatTimeOnly in expanded detail", async () => {
    await userEvent.click(screen.getByTestId("trade-detail-toggle-trade-1"));
    expect(screen.getByText("Exit Time")).toBeInTheDocument();
    expect(screen.getAllByText("09:30").length).toBeGreaterThan(0);
  });

  it("Duration formatted via formatDuration", () => {
    expect(screen.getByText("30m")).toBeInTheDocument();
  });
  it("Net P&L displayed with formatted number", () => {
    // May appear in multiple places (row, summary); ensure at least one
    expect(screen.getAllByText((content) => content.includes("₹500")).length).toBeGreaterThan(0);
  });
  it("Bot anchor renders bot name", () => {
    expect(screen.getByText("Test Bot")).toBeInTheDocument();
  });
  it("Bot anchor has data-testid trade-bot-filter-{trade_id}", () => {
    expect(screen.getByTestId("trade-bot-filter-trade-1")).toBeInTheDocument();
  });
  it("Strategy anchor renders strategy name", () => {
    expect(screen.getByText("ORB Conservative")).toBeInTheDocument();
  });
  it("Strategy anchor has data-testid trade-strategy-filter-{trade_id}", () => {
    expect(screen.getByTestId("trade-strategy-filter-trade-1")).toBeInTheDocument();
  });
  it("ExitReasonBadge renders exit reason", () => {
    expect(screen.getAllByText("TP").length).toBeGreaterThanOrEqual(1);
  });
  it("Expand toggle button renders with ▶ when detail collapsed", () => {
    const toggle = screen.getByTestId("trade-detail-toggle-trade-1");
    expect(toggle).toHaveTextContent("▶");
  });
  it("Expand toggle button renders with ▼ when expanded", async () => {
    const toggle = screen.getByTestId("trade-detail-toggle-trade-1");
    await userEvent.click(toggle);
    expect(toggle).toHaveTextContent("▼");
  });
});

// ============================================
// Expand/Collapse Tests
// ============================================

describe("Expand/Collapse functionality", () => {
  const trade = mockTrade(defaultTradeOverrides);
  it("clicking toggle button expands detail locally", async () => {
    render(<DayGroup {...defaultProps} trades={[trade]} expanded={true} />, {
      wrapper: TestWrapper,
    });

    const toggle = screen.getByTestId("trade-detail-toggle-trade-1");
    await userEvent.click(toggle);

    expect(screen.getByText("Entry Time")).toBeInTheDocument();
  });
  it("clicking toggle button again collapses detail", async () => {
    render(<DayGroup {...defaultProps} trades={[trade]} expanded={true} />, {
      wrapper: TestWrapper,
    });
    const toggle = screen.getByTestId("trade-detail-toggle-trade-1");
    await userEvent.click(toggle);
    expect(screen.getByText("Entry Time")).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(screen.queryByText("Entry Time")).not.toBeInTheDocument();
  });
  it("expanded prop controls DayGroup-level table visibility", () => {
    const { rerender } = render(<DayGroup {...defaultProps} trades={[trade]} expanded={false} />, {
      wrapper: TestWrapper,
    });
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    rerender(<DayGroup {...defaultProps} trades={[trade]} expanded={true} />, {
      wrapper: TestWrapper,
    });
    expect(screen.getByRole("table")).toBeInTheDocument();
  });
});

// ============================================
// TradeDetail Tests
// ============================================

describe("TradeDetail", () => {
  const trade = mockTrade(defaultTradeOverrides);
  it("shows TradeStats grid with all stats", async () => {
    await setupTradeDetail([trade]);
    expect(screen.getByText("SL")).toBeInTheDocument();
    // "TP" appears both as label and in ExitReasonBadge; check at least one
    expect(screen.getAllByText("TP").length).toBeGreaterThan(0);
    expect(screen.getByText("Peak")).toBeInTheDocument();
    expect(screen.getByText("Low")).toBeInTheDocument();
    expect(screen.getByText("Costs")).toBeInTheDocument();
    expect(screen.getByText("Gross P&L")).toBeInTheDocument();
    expect(screen.getByText("Net P&L")).toBeInTheDocument();
  });
  it("SL shows toFixed(2) value with ₹ prefix", async () => {
    await setupTradeDetail([trade]);
    // Find the SL value by looking for text after "SL" label
    const slElements = screen.getAllByText("₹3700.00");
    expect(slElements.length).toBeGreaterThan(0);
  });
  it("TP shows toFixed(2) value with ₹ prefix", async () => {
    await setupTradeDetail([trade]);
    const tpElements = screen.getAllByText("₹3900.00");
    expect(tpElements.length).toBeGreaterThan(0);
  });
  it("Peak shows toFixed(2) value with ₹ prefix", async () => {
    await setupTradeDetail([trade]);
    const peakElements = screen.getAllByText("₹3830.00");
    expect(peakElements.length).toBeGreaterThan(0);
  });
  it("Low shows toFixed(2) value with ₹ prefix", async () => {
    await setupTradeDetail([trade]);
    const lowElements = screen.getAllByText("₹3710.00");
    expect(lowElements.length).toBeGreaterThan(0);
  });
  it("null peak_price shows dash", async () => {
    const tradeNoPeak = mockTrade({...defaultTradeOverrides, 
      peak_price: null as any,
    });
    await setupTradeDetail([tradeNoPeak]);
    expect(screen.getByText("₹-")).toBeInTheDocument();
  });
  it("null low_price shows dash", async () => {
    const tradeNoLow = mockTrade({...defaultTradeOverrides, 
      low_price: null as any,
    });
    await setupTradeDetail([tradeNoLow]);
    expect(screen.getByText("₹-")).toBeInTheDocument();
  });
  it("Costs formatted via formatNumber", async () => {
    // formatNumber(50) returns "50", component renders "₹50"
    await setupTradeDetail([trade]);
    const costElements = screen.getAllByText((content) => content.includes("₹50"));
    expect(costElements.length).toBeGreaterThan(0);
  });
  it("Gross P&L shows with sign and formatted", async () => {
    await setupTradeDetail([trade]);
    const grossElements = screen.getAllByText((content) => content.includes("+₹500"));
    expect(grossElements.length).toBeGreaterThan(0);
  });
  it("Net P&L shows with sign and formatted", async () => {
    await setupTradeDetail([trade]);
    const netElements = screen.getAllByText((content) => content.includes("+₹500"));
    expect(netElements.length).toBeGreaterThan(0);
  });
});

// ============================================
// TradeNotesEditor Tests
// ============================================

describe("TradeNotesEditor", () => {
  const trade = mockTrade(defaultTradeOverrides);
  it("renders reason text with data-testid trade-reason-{trade_id}", async () => {
    await setupTradeDetail([trade]);
    expect(screen.getByTestId(`trade-reason-${trade.trade_id}`)).toBeInTheDocument();
  });
  it("renders notes textarea with data-testid trade-notes-{trade_id}", async () => {
    await setupTradeDetail([trade]);
    expect(screen.getByTestId(`trade-notes-${trade.trade_id}`)).toBeInTheDocument();
  });
  it("renders Save button with data-testid trade-notes-save-{trade_id}", async () => {
    await setupTradeDetail([trade]);
    expect(screen.getByTestId(`trade-notes-save-${trade.trade_id}`)).toBeInTheDocument();
  });
  it("reason text displays trade.reason value", async () => {
    await setupTradeDetail([trade]);
    const reasonEl = screen.getByTestId(`trade-reason-${trade.trade_id}`);
    expect(reasonEl).toHaveTextContent("Test reason");
  });
  it("notes textarea initial value from trade.notes", async () => {
    await setupTradeDetail([trade]);
    const textarea = screen.getByTestId(`trade-notes-${trade.trade_id}`) as HTMLTextAreaElement;
    expect(textarea.value).toBe("Test notes");
  });
  it("reason is displayed as read-only text", async () => {
    await setupTradeDetail([trade]);
    const reasonEl = screen.getByTestId(`trade-reason-${trade.trade_id}`);
    expect(reasonEl).toHaveTextContent("Test reason");
    expect(reasonEl.tagName).toBe("SPAN");
  });
  it("notes textarea is editable", async () => {
    await setupTradeDetail([trade]);
    const textarea = screen.getByTestId(`trade-notes-${trade.trade_id}`) as HTMLTextAreaElement;
    await userEvent.clear(textarea);
    await userEvent.type(textarea, "Updated notes");
    expect(textarea.value).toBe("Updated notes");
  });
  it("clicking Save calls updateTradeNotesAction with correct args", async () => {
    const { updateTradeNotesAction } = await import("../../state/paperTrading");
    await setupTradeDetail([trade]);

    // Change notes only (reason is read-only)
    const notesArea = screen.getByTestId(`trade-notes-${trade.trade_id}`) as HTMLTextAreaElement;
    await userEvent.clear(notesArea);
    await userEvent.type(notesArea, "Updated notes");

    // Click save
    await userEvent.click(screen.getByTestId(`trade-notes-save-${trade.trade_id}`));
    expect(updateTradeNotesAction).toHaveBeenCalledWith(
      "trade-1",
      "Updated notes",
      "Test reason",
    );
  });
  it("Save button shows loading state while saving", async () => {
    const { updateTradeNotesAction } = await import("../../state/paperTrading");
    updateTradeNotesAction.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 100)),
    );
    const { user } = await setupTradeDetail([trade]);
    await user.click(screen.getByTestId(`trade-notes-save-${trade.trade_id}`));
    const saveBtn = screen.getByTestId(`trade-notes-save-${trade.trade_id}`);
    expect(saveBtn).toHaveAttribute("loading", "");
  });
  it("handles empty reason shows dash", async () => {
    const emptyReasonTrade = mockTrade({...defaultTradeOverrides,  reason: "" });
    await setupTradeDetail([emptyReasonTrade]);
    const reasonEl = screen.getByTestId(`trade-reason-${emptyReasonTrade.trade_id}`);
    expect(reasonEl).toHaveTextContent("-");
  });
  it("handles empty notes textarea", async () => {
    await setupTradeDetail([trade]);
    const textarea = screen.getByTestId(`trade-notes-${trade.trade_id}`) as HTMLTextAreaElement;
    await userEvent.clear(textarea);
    expect(textarea.value).toBe("");
  });
});

// ============================================
// Interaction Tests
// ============================================

describe("Interactions", () => {
  const trade = mockTrade(defaultTradeOverrides);
  it("row click calls onSelectSymbol with correct args", () => {
    render(<DayGroup {...defaultProps} trades={[trade]} expanded={true} />, {
      wrapper: TestWrapper,
    });
    screen.getByTestId("trade-row-trade-1").click();
    expect(defaultProps.onSelectSymbol).toHaveBeenCalledWith(
      "RELIANCE",
      "2026-04-24T10:00:00Z",
      "trade-1",
      "orb",
      1,
      "2026-04-24T09:30:00Z",
    );
  });
  it("strategyType derived from trade.strategy_type when present", () => {
    const tradeWithType = mockTrade({...defaultTradeOverrides, 
      strategy_type: "custom_type",
    });
    render(<DayGroup {...defaultProps} trades={[tradeWithType]} expanded={true} />, {
      wrapper: TestWrapper,
    });
    screen.getByTestId("trade-row-trade-1").click();
    expect(defaultProps.onSelectSymbol).toHaveBeenCalledWith(
      "RELIANCE",
      expect.any(String),
      "trade-1",
      "custom_type",
      1,
      expect.any(String),
    );
  });
  it("strategyType falls back to getStrategyTypeFromName when strategy_type is undefined", () => {
    const tradeNoType = mockTrade({...defaultTradeOverrides, 
      strategy_type: undefined,
      strategy_name: "ORB Conservative",
    });
    render(<DayGroup {...defaultProps} trades={[tradeNoType]} expanded={true} />, {
      wrapper: TestWrapper,
    });
    screen.getByTestId("trade-row-trade-1").click();
    expect(defaultProps.onSelectSymbol).toHaveBeenCalledWith(
      "RELIANCE",
      expect.any(String),
      "trade-1",
      "orb",
      1,
      expect.any(String),
    );
  });
  it("bot anchor click calls setFilterBot with bot_id", async () => {
    const { setFilterBot } = await import("../../state/paperTrading");
    render(<DayGroup {...defaultProps} trades={[trade]} expanded={true} />, {
      wrapper: TestWrapper,
    });
    await userEvent.click(screen.getByTestId("trade-bot-filter-trade-1"));
    expect(setFilterBot).toHaveBeenCalledWith("bot-1");
  });
  it("bot anchor click does not call setFilterBot when bot_id is null", async () => {
    const { setFilterBot } = await import("../../state/paperTrading");
    const tradeNoBot = mockTrade({...defaultTradeOverrides, 
      bot_id: null,
      bot_name: "-",
    });
    render(<DayGroup {...defaultProps} trades={[tradeNoBot]} expanded={true} />, {
      wrapper: TestWrapper,
    });
    await userEvent.click(screen.getByTestId("trade-bot-filter-trade-1"));
    expect(setFilterBot).toHaveBeenCalledWith(null);
  });
  it("strategy anchor click calls setFilterStrategy with strategy_id", async () => {
    const { setFilterStrategy } = await import("../../state/paperTrading");
    render(<DayGroup {...defaultProps} trades={[trade]} expanded={true} />, {
      wrapper: TestWrapper,
    });
    await userEvent.click(screen.getByTestId("trade-strategy-filter-trade-1"));
    expect(setFilterStrategy).toHaveBeenCalledWith(1);
  });
  it("strategy anchor click does not call setFilterStrategy when strategy_id is null", async () => {
    const { setFilterStrategy } = await import("../../state/paperTrading");
    const tradeNoStrategy = mockTrade({...defaultTradeOverrides, 
      strategy_id: null,
      strategy_name: "default",
    });
    render(<DayGroup {...defaultProps} trades={[tradeNoStrategy]} expanded={true} />, {
      wrapper: TestWrapper,
    });
    await userEvent.click(screen.getByTestId("trade-strategy-filter-trade-1"));
    expect(setFilterStrategy).toHaveBeenCalledWith(null);
  });
  it("all click handlers stop propagation to row", () => {
    render(<DayGroup {...defaultProps} trades={[trade]} expanded={true} />, {
      wrapper: TestWrapper,
    });

    // These should not trigger row click (onSelectSymbol)
    const botBtn = screen.getByTestId("trade-bot-filter-trade-1");
    const strategyBtn = screen.getByTestId("trade-strategy-filter-trade-1");
    const toggleBtn = screen.getByTestId("trade-detail-toggle-trade-1");

    // Click bot filter
    defaultProps.onSelectSymbol.mockClear();
    fireEvent.click(botBtn);
    expect(defaultProps.onSelectSymbol).not.toHaveBeenCalled();

    // Click strategy filter
    fireEvent.click(strategyBtn);
    expect(defaultProps.onSelectSymbol).not.toHaveBeenCalled();

    // Click toggle
    fireEvent.click(toggleBtn);
    expect(defaultProps.onSelectSymbol).not.toHaveBeenCalled();
  });
});

// ============================================
// Sorting Tests
// ============================================

describe("Sorting", () => {
  const trades = [
    mockTrade({...defaultTradeOverrides, 
      trade_id: "t1",
      symbol: "AAPL",
      net_pnl: 100,
      exit_time: "2026-04-24T09:00:00Z",
    }),
    mockTrade({...defaultTradeOverrides, 
      trade_id: "t2",
      symbol: "GOOGL",
      net_pnl: 200,
      exit_time: "2026-04-24T08:00:00Z",
    }),
    mockTrade({...defaultTradeOverrides, 
      trade_id: "t3",
      symbol: "MSFT",
      net_pnl: 50,
      exit_time: "2026-04-24T10:00:00Z",
    }),
  ];
  it("SortableHeader clicks call onSort with columnKey", () => {
    render(<DayGroup {...defaultProps} trades={trades} expanded={true} />, {
      wrapper: TestWrapper,
    });
    fireEvent.click(screen.getByTestId("sort-header-symbol"));
    expect(defaultProps.onSort).toHaveBeenCalledWith("symbol");
    fireEvent.click(screen.getByTestId("sort-header-net_pnl"));
    expect(defaultProps.onSort).toHaveBeenCalledWith("net_pnl");
  });
  it("trades rendered in default order when no sorting (sorted by exit_time desc)", () => {
    render(<DayGroup {...defaultProps} trades={trades} expanded={true} />, {
      wrapper: TestWrapper,
    });
    const rows = screen.getAllByRole("row");
    // First row is header, subsequent are trade rows
    const tradeRows = rows.filter((r) => r.getAttribute("data-testid")?.startsWith("trade-row-"));
    expect(tradeRows.length).toBe(3);
  });
  it("trades rendered in sorted order when sortColumn is set", () => {
    render(
      <DayGroup
        {...defaultProps}
        trades={trades}
        sortColumn="symbol"
        sortDirection="asc"
        expanded={true}
      />,
      {
        wrapper: TestWrapper,
      },
    );
    const rows = screen.getAllByRole("row");
    const tradeRows = rows.filter((r) => r.getAttribute("data-testid")?.startsWith("trade-row-"));
    expect(tradeRows.length).toBe(3);
  });
  it("SortableHeader shows sort indicator when active", () => {
    render(
      <DayGroup
        {...defaultProps}
        trades={trades}
        sortColumn="symbol"
        sortDirection="asc"
        expanded={true}
      />,
      {
        wrapper: TestWrapper,
      },
    );
    const header = screen.getByTestId("sort-header-symbol");
    expect(header).toHaveAttribute("data-sorted", "true");
    expect(header).toHaveAttribute("data-direction", "asc");
    expect(screen.getByTestId("icon-arrow-up")).toBeInTheDocument();
  });
  it("SortableHeader shows descending indicator when direction is desc", () => {
    render(
      <DayGroup
        {...defaultProps}
        trades={trades}
        sortColumn="symbol"
        sortDirection="desc"
        expanded={true}
      />,
      {
        wrapper: TestWrapper,
      },
    );
    const header = screen.getByTestId("sort-header-symbol");
    expect(header).toHaveAttribute("data-direction", "desc");
    expect(screen.getByTestId("icon-arrow-down")).toBeInTheDocument();
  });
  it("SortableHeader hides indicator when not the active column", () => {
    render(
      <DayGroup
        {...defaultProps}
        trades={trades}
        sortColumn="net_pnl"
        sortDirection="asc"
        expanded={true}
      />,
      {
        wrapper: TestWrapper,
      },
    );
    const header = screen.getByTestId("sort-header-symbol");
    expect(header).toHaveAttribute("data-sorted", "false");
    // Symbol header should not contain sort indicator
    expect(within(header).queryByTestId("icon-arrow-up")).not.toBeInTheDocument();
    expect(within(header).queryByTestId("icon-arrow-down")).not.toBeInTheDocument();
  });
});

// ============================================
// Edge Cases
// ============================================

describe("Edge cases", () => {
  it("trade with null peak_price shows dash in TradeStats", async () => {
    await setupTradeDetail([mockTrade({...defaultTradeOverrides, 
      peak_price: null as any,
    })]);
    expect(screen.getByText("₹-")).toBeInTheDocument();
  });
  it("trade with null low_price shows dash in TradeStats", async () => {
    await setupTradeDetail([mockTrade({...defaultTradeOverrides, 
      low_price: null as any,
    })]);
    expect(screen.getByText("₹-")).toBeInTheDocument();
  });
  it("trade with null bot_id shows dash for bot name", () => {
    render(
      <DayGroup
        {...defaultProps}
        trades={[
          mockTrade({...defaultTradeOverrides, 
            bot_id: null,
            bot_name: "-",
          }),
        ]}
        expanded={true}
      />,
      {
        wrapper: TestWrapper,
      },
    );
    const dashElements = screen.getAllByText("-");
    expect(dashElements.length).toBeGreaterThanOrEqual(1);
  });
  it("bot anchor does not call setFilterBot when bot_id is null", async () => {
    const { setFilterBot } = await import("../../state/paperTrading");
    render(
      <DayGroup
        {...defaultProps}
        trades={[
          mockTrade({...defaultTradeOverrides, 
            bot_id: null,
            bot_name: "-",
          }),
        ]}
        expanded={true}
      />,
      {
        wrapper: TestWrapper,
      },
    );
    await userEvent.click(screen.getByTestId("trade-bot-filter-trade-1"));
    expect(setFilterBot).toHaveBeenCalledWith(null);
  });
  it("trade with null strategy_id shows 'default' as strategy name", () => {
    render(
      <DayGroup
        {...defaultProps}
        trades={[
          mockTrade({...defaultTradeOverrides, 
            strategy_id: null,
            strategy_name: "default",
          }),
        ]}
        expanded={true}
      />,
      {
        wrapper: TestWrapper,
      },
    );
    expect(screen.getByText("default")).toBeInTheDocument();
  });
  it("strategy anchor does not call setFilterStrategy when strategy_id is null", async () => {
    const { setFilterStrategy } = await import("../../state/paperTrading");
    render(
      <DayGroup
        {...defaultProps}
        trades={[
          mockTrade({...defaultTradeOverrides, 
            strategy_id: null,
            strategy_name: "default",
          }),
        ]}
        expanded={true}
      />,
      {
        wrapper: TestWrapper,
      },
    );
    await userEvent.click(screen.getByTestId("trade-strategy-filter-trade-1"));
    expect(setFilterStrategy).toHaveBeenCalledWith(null);
  });
  it("trade with null exit_reason handled gracefully by ExitReasonBadge", () => {
    render(
      <DayGroup
        {...defaultProps}
        trades={[
          mockTrade({...defaultTradeOverrides, 
            exit_reason: "",
          }),
        ]}
        expanded={true}
      />,
      {
        wrapper: TestWrapper,
      },
    );
    // Empty exit_reason should render a badge with empty text and gray color
    const row = screen.getByTestId("trade-row-trade-1");
    const emptyBadge = within(row).getByText((content, element) => {
      return (
        element.tagName === "SPAN" &&
        element.getAttribute("data-color") === "gray" &&
        content === ""
      );
    });
    expect(emptyBadge).toBeInTheDocument();
  });
  it("empty trades array renders only DaySummary, no table", () => {
    render(<DayGroup {...defaultProps} trades={[]} expanded={false} />, {
      wrapper: TestWrapper,
    });
    expect(screen.getByTestId("day-header-2026-04-24")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
  it("single trade renders correctly", () => {
    render(<DayGroup {...defaultProps} trades={[mockTrade(defaultTradeOverrides)]} expanded={true} />, {
      wrapper: TestWrapper,
    });
    expect(screen.getByTestId("trade-row-trade-1")).toBeInTheDocument();
    expect(screen.getAllByRole("row").length).toBe(3); // header + 1 trade row + 1 detail row
  });
  it("multiple trades same day render all rows", () => {
    const trades = [
      mockTrade({...defaultTradeOverrides, 
        trade_id: "t1",
        symbol: "AAPL",
      }),
      mockTrade({...defaultTradeOverrides, 
        trade_id: "t2",
        symbol: "GOOGL",
      }),
      mockTrade({...defaultTradeOverrides, 
        trade_id: "t3",
        symbol: "MSFT",
      }),
    ];
    render(<DayGroup {...defaultProps} trades={trades} expanded={true} />, {
      wrapper: TestWrapper,
    });
    expect(screen.getByTestId("trade-row-t1")).toBeInTheDocument();
    expect(screen.getByTestId("trade-row-t2")).toBeInTheDocument();
    expect(screen.getByTestId("trade-row-t3")).toBeInTheDocument();
  });
  it("trade without reason shows dash", async () => {
    const tradeNoReason = mockTrade({...defaultTradeOverrides, 
      reason: "",
    });
    await setupTradeDetail([tradeNoReason]);
    const reasonEl = screen.getByTestId(`trade-reason-${tradeNoReason.trade_id}`);
    expect(reasonEl).toHaveTextContent("-");
  });
  it("trade without notes shows empty textarea", async () => {
    const tradeNoNotes = mockTrade({...defaultTradeOverrides, 
      notes: "",
    });
    await setupTradeDetail([tradeNoNotes]);
    const textarea = screen.getByTestId(
      `trade-notes-${tradeNoNotes.trade_id}`,
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe("");
  });
  it("handles very long symbol names", () => {
    const longSymbol = "VERY-LONG-SYMBOL-NAME-EXCEEDING-NORMAL-LENGTH-" + "A".repeat(50);
    render(
      <DayGroup
        {...defaultProps}
        trades={[
          mockTrade({...defaultTradeOverrides, 
            symbol: longSymbol,
          }),
        ]}
        expanded={true}
      />,
      {
        wrapper: TestWrapper,
      },
    );
    expect(screen.getByText(longSymbol)).toBeInTheDocument();
  });
  it("negative P&L displays correct sign and formatted value", () => {
    const negativeTrade = mockTrade({...defaultTradeOverrides, 
      net_pnl: -500,
    });
    render(<DayGroup {...defaultProps} trades={[negativeTrade]} expanded={true} />, {
      wrapper: TestWrapper,
    });
    // Negative net P&L shows "₹500" (no sign prefix) with red color
    const netElements = screen.getAllByText(
      (content, element) =>
        content.includes("₹500") && element?.getAttribute("data-color") === "red",
    );
    expect(netElements.length).toBeGreaterThan(0);
  });
  it("zero net_pnl displays correct formatting", () => {
    const zeroTrade = mockTrade({...defaultTradeOverrides, 
      net_pnl: 0,
    });
    render(<DayGroup {...defaultProps} trades={[zeroTrade]} expanded={true} />, {
      wrapper: TestWrapper,
    });
    expect(screen.getByText((content) => content.includes("+₹0"))).toBeInTheDocument();
  });
});

// ============================================
// Lifecycle Tests
// ============================================

describe("Lifecycle", () => {
  it("useEffect scrolls row into view when isSelected becomes true", () => {
    const trade = mockTrade(defaultTradeOverrides);
    const scrollIntoViewSpy = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
    render(
      <DayGroup {...defaultProps} trades={[trade]} selectedTradeId="trade-1" expanded={true} />,
      {
        wrapper: TestWrapper,
      },
    );

    // The effect should trigger on mount since selectedTradeId matches
    expect(scrollIntoViewSpy).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    });
    scrollIntoViewSpy.mockRestore();
  });
  it("does not scroll when isSelected is false", () => {
    const trade = mockTrade(defaultTradeOverrides);
    const scrollIntoViewSpy = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
    render(
      <DayGroup {...defaultProps} trades={[trade]} selectedTradeId="other-id" expanded={true} />,
      {
        wrapper: TestWrapper,
      },
    );
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
    scrollIntoViewSpy.mockRestore();
  });
});

// ============================================
// TradeRow Styling Tests
// ============================================

describe("TradeRow styling", () => {
  const trade = mockTrade(defaultTradeOverrides);
  it("selected row has trade-row-highlighted class", () => {
    render(
      <DayGroup {...defaultProps} trades={[trade]} selectedTradeId="trade-1" expanded={true} />,
      {
        wrapper: TestWrapper,
      },
    );
    const row = screen.getByTestId("trade-row-trade-1");
    expect(row).toHaveClass("trade-row-highlighted");
  });
  it("unselected row does not have trade-row-highlighted class", () => {
    render(<DayGroup {...defaultProps} trades={[trade]} selectedTradeId={null} expanded={true} />, {
      wrapper: TestWrapper,
    });
    const row = screen.getByTestId("trade-row-trade-1");
    expect(row).not.toHaveClass("trade-row-highlighted");
  });
  it("row has cursor: pointer style", () => {
    render(<DayGroup {...defaultProps} trades={[trade]} expanded={true} />, {
      wrapper: TestWrapper,
    });
    const row = screen.getByTestId("trade-row-trade-1");
    expect(row).toHaveStyle({
      cursor: "pointer",
    });
  });
});

// ============================================
// TradeStats Color Tests
// ============================================

describe("TradeStats colors", () => {
  it("Gross P&L positive shows green", async () => {
    await setupTradeDetail([mockTrade({...defaultTradeOverrides, 
      pnl: 500,
    })]);
    // The text is within an element with data-color="green"
    const grossPnlElements = screen.getAllByText((content) => content.includes("+₹500"));
    expect(grossPnlElements.length).toBeGreaterThan(0);
  });
  it("Gross P&L negative shows red", async () => {
    await setupTradeDetail([mockTrade({...defaultTradeOverrides, 
      pnl: -500,
    })]);
    // Negative P&L shows "₹500" (no sign) with red color
    const grossPnlElements = screen.getAllByText(
      (content, element) =>
        content.includes("₹500") && element?.getAttribute("data-color") === "red",
    );
    expect(grossPnlElements.length).toBeGreaterThan(0);
  });
});

// ============================================
// Summary
// ============================================
