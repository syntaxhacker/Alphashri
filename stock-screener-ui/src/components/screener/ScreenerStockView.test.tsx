// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { ScreenerStockView } from "./ScreenerStockView";
import { UIProvider } from "@/ui";

vi.mock("./ScreenerTable", () => ({
  ScreenerTable: (props: any) => (
    <div data-testid={props.testId || "screener-table"} data-view="table">
      Table View
    </div>
  ),
}));

describe("ScreenerStockView", () => {
  const defaultProps = {
    stocks: [],
    columns: [],
    touchedSymbols: new Set<string>(),
    onSymbolClick: vi.fn(),
    onSymbolHover: vi.fn(),
    section: "approaching" as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders ScreenerTable", () => {
    render(() => (
      <UIProvider>
        <ScreenerStockView {...defaultProps} />
      </UIProvider>
    ));
    expect(screen.getByTestId("screener-table-approaching")).toBeInTheDocument();
  });

  it("passes data-testid with section suffix", () => {
    render(() => (
      <UIProvider>
        <ScreenerStockView {...defaultProps} section="touched" />
      </UIProvider>
    ));
    expect(screen.getByTestId("screener-table-touched")).toBeInTheDocument();
  });
});