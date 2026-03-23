import { describe, expect, test } from "vitest";
import { formatExpiresIn } from "./BrokerConnectionCard";

describe("BrokerConnectionCard helpers", () => {
  describe("formatExpiresIn", () => {
    test("formats hours and minutes correctly", () => {
      expect(formatExpiresIn(12.5)).toBe("12h 30m");
      expect(formatExpiresIn(1.0)).toBe("1h 0m");
      expect(formatExpiresIn(23.75)).toBe("23h 45m");
    });

    test("formats only minutes when less than 1 hour", () => {
      expect(formatExpiresIn(0.5)).toBe("30m");
      expect(formatExpiresIn(0.25)).toBe("15m");
      expect(formatExpiresIn(0.0)).toBe("0m");
    });

    test("returns empty string for null", () => {
      expect(formatExpiresIn(null)).toBe("");
    });
  });
});
