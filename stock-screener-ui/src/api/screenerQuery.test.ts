import { describe, it, expect } from "vitest";
import { API_BASE } from "@/api/config";
import {
  SCREENER_API_URL,
  SCREENER_DEFAULT_MODE,
  SCREENER_DEFAULT_PROVIDER,
  approachingStocksOf,
  buildScreenerApiUrl,
  buildScreenerPreviewUrl,
  createBaseSearchParams,
  isEmptyFilterValue,
  normalizeScreenerId,
  touchedStocksOf,
} from "./screenerQuery";

const QUERY = (url: string) => url.slice(url.indexOf("?") + 1);

describe("normalizeScreenerId", () => {
  it("strips a leading builtin: prefix", () => {
    expect(normalizeScreenerId("builtin:52w_high")).toBe("52w_high");
  });

  it("leaves plain ids unchanged", () => {
    expect(normalizeScreenerId("52w_high")).toBe("52w_high");
  });

  it("only strips the prefix, not a mid-string occurrence", () => {
    expect(normalizeScreenerId("x_builtin:y")).toBe("x_builtin:y");
  });
});

describe("isEmptyFilterValue", () => {
  it("treats undefined, null and empty string as empty", () => {
    expect(isEmptyFilterValue(undefined)).toBe(true);
    expect(isEmptyFilterValue(null)).toBe(true);
    expect(isEmptyFilterValue("")).toBe(true);
  });

  it("keeps zero and false", () => {
    expect(isEmptyFilterValue(0)).toBe(false);
    expect(isEmptyFilterValue(false)).toBe(false);
    expect(isEmptyFilterValue("0")).toBe(false);
  });
});

describe("createBaseSearchParams", () => {
  it("sets provider, mode, screener in that order", () => {
    const p = createBaseSearchParams({ provider: "indmoney", mode: "historical", screener: "trending" });
    expect(p.toString()).toBe("provider=indmoney&mode=historical&screener=trending");
  });

  it("falls back to upstox/intraday defaults", () => {
    const p = createBaseSearchParams({ screener: "trending" });
    expect(p.toString()).toBe("provider=upstox&mode=intraday&screener=trending");
    expect(SCREENER_DEFAULT_PROVIDER).toBe("upstox");
    expect(SCREENER_DEFAULT_MODE).toBe("intraday");
  });

  it("strips builtin: prefix only when asked", () => {
    expect(createBaseSearchParams({ screener: "builtin:x" }).toString()).toBe(
      "provider=upstox&mode=intraday&screener=builtin%3Ax",
    );
    expect(
      createBaseSearchParams({ screener: "builtin:x", stripBuiltinPrefix: true }).toString(),
    ).toBe("provider=upstox&mode=intraday&screener=x");
  });
});

describe("buildScreenerApiUrl", () => {
  it("pins the exact query string for representative params", () => {
    const url = buildScreenerApiUrl({
      provider: "upstox",
      mode: "intraday",
      screener: "builtin:top_gainers",
      filters: { min_price: 100, limit: 25, active: true },
    });
    expect(url).toBe(
      `${API_BASE}/api/screener?provider=upstox&mode=intraday&screener=builtin%3Atop_gainers&min_price=100&limit=25&active=true`,
    );
  });

  it("pins defaults when provider/mode are omitted", () => {
    expect(buildScreenerApiUrl({ screener: "builtin:52w_high" })).toBe(
      `${API_BASE}/api/screener?provider=upstox&mode=intraday&screener=builtin%3A52w_high`,
    );
  });

  it("drops undefined/null/empty-string filters but keeps 0 and false", () => {
    const url = buildScreenerApiUrl({
      screener: "s",
      filters: { a: undefined, b: null, c: "", d: 0, e: false, f: "ok" },
    });
    expect(QUERY(url)).toBe("provider=upstox&mode=intraday&screener=s&d=0&e=false&f=ok");
  });

  it("uses the bare screener endpoint constant", () => {
    expect(SCREENER_API_URL).toBe(`${API_BASE}/api/screener`);
  });
});

describe("buildScreenerPreviewUrl", () => {
  it("pins the exact query string with columns and filter defaults", () => {
    const url = buildScreenerPreviewUrl({
      screener: "builtin:top_gainers",
      columns: ["price", "volume"],
      filters: [
        { key: "min_price", default: 50 },
        { key: "empty", default: undefined },
      ],
    });
    expect(url).toBe(
      `${API_BASE}/api/screener?provider=upstox&mode=intraday&screener=top_gainers&columns=price%2Cvolume&min_price=50`,
    );
  });

  it("pins the exact query string with no columns and no filters", () => {
    expect(buildScreenerPreviewUrl({ screener: "builtin:x" })).toBe(
      `${API_BASE}/api/screener?provider=upstox&mode=intraday&screener=x`,
    );
  });

  it("omits columns when the array is empty", () => {
    expect(buildScreenerPreviewUrl({ screener: "x", columns: [] })).not.toContain("columns=");
  });

  it("keeps falsy-but-defined filter defaults such as 0 and false", () => {
    const url = buildScreenerPreviewUrl({
      screener: "x",
      filters: [
        { key: "min", default: 0 },
        { key: "flag", default: false },
      ],
    });
    expect(QUERY(url)).toBe("provider=upstox&mode=intraday&screener=x&min=0&flag=false");
  });

  it("ignores non-array filter input instead of crashing", () => {
    const url = buildScreenerPreviewUrl({
      screener: "x",
      filters: { foo: "bar" } as unknown as never,
    });
    expect(QUERY(url)).toBe("provider=upstox&mode=intraday&screener=x");
  });
});

describe("approachingStocksOf / touchedStocksOf", () => {
  const stocks = [{ symbol: "INFY" } as any];

  it("returns the arrays when present", () => {
    expect(approachingStocksOf({ approaching: stocks, touched: [] } as any)).toBe(stocks);
    expect(touchedStocksOf({ approaching: [], touched: stocks } as any)).toBe(stocks);
  });

  it("falls back to empty arrays for nullish data or missing arrays", () => {
    expect(approachingStocksOf(null)).toEqual([]);
    expect(approachingStocksOf(undefined)).toEqual([]);
    expect(touchedStocksOf(null)).toEqual([]);
    expect(approachingStocksOf({} as any)).toEqual([]);
    expect(touchedStocksOf({} as any)).toEqual([]);
  });
});
