import { describe, expect, test } from "vitest";
import { PCR_BEARISH_MAX, PCR_BULLISH_MIN, pcrTone } from "./optionsMath";

describe("pcrTone", () => {
  test("is bullish only above the shared upper cutoff", () => {
    expect(pcrTone(PCR_BULLISH_MIN + 0.01)).toBe("bullish");
    expect(pcrTone(2)).toBe("bullish");
  });

  test("is bearish only below the shared lower cutoff", () => {
    expect(pcrTone(PCR_BEARISH_MAX - 0.01)).toBe("bearish");
    expect(pcrTone(0.2)).toBe("bearish");
  });

  test("is neutral between the cutoffs and at both boundaries", () => {
    expect(pcrTone(PCR_BEARISH_MAX)).toBe("neutral");
    expect(pcrTone(1)).toBe("neutral");
    expect(pcrTone(PCR_BULLISH_MIN)).toBe("neutral");
  });

  test("treats missing and non-finite PCR as neutral", () => {
    expect(pcrTone(null)).toBe("neutral");
    expect(pcrTone(undefined)).toBe("neutral");
    expect(pcrTone(Number.NaN)).toBe("neutral");
    expect(pcrTone(Number.POSITIVE_INFINITY)).toBe("neutral");
  });
});
