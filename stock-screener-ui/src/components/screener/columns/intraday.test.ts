import { describe, it, expect } from "vitest";
import { getIntraday5mColumns, getIntraday10mColumns, getIntraday15mColumns } from "./intraday";
import { cellOf, cellText } from "./columnTestFixtures";

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
    expect(cellText(() => fmt(cols, moveKey)(2.5))).toBe("+2.50%");
    expect(cellOf(() => fmt(cols, moveKey)(2.5)).tone).toBe("success");
    expect(cellOf(() => fmt(cols, moveKey)(-1)).tone).toBe("error");
    expect(cellText(() => fmt(cols, moveKey)(null))).toBe("-");
    expect(cellOf(() => fmt(cols, moveKey)(null)).tone).toBe("");
    expect(() => cellText(() => fmt(cols, moveKey)(NaN))).not.toThrow();
    expect(() => cellText(() => fmt(cols, moveKey)(Infinity))).not.toThrow();
    expect(cellOf(() => fmt(cols, moveKey)(0)).tone).toBe("success");
  });
  it("volume_surge formats", () => {
    expect(cellText(() => fmt(cols, "volume_surge")(1.5))).toBe("1.5x");
    expect(cellText(() => fmt(cols, "volume_surge")(null))).toBe("1.0x");
    expect(cellText(() => fmt(cols, "volume_surge")(0))).toBe("0.0x");
    expect(() => cellText(() => fmt(cols, "volume_surge")(NaN))).not.toThrow();
  });
  it("rsi null -> 0.0", () => expect(cellText(() => fmt(cols, "rsi")(null))).toBe("0.0"));
  it("volume_m null -> 0.00", () =>
    expect(cellText(() => fmt(cols, "volume_m")(null))).toBe("0.00"));
  it("day_change green/red", () => {
    expect(cellOf(() => fmt(cols, "day_change")(1)).tone).toBe("success");
    expect(cellOf(() => fmt(cols, "day_change")(-1)).tone).toBe("error");
  });
  it("all sortable", () => cols.forEach((c) => expect(c.sortable).toBe(true)));
});
