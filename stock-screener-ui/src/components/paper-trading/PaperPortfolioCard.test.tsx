// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { PaperPortfolioCard, type Portfolio, type StrategySummary } from "./PaperPortfolioCard";
import { renderWithMantine } from "../../test-utils/renderWithMantine";

afterEach(() => {
  cleanup();
});

const renderWithPortfolio = (
  overrides: Partial<Portfolio> = {},
  extras: { isMultiStrategy?: boolean; strategySummaries?: StrategySummary[] } = {},
) => {
  const portfolio = mockPortfolio(overrides);
  return renderWithMantine(
    <PaperPortfolioCard
      portfolio={portfolio}
      isMultiStrategy={extras.isMultiStrategy ?? false}
      strategySummaries={extras.strategySummaries ?? []}
    />,
  );
};

const mockPortfolio = (overrides: Partial<Portfolio> = {}): Portfolio => ({
  total_value: 100000,
  cash: 50000,
  margin_used: 50000,
  day_pnl: 0,
  positions_count: 0,
  max_daily_loss_pct: undefined,
  daily_loss_limit_exceeded: undefined,
  ...overrides,
});

const mockStrategySummary = (overrides: Partial<StrategySummary> = {}): StrategySummary => ({
  strategy_name: "ORB",
  pnl: 0,
  positions: 0,
  ...overrides,
});

