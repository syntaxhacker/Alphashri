// @vitest-environment happy-dom
import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { buildSummaryItems, getTone, ScreenerSummary } from "./ScreenerSummary";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

vi.mock("../common/compact", () => ({
  CompactStatGrid: ({ children }: any) => <div data-testid="compact-stat-grid">{children}</div>,
  // `CompactStat` forwards testId as `data-testid` now, so read the rest props.
  CompactStat: ({ label, value, tone, ...rest }: { label: string; value: string | number; tone?: string; [key: string]: unknown }) => (
    <div data-testid={rest["data-testid"] as string | undefined} data-tone={tone}>
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
    test("returns the palette variable when color is set", () => {
      expect(getTone({ label: "A", value: 1, color: "green" })).toBe(
        "var(--color-fin-positive)",
      );
      expect(getTone({ label: "B", value: 2, color: "red" })).toBe("var(--color-fin-negative)");
      expect(getTone({ label: "C", value: 3, color: "blue" })).toBe("var(--color-fin-primary)");
    });

    test("returns default text color when color is undefined", () => {
      expect(getTone({ label: "A", value: 1 })).toBe("var(--color-fin-text)");
    });

    test("returns default text color when color is not set", () => {
      expect(getTone({ label: "A", value: 1, color: undefined })).toBe("var(--color-fin-text)");
    });
  });

  describe("rendering", () => {
    beforeEach(() => {
      cleanup();
    });

    test("renders CompactStatGrid with CompactStat items", () => {
      render(() =>
        <ScreenerSummary
          summary={[
            { label: "Total", value: 100, color: "green" },
            { label: "Active", value: 42 },
          ]}
        />,
      );
      expect(screen.getByTestId("compact-stat-grid")).toBeInTheDocument();
      expect(screen.getByTestId("summary-card-Total")).toBeInTheDocument();
      expect(screen.getByTestId("summary-card-Active")).toBeInTheDocument();
      expect(screen.getByText("Total")).toBeInTheDocument();
      expect(screen.getByText("Active")).toBeInTheDocument();
    });

    test("CompactStat receives correct tone from color", () => {
      render(() =>
        <ScreenerSummary
          summary={[
            { label: "Green", value: 1, color: "green" },
            { label: "No Color", value: 2 },
          ]}
        />,
      );
      expect(screen.getByTestId("summary-card-Green")).toHaveAttribute(
        "data-tone",
        "var(--color-fin-positive)",
      );
      expect(screen.getByTestId("summary-card-No Color")).toHaveAttribute(
        "data-tone",
        "var(--color-fin-text)",
      );
    });

    test("renders empty summary gracefully", () => {
      const { container } = render(() => <ScreenerSummary summary={[]} />);
      expect(container.querySelector("[data-testid='compact-stat-grid']")).toBeInTheDocument();
      expect(container.querySelectorAll("[data-testid^='summary-card-']").length).toBe(0);
    });
  });
});
