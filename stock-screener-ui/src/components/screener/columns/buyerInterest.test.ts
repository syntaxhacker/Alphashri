import { describe, it, expect } from "vitest";
import { getBuyerInterestColumns } from "./buyerInterest";

function fmt(key: string) {
  const c = getBuyerInterestColumns().find((x) => x.key === key);
  if (!c?.format) throw new Error(key);
  return c.format as any;
}

describe("buyerInterest columns", () => {
  it("7 columns", () => expect(getBuyerInterestColumns().length).toBe(7));
  it("symbol first sector last", () => {
    const cols = getBuyerInterestColumns();
    expect(cols[0].key).toBe("symbol");
    expect(cols[cols.length - 1].key).toBe("sector");
  });

  describe("touched_52w badge", () => {
    it.each([
      [true, "Yes"],
      [false, "No"],
    ])("touched %s -> %s", (v, exp) => expect(fmt("touched_52w")(v, {})).toBe(exp));
    it("true with last_touched -> element", () => {
      const iso = new Date(Date.now() - 86400000).toISOString();
      const r: any = fmt("touched_52w")(true, { last_touched: iso });
      expect(r.props.label).toContain("Touched on");
    });
  });

  describe("day_change", () => {
    it.each([
      [1.25, "+1.25%", "success"],
      [-0.75, "-0.75%", "error"],
      [0, "+0.00%", "success"],
    ])("day_change %s", (v, ev, ec) => {
      const r: any = fmt("day_change")(v);
      expect(r.value).toBe(ev);
      expect(r.className).toBe(ec);
    });
    it("NaN -> NaN% red", () => expect((fmt("day_change")(NaN) as any).value).toBe("NaN%"));
  });

  describe("volume_m", () => {
    it("null -> 0.00", () => expect(fmt("volume_m")(null)).toBe("0.00"));
    it("12.345 -> 12.35", () => expect(fmt("volume_m")(12.345)).toBe("12.35"));
  });

  describe("recent_return_5d via perfW spread (no emoji, just pct)", () => {
    it("3.2 green", () => {
      const r: any = fmt("recent_return_5d")(3.2);
      expect(r.value).toBe("+3.2%");
      expect(r.className).toBe("success");
    });
    it("-1.5 red", () => {
      const r: any = fmt("recent_return_5d")(-1.5);
      expect(r.value).toBe("-1.5%");
      expect(r.className).toBe("error");
    });
    it("0 red", () => expect((fmt("recent_return_5d")(0) as any).className).toBe("error"));
  });

  it("all sortable", () => getBuyerInterestColumns().forEach((c) => expect(c.sortable).toBe(true)));
});
