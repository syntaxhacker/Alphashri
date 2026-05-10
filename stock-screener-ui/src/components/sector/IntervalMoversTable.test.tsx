// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MantineProvider } from "@mantine/core";
import { IntervalMoversTable } from "./IntervalMoversTable";
import type { InternalStockMover } from "./sectorUtils";

afterEach(() => cleanup());

function renderWithMantine(ui: React.ReactElement) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

describe("IntervalMoversTable", () => {
  it("shows empty state when no movers", () => {
    renderWithMantine(<IntervalMoversTable movers={[]} />);
    expect(screen.getByText("Collecting baseline for interval moves...")).toBeInTheDocument();
  });

  it("renders mover rows with symbol, previous change, current change, and delta", () => {
    const movers: InternalStockMover[] = [
      { symbol: "TCS", change: 3.0, prev_change: 2.0, delta: 1.0 },
      { symbol: "INFY", change: 1.5, prev_change: 1.0, delta: 0.5 },
    ];
    renderWithMantine(<IntervalMoversTable movers={movers} />);
    expect(screen.getByText("TCS")).toBeInTheDocument();
    expect(screen.getByText("INFY")).toBeInTheDocument();
    expect(screen.getByText("2.00%")).toBeInTheDocument();
    expect(screen.getByText("3.00%")).toBeInTheDocument();
  });

  it("displays delta with + prefix for positive values", () => {
    const movers: InternalStockMover[] = [
      { symbol: "TCS", change: 3.0, prev_change: 2.0, delta: 1.0 },
    ];
    renderWithMantine(<IntervalMoversTable movers={movers} />);
    expect(screen.getByText("+1.00%")).toBeInTheDocument();
  });

  it("displays delta with - prefix for negative values", () => {
    const movers: InternalStockMover[] = [
      { symbol: "TCS", change: 1.0, prev_change: 2.0, delta: -1.0 },
    ];
    renderWithMantine(<IntervalMoversTable movers={movers} />);
    expect(screen.getByText("-1.00%")).toBeInTheDocument();
  });

  it("renders table headers", () => {
    const movers: InternalStockMover[] = [
      { symbol: "TCS", change: 3.0, prev_change: 2.0, delta: 1.0 },
    ];
    renderWithMantine(<IntervalMoversTable movers={movers} />);
    expect(screen.getByText("Stock")).toBeInTheDocument();
    expect(screen.getByText("Prev")).toBeInTheDocument();
    expect(screen.getByText("Now")).toBeInTheDocument();
  });

  it("color-codes delta value by PnL color (green for positive)", () => {
    const movers: InternalStockMover[] = [
      { symbol: "TCS", change: 3.0, prev_change: 2.0, delta: 1.0 },
    ];
    renderWithMantine(<IntervalMoversTable movers={movers} />);
    const deltaText = screen.getByText("+1.00%");
    expect(deltaText).toBeInTheDocument();
  });

  it("color-codes delta value by PnL color (red for negative)", () => {
    const movers: InternalStockMover[] = [
      { symbol: "TCS", change: 1.0, prev_change: 2.0, delta: -1.0 },
    ];
    renderWithMantine(<IntervalMoversTable movers={movers} />);
    const deltaText = screen.getByText("-1.00%");
    expect(deltaText).toBeInTheDocument();
  });

  it("renders delta column header", () => {
    const movers: InternalStockMover[] = [
      { symbol: "TCS", change: 3.0, prev_change: 2.0, delta: 1.0 },
    ];
    renderWithMantine(<IntervalMoversTable movers={movers} />);
    expect(screen.getByText("\u0394")).toBeInTheDocument();
  });
});
