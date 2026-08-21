import { describe, it, expect } from "vitest";
import { getTouched52wColumns } from "./touched52wHigh";

function fmt(key: string) {
  const c = getTouched52wColumns().find((x) => x.key === key);
  if (!c?.format) throw new Error(key);
  return c.format as any;
}

describe("touched52wHigh columns", () => {
  it("9 columns", () => expect(getTouched52wColumns().length).toBe(9));
  it("starts with symbol", () => expect(getTouched52wColumns()[0].key).toBe("symbol"));

  describe("high_52w", () => {
    it("formats 2600 -> 2600.00", () => expect(fmt("high_52w")(2600).value).toBe("2600.00"));
    it("null/undefined -> dash", () => {
      expect(fmt("high_52w")(null).value).toBe("-");
      expect(fmt("high_52w")(undefined).value).toBe("-");
      expect(fmt("high_52w")(null)).toEqual(expect.objectContaining({ value: "-" }));
    });
    it("0 -> 0.00", () => expect(fmt("high_52w")(0).value).toBe("0.00"));
    it("NaN without throw", () => expect(() => fmt("high_52w")(NaN)).not.toThrow());
  });

  describe("days_ago", () => {
    it.each([
      [0, "0d"],
      [1, "1d"],
      [5, "5d"],
      [30, "30d"],
    ])("days %s -> %s", (v, exp) => expect(fmt("days_ago")(v).value).toBe(exp));
    it("null -> dash string", () => expect(fmt("days_ago")(null)).toBe("-"));
    it("undefined -> dash", () => expect(fmt("days_ago")(undefined)).toBe("-"));
  });

  describe("rsi/adx", () => {
    it("rsi formats", () => expect(fmt("rsi")(65.3)).toBe("65.3"));
    it("adx formats", () => expect(fmt("adx")(25)).toBe("25.0"));
    it("null fallback 0.0", () => {
      expect(fmt("rsi")(null)).toBe("0.0");
      expect(fmt("adx")(undefined)).toBe("0.0");
    });
    it("Infinity not throw", () => expect(() => fmt("rsi")(Infinity)).not.toThrow());
  });

  describe("day_change / recent_return_5d / perf_w", () => {
    it("day_change green/red", () => {
      expect((fmt("day_change")(2) as any).className).toBe("green");
      expect((fmt("day_change")(-1) as any).className).toBe("red");
    });
    it("recent_return rocket", () => expect((fmt("recent_return_5d")(6) as any).value).toContain("🚀"));
    it("perf_w red for 0", () => expect((fmt("perf_w")(0) as any).className).toBe("red"));
  });

  describe("volume_m", () => {
    it("12.345 -> 12.35", () => expect(fmt("volume_m")(12.345)).toBe("12.35"));
    it("null -> 0.00", () => expect(fmt("volume_m")(null)).toBe("0.00"));
  });

  it("all sortable", () => getTouched52wColumns().forEach((c) => expect(c.sortable).toBe(true)));
});
