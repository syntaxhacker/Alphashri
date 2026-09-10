import { describe, it, expect } from "vitest";
import { getIntraday5mColumns, getIntraday10mColumns, getIntraday15mColumns } from "./intraday";

function fmt(cols: ReturnType<typeof getIntraday5mColumns>, key: string) {
  const c = cols.find((x) => x.key === key);
  if (!c?.format) throw new Error(key);
  return c.format as any;
}

describe.each([
  ["5m", getIntraday5mColumns, "move_5m", "5-Min Move"],
  ["10m", getIntraday10mColumns, "move_10m", "10-Min Move"],
  ["15m", getIntraday15mColumns, "move_15m", "15-Min Move"],
] as const)("intraday %s columns", (_label, getCols, moveKey, moveLabel) => {
  const cols = getCols();
  it(`returns 9 columns with ${moveKey}`, () => {
    expect(cols.length).toBe(9);
    expect(cols.some((c) => c.key === moveKey)).toBe(true);
    const moveCol = cols.find((c) => c.key === moveKey)!;
    expect(moveCol.label).toBe(moveLabel);
  });
  it("symbol first sector last", () => {
    expect(cols[0].key).toBe("symbol");
    expect(cols[cols.length - 1].key).toBe("sector");
  });
  it("move column + green - red dash for null", () => {
    const f = fmt(cols, moveKey);
    expect((f(2.5) as any).value).toBe("+2.50%");
    expect((f(2.5) as any).className).toBe("success");
    expect((f(-1) as any).className).toBe("error");
    expect((f(null) as any).value).toBe("-");
    expect((f(null) as any).className).toBe("");
    expect(() => f(NaN)).not.toThrow();
    expect(() => f(Infinity)).not.toThrow();
    expect((f(0) as any).className).toBe("success");
  });
  it("volume_surge formats", () => {
    const f = fmt(cols, "volume_surge");
    expect(f(1.5)).toBe("1.5x");
    expect(f(null)).toBe("1.0x");
    expect(f(0)).toBe("0.0x");
    expect(() => f(NaN)).not.toThrow();
  });
  it("rsi null -> 0.0", () => expect(fmt(cols, "rsi")(null)).toBe("0.0"));
  it("volume_m null -> 0.00", () => expect(fmt(cols, "volume_m")(null)).toBe("0.00"));
  it("day_change green/red", () => {
    expect((fmt(cols, "day_change")(1) as any).className).toBe("success");
    expect((fmt(cols, "day_change")(-1) as any).className).toBe("error");
  });
  it("all sortable", () => cols.forEach((c) => expect(c.sortable).toBe(true)));
});
