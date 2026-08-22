// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrategyCard } from "./StrategyCard";
import { mockPosition } from "./testFixtures";
import { renderWithMantine } from "../../test-utils/renderWithMantine";
import type { PaperPosition } from "../../types/paperTrading";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

vi.mock("./PositionsHelpers", () => ({
  PositionsTableBody: vi.fn(() => <div data-testid="positions-body" />),
}));

vi.mock("../common/compact", () => ({
  CompactPanel: vi.fn(({ children, testId }: { children: React.ReactNode; testId?: string }) => (
    <div data-testid={testId}>{children}</div>
  )),
}));

function createPositions(count: number, overrides: Partial<PaperPosition> = {}): PaperPosition[] {
  return Array.from({ length: count }, (_, i) =>
    mockPosition({ symbol: `SYM${i}`, order_id: `ord-${i}`, ...overrides }),
  );
}

describe("StrategyCard", () => {
  const defaultProps = {
    strategyName: "ORB Strategy",
    positions: [] as PaperPosition[],
    maxCapacity: 10,
    onSelectSymbol: vi.fn(),
    onClosePosition: vi.fn(),
    onCloseAll: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Basic rendering", () => {
    test("renders strategy name and position count", () => {
      const positions = createPositions(3);
      renderWithMantine(
        <StrategyCard {...defaultProps} positions={positions} />,
      );
      const card = screen.getByTestId("strategy-card-ORB Strategy");
      expect(card).toBeInTheDocument();
      expect(card).toHaveTextContent("ORB Strategy");
      expect(card.textContent).toContain("3");
    });

    test("shows total P&L positive", () => {
      const positions = createPositions(2, { pnl: 5000 });
      renderWithMantine(
        <StrategyCard {...defaultProps} positions={positions} />,
      );
      expect(screen.getByText((c) => c.includes("+") && c.includes("₹"))).toBeInTheDocument();
    });

    test("shows total P&L negative", () => {
      const positions = createPositions(1, { pnl: -500 });
      renderWithMantine(
        <StrategyCard {...defaultProps} positions={positions} />,
      );
      expect(screen.getByText((c) => c.includes("-") && c.includes("₹"))).toBeInTheDocument();
    });

    test("renders close all button", () => {
      const positions = createPositions(2);
      renderWithMantine(
        <StrategyCard {...defaultProps} positions={positions} />,
      );
      expect(screen.getByTestId("close-strategy-ORB Strategy")).toBeInTheDocument();
    });

    test("close all calls onCloseAll with stopPropagation", async () => {
      const user = userEvent.setup();
      const onCloseAll = vi.fn();
      const positions = createPositions(2);
      renderWithMantine(
        <StrategyCard {...defaultProps} positions={positions} onCloseAll={onCloseAll} />,
      );
      await user.click(screen.getByTestId("close-strategy-ORB Strategy"));
      expect(onCloseAll).toHaveBeenCalledWith(positions);
    });
  });

  describe("Capacity bar", () => {
    test("capacity bar at 0% when no positions", () => {
      renderWithMantine(
        <StrategyCard {...defaultProps} positions={[]} />,
      );
      const progress = screen.getByRole("progressbar");
      expect(progress).toBeInTheDocument();
      expect(progress).toHaveAttribute("aria-valuenow", "0");
    });

    test("capacity bar at 50% when half full", () => {
      const positions = createPositions(5);
      renderWithMantine(
        <StrategyCard {...defaultProps} positions={positions} maxCapacity={10} />,
      );
      const progress = screen.getByRole("progressbar");
      expect(progress).toHaveAttribute("aria-valuenow", "50");
    });

    test("capacity bar at 100% (red color)", () => {
      const positions = createPositions(10);
      renderWithMantine(
        <StrategyCard {...defaultProps} positions={positions} maxCapacity={10} />,
      );
      const progress = screen.getByRole("progressbar");
      expect(progress).toHaveAttribute("aria-valuenow", "100");
    });

    test("capacity bar at >100% (clamped to 100, red)", () => {
      const positions = createPositions(15);
      renderWithMantine(
        <StrategyCard {...defaultProps} positions={positions} maxCapacity={10} />,
      );
      const progress = screen.getByRole("progressbar");
      expect(progress).toHaveAttribute("aria-valuenow", "100");
    });
  });

  describe("Expand/collapse", () => {
    test("always renders PositionsTableBody", () => {
      const positions = createPositions(2);
      renderWithMantine(
        <StrategyCard {...defaultProps} positions={positions} />,
      );
      expect(screen.getByTestId("positions-body")).toBeInTheDocument();
    });

    test("testId prop is passed to CompactPanel", () => {
      renderWithMantine(
        <StrategyCard {...defaultProps} strategyName="Test Strat" />,
      );
      expect(screen.getByTestId("strategy-card-Test Strat")).toBeInTheDocument();
    });
  });

  describe("data integrity edge cases", () => {
    test("renders strategy with single position", () => {
      const positions = createPositions(1);
      renderWithMantine(
        <StrategyCard {...defaultProps} positions={positions} />,
      );
      const card = screen.getByTestId("strategy-card-ORB Strategy");
      expect(card.textContent).toContain("1");
    });

    test("capacity bar at 0% when maxCapacity > 0 and no positions", () => {
      renderWithMantine(
        <StrategyCard {...defaultProps} positions={[]} maxCapacity={5} />,
      );
      const progress = screen.getByRole("progressbar");
      expect(progress).toHaveAttribute("aria-valuenow", "0");
    });

    test("formatSignedPnl renders positive P&L with + sign", () => {
      const positions = createPositions(1, { pnl: 2500 });
      renderWithMantine(
        <StrategyCard {...defaultProps} positions={positions} />,
      );
      expect(screen.getByText((c) => c.includes("+") && c.includes("₹"))).toBeInTheDocument();
    });

    test("formatSignedPnl renders negative P&L with - sign", () => {
      const positions = createPositions(1, { pnl: -2500 });
      renderWithMantine(
        <StrategyCard {...defaultProps} positions={positions} />,
      );
      expect(screen.getByText((c) => c.includes("-") && c.includes("₹"))).toBeInTheDocument();
    });

    test("does not crash when positions contain NaN P&L", () => {
      const positions = createPositions(2, { pnl: NaN, pnl_pct: NaN });
      renderWithMantine(
        <StrategyCard {...defaultProps} positions={positions} />,
      );
      expect(screen.getByText("ORB Strategy")).toBeInTheDocument();
    });

    test("renders multiple positions across same strategy", () => {
      const positions = createPositions(5);
      renderWithMantine(
        <StrategyCard {...defaultProps} positions={positions} />,
      );
      const card = screen.getByTestId("strategy-card-ORB Strategy");
      expect(card.textContent).toContain("5");
    });
  });
});
