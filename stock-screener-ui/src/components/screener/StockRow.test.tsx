// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { StockRow } from "./StockRow";
import type { Stock } from "../../types";
import type { ColumnDef } from "./columns";

// Mock Mantine components to avoid context requirements
vi.mock("@/ui", () => {
  const Tr = ({ children, className, id, ...props }: any) => (
    <tr className={className} id={id} {...props}>
      {children}
    </tr>
  );
  const Td = ({ children, className, "data-testid": dataTestId, ...props }: any) => (
    <td className={className} data-testid={dataTestId} {...props}>
      {children}
    </td>
  );

  const Table = ({ children }: any) => <table>{children}</table>;
  Table.Tr = Tr;
  Table.Td = Td;

  return {
    Table,
    Group: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    Text: ({ children, c, ...props }: any) => (
      <span style={{ color: c } as React.CSSProperties} {...props}>
        {children}
      </span>
    ),
    Badge: ({ children, color, className, ...props }: any) => (
      <span data-color={color} className={className} {...props}>
        {children}
      </span>
    ),
    Tooltip: ({ children, label, ...props }: any) => {
      const child = typeof children === "function" ? children({}) : children;
      return (
        <div data-tooltip-label={label} {...props}>
          {child}
        </div>
      );
    },
    Anchor: ({ children, ..._props }: any) => <a {..._props}>{children}</a>,
    ActionIcon: ({ children, onClick, "data-testid": dataTestId, ...props }: any) => (
      <button type="button" onClick={onClick} data-testid={dataTestId} {...props}>
        {children}
      </button>
    ),
    CopyButton: ({ value: _value, children }: any) => {
      const copy = vi.fn().mockImplementation(async () => {});
      return children({ copied: false, copy });
    },
    Checkbox: ({ checked, onChange, "data-testid": dataTestId, ...props }: any) => (
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        data-testid={dataTestId}
        {...props}
      />
    ),
  };
});

// Mock PreviewChartProvider
vi.mock("../common/PreviewChartProvider", () => ({
  usePreviewChart: () => ({
    showPreviewChart: vi.fn(),
    hidePreviewChart: vi.fn(),
  }),
}));

// Mock ui-helpers
vi.mock("../../utils/ui-helpers", () => ({
  getValueColor: vi.fn(() => "green"),
  getScoreColor: vi.fn(() => "blue"),
  formatNumber: (n: number) => `${n}`,
}));

const mockStock: Stock = {
  symbol: "RELIANCE",
  score: 85,
  tv_price: 2450.5,
  upstox_price: 2451.0,
  broker_diff: 0.02,
  high_52w: 2600,
  to_52w_high: -5.76,
  recent_return_5d: 3.2,
  perf_w: 1.5,
  sector: "Energy",
  touched_52w: false,
  day_change: 1.25,
  rsi: 65.3,
  stoch_k: 72.1,
  gap_pct: 0.5,
  premarket_change: 0.8,
  impact_score: 2.5,
  market_cap_b: 185.3,
  volume_m: 12.45,
};

const mockColumns: ColumnDef[] = [
  { key: "symbol", label: "Symbol", type: "string" },
  { key: "score", label: "Score", type: "badge" },
  { key: "tv_price", label: "Price", type: "number" },
  { key: "day_change", label: "Change", type: "number" },
  { key: "rsi", label: "RSI", type: "number" },
  { key: "sector", label: "Sector", type: "string" },
];

