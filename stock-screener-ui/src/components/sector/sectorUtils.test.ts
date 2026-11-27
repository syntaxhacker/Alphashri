import { describe, expect, test } from "vitest";
import { formatSectorPercentage, normalizePercentText } from "./sectorUtils";

describe("formatSectorPercentage", () => {
  test("normalizes signed zero after rounding", () => {
    expect(formatSectorPercentage(-0)).toBe("0.00%");
    expect(formatSectorPercentage(-0.0001, 1)).toBe("0.0%");
    expect(formatSectorPercentage(-0.004, 2)).toBe("0.00%");
    expect(formatSectorPercentage(-0.04, 1)).toBe("0.0%");
  });

  test("keeps the sign on values that actually round away from zero", () => {
    expect(formatSectorPercentage(0.004, 2)).toBe("0.00%");
    expect(formatSectorPercentage(0.05, 1)).toBe("+0.1%");
    expect(formatSectorPercentage(-0.05, 1)).toBe("-0.1%");
    expect(formatSectorPercentage(4.05)).toBe("+4.05%");
  });

  test("normalizes preformatted backend percentages without losing precision", () => {
    expect(normalizePercentText("-0.0%")).toBe("0.0%");
    expect(normalizePercentText("-0.00%")).toBe("0.00%");
    expect(normalizePercentText("+0.0%")).toBe("0.0%");
    expect(normalizePercentText("-0.01%")).toBe("-0.01%");
    expect(normalizePercentText("+6.3%")).toBe("+6.3%");
    expect(normalizePercentText("not-a-percent")).toBe("not-a-percent");
  });

  test("supports the no-plus variant and missing values", () => {
    expect(formatSectorPercentage(2.5, 2, false)).toBe("2.50%");
    expect(formatSectorPercentage(-1, 1, false)).toBe("-1.0%");
    expect(formatSectorPercentage(Number.NaN)).toBe("—");
    expect(formatSectorPercentage(null)).toBe("—");
    expect(formatSectorPercentage(undefined)).toBe("—");
  });
});
