import { describe, it, expect } from "vitest";
import { formatBotCapitalPct, formatBotMaxPositions } from "./botFormat";

describe("bot list formatting", () => {
  it("shows a dash for missing or non-finite max positions", () => {
    expect(formatBotMaxPositions(undefined)).toBe("—");
    expect(formatBotMaxPositions(null)).toBe("—");
    expect(formatBotMaxPositions(Number.NaN)).toBe("—");
    expect(formatBotMaxPositions(Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("keeps real max positions as plain numbers", () => {
    expect(formatBotMaxPositions(0)).toBe("0");
    expect(formatBotMaxPositions(5)).toBe("5");
  });

  it("shows a dash for missing or non-finite max capital", () => {
    expect(formatBotCapitalPct(undefined)).toBe("—");
    expect(formatBotCapitalPct(null)).toBe("—");
    expect(formatBotCapitalPct(Number.NaN)).toBe("—");
    expect(formatBotCapitalPct(Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("formats finite capital fractions as whole percentages", () => {
    expect(formatBotCapitalPct(0)).toBe("0%");
    expect(formatBotCapitalPct(0.5)).toBe("50%");
    expect(formatBotCapitalPct(1)).toBe("100%");
  });
});
