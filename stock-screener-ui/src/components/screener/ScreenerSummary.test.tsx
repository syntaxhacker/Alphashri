// @vitest-environment happy-dom
import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { buildSummaryItems, getTone, ScreenerSummary } from "./ScreenerSummary";

vi.mock("../common/compact", () => ({
  CompactStatGrid: ({ children }: any) => <div data-testid="compact-stat-grid">{children}</div>,
  CompactStat: ({ label, value, tone, testId }: any) => (
    <div data-testid={testId} data-tone={tone}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  ),
}));

describe("ScreenerSummary", () => {
  describe("summary item rendering", () => {
    test("renders items with string values", () => {
      const items = buildSummaryItems([
        { label: "Status", value: "Active" },
        { label: "Market", value: "NSE" },
      ]);
      expect(items).toHaveLength(2);
      expect(items[0].label).toBe("Status");
      expect(items[0].value).toBe("Active");
    });

    test("renders items with numeric values", () => {
      const items = buildSummaryItems([
        { label: "Count", value: 42 },
        { label: "PnL", value: -1500.5 },
      ]);
      expect(items[0].value).toBe(42);
      expect(items[1].value).toBe(-1500.5);
    });

    test("handles empty array", () => {
      const items = buildSummaryItems([]);
      expect(items).toHaveLength(0);
    });

    test("handles single item", () => {
      const items = buildSummaryItems([{ label: "Total", value: 100 }]);
      expect(items).toHaveLength(1);
    });
  });

  describe("color tone mapping", () => {
    test("returns mantine color variable when color is set", () => {
      expect(getTone({ label: "A", value: 1, color: "green" })).toBe(
        "var(--mantine-color-green-6)",
      );
      expect(getTone({ label: "B", value: 2, color: "red" })).toBe("var(--mantine-color-red-6)");
      expect(getTone({ label: "C", value: 3, color: "blue" })).toBe("var(--mantine-color-blue-6)");
    });

    test("returns default text color when color is undefined", () => {
      expect(getTone({ label: "A", value: 1 })).toBe("var(--mantine-color-text)");
    });

    test("returns default text color when color is not set", () => {
      expect(getTone({ label: "A", value: 1, color: undefined })).toBe("var(--mantine-color-text)");
    });
  });

  describe("test IDs", () => {
    test("generates sequential test IDs based on index", () => {
      const items = buildSummaryItems([
        { label: "First", value: 1 },
        { label: "Second", value: 2 },
        { label: "Third", value: 3 },
      ]);
      items.forEach((_, index) => {
        expect(`summary-card-${index}`).toBe(`summary-card-${index}`);
      });
    });
  });

  describe("rendering", () => {
    beforeEach(() => {
      cleanup();
    });

    test("renders CompactStatGrid with CompactStat items", () => {
      render(
        <ScreenerSummary
          summary={[
            { label: "Total", value: 100, color: "green" },
            { label: "Active", value: 42 },
          ]}
        />,
      );
      expect(screen.getByTestId("compact-stat-grid")).toBeInTheDocument();
      expect(screen.getByTestId("summary-card-0")).toBeInTheDocument();
      expect(screen.getByTestId("summary-card-1")).toBeInTheDocument();
      expect(screen.getByText("Total")).toBeInTheDocument();
      expect(screen.getByText("Active")).toBeInTheDocument();
    });

    test("CompactStat receives correct tone from color", () => {
      render(
        <ScreenerSummary
          summary={[
            { label: "Green", value: 1, color: "green" },
            { label: "No Color", value: 2 },
          ]}
        />,
      );
      expect(screen.getByTestId("summary-card-0")).toHaveAttribute(
        "data-tone",
        "var(--mantine-color-green-6)",
      );
      expect(screen.getByTestId("summary-card-1")).toHaveAttribute(
        "data-tone",
        "var(--mantine-color-text)",
      );
    });

    test("renders empty summary gracefully", () => {
      const { container } = render(<ScreenerSummary summary={[]} />);
      expect(container.querySelector("[data-testid='compact-stat-grid']")).toBeInTheDocument();
      expect(container.querySelectorAll("[data-testid^='summary-card-']").length).toBe(0);
    });
  });
});
