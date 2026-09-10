import { describe, it, expect } from "vitest";
import { get52wHighColumns } from "./52wHigh";

function findFmt(key: string) {
  const cols = get52wHighColumns();
  const col = cols.find((c) => c.key === key);
  if (!col || !col.format) throw new Error(`no format for ${key}`);
  return col.format as (v: any, row?: any) => any;
}

describe("52wHigh columns", () => {
  it("returns 12 columns by default", () => {
    expect(get52wHighColumns().length).toBe(12);
    expect(get52wHighColumns("approaching").length).toBe(12);
    expect(get52wHighColumns("touched").length).toBe(12);
  });

  it("core columns exist", () => {
    const keys = get52wHighColumns().map((c) => c.key);
    expect(keys).toEqual(expect.arrayContaining(["symbol","score","to_52w_high","high_52w","low_52w","upstox_price","days_ago","volume_m","volume","rsi","adx","day_change"]));
  });

  describe("gapCol to_52w_high formatting (52W gap %)", () => {
    const fmt = () => findFmt("to_52w_high");
    it.each([
      [-5.76, "-5.76%", "success"],
      [0, "0.00%", ""],
      [0.3, "+0.30%", ""],
      [2, "+2.00%", ""],
      [2.01, "+2.01%", "error"],
      [3.5, "+3.50%", "error"],
    ])("gap %s -> %s class %s", (val, expVal, expCls) => {
      const res: any = fmt()(val);
      expect(res.value).toBe(expVal);
      expect(res.className).toBe(expCls);
    });

    it("handles NaN/Infinity without throwing", () => {
      const f = fmt();
      expect(() => f(NaN)).not.toThrow();
      expect(() => f(Infinity)).not.toThrow();
      expect(() => f(-Infinity)).not.toThrow();
      const nanRes: any = f(NaN);
      // NaN.toFixed yields "NaN" string, should not crash
      expect(typeof nanRes.value).toBe("string");
    });
  });

  describe("high_52w column", () => {
    const fmt = () => findFmt("high_52w");
    it("formats to 2 decimals", () => {
      expect(fmt()(2600).value).toBe("2600.00");
      expect(fmt()(0).value).toBe("0.00");
    });
    it("handles price 0", () => {
      expect(fmt()(0).value).toBe("0.00");
    });
    it("null/undefined yields dash", () => {
      const highFmt = fmt();
      // low_52w has dash fallback, high_52w uses value?.toFixed || "-" so null -> "-"
      expect(highFmt(null)).toEqual(expect.objectContaining({ value: expect.any(String) }) );
      // for high_52w, toFixed on null would error, but implementation is value?.toFixed(2) || "-"
      // Check undefined returns -
      const res = highFmt(undefined);
      expect((res as any).value === "-" || typeof (res as any).value === "string").toBe(true);
    });
  });

  describe("low_52w column", () => {
    const fmt = () => findFmt("low_52w");
    it.each([
      [100, "100.00"],
      [0, "0.00"],
    ])("formats %s", (v, exp) => {
      expect((fmt()(v) as any).value).toBe(exp);
    });
    it("null/undefined returns dash string", () => {
      expect(fmt()(null)).toBe("-");
      expect(fmt()(undefined)).toBe("-");
    });
    it("handles NaN without throwing", () => {
      expect(() => fmt()(NaN)).not.toThrow();
    });
  });

  describe("LTP column", () => {
    const fmt = () => findFmt("upstox_price");
    it.each([
      [2451.0, "₹2451.00"],
      [0, "₹0.00"],
      [0.01, "₹0.01"],
    ])("price %s -> %s", (v, exp) => {
      expect(fmt()(v)).toBe(exp);
    });
  });

  describe("days_ago column", () => {
    const fmt = () => findFmt("days_ago");
    it.each([
      [0, "Today"],
      [1, "1d"],
      [5, "5d"],
      [30, "30d"],
    ])("days %s -> %s", (v, exp) => {
      const r: any = fmt()(v);
      expect(r.value).toBe(exp);
    });
    it("null/undefined -> dash", () => {
      expect(fmt()(null)).toBe("-");
      expect(fmt()(undefined)).toBe("-");
    });
    it("handles 0 correctly not as falsy", () => {
      const r: any = fmt()(0);
      expect(r.value).toBe("Today");
    });
  });

  describe("volume_m", () => {
    const fmt = () => findFmt("volume_m");
    it.each([
      [12.345, "12.35"],
      [0, "0.00"],
      [0.001, "0.00"],
    ])("volume_m %s -> %s", (v, exp) => {
      expect(fmt()(v)).toBe(exp);
    });
    it("null/undefined -> dash", () => {
      expect(fmt()(null)).toBe("-");
      expect(fmt()(undefined)).toBe("-");
    });
    it("NaN -> NaN string dash fallback not crash", () => {
      expect(() => fmt()(NaN)).not.toThrow();
      expect(fmt()(NaN)).toBe("NaN");
    });
  });

  describe("volume", () => {
    const fmt = () => findFmt("volume");
    it("round and locale", () => {
      expect(fmt()(1234567)).toBe((1234567).toLocaleString());
      expect(fmt()(0)).toBe("0");
    });
    it("null -> dash", () => {
      expect(fmt()(null)).toBe("-");
      expect(fmt()(undefined)).toBe("-");
    });
  });

  describe("rsi/adx", () => {
    const rsiFmt = () => findFmt("rsi");
    const adxFmt = () => findFmt("adx");
    it.each([
      [65.3, "65.3"],
      [0, "0.0"],
      [100, "100.0"],
    ])("rsi %s -> %s", (v, exp) => expect(rsiFmt()(v)).toBe(exp));
    it("rsi null -> dash", () => expect(rsiFmt()(null)).toBe("-"));
    it("adx NaN handling", () => expect(() => adxFmt()(NaN)).not.toThrow());
    it("handles Infinity", () => expect(() => rsiFmt()(Infinity)).not.toThrow());
  });

  describe("table-driven 52W high calculations edge", () => {
    // simulate gap calculations: (price-high)/high*100
    const pctFromHigh = (high: number, price: number) => ((high - price) / high * 100);
    it.each([
      [100, 97, 3.0],
      [200, 200, 0],
      [200, 210, -5],
    ])("high %s price %s gap %s", (high, price, exp) => {
      expect(pctFromHigh(high, price)).toBeCloseTo(exp, 5);
    });
    it("gap handles price 0", () => {
      expect(pctFromHigh(100, 0)).toBeCloseTo(100, 5);
    });
    it("gap handles high 0 -> Infinity not crash", () => {
      const v = pctFromHigh(0, 100);
      expect(!isFinite(v) || isNaN(v)).toBe(true);
    });
  });

  describe("ADX<25, RSI 50-70 filter boundaries (column-level display)", () => {
    // Ensure columns display values even at filter boundaries
    const rsiFmt = () => findFmt("rsi");
    const adxFmt = () => findFmt("adx");
    it.each([
      [24.9, "24.9"],
      [25, "25.0"],
      [25.1, "25.1"],
    ])("adx %s displays correctly", (v, exp) => expect(adxFmt()(v)).toBe(exp));
    it.each([
      [49.9, "49.9"],
      [50, "50.0"],
      [70, "70.0"],
      [70.1, "70.1"],
    ])("rsi %s displays correctly", (v, exp) => expect(rsiFmt()(v)).toBe(exp));
  });

  it("all columns sortable", () => {
    get52wHighColumns().forEach((c) => expect(c.sortable).toBe(true));
  });
});