describe("PaperPortfolioCard", () => {
  describe("null/loading state", () => {
    test("shows Loading... text when portfolio is null", () => {
      const { container } = renderWithMantine(
        <PaperPortfolioCard portfolio={null} isMultiStrategy={false} strategySummaries={[]} />,
      );
      expect(container.textContent).toContain("Loading...");
    });

    test("renders with data-testid for null portfolio", () => {
      const { getByTestId } = renderWithMantine(
        <PaperPortfolioCard portfolio={null} isMultiStrategy={false} strategySummaries={[]} />,
      );
      expect(getByTestId("portfolio-card")).toBeInTheDocument();
    });
  });

  describe("P&L formatting", () => {
    test.each([
      { name: "positive P&L shows + prefix", day_pnl: 5000, expected: /\+₹5,000/ },
      {
        name: "negative P&L shows no + prefix",
        day_pnl: -5000,
        expected: /₹-5,000/,
        notExpected: /\+₹5,000/,
      },
      { name: "zero P&L shows 0 without prefix", day_pnl: 0, expected: /₹0/ },
      { name: "large P&L formats with commas", day_pnl: 100000, expected: /\+₹1,00,000/ },
    ])("$name", ({ day_pnl, expected, notExpected }) => {
      const result = renderWithPortfolio({ day_pnl });
      if (notExpected) {
        expect(result.container.textContent).not.toMatch(notExpected);
      }
      expect(screen.getByText(expected)).toBeInTheDocument();
    });
  });

  describe("daily loss bar - conditional display", () => {
    test.each([
      {
        name: "shows when max_daily_loss_pct > 0 and day_pnl < 0",
        day_pnl: -2000,
        max_daily_loss_pct: 1.0,
        expected: true,
      },
      {
        name: "hides when day_pnl is positive",
        day_pnl: 2000,
        max_daily_loss_pct: 1.0,
        expected: false,
      },
      {
        name: "hides when max_daily_loss_pct is 0",
        day_pnl: -2000,
        max_daily_loss_pct: 0,
        expected: false,
      },
      {
        name: "hides when max_daily_loss_pct is undefined",
        day_pnl: -2000,
        max_daily_loss_pct: undefined,
        expected: false,
      },
    ])("$name", ({ day_pnl, max_daily_loss_pct, expected }) => {
      const result = renderWithPortfolio({ day_pnl, max_daily_loss_pct });
      if (expected) {
        expect(screen.getByTestId("daily-loss-progress")).toBeInTheDocument();
      } else {
        expect(result.queryByTestId("daily-loss-progress")).not.toBeInTheDocument();
      }
    });
  });

  describe("daily loss limit exceeded", () => {
    test("shows LOSS LIMIT badge when daily_loss_limit_exceeded is true", () => {
      const portfolio = mockPortfolio({
        day_pnl: -10000,
        max_daily_loss_pct: 1.0,
        daily_loss_limit_exceeded: true,
      });
      renderWithMantine(
        <PaperPortfolioCard portfolio={portfolio} isMultiStrategy={false} strategySummaries={[]} />,
      );
      expect(screen.getByTestId("daily-loss-halted")).toBeInTheDocument();
      expect(screen.getByText("LOSS LIMIT")).toBeInTheDocument();
    });

    test("shows progress bar when limit exceeded", () => {
      const portfolio = mockPortfolio({
        day_pnl: -10000,
        max_daily_loss_pct: 1.0,
        daily_loss_limit_exceeded: true,
      });
      const { getByTestId } = renderWithMantine(
        <PaperPortfolioCard portfolio={portfolio} isMultiStrategy={false} strategySummaries={[]} />,
      );
      expect(getByTestId("daily-loss-progress")).toBeInTheDocument();
    });
  });

  describe("strategy summaries - multiple strategies", () => {
    test("shows strategy summaries when isMultiStrategy is true with non-empty summaries", () => {
      const portfolio = mockPortfolio();
      const summaries = [
        mockStrategySummary({ strategy_name: "ORB", pnl: 5000 }),
        mockStrategySummary({ strategy_name: "SR Breakout", pnl: -2000 }),
      ];
      renderWithMantine(
        <PaperPortfolioCard
          portfolio={portfolio}
          isMultiStrategy={true}
          strategySummaries={summaries}
        />,
      );
      expect(screen.getByTestId("strategy-summaries")).toBeInTheDocument();
    });

    test("shows strategy badges for each strategy", () => {
      const portfolio = mockPortfolio();
      const summaries = [
        mockStrategySummary({ strategy_name: "ORB", pnl: 5000 }),
        mockStrategySummary({ strategy_name: "SR Breakout", pnl: -2000 }),
      ];
      renderWithMantine(
        <PaperPortfolioCard
          portfolio={portfolio}
          isMultiStrategy={true}
          strategySummaries={summaries}
        />,
      );
      expect(screen.getByTestId("strategy-badge-ORB")).toBeInTheDocument();
      expect(screen.getByTestId("strategy-badge-SR Breakout")).toBeInTheDocument();
    });

    test("shows + prefix for positive strategy P&L", () => {
      const portfolio = mockPortfolio();
      const summaries = [mockStrategySummary({ strategy_name: "ORB", pnl: 5000 })];
      renderWithMantine(
        <PaperPortfolioCard
          portfolio={portfolio}
          isMultiStrategy={true}
          strategySummaries={summaries}
        />,
      );
      expect(screen.getAllByText(/\+₹5,000/).length).toBeGreaterThan(0);
    });
  });

  describe("strategy summaries - single strategy", () => {
    test("does not show strategy summaries when isMultiStrategy is false", () => {
      const portfolio = mockPortfolio();
      const summaries = [mockStrategySummary({ strategy_name: "ORB", pnl: 5000 })];
      const { queryByTestId } = renderWithMantine(
        <PaperPortfolioCard
          portfolio={portfolio}
          isMultiStrategy={false}
          strategySummaries={summaries}
        />,
      );
      expect(queryByTestId("strategy-summaries")).not.toBeInTheDocument();
    });
  });

  describe("strategy summaries - empty array", () => {
    test("does not show strategy summaries when array is empty", () => {
      const portfolio = mockPortfolio();
      const { queryByTestId } = renderWithMantine(
        <PaperPortfolioCard portfolio={portfolio} isMultiStrategy={true} strategySummaries={[]} />,
      );
      expect(queryByTestId("strategy-summaries")).not.toBeInTheDocument();
    });
  });

  describe("large values formatting", () => {
    test("formats large total_value in INR format (1,00,000)", () => {
      const portfolio = mockPortfolio({ total_value: 100000, cash: 75000, margin_used: 25000 });
      renderWithMantine(
        <PaperPortfolioCard portfolio={portfolio} isMultiStrategy={false} strategySummaries={[]} />,
      );
      expect(screen.getByText(/1,00,000/)).toBeInTheDocument();
    });

    test("formats large P&L values (1,00,000)", () => {
      const portfolio = mockPortfolio({ day_pnl: 100000 });
      renderWithMantine(
        <PaperPortfolioCard portfolio={portfolio} isMultiStrategy={false} strategySummaries={[]} />,
      );
      expect(screen.getByText(/\+₹1,00,000/)).toBeInTheDocument();
    });
  });

  describe("portfolio labels", () => {
    const labels = ["Total Value", "Cash", "Margin Used", "Day P&L"];
    test.each(labels)("displays $label", (label) => {
      renderWithPortfolio();
      expect(screen.getByText(new RegExp(label))).toBeInTheDocument();
    });
  });
});
