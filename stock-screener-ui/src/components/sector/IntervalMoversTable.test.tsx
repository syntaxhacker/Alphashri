// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { UIProvider } from "@/ui";
import { IntervalMoversTable } from "./IntervalMoversTable";
import { SymbolDockContext } from "../common/symbolDockContext";
import type { InternalStockMover } from "./sectorUtils";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("IntervalMoversTable", () => {
  it("shows empty state when no movers", () => {
    render(() => <IntervalMoversTable movers={[]} />);
    expect(screen.getByTestId("interval-movers-empty")).toHaveTextContent(
      "First poll establishes the baseline.",
    );
  });

  it("renders mover rows with symbol, previous change, current change, and delta", () => {
    const movers: InternalStockMover[] = [
      { symbol: "TCS", change: 3.0, prev_change: 2.0, delta: 1.0 },
      { symbol: "INFY", change: 1.5, prev_change: 1.0, delta: 0.5 },
    ];
    render(() => <IntervalMoversTable movers={movers} />);
    expect(screen.getByText("TCS")).toBeInTheDocument();
    expect(screen.getByText("INFY")).toBeInTheDocument();
    expect(screen.getByText("2.00%")).toBeInTheDocument();
    expect(screen.getByText("3.00%")).toBeInTheDocument();
  });

  it("displays delta with + prefix for positive values", () => {
    const movers: InternalStockMover[] = [
      { symbol: "TCS", change: 3.0, prev_change: 2.0, delta: 1.0 },
    ];
    render(() => <IntervalMoversTable movers={movers} />);
    expect(screen.getByText("+1.00%")).toBeInTheDocument();
  });

  it("displays delta with - prefix for negative values", () => {
    const movers: InternalStockMover[] = [
      { symbol: "TCS", change: 1.0, prev_change: 2.0, delta: -1.0 },
    ];
    render(() => <IntervalMoversTable movers={movers} />);
    expect(screen.getByText("-1.00%")).toBeInTheDocument();
  });

  it("renders table headers", () => {
    const movers: InternalStockMover[] = [
      { symbol: "TCS", change: 3.0, prev_change: 2.0, delta: 1.0 },
    ];
    render(() => <IntervalMoversTable movers={movers} />);
    expect(screen.getByText("Stock")).toBeInTheDocument();
    expect(screen.getByText("Prev")).toBeInTheDocument();
    expect(screen.getByText("Now")).toBeInTheDocument();
  });

  it("color-codes delta value by PnL color (green for positive)", () => {
    const movers: InternalStockMover[] = [
      { symbol: "TCS", change: 3.0, prev_change: 2.0, delta: 1.0 },
    ];
    render(() => <IntervalMoversTable movers={movers} />);
    const deltaText = screen.getByText("+1.00%");
    expect(deltaText).toBeInTheDocument();
  });

  it("color-codes delta value by PnL color (red for negative)", () => {
    const movers: InternalStockMover[] = [
      { symbol: "TCS", change: 1.0, prev_change: 2.0, delta: -1.0 },
    ];
    render(() => <IntervalMoversTable movers={movers} />);
    const deltaText = screen.getByText("-1.00%");
    expect(deltaText).toBeInTheDocument();
  });

  it("renders delta column header", () => {
    const movers: InternalStockMover[] = [
      { symbol: "TCS", change: 3.0, prev_change: 2.0, delta: 1.0 },
    ];
    render(() => <IntervalMoversTable movers={movers} />);
    expect(screen.getByText("\u0394")).toBeInTheDocument();
  });

  it("opens the dock from the symbol button and keeps US market routing", () => {
    const open = vi.fn();
    const movers: InternalStockMover[] = [
      { symbol: "AAPL", change: 3.0, prev_change: 2.0, delta: 1.0 },
    ];
    render(() => (
      <UIProvider>
        <SymbolDockContext.Provider
          value={{
            open,
            preview: vi.fn(),
            endPreview: vi.fn(),
            close: vi.fn(),
            pinned: false,
            setOutlet: vi.fn(),
          }}
        >
          <IntervalMoversTable movers={movers} market="usa" />
        </SymbolDockContext.Provider>
      </UIProvider>
    ));

    const button = screen.getByTestId("interval-mover-AAPL");
    expect(button.tagName).toBe("BUTTON");
    expect(document.querySelector('a[href="/chart/AAPL"]')).toBeNull();

    fireEvent.click(button);
    expect(open).toHaveBeenCalledWith("AAPL", "chart", "usa");
  });

  it("uses the host handler when one is supplied instead of the dock", () => {
    const open = vi.fn();
    const onSymbolClick = vi.fn();
    const movers: InternalStockMover[] = [
      { symbol: "TCS", change: 3.0, prev_change: 2.0, delta: 1.0 },
    ];
    render(() => (
      <UIProvider>
        <SymbolDockContext.Provider
          value={{
            open,
            preview: vi.fn(),
            endPreview: vi.fn(),
            close: vi.fn(),
            pinned: false,
            setOutlet: vi.fn(),
          }}
        >
          <IntervalMoversTable movers={movers} onSymbolClick={onSymbolClick} />
        </SymbolDockContext.Provider>
      </UIProvider>
    ));

    fireEvent.click(screen.getByTestId("interval-mover-TCS"));
    expect(onSymbolClick).toHaveBeenCalledWith("TCS");
    expect(open).not.toHaveBeenCalled();
  });
});
