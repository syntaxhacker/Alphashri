import { describe, it, expect } from "vitest";
import {
  fixedOrDash,
  fixedOrZero,
  intLocaleOrDash,
  pctOrEmpty,
  rupeePrice,
  fixedCellDash,
  fixedCellOrString,
  signedPercent,
  signedFixed,
  tonePositive,
  pnlPctCell,
  signedPercentCell,
  gapTone,
  gapCell,
  daysAgoCell,
  numCol,
} from "./columnHelpers";

describe("fixedOrDash", () => {
  it.each([
    [12.345, 2, "12.35"],
    [0, 1, "0.0"],
    [null, 2, "-"],
    [undefined, 2, "-"],
    [NaN, 1, "NaN"],
  ] as const)("%s prec %s -> %s", (v, prec, exp) => {
    expect(fixedOrDash(v as any, prec)).toBe(exp);
  });
});

describe("fixedOrZero", () => {
  it.each([
    [12.345, 2, "12.35"],
    [0, 1, "0.0"],
    [null, 2, "0.00"],
    [undefined, 1, "0.0"],
  ] as const)("%s prec %s -> %s", (v, prec, exp) => {
    expect(fixedOrZero(v as any, prec)).toBe(exp);
  });
});

describe("intLocaleOrDash", () => {
  it("rounds and locale-groups", () => {
    expect(intLocaleOrDash(1234567)).toBe((1234567).toLocaleString());
    expect(intLocaleOrDash(0.4)).toBe("0");
    expect(intLocaleOrDash(0)).toBe("0");
  });
  it("null/undefined -> dash", () => {
    expect(intLocaleOrDash(null)).toBe("-");
    expect(intLocaleOrDash(undefined)).toBe("-");
  });
});

describe("pctOrEmpty", () => {
  it.each([
    [2.5, "2.5%"],
    [0, ""],
    [null, ""],
    [undefined, ""],
    [-1, ""],
  ] as const)("%s -> %s", (v, exp) => expect(pctOrEmpty(v as any)).toBe(exp));
});

describe("rupeePrice", () => {
  it.each([
    [2450.5, "₹2450.50"],
    [0, "₹0.00"],
    [null, "—"],
    [undefined, "—"],
  ] as const)("%s -> %s", (v, exp) => expect(rupeePrice(v as any)).toBe(exp));
});

describe("fixedCellDash", () => {
  it("formats with fixed decimals", () => {
    expect(fixedCellDash(2600, 2)).toEqual({ value: "2600.00" });
    expect(fixedCellDash(0, 2)).toEqual({ value: "0.00" });
  });
  it("null/undefined -> dash cell", () => {
    expect(fixedCellDash(null, 2)).toEqual({ value: "-" });
    expect(fixedCellDash(undefined, 2)).toEqual({ value: "-" });
  });
});

describe("fixedCellOrString", () => {
  it("formats a cell for numbers", () => {
    expect(fixedCellOrString(100, 2)).toEqual({ value: "100.00" });
  });
  it("returns a bare dash string for null/undefined", () => {
    expect(fixedCellOrString(null, 2)).toBe("-");
    expect(fixedCellOrString(undefined, 2)).toBe("-");
  });
});

describe("signedPercent", () => {
  it.each([
    [2.5, 2, "+2.50%"],
    [-1.25, 2, "-1.25%"],
    [0, 2, "0.00%"],
    [8.5, 1, "+8.5%"],
    [0, 1, "0.0%"],
  ] as const)("%s prec %s -> %s", (v, prec, exp) => {
    expect(signedPercent(v, prec)).toBe(exp);
  });
});

describe("signedFixed", () => {
  it("plus only above zero by default", () => {
    expect(signedFixed(2.5, 2)).toBe("+2.50");
    expect(signedFixed(0, 2)).toBe("0.00");
    expect(signedFixed(-1.3, 2)).toBe("-1.30");
  });
  it("plusAtZero includes zero", () => {
    expect(signedFixed(0, 2, true)).toBe("+0.00");
    expect(signedFixed(-1.3, 2, true)).toBe("-1.30");
  });
});

describe("tonePositive", () => {
  it("strictly positive -> success else error", () => {
    expect(tonePositive(1)).toBe("success");
    expect(tonePositive(0)).toBe("error");
    expect(tonePositive(-1)).toBe("error");
  });
});

describe("pnlPctCell", () => {
  it("formats signed 2dp percent with >=0 green tone", () => {
    expect(pnlPctCell(1.25)).toEqual({ value: "+1.25%", className: "success" });
    expect(pnlPctCell(0)).toEqual({ value: "+0.00%", className: "success" });
    expect(pnlPctCell(-0.5)).toEqual({ value: "-0.50%", className: "error" });
  });
});

describe("signedPercentCell", () => {
  it("formats signed percent with strictly-positive tone", () => {
    expect(signedPercentCell(1.5, 1)).toEqual({ value: "+1.5%", className: "success" });
    expect(signedPercentCell(0, 1)).toEqual({ value: "0.0%", className: "error" });
    expect(signedPercentCell(-3.2, 1)).toEqual({ value: "-3.2%", className: "error" });
  });
});

describe("gapTone", () => {
  it("below zero is success, above threshold is error, between is neutral", () => {
    expect(gapTone(-5.76, 2)).toBe("success");
    expect(gapTone(0, 2)).toBe("");
    expect(gapTone(2, 2)).toBe("");
    expect(gapTone(2.01, 2)).toBe("error");
    expect(gapTone(0.5, 0.5)).toBe("");
    expect(gapTone(0.51, 0.5)).toBe("error");
  });
});

describe("gapCell", () => {
  it("combines signed 2dp percent with the gap tone", () => {
    expect(gapCell(-5.76, 2)).toEqual({ value: "-5.76%", className: "success" });
    expect(gapCell(0.3, 2)).toEqual({ value: "+0.30%", className: "" });
    expect(gapCell(3.5, 2)).toEqual({ value: "+3.50%", className: "error" });
  });
});

describe("daysAgoCell", () => {
  it("dash on null/undefined", () => {
    expect(daysAgoCell(null)).toBe("-");
    expect(daysAgoCell(undefined)).toBe("-");
  });
  it("renders n-days suffix by default", () => {
    expect(daysAgoCell(0)).toEqual({ value: "0d" });
    expect(daysAgoCell(1)).toEqual({ value: "1d" });
    expect(daysAgoCell(30)).toEqual({ value: "30d" });
  });
  it("renders the today label for 0 when provided", () => {
    expect(daysAgoCell(0, "Today")).toEqual({ value: "Today" });
    expect(daysAgoCell(1, "Today")).toEqual({ value: "1d" });
  });
});

describe("numCol", () => {
  it("builds a sortable number column with optional format", () => {
    const bare = numCol("foo", "Foo");
    expect(bare).toEqual({ key: "foo", label: "Foo", type: "number", sortable: true });
    expect(bare.format).toBeUndefined();
    const withFmt = numCol("bar", "Bar", (v: number) => `${v}!`);
    expect(withFmt.type).toBe("number");
    expect(withFmt.format!(42 as any, {} as any)).toBe("42!");
  });
});