describe("StockRow", () => {
  const defaultProps = {
    stock: mockStock,
    columns: mockColumns,
    isTouched: false,
    onSymbolClick: vi.fn(),
    onSymbolHover: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders row with correct test id", () => {
    render(<StockRow {...defaultProps} />);
    expect(screen.getByTestId("stock-row-RELIANCE")).toBeInTheDocument();
  });

  it("applies 'approaching' class when not touched", () => {
    render(<StockRow {...defaultProps} />);
    expect(screen.getByTestId("stock-row-RELIANCE")).toHaveClass("approaching");
  });

  it("applies 'touched' class when touched", () => {
    render(<StockRow {...defaultProps} isTouched={true} />);
    expect(screen.getByTestId("stock-row-RELIANCE")).toHaveClass("touched");
  });

  it("renders symbol cell with link and copy button", () => {
    render(<StockRow {...defaultProps} />);
    expect(screen.getByTestId("symbol-link-RELIANCE")).toBeInTheDocument();
    expect(screen.getByTestId("copy-symbol-btn-RELIANCE")).toBeInTheDocument();
    expect(screen.getByText("RELIANCE")).toBeInTheDocument();
  });

  it("calls onSymbolClick when symbol link is clicked", () => {
    render(<StockRow {...defaultProps} />);
    fireEvent.click(screen.getByTestId("symbol-link-RELIANCE"));
    expect(defaultProps.onSymbolClick).toHaveBeenCalledWith("RELIANCE");
  });

  it("calls onSymbolHover on mouse enter and leave", () => {
    render(<StockRow {...defaultProps} />);
    const link = screen.getByTestId("symbol-link-RELIANCE");

    fireEvent.mouseEnter(link);
    expect(defaultProps.onSymbolHover).toHaveBeenCalledWith("RELIANCE");

    fireEvent.mouseLeave(link);
    expect(defaultProps.onSymbolHover).toHaveBeenCalledWith(null);
  });

  it("shows touched badge when isTouched and badgeLabel are set", () => {
    render(<StockRow {...defaultProps} isTouched={true} badgeLabel="Touched" />);
    expect(screen.getByTestId("touched-badge-RELIANCE")).toBeInTheDocument();
    expect(screen.getByText("Touched")).toBeInTheDocument();
  });

  it("does not show touched badge when isTouched without badgeLabel", () => {
    render(<StockRow {...defaultProps} isTouched={true} />);
    expect(screen.queryByTestId("touched-badge-RELIANCE")).not.toBeInTheDocument();
  });

  it("does not show touched badge when isTouched is false", () => {
    render(<StockRow {...defaultProps} isTouched={false} />);
    expect(screen.queryByTestId("touched-badge-RELIANCE")).not.toBeInTheDocument();
  });

  it("renders score badge with correct test id", () => {
    render(<StockRow {...defaultProps} />);
    expect(screen.getByTestId("score-badge-RELIANCE")).toBeInTheDocument();
    expect(screen.getByText("85")).toBeInTheDocument();
  });

  it("renders numeric cells with correct test ids", () => {
    render(<StockRow {...defaultProps} />);
    expect(screen.getByTestId("number-cell-RELIANCE-tv_price")).toBeInTheDocument();
    expect(screen.getByTestId("number-cell-RELIANCE-day_change")).toBeInTheDocument();
  });

  it("renders all column cells", () => {
    render(<StockRow {...defaultProps} />);
    mockColumns.forEach((col) => {
      expect(screen.getByTestId(`cell-RELIANCE-${col.key}`)).toBeInTheDocument();
    });
  });

  it("handles missing optional day_change gracefully", () => {
    const stockWithoutDayChange = { ...mockStock, day_change: undefined };
    render(<StockRow {...defaultProps} stock={stockWithoutDayChange} />);
    expect(screen.getByTestId("cell-RELIANCE-day_change")).toHaveTextContent("-");
  });

  it("handles missing optional rsi gracefully", () => {
    const stockWithoutRsi = { ...mockStock, rsi: undefined };
    render(<StockRow {...defaultProps} stock={stockWithoutRsi} />);
    expect(screen.getByTestId("cell-RELIANCE-rsi")).toHaveTextContent("-");
  });

  it("renders copy symbol button and handles copy", () => {
    render(<StockRow {...defaultProps} />);
    const copyBtn = screen.getByTestId("copy-symbol-btn-RELIANCE");
    expect(copyBtn).toBeInTheDocument();
    fireEvent.click(copyBtn);
  });

  it("renders sector as plain text", () => {
    render(<StockRow {...defaultProps} />);
    expect(screen.getByTestId("cell-RELIANCE-sector")).toHaveTextContent("Energy");
  });

  it("handles stock with missing optional fields", () => {
    const minimalStock: Stock = {
      symbol: "TEST",
      score: 0,
      tv_price: 100,
      upstox_price: 100,
      broker_diff: 0,
      high_52w: 200,
      to_52w_high: 0,
      recent_return_5d: 0,
      perf_w: 0,
      sector: "Unknown",
      touched_52w: false,
    };
    render(<StockRow {...defaultProps} stock={minimalStock} />);
    expect(screen.getByTestId("stock-row-TEST")).toBeInTheDocument();
  });

  it("calls onSymbolHover when mouse enters symbol link", () => {
    render(<StockRow {...defaultProps} />);
    const link = screen.getByTestId("symbol-link-RELIANCE");
    fireEvent.mouseEnter(link);
    expect(defaultProps.onSymbolHover).toHaveBeenCalledWith("RELIANCE");
  });

  it("calls onSymbolHover when mouse leaves symbol link", () => {
    render(<StockRow {...defaultProps} />);
    const link = screen.getByTestId("symbol-link-RELIANCE");
    fireEvent.mouseLeave(link);
    expect(defaultProps.onSymbolHover).toHaveBeenCalledWith(null);
  });

  it("renders score badge with correct color class", () => {
    render(<StockRow {...defaultProps} />);
    const badge = screen.getByTestId("score-badge-RELIANCE");
    expect(badge).toHaveClass("score-badge");
  });

  it("renders number cells with correct color class", () => {
    render(<StockRow {...defaultProps} />);
    const priceCell = screen.getByTestId("number-cell-RELIANCE-tv_price");
    expect(priceCell).toHaveClass("number-cell");
  });
});
