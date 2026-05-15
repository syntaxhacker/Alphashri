import { describe, expect, test } from "vitest";
import { buildSummaryItems, getTone } from "./ScreenerSummary";

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
});
