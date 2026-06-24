// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { PaperPortfolioCard, type Portfolio } from "./PaperPortfolioCard";
import { renderWithMantine } from "../../test-utils/renderWithMantine";

afterEach(() => {
  cleanup();
});

const renderWithPortfolio = (overrides: Partial<Portfolio> = {}) => {
  const portfolio = mockPortfolio(overrides);
  return renderWithMantine(<PaperPortfolioCard portfolio={portfolio} />);
};

const mockPortfolio = (overrides: Partial<Portfolio> = {}): Portfolio => ({
  total_value: 100000,
  cash: 50000,
  margin_used: 50000,
  day_pnl: 0,
  positions_count: 0,
  ...overrides,
});

describe("PaperPortfolioCard", () => {
  describe("null/loading state", () => {
    test("shows Loading... text when portfolio is null", () => {
      const { container } = renderWithMantine(
        <PaperPortfolioCard portfolio={null} />,
      );
      expect(container.textContent).toContain("Loading...");
    });

    test("renders with data-testid for null portfolio", () => {
      const { getByTestId } = renderWithMantine(
        <PaperPortfolioCard portfolio={null} />,
      );
      expect(getByTestId("portfolio-card")).toBeInTheDocument();
    });
  });

  describe("P&L formatting", () => {
    test.each([
      { name: "positive P&L shows + prefix", day_pnl: 5000, expected: /\+₹5\.0K/ },
      {
        name: "negative P&L shows no + prefix",
        day_pnl: -5000,
        expected: /₹-5\.0K/,
        notExpected: /\+₹5\.0K/,
      },
      { name: "zero P&L shows 0", day_pnl: 0, expected: /₹0/ },
      { name: "large P&L in L format", day_pnl: 100000, expected: /\+₹1\.0L/ },
    ])("$name", ({ day_pnl, expected, notExpected }) => {
      const result = renderWithPortfolio({ day_pnl });
      if (notExpected) {
        expect(result.container.textContent).not.toMatch(notExpected);
      }
      expect(screen.getByText(expected)).toBeInTheDocument();
    });
  });

  describe("compact value formatting", () => {
    test("formats values in K/L/Cr", () => {
      const portfolio = mockPortfolio({ total_value: 100000, cash: 50000, margin_used: 50000 });
      renderWithMantine(<PaperPortfolioCard portfolio={portfolio} />);
      expect(screen.getByText(/1\.0L/)).toBeInTheDocument();
      expect(screen.getAllByText(/50\.0K/)).toHaveLength(2);
    });

    test("formats large P&L in L format", () => {
      const portfolio = mockPortfolio({ day_pnl: 100000 });
      renderWithMantine(<PaperPortfolioCard portfolio={portfolio} />);
      expect(screen.getByText(/\+₹1\.0L/)).toBeInTheDocument();
    });
  });

  describe("portfolio labels", () => {
    test("displays abbreviated stat labels", () => {
      renderWithPortfolio();
      expect(screen.getByText(/Val/)).toBeInTheDocument();
      expect(screen.getByText(/Cash/)).toBeInTheDocument();
      expect(screen.getByText(/Mrgn/)).toBeInTheDocument();
    });
  });
});
