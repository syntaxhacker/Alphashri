// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { parsePatternParams, buildPatternParams } from "./usePatternUrlSync";
import { DEFAULT_PATTERN_FILTERS } from "../state/chartPatterns";

describe("pattern from/to URL params", () => {
  it("parses from/to into from_date/to_date", () => {
    const parsed = parsePatternParams(
      new URLSearchParams("from=2026-06-01&to=2026-09-30T14%3A30"),
    );
    expect(parsed.filters.from_date).toBe("2026-06-01");
    expect(parsed.filters.to_date).toBe("2026-09-30T14:30");
  });

  it("ignores blank from/to", () => {
    const parsed = parsePatternParams(new URLSearchParams("from=&to="));
    expect(parsed.filters.from_date).toBeUndefined();
    expect(parsed.filters.to_date).toBeUndefined();
  });

  it("round-trips from_date/to_date through build/parse", () => {
    const state = {
      universe: "",
      timeframe: "1D",
      lookbackBars: null as number | null,
      filters: { ...DEFAULT_PATTERN_FILTERS, from_date: "2026-06-01", to_date: "2026-09-30T14:30" },
    };
    const serialized = buildPatternParams(state).toString();
    expect(serialized).toContain("from=2026-06-01");
    expect(serialized).toContain("to=2026-09-30T14%3A30");
    const parsed = parsePatternParams(new URLSearchParams(serialized));
    expect(parsed.filters.from_date).toBe("2026-06-01");
    expect(parsed.filters.to_date).toBe("2026-09-30T14:30");
  });

  it("omits from/to when unset", () => {
    const clean = buildPatternParams({
      universe: "",
      timeframe: "1D",
      lookbackBars: null,
      filters: { ...DEFAULT_PATTERN_FILTERS },
    });
    expect(clean.has("from")).toBe(false);
    expect(clean.has("to")).toBe(false);
  });
});
