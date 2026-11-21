import { describe, expect, it } from "vitest";
import { finiteNumber, finiteText } from "./wireParse";

describe("finiteNumber", () => {
  it("parses finite numbers and numeric strings, including padded and exponent forms", () => {
    expect(finiteNumber(42)).toBe(42);
    expect(finiteNumber(-0.5)).toBe(-0.5);
    expect(finiteNumber(" 123.45 ")).toBe(123.45);
    expect(finiteNumber("1e3")).toBe(1000);
  });

  it("keeps NaN, infinities and nullish/garbage values null — never 0", () => {
    expect(finiteNumber(Number.NaN)).toBeNull();
    expect(finiteNumber(Number.POSITIVE_INFINITY)).toBeNull();
    expect(finiteNumber(Number.NEGATIVE_INFINITY)).toBeNull();
    expect(finiteNumber(null)).toBeNull();
    expect(finiteNumber(undefined)).toBeNull();
    expect(finiteNumber("")).toBeNull();
    expect(finiteNumber("   ")).toBeNull();
    expect(finiteNumber("n/a")).toBeNull();
    expect(finiteNumber(true)).toBeNull();
    expect(finiteNumber({})).toBeNull();
  });
});

describe("finiteText", () => {
  it("keeps non-blank strings unchanged so callers can trim/case-fold", () => {
    expect(finiteText("RELIANCE")).toBe("RELIANCE");
    expect(finiteText("  Reliance  ")).toBe("  Reliance  ");
  });

  it("rejects blank strings, numbers and nullish values", () => {
    expect(finiteText("")).toBeNull();
    expect(finiteText("   ")).toBeNull();
    expect(finiteText(5)).toBeNull();
    expect(finiteText(Number.NaN)).toBeNull();
    expect(finiteText(Number.POSITIVE_INFINITY)).toBeNull();
    expect(finiteText(null)).toBeNull();
    expect(finiteText(undefined)).toBeNull();
  });
});
