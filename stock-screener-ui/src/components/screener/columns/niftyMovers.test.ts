import { describe, it, expect } from "vitest";
import { getNiftyMoversColumns } from "./niftyMovers";

function fmt(key: string) {
  const c = getNiftyMoversColumns().find((x) => x.key === key);
  if (!c?.format) throw new Error(key);
  return c.format as any;
}

describe("niftyMovers columns", () => {
  it("7 columns symbol first sector last", () => {
    const cols = getNiftyMoversColumns();
    expect(cols.length).toBe(7);
    expect(cols[0].key).toBe("symbol");
    expect(cols[cols.length - 1].key).toBe("sector");
  });

  describe("impact_score", () => {
    it.each([
      [2.5, "+2.50", "success"],
      [-1.3, "-1.30", "error"],
      [0, "+0.00", "success"],
      [NaN, "NaN", "error"],
      [Infinity, "+Infinity", "success"],
      [-Infinity, "-Infinity", "error"],
    ])("impact %s -> %s %s", (v, ev, ec) => {
      const r: any = fmt("impact_score")(v);
      expect(r.value).toBe(ev);
      expect(r.className).toBe(ec);
    });
  });

  describe("market_cap_b", () => {
    it.each([
      [185.3, "185.3B"],
      [0, "0.0B"],
      [10, "10.0B"],
    ])("mcap %s -> %s", (v, exp) => expect(fmt("market_cap_b")(v)).toBe(exp));
    it("null/undefined -> 0.0B", () => {
      expect(fmt("market_cap_b")(null)).toBe("0.0B");
      expect(fmt("market_cap_b")(undefined)).toBe("0.0B");
    });
    it("NaN -> NaNB", () => expect(() => fmt("market_cap_b")(NaN)).not.toThrow());
  });

  describe("day_change", () => {
    it("positive green negative red zero green", () => {
      expect((fmt("day_change")(1.5) as any).className).toBe("success");
      expect((fmt("day_change")(-2) as any).className).toBe("error");
      expect((fmt("day_change")(0) as any).className).toBe("success");
    });
  });

  describe("volume_m", () => {
    it("formats and null fallback", () => {
      expect(fmt("volume_m")(5)).toBe("5.00");
      expect(fmt("volume_m")(null)).toBe("0.00");
      expect(() => fmt("volume_m")(NaN)).not.toThrow();
    });
  });

  it("all sortable", () => getNiftyMoversColumns().forEach((c) => expect(c.sortable).toBe(true)));
});
