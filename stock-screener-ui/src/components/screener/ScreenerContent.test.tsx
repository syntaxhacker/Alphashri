// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MantineProvider } from "@mantine/core";
import { ScreenerContent } from "./ScreenerContent";
import type { ReactElement } from "react";

const renderWithProvider = (ui: ReactElement) =>
  render(<MantineProvider>{ui}</MantineProvider>);

vi.mock("./ScreenerSection", () => ({
  ScreenerSection: ({ title, description }: any) => (
    <div data-testid="screener-section" data-title={title} data-description={description || ""}>
      {title}
    </div>
  ),
}));

vi.mock("./ScreenerLoading", () => ({
  ScreenerLoading: () => <div data-testid="screener-loading">Loading</div>,
}));

vi.mock("./ScreenerEmpty", () => ({
  ScreenerEmpty: () => <div data-testid="screener-empty">Empty</div>,
}));

vi.mock("./ScreenerErrorPanel", () => ({
  ScreenerErrorPanel: ({ error, onRefresh }: any) => (
    <div data-testid="screener-error">
      Error: {error}
      <button data-testid="retry-btn" onClick={onRefresh}>Retry</button>
    </div>
  ),
}));

vi.mock("../../state", () => ({
  screenerOptions: [
    { id: "trending", label: "Trending" },
    { id: "buyer_interest", label: "Buyer Interest" },
  ],
  profileMetaById: {
    "trending": { section_labels: { primary: "Approaching", secondary: "Touched" } },
    "buyer_interest": { section_labels: { primary: "Buyer Interest", secondary: "Stronger Setups" } },
  },
}));

const defaultProps = {
  approachingStocks: [] as any[],
  touchedStocks: [] as any[],
  sortColumn: null as string | null,
  sortDirection: "asc" as const,
  handleSortChange: vi.fn(),
  isLoading: false,
  error: null as string | null,
  totalStocks: 0,
  onRefresh: vi.fn(),
  onSymbolClick: vi.fn(),
  onSymbolHover: vi.fn(),
  activeScreener: "trending",
  viewMode: "table" as const,
};

describe("ScreenerContent", () => {
  beforeEach(() => {
    cleanup();
  });

  it("shows loading when isLoading is true", () => {
    renderWithProvider(<ScreenerContent {...defaultProps} isLoading totalStocks={0} />);
    expect(screen.getByTestId("screener-loading")).toBeInTheDocument();
  });

  it("shows error panel when error is set", () => {
    renderWithProvider(<ScreenerContent {...defaultProps} error="Failed to fetch" />);
    expect(screen.getByTestId("screener-error")).toBeInTheDocument();
    expect(screen.getByTestId("screener-error")).toHaveTextContent("Failed to fetch");
  });

  it("shows empty state when totalStocks is 0", () => {
    renderWithProvider(<ScreenerContent {...defaultProps} />);
    expect(screen.getByTestId("screener-empty")).toBeInTheDocument();
  });

  it("renders section with dynamic labels from screenerOptions", () => {
    renderWithProvider(
      <ScreenerContent
        {...defaultProps}
        totalStocks={3}
        approachingStocks={[
          { symbol: "A" } as any,
          { symbol: "B" } as any,
          { symbol: "C" } as any,
        ]}
      />,
    );
    const section = screen.getByTestId("screener-section");
    expect(section).toHaveAttribute("data-title", "Approaching (3)");
  });

  it("renders section with buyer interest label when activeScreener matches", () => {
    renderWithProvider(
      <ScreenerContent
        {...defaultProps}
        activeScreener="buyer_interest"
        totalStocks={5}
        approachingStocks={[
          { symbol: "A" } as any,
          { symbol: "B" } as any,
          { symbol: "C" } as any,
          { symbol: "D" } as any,
          { symbol: "E" } as any,
        ]}
      />,
    );
    const section = screen.getByTestId("screener-section");
    expect(section).toHaveAttribute("data-title", "Buyer Interest (5)");
  });

  it("has no description when custom labels are used", () => {
    renderWithProvider(
      <ScreenerContent
        {...defaultProps}
        activeScreener="buyer_interest"
        totalStocks={2}
        approachingStocks={[{ symbol: "A" } as any, { symbol: "B" } as any]}
      />,
    );
    const section = screen.getByTestId("screener-section");
    expect(section).toHaveAttribute("data-description", "");
  });

  it("renders touched section when touched stocks exist", () => {
    renderWithProvider(
      <ScreenerContent
        {...defaultProps}
        totalStocks={3}
        approachingStocks={[
          { symbol: "A" } as any,
          { symbol: "B" } as any,
        ]}
        touchedStocks={[
          { symbol: "C" } as any,
        ]}
      />,
    );
    const sections = screen.getAllByTestId("screener-section");
    expect(sections).toHaveLength(2);
    expect(sections[0]).toHaveAttribute("data-title", "Approaching (2)");
    expect(sections[1]).toHaveAttribute("data-title", "Touched (1)");
  });

  it("hides touched section when empty", () => {
    renderWithProvider(
      <ScreenerContent
        {...defaultProps}
        totalStocks={2}
        approachingStocks={[{ symbol: "A" } as any, { symbol: "B" } as any]}
        touchedStocks={[]}
      />,
    );
    const sections = screen.getAllByTestId("screener-section");
    expect(sections).toHaveLength(1);
    expect(sections[0]).toHaveAttribute("data-title", "Approaching (2)");
  });
});
