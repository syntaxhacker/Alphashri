import { describe, it, expect } from "vitest";
import { get52wHighColumns } from "./52wHigh";
import { cellOf, cellText, fmtOf } from "./columnTestFixtures";

function findFmt(key: string) {
  return fmtOf(get52wHighColumns, key) as (v: any, row?: any) => any;
}

describe("52wHigh columns", () => {
  it("returns 12 columns by default", () => {
    expect(get52wHighColumns().length).toBe(12);
    expect(get52wHighColumns("approaching").length).toBe(12);
    expect(get52wHighColumns("touched").length).toBe(12);
  });

  it("core columns exist", () => {
    const keys = get52wHighColumns().map((c) => c.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "symbol",
        "score",
        "to_52w_high",
        "high_52w",
        "low_52w",
        "upstox_price",
        "days_ago",
        "volume_m",
        "volume",
        "rsi",
        "adx",
        "day_change",
      ]),
    );
  });

  describe("gapCol to_52w_high formatting (52W gap %)", () => {
    it.each([
      [-5.76, "-5.76%", "success"],
      [0, "0.00%", ""],
      [0.3, "+0.30%", ""],
      [2, "+2.00%", ""],
      [2.01, "+2.01%", "error"],
      [3.5, "+3.50%", "error"],
    ])("gap %s -> %s tone %s", (val, expVal, expTone) => {
      const cell = cellOf(() => findFmt("to_52w_high")(val));
      expect(cell.text).toBe(expVal);
      expect(cell.tone).toBe(expTone);
    });

    it("renders mono, tabular and right aligned", () => {
      const cell = cellOf(() => findFmt("to_52w_high")(-5.76));
      expect(cell.className).toContain("font-mono");
      expect(cell.className).toContain("tabular-nums");
      expect(cell.className).toContain("text-right");
    });

    it("NaN/Infinity render a dash without throwing", () => {
      expect(cellText(() => findFmt("to_52w_high")(NaN))).toBe("—");
      expect(cellText(() => findFmt("to_52w_high")(Infinity))).toBe("—");
      expect(cellText(() => findFmt("to_52w_high")(-Infinity))).toBe("—");
    });
  });

  describe("high_52w column", () => {
    it("formats to 2 decimals", () => {
      expect(cellText(() => findFmt("high_52w")(2600))).toBe("2600.00");
      expect(cellText(() => findFmt("high_52w")(0))).toBe("0.00");
    });
    it("null/undefined yields dash", () => {
      expect(cellText(() => findFmt("high_52w")(null))).toBe("-");
      expect(cellText(() => findFmt("high_52w")(undefined))).toBe("-");
    });
    it("NaN -> dash", () => expect(cellText(() => findFmt("high_52w")(NaN))).toBe("-"));
  });

  describe("low_52w column", () => {
    it.each([
      [100, "100.00"],
      [0, "0.00"],
    ])("formats %s", (v, exp) => {
      expect(cellText(() => findFmt("low_52w")(v))).toBe(exp);
    });
    it("null/undefined returns dash", () => {
      expect(cellText(() => findFmt("low_52w")(null))).toBe("-");
      expect(cellText(() => findFmt("low_52w")(undefined))).toBe("-");
    });
    it("handles NaN without throwing", () => {
      expect(cellText(() => findFmt("low_52w")(NaN))).toBe("-");
    });
  });

  describe("LTP column", () => {
    it.each([
      [2451.0, "₹2451.00"],
      [0, "₹0.00"],
      [0.01, "₹0.01"],
    ])("price %s -> %s", (v, exp) => {
      expect(cellText(() => findFmt("upstox_price")(v))).toBe(exp);
    });
    it("nullish -> dash, never ₹0.00", () => {
      expect(cellText(() => findFmt("upstox_price")(null))).toBe("-");
      expect(cellText(() => findFmt("upstox_price")(undefined))).toBe("-");
    });
  });

  describe("days_ago column", () => {
    it.each([
      [0, "Today"],
      [1, "1d"],
      [5, "5d"],
      [30, "30d"],
    ])("days %s -> %s", (v, exp) => {
      expect(cellText(() => findFmt("days_ago")(v))).toBe(exp);
    });
    it("null/undefined -> dash", () => {
      expect(cellText(() => findFmt("days_ago")(null))).toBe("-");
      expect(cellText(() => findFmt("days_ago")(undefined))).toBe("-");
    });
    it("handles 0 correctly not as falsy", () => {
      expect(cellText(() => findFmt("days_ago")(0))).toBe("Today");
    });
  });

  describe("volume_m", () => {
    it.each([
      [12.345, "12.35"],
      [0, "0.00"],
      [0.001, "0.00"],
    ])("volume_m %s -> %s", (v, exp) => {
      expect(cellText(() => findFmt("volume_m")(v))).toBe(exp);
    });
    it("null/undefined -> dash", () => {
      expect(cellText(() => findFmt("volume_m")(null))).toBe("-");
      expect(cellText(() => findFmt("volume_m")(undefined))).toBe("-");
    });
    it("NaN -> dash", () => expect(cellText(() => findFmt("volume_m")(NaN))).toBe("-"));
  });

  describe("volume", () => {
    it("round and locale", () => {
      expect(cellText(() => findFmt("volume")(1234567))).toBe((1234567).toLocaleString());
      expect(cellText(() => findFmt("volume")(0))).toBe("0");
    });
    it("null -> dash", () => {
      expect(cellText(() => findFmt("volume")(null))).toBe("-");
      expect(cellText(() => findFmt("volume")(undefined))).toBe("-");
    });
  });

  describe("rsi/adx", () => {
    it.each([
      [65.3, "65.3"],
      [0, "0.0"],
      [100, "100.0"],
    ])("rsi %s -> %s", (v, exp) => expect(cellText(() => findFmt("rsi")(v))).toBe(exp));
    it("rsi null -> dash", () => expect(cellText(() => findFmt("rsi")(null))).toBe("-"));
    it("adx NaN -> dash", () => expect(cellText(() => findFmt("adx")(NaN))).toBe("-"));
    it("Infinity -> dash", () => expect(cellText(() => findFmt("rsi")(Infinity))).toBe("-"));
  });

  it("all columns sortable", () => {
    get52wHighColumns().forEach((c) => expect(c.sortable).toBe(true));
  });
});
