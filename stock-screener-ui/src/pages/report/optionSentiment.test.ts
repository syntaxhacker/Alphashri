// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";
import {
  sentimentCode,
  sentimentLabel,
  sentimentNote,
  sentimentSign,
} from "./optionSentiment";

describe("sentimentCode", () => {
  test("accepts the 2-letter code, the full class name and casing", () => {
    expect(sentimentCode("SC")).toBe("SC");
    expect(sentimentCode(" sc ")).toBe("SC");
    expect(sentimentCode("Short Cover")).toBe("SC");
    expect(sentimentCode("SHORT COVERING")).toBe("SC");
    expect(sentimentCode("Long Unwinding")).toBe("LU");
    expect(sentimentCode("Neutral")).toBe("");
    expect(sentimentCode(null)).toBe("");
  });
});

describe("sentimentSign", () => {
  test("matches the backend class_sign map on both sides", () => {
    const bullish = [
      ["LB", "CE"],
      ["SC", "CE"],
      ["SB", "PE"],
      ["LU", "PE"],
    ] as const;
    const bearish = [
      ["SB", "CE"],
      ["LU", "CE"],
      ["LB", "PE"],
      ["SC", "PE"],
    ] as const;
    for (const [code, side] of bullish) expect(sentimentSign(code, side)).toBe(1);
    for (const [code, side] of bearish) expect(sentimentSign(code, side)).toBe(-1);
    expect(sentimentSign("Neutral", "PE")).toBe(0);
    expect(sentimentSign("", "CE")).toBe(0);
  });

  test("puts on the full label resolve to the same sign as the code", () => {
    expect(sentimentSign("Short Cover", "PE")).toBe(-1);
    expect(sentimentSign("Long Unwinding", "PE")).toBe(1);
    expect(sentimentSign("Short Covering", "CE")).toBe(1);
  });
});

describe("sentimentLabel + sentimentNote", () => {
  test("label prefers the canonical full name and keeps unknown text", () => {
    expect(sentimentLabel("SC")).toBe("Short Cover");
    expect(sentimentLabel("Short Cover")).toBe("Short Cover");
    expect(sentimentLabel("Bullish")).toBe("Bullish");
    expect(sentimentLabel("")).toBe("");
  });

  test("note states the action and the delta-exposure direction", () => {
    expect(sentimentNote("SC", "PE")).toBe(
      "put writers buying back · adds/supports short delta — bearish",
    );
    expect(sentimentNote("LU", "PE")).toBe(
      "put buyers selling out · adds/supports long delta — bullish",
    );
    expect(sentimentNote("Neutral", "CE")).toBe("unclassified flow");
  });
});
