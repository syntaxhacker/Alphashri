import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MARKET_ROW_CAP, MARKET_SYMBOL_CAP, VALUE_ROW_CAP } from "./apiLimits";

const CAPS = [
  ["MARKET_ROW_CAP", MARKET_ROW_CAP],
  ["MARKET_SYMBOL_CAP", MARKET_SYMBOL_CAP],
  ["VALUE_ROW_CAP", VALUE_ROW_CAP],
] as const;

const source = (path: string): string => readFileSync(resolve(process.cwd(), path), "utf8");

describe("apiLimits", () => {
  for (const [name, value] of CAPS) {
    test(`${name} is a positive integer`, () => {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
    });
  }

  test("marketScreener imports the market caps", () => {
    const client = source("src/api/marketScreener.ts");
    expect(client).toMatch(/from ["'][^"']*config\/apiLimits["']/);
    expect(client).toContain("MARKET_ROW_CAP");
    expect(client).toContain("MARKET_SYMBOL_CAP");
  });

  test("valueScan imports the value row cap", () => {
    const client = source("src/api/valueScan.ts");
    expect(client).toMatch(/from ["'][^"']*config\/apiLimits["']/);
    expect(client).toContain("VALUE_ROW_CAP");
  });
});
