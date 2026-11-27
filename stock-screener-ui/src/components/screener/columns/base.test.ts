import { describe, it, expect } from "vitest";
import {
  symbolCol,
  scoreCol,
  dayChangeCol,
  volumeMCol,
  rsiCol,
  adxCol,
  touched52wCol,
  volumeSurgeCol,
  moveCol,
  recentReturn5dCol,
  perfWCol,
} from "./base";
import { cellOf, cellText } from "./columnTestFixtures";

describe("base columns", () => {
  it("symbolCol structure", () => {
    expect(symbolCol.key).toBe("symbol");
    expect(symbolCol.type).toBe("string");
    expect(symbolCol.sortable).toBe(true);
  });
  it("scoreCol badge", () => {
    expect(scoreCol.type).toBe("badge");
  });

  describe("dayChangeCol", () => {
    const fmt = dayChangeCol.format!;
    it.each([
      [1.25, "+1.25%", "success"],
      [-0.5, "-0.50%", "error"],
      [0, "+0.00%", "success"],
    ])("value %s -> %s %s", (val, expVal, expTone) => {
      const cell = cellOf(() => fmt(val, {} as any));
      expect(cell.text).toBe(expVal);
      expect(cell.tone).toBe(expTone);
    });
    it("numbers are mono tabular and right aligned", () => {
      const cell = cellOf(() => fmt(1.25, {} as any));
      expect(cell.className).toContain("font-mono");
      expect(cell.className).toContain("tabular-nums");
      expect(cell.className).toContain("text-right");
    });
    it("NaN/Infinity render the dash instead of NaN%", () => {
      expect(cellText(() => fmt(NaN as any, {} as any))).toBe("—");
      expect(cellText(() => fmt(Infinity, {} as any))).toBe("—");
      expect(cellText(() => fmt(-Infinity, {} as any))).toBe("—");
    });
  });

  describe("volumeMCol", () => {
    const fmt = volumeMCol.format!;
    it.each([
      [12.345, "12.35"],
      [0, "0.00"],
      [null, "0.00"],
      [undefined, "0.00"],
    ])("volumeM %s -> %s", (val, exp) =>
      expect(cellText(() => fmt(val as any, {} as any))).toBe(exp),
    );
    it("Infinity -> dash", () => expect(cellText(() => fmt(Infinity as any, {} as any))).toBe("—"));
  });

  describe("rsiCol / adxCol", () => {
    it.each([
      [rsiCol, 65.3, "65.3"],
      [rsiCol, null, "0.0"],
      [adxCol, 30.123, "30.1"],
      [adxCol, undefined, "0.0"],
    ])("%s", (col, val, exp) => {
      expect(cellText(() => col.format!(val as any, {} as any))).toBe(exp);
    });
    it("NaN -> dash", () =>
      expect(cellText(() => rsiCol.format!(NaN as any, {} as any))).toBe("—"));
    it("Infinity -> dash", () =>
      expect(cellText(() => rsiCol.format!(Infinity as any, {} as any))).toBe("—"));
  });

  describe("touched52wCol", () => {
    const fmt = touched52wCol.format!;
    it("false -> No badge", () => {
      const cell = cellOf(() => fmt(false as any, {} as any));
      expect(cell.text).toBe("No");
    });
    it("true without last_touched -> Yes badge", () => {
      expect(cellText(() => fmt(true as any, {} as any))).toBe("Yes");
    });
    it("true with last_touched -> tooltip carrying the full date", () => {
      const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString();
      const cell = cellOf(() => fmt(true as any, { last_touched: twoDaysAgo } as any));
      expect(cell.text).toContain("Yes");
      expect(cell.text).toContain("2d ago");
      const labelled = document.body.querySelector("[aria-label^='Touched on']");
      expect(labelled?.getAttribute("aria-label")).toContain("Touched on");
    });
    it("handles missing stock object", () =>
      expect(cellText(() => fmt(true as any, null as any))).toBe("Yes"));
  });

  describe("volumeSurgeCol", () => {
    const fmt = volumeSurgeCol.format!;
    it.each([
      [1.5, "1.5x"],
      [null, "1.0x"],
      [undefined, "1.0x"],
      [0, "0.0x"],
    ])("surge %s -> %s", (val, exp) =>
      expect(cellText(() => fmt(val as any, {} as any))).toBe(exp),
    );
    it("Infinity -> dash", () => expect(cellText(() => fmt(Infinity as any, {} as any))).toBe("—"));
  });

  describe("moveCol", () => {
    const col = moveCol("move_5m", "5-Min Move");
    it("keys/label correct", () => {
      expect(col.key).toBe("move_5m");
      expect(col.label).toBe("5-Min Move");
      expect(col.sortable).toBe(true);
    });
    it.each([
      [2.5, "+2.50%", "success"],
      [-1.2, "-1.20%", "error"],
      [0, "0.00%", "success"],
    ])("move %s", (val, expVal, expTone) => {
      const cell = cellOf(() => col.format!(val as any, {} as any));
      expect(cell.text).toBe(expVal);
      expect(cell.tone).toBe(expTone);
    });
    it("null -> dash", () => {
      const cell = cellOf(() => col.format!(null as any, {} as any));
      expect(cell.text).toBe("-");
      expect(cell.tone).toBe("");
    });
    it("NaN handled", () => {
      expect(cellText(() => col.format!(NaN as any, {} as any))).toBe("-");
    });
  });

  describe("recentReturn5dCol", () => {
    const fmt = recentReturn5dCol.format!;
    it.each([
      [8.5, "🚀 +8.5%", "success"],
      [3.2, "🟢 +3.2%", "success"],
      [-2.1, "🔴 -2.1%", "error"],
      [0, "🔴 0.0%", "error"],
      [5, "🟢 +5.0%", "success"],
      [5.01, "🚀 +5.0%", "success"],
    ])("return %s", (val, expVal, expTone) => {
      const cell = cellOf(() => fmt(val as any, {} as any));
      expect(cell.text).toBe(expVal);
      expect(cell.tone).toBe(expTone);
    });
    it("NaN -> dash", () => expect(cellText(() => fmt(NaN as any, {} as any))).toBe("—"));
  });

  describe("perfWCol", () => {
    const fmt = perfWCol.format!;
    it.each([
      [1.5, "+1.5%", "success"],
      [-3.2, "-3.2%", "error"],
      [0, "0.0%", "error"],
    ])("perf %s -> %s", (val, expVal, expTone) => {
      const cell = cellOf(() => fmt(val as any, {} as any));
      expect(cell.text).toBe(expVal);
      expect(cell.tone).toBe(expTone);
    });
    it("NaN -> dash", () => expect(cellText(() => fmt(NaN as any, {} as any))).toBe("—"));
  });
});
