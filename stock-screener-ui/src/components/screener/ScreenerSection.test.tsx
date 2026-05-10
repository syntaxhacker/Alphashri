// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ScreenerSection } from "./ScreenerSection";
import { MantineProvider } from "@mantine/core";

vi.mock("./ScreenerStockView", () => ({
  ScreenerStockView: (props: any) => (
    <div data-testid="screener-stock-view" data-section={props.section}>
      Stock View
    </div>
  ),
}));

describe("ScreenerSection", () => {
  const defaultProps = {
    title: "Approaching (3)",
    description: "Stocks nearing the high",
    testId: "screener-section-test",
    stocks: [],
    columns: [],
    touchedSymbols: new Set<string>(),
    sortColumn: null,
    sortDirection: "desc" as const,
    onSortChange: vi.fn(),
    onSymbolClick: vi.fn(),
    onSymbolHover: vi.fn(),
    viewMode: "table" as const,
    section: "approaching" as const,
    activeScreener: "trending",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders CompactPanel with title and description", () => {
    render(
      <MantineProvider>
        <ScreenerSection {...defaultProps} />
      </MantineProvider>,
    );
    expect(screen.getByText("Approaching (3)")).toBeInTheDocument();
    expect(screen.getByText("Stocks nearing the high")).toBeInTheDocument();
  });

  it("delegates to ScreenerStockView", () => {
    render(
      <MantineProvider>
        <ScreenerSection {...defaultProps} />
      </MantineProvider>,
    );
    expect(screen.getByTestId("screener-stock-view")).toBeInTheDocument();
  });
});
