// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SelectedPositionBar } from "./SelectedPositionBar";
import { mockPosition } from "./testFixtures";
import { renderWithMantine } from "../../test-utils/renderWithMantine";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SelectedPositionBar", () => {
  describe("Placeholder state", () => {
    test("shows placeholder when position is null", () => {
      renderWithMantine(<SelectedPositionBar position={null} />);
      expect(
        screen.getByText("No position selected — click a row to view details"),
      ).toBeInTheDocument();
    });
  });

  describe("Position display", () => {
    test("renders position symbol", () => {
      const pos = mockPosition();
      renderWithMantine(<SelectedPositionBar position={pos} />);
      expect(screen.getByText("RELIANCE")).toBeInTheDocument();
    });

    test("renders side badge with correct color (BUY=teal, SELL=red)", () => {
      const buyPos = mockPosition({ side: "BUY" });
      const { rerender } = renderWithMantine(
        <SelectedPositionBar position={buyPos} />,
      );
      expect(screen.getByText("BUY")).toBeInTheDocument();

      const sellPos = mockPosition({ side: "SELL" });
      rerender(<SelectedPositionBar position={sellPos} />);
      expect(screen.getByText("SELL")).toBeInTheDocument();
    });

    test("shows quantity", () => {
      const pos = mockPosition({ quantity: 50 });
      renderWithMantine(<SelectedPositionBar position={pos} />);
      expect(screen.getByText("50")).toBeInTheDocument();
    });

    test("shows entry price formatted", () => {
      const pos = mockPosition({ entry_price: 2500 });
      renderWithMantine(<SelectedPositionBar position={pos} />);
      expect(screen.getByText("₹2500.00")).toBeInTheDocument();
    });

    test("shows current price formatted", () => {
      const pos = mockPosition({ current_price: 2550 });
      renderWithMantine(<SelectedPositionBar position={pos} />);
      expect(screen.getByText("₹2550.00")).toBeInTheDocument();
    });

    test("shows P&L with sign (+/-) and percentage", () => {
      const pos = mockPosition({ pnl: 5000, pnl_pct: 2.0 });
      renderWithMantine(<SelectedPositionBar position={pos} />);
      expect(screen.getByText((c) => c.includes("+") && c.includes("₹5.0K") && c.includes("2.00%"))).toBeInTheDocument();
    });

    test("shows TP with ₹ format or dash", () => {
      const pos = mockPosition({ take_profit: 2650 });
      renderWithMantine(<SelectedPositionBar position={pos} />);
      expect(screen.getByText("₹2650.00")).toBeInTheDocument();
    });

    test("shows SL with ₹ format or dash", () => {
      const pos = mockPosition({ stop_loss: 2450 });
      renderWithMantine(<SelectedPositionBar position={pos} />);
      expect(screen.getByText("₹2450.00")).toBeInTheDocument();
    });

    test("close button visible when onClose provided", () => {
      const onClose = vi.fn();
      const pos = mockPosition();
      renderWithMantine(
        <SelectedPositionBar position={pos} onClose={onClose} />,
      );
      expect(screen.getByTestId("close-selected-position")).toBeInTheDocument();
    });

    test("close button NOT visible when onClose is undefined", () => {
      const pos = mockPosition();
      renderWithMantine(<SelectedPositionBar position={pos} />);
      expect(screen.queryByTestId("close-selected-position")).not.toBeInTheDocument();
    });

    test("close button calls onClose with symbol and current_price", async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      const pos = mockPosition({ symbol: "RELIANCE", current_price: 2550 });
      renderWithMantine(
        <SelectedPositionBar position={pos} onClose={onClose} />,
      );
      await user.click(screen.getByTestId("close-selected-position"));
      expect(onClose).toHaveBeenCalledWith("RELIANCE", 2550);
    });

    test("P&L uses getPnLTextColor (positive/negative)", () => {
      const pos = mockPosition({ pnl: 5000, pnl_pct: 2.0 });
      renderWithMantine(<SelectedPositionBar position={pos} />);
      const pnlText = screen.getByText((c) => c.includes("₹5.0K"));
      expect(pnlText).toBeInTheDocument();
    });
  });

  describe("data integrity edge cases", () => {
    test("does not crash with NaN pnl", () => {
      const pos = mockPosition({ pnl: NaN, pnl_pct: NaN });
      renderWithMantine(<SelectedPositionBar position={pos} />);
      expect(screen.getByText("RELIANCE")).toBeInTheDocument();
    });

    test("does not crash with Infinity pnl", () => {
      const pos = mockPosition({ pnl: Infinity, pnl_pct: Infinity });
      renderWithMantine(<SelectedPositionBar position={pos} />);
      expect(screen.getByText("RELIANCE")).toBeInTheDocument();
    });

    test("shows dash for take_profit = 0", () => {
      const pos = mockPosition({ take_profit: 0 });
      renderWithMantine(<SelectedPositionBar position={pos} />);
      expect(screen.getByText("—")).toBeInTheDocument();
    });

    test("shows dash for stop_loss = 0", () => {
      const pos = mockPosition({ stop_loss: 0 });
      renderWithMantine(<SelectedPositionBar position={pos} />);
      expect(screen.getByText("—")).toBeInTheDocument();
    });

    test("renders with zero quantity", () => {
      const pos = mockPosition({ quantity: 0 });
      renderWithMantine(<SelectedPositionBar position={pos} />);
      expect(screen.getByText("0")).toBeInTheDocument();
    });

    test("renders with negative entry_price", () => {
      const pos = mockPosition({ entry_price: -100 });
      renderWithMantine(<SelectedPositionBar position={pos} />);
      expect(screen.getByText("₹-100.00")).toBeInTheDocument();
    });

    test("handles null side gracefully (falls to red badge)", () => {
      const pos = mockPosition({ side: null as any });
      renderWithMantine(<SelectedPositionBar position={pos} />);
      expect(screen.getByText("RELIANCE")).toBeInTheDocument();
    });
  });
});
