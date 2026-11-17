import { describe, expect, test } from "vitest";
import { isNonEmptyString, isRecord, parseStringList } from "./persistedConfig";

describe("isRecord", () => {
  test("accepts plain objects only", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord(Object.create(null))).toBe(true);
  });

  test("rejects null, arrays and primitives", () => {
    expect(isRecord(null)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord([])).toBe(false);
    expect(isRecord([1, 2])).toBe(false);
    expect(isRecord("{}")).toBe(false);
    expect(isRecord(42)).toBe(false);
    expect(isRecord(true)).toBe(false);
  });

  test("narrows the value to a string-keyed record", () => {
    const raw: unknown = { sort: "mcap_desc" };
    if (isRecord(raw)) {
      expect(raw.sort).toBe("mcap_desc");
    } else {
      throw new Error("expected a record");
    }
  });
});

describe("isNonEmptyString", () => {
  test("accepts strings with a non-whitespace character", () => {
    expect(isNonEmptyString("a")).toBe(true);
    expect(isNonEmptyString(" IT ")).toBe(true);
  });

  test("rejects blanks, non-strings and nullish values", () => {
    expect(isNonEmptyString("")).toBe(false);
    expect(isNonEmptyString("   ")).toBe(false);
    expect(isNonEmptyString("\t\n")).toBe(false);
    expect(isNonEmptyString(1)).toBe(false);
    expect(isNonEmptyString(null)).toBe(false);
    expect(isNonEmptyString(undefined)).toBe(false);
    expect(isNonEmptyString({})).toBe(false);
  });
});

describe("parseStringList", () => {
  test("a non-array payload degrades to an empty list", () => {
    expect(parseStringList(undefined)).toEqual([]);
    expect(parseStringList(null)).toEqual([]);
    expect(parseStringList("a,b")).toEqual([]);
    expect(parseStringList({ 0: "a" })).toEqual([]);
    expect(parseStringList(42)).toEqual([]);
  });

  test("ignores non-strings and blank strings", () => {
    expect(parseStringList(["a", 1, null, undefined, {}, [], "", "  ", "\t"])).toEqual(["a"]);
  });

  test("dedupes case-sensitively in first-seen order", () => {
    expect(parseStringList(["a", "b", "a", "B", "b"])).toEqual(["a", "b", "B"]);
  });

  test("keeps entries verbatim — trimming only detects blanks", () => {
    expect(parseStringList([" IT ", "IT", " Energy"])).toEqual([" IT ", "IT", " Energy"]);
  });

  test("no length cap: a long saved list round-trips intact", () => {
    const list = Array.from({ length: 500 }, (_, i) => `sector-${i}`);
    expect(parseStringList(list)).toEqual(list);
  });

  test("an empty array stays empty", () => {
    expect(parseStringList([])).toEqual([]);
  });
});
