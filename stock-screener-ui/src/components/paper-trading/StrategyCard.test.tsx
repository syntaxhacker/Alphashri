// @vitest-environment happy-dom
import type { JSX } from "solid-js";
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@solidjs/testing-library";
import { StrategyCard } from "./StrategyCard";
import { mockPosition } from "./testFixtures";
import { renderWithProviders } from "../../test-utils/renderWithProviders";
import type { PaperPosition } from "../../types/paperTrading";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

vi.mock("./PositionsHelpers", () => ({
  PositionsTableBody: vi.fn(() => <div data-testid="positions-body" />),
}));

vi.mock("../common/compact", () => ({
  CompactPanel: vi.fn(({ children, testId }: { children: JSX.Element; testId?: string }) => (
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
      render(() => 
        <StrategyCard {...defaultProps} positions={positions} />,
      );
      const card = screen.getByTestId("strategy-card-ORB Strategy");
      expect(card).toBeInTheDocument();
      expect(card).toHaveTextContent("ORB Strategy");
      expect(card.textContent).toContain("3");
    });

    test("shows total P&L positive", () => {
      const positions = createPositions(2, { pnl: 5000 });
      render(() => 
        <StrategyCard {...defaultProps} positions={positions} />,
      );
      expect(screen.getByText((c) => c.includes("+") && c.includes("₹"))).toBeInTheDocument();
    });

    test("shows total P&L negative", () => {
      const positions = createPositions(1, { pnl: -500 });
      render(() => 
        <StrategyCard {...defaultProps} positions={positions} />,
      );
      expect(screen.getByText((c) => c.includes("-") && c.includes("₹"))).toBeInTheDocument();
    });

    test("renders close all button", () => {
      const positions = createPositions(2);
      render(() => 
        <StrategyCard {...defaultProps} positions={positions} />,
      );
      expect(screen.getByTestId("close-strategy-ORB Strategy")).toBeInTheDocument();
    });

    test("close all calls onCloseAll with stopPropagation", async () => {
      const onCloseAll = vi.fn();
      const positions = createPositions(2);
      render(() => 
        <StrategyCard {...defaultProps} positions={positions} onCloseAll={onCloseAll} />,
      );
      await fireEvent.click(screen.getByTestId("close-strategy-ORB Strategy"));
      expect(onCloseAll).toHaveBeenCalledWith(positions);
    });
  });

  describe("Capacity bar", () => {
    test("capacity bar at 0% when no positions", () => {
      render(() => 
        <StrategyCard {...defaultProps} positions={[]} />,
      );
      const progress = screen.getByRole("progressbar");
      expect(progress).toBeInTheDocument();
      expect(progress).toHaveAttribute("aria-valuenow", "0");
    });

    test("capacity bar at 50% when half full", () => {
      const positions = createPositions(5);
      render(() => 
        <StrategyCard {...defaultProps} positions={positions} maxCapacity={10} />,
      );
      const progress = screen.getByRole("progressbar");
      expect(progress).toHaveAttribute("aria-valuenow", "50");
    });

    test("capacity bar at 100% (red color)", () => {
      const positions = createPositions(10);
      render(() => 
        <StrategyCard {...defaultProps} positions={positions} maxCapacity={10} />,
      );
      const progress = screen.getByRole("progressbar");
      expect(progress).toHaveAttribute("aria-valuenow", "100");
    });

    test("capacity bar at >100% (clamped to 100, red)", () => {
      const positions = createPositions(15);
      render(() => 
        <StrategyCard {...defaultProps} positions={positions} maxCapacity={10} />,
      );
      const progress = screen.getByRole("progressbar");
      expect(progress).toHaveAttribute("aria-valuenow", "100");
    });
  });

  describe("Expand/collapse", () => {
    test("always renders PositionsTableBody", () => {
      const positions = createPositions(2);
      render(() => 
        <StrategyCard {...defaultProps} positions={positions} />,
      );
      expect(screen.getByTestId("positions-body")).toBeInTheDocument();
    });

    test("testId prop is passed to CompactPanel", () => {
      render(() => 
        <StrategyCard {...defaultProps} strategyName="Test Strat" />,
      );
      expect(screen.getByTestId("strategy-card-Test Strat")).toBeInTheDocument();
    });
  });

  describe("data integrity edge cases", () => {
    test("does not crash when positions contain NaN P&L", () => {
      const positions = createPositions(2, { pnl: NaN, pnl_pct: NaN });
      render(() => 
        <StrategyCard {...defaultProps} positions={positions} />,
      );
      expect(screen.getByText("ORB Strategy")).toBeInTheDocument();
    });
  });
});
