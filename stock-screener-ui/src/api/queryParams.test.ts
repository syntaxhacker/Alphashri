import { describe, it, expect, vi } from "vitest";

vi.mock("../state/auth", () => ({
  fetchWithAuth: vi.fn(),
}));

import {
  appendAll,
  appendParams,
  buildQueryString,
  normalizeFilterArray,
  normalizeSymbolList,
} from "./queryParams";
import { buildPatternsQuery, buildWatchQuery } from "./chartPatterns";

describe("normalizeFilterArray", () => {
  it("trims, drops empties and de-duplicates preserving first occurrence", () => {
    expect(normalizeFilterArray([" reversal ", "curve_cup", "reversal", "", "  "])).toEqual([
      "reversal",
      "curve_cup",
    ]);
  });

  it("splits a raw string on whitespace/commas/semicolons/pipes", () => {
    expect(normalizeFilterArray("reversal, curve_cup;flag|wedge  bull_flag")).toEqual([
      "reversal",
      "curve_cup",
      "flag",
      "wedge",
      "bull_flag",
    ]);
  });

  it("keeps case by default and upper-cases with the option", () => {
    expect(normalizeFilterArray(["Nifty500", "NIFTY500"])).toEqual(["Nifty500", "NIFTY500"]);
    expect(normalizeFilterArray(["nifty500", "NIFTY500"], { upper: true })).toEqual(["NIFTY500"]);
  });

  it("returns [] for null/undefined and non-string values become strings", () => {
    expect(normalizeFilterArray(null)).toEqual([]);
    expect(normalizeFilterArray(undefined)).toEqual([]);
    expect(normalizeFilterArray([1, 2, null, undefined] as unknown[])).toEqual(["1", "2"]);
  });
});

describe("normalizeSymbolList", () => {
  it("parses a delimited string with spaces and commas, upper-casing and de-duping", () => {
    expect(normalizeSymbolList("SBIN, TCS , infy; TCS|sbin")).toEqual(["SBIN", "TCS", "INFY"]);
  });

  it("accepts an array (store path) without splitting elements", () => {
    expect(normalizeSymbolList([" bse ", "INFY", "BSE", ""])).toEqual(["BSE", "INFY"]);
    expect(normalizeSymbolList(["SBIN, TCS"])).toEqual(["SBIN, TCS"]);
  });

  it("returns [] for empty/nullish input", () => {
    expect(normalizeSymbolList("")).toEqual([]);
    expect(normalizeSymbolList(null)).toEqual([]);
    expect(normalizeSymbolList(undefined)).toEqual([]);
    expect(normalizeSymbolList([])).toEqual([]);
  });

  it("feeds the results query builder element-wise", () => {
    expect(buildPatternsQuery({ symbols: normalizeSymbolList("sbin, tcs, INFY") })).toBe(
      "?symbol=SBIN&symbol=TCS&symbol=INFY",
    );
  });
});

describe("appendAll", () => {
  it("appends element-wise and is null-safe", () => {
    const params = new URLSearchParams();
    appendAll(params, "family", ["reversal", "curve_cup"]);
    appendAll(params, "status", null);
    appendAll(params, "status", undefined);
    appendAll(params, "status", []);
    expect(params.getAll("family")).toEqual(["reversal", "curve_cup"]);
    expect(params.getAll("status")).toEqual([]);
  });
});

describe("appendParams", () => {
  it("sets non-empty strings, appends arrays, keeps 0/false, skips null/undefined/empty", () => {
    const params = new URLSearchParams();
    appendParams(params, [
      ["a", "x"],
      ["b", ""],
      ["c", 0],
      ["d", false],
      ["e", null],
      ["f", undefined],
      ["g", ["one", "two"]],
      ["g", ["three"]],
      ["h", true],
    ]);
    expect(params.get("a")).toBe("x");
    expect(params.get("b")).toBeNull();
    expect(params.get("c")).toBe("0");
    expect(params.get("d")).toBe("false");
    expect(params.get("e")).toBeNull();
    expect(params.get("f")).toBeNull();
    expect(params.getAll("g")).toEqual(["one", "two", "three"]);
    expect(params.get("h")).toBe("true");
  });

  it("sets (not appends) repeated scalar keys in spec order", () => {
    const params = new URLSearchParams();
    appendParams(params, [
      ["k", "first"],
      ["k", "second"],
    ]);
    expect(params.get("k")).toBe("second");
    expect(params.getAll("k")).toEqual(["second"]);
  });
});

describe("buildQueryString", () => {
  it("returns '' when nothing serializes and '?…' otherwise", () => {
    expect(buildQueryString([])).toBe("");
    expect(buildQueryString([["a", null], ["b", ""]])).toBe("");
    expect(buildQueryString([["a", "1"], ["b", "two words"]])).toBe("?a=1&b=two+words");
  });
});

describe("buildPatternsQuery exact strings", () => {
  it("serializes an empty query to ''", () => {
    expect(buildPatternsQuery({})).toBe("");
    expect(buildPatternsQuery({ job_id: undefined, limit: undefined, offset: undefined })).toBe("");
    expect(buildPatternsQuery({ quality: undefined, sort: undefined })).toBe("");
  });

  it("serializes a single filter", () => {
    expect(buildPatternsQuery({ universe: "nifty500" })).toBe("?universe=nifty500");
    expect(buildPatternsQuery({ timeframe: "1D" })).toBe("?timeframe=1D");
  });

  it("serializes multi-value arrays element-wise, in order", () => {
    expect(
      buildPatternsQuery({ family: ["reversal", "curve_cup"], status: ["confirmed", "forming"] }),
    ).toBe("?family=reversal&family=curve_cup&status=confirmed&status=forming");
  });

  it("serializes the singular then the repeated symbol keys", () => {
    expect(buildPatternsQuery({ symbol: "IRCON", symbols: ["SBIN", "TCS"], q: "bank" })).toBe(
      "?symbol=IRCON&symbol=SBIN&symbol=TCS&q=bank",
    );
  });

  it("keeps volume_confirmed=false and lookback_bars=0", () => {
    expect(buildPatternsQuery({ volume_confirmed: false })).toBe("?volume_confirmed=false");
    expect(buildPatternsQuery({ lookback_bars: 0 })).toBe("?lookback_bars=0");
    expect(buildPatternsQuery({ min_rr: 0 })).toBe("?min_rr=0");
  });

  it("omits the default sort but passes other sorts through untouched", () => {
    expect(buildPatternsQuery({ sort: "confidence" })).toBe("");
    expect(buildPatternsQuery({ sort: "newest" })).toBe("?sort=newest");
    expect(buildPatternsQuery({ sort: "distance" })).toBe("?sort=distance");
  });

  it("serializes compute_trendlines only when explicitly false", () => {
    expect(buildPatternsQuery({ compute_trendlines: false })).toBe("?compute_trendlines=0");
    expect(buildPatternsQuery({ compute_trendlines: true })).toBe("");
    expect(buildPatternsQuery({})).toBe("");
  });

  it("pins the full representative query string byte-for-byte", () => {
    expect(
      buildPatternsQuery({
        job_id: "cpj_9",
        universe: "nifty500",
        timeframe: "1D",
        lookback_bars: 250,
        family: ["reversal", "curve_cup"],
        pattern_id: ["double_bottom"],
        direction: ["bullish"],
        status: ["confirmed", "forming"],
        quality: "strong",
        formed_within_bars: 5,
        volume_confirmed: true,
        min_rr: 1.5,
        min_base_days: 30,
        max_range_pct: 20,
        max_52w_gap: 5,
        min_range_pos: 80,
        symbol: "IRCON",
        symbols: ["SBIN", "TCS"],
        q: "bank",
        from_date: "2026-06-01",
        to_date: "2026-09-30T14:30",
        sort: "newest",
        compute_trendlines: false,
        limit: 200,
        offset: 0,
      }),
    ).toBe(
      "?job_id=cpj_9&universe=nifty500&timeframe=1D&lookback_bars=250" +
        "&family=reversal&family=curve_cup" +
        "&pattern_id=double_bottom&direction=bullish&status=confirmed&status=forming" +
        "&quality=strong&formed_within_bars=5&volume_confirmed=true&min_rr=1.5" +
        "&min_base_days=30&max_range_pct=20&max_52w_gap=5&min_range_pos=80" +
        "&symbol=IRCON&symbol=SBIN&symbol=TCS&q=bank" +
        "&from_date=2026-06-01&to_date=2026-09-30T14%3A30" +
        "&sort=newest&compute_trendlines=0&limit=200&offset=0",
    );
  });
});

describe("buildWatchQuery exact strings", () => {
  it("serializes empty, single and full watch queries", () => {
    expect(buildWatchQuery({ setup: "", universe: "", timeframe: "" })).toBe("");
    expect(buildWatchQuery({ setup: "base", universe: "nifty500", timeframe: "1D" })).toBe(
      "?setup=base&universe=nifty500&timeframe=1D",
    );
    expect(
      buildWatchQuery({
        setup: "base",
        universe: "nifty500",
        timeframe: "1D",
        minBaseDays: 30,
        minRelVolume: 1.5,
      }),
    ).toBe("?setup=base&universe=nifty500&timeframe=1D&min_base_days=30&min_rel_volume=1.5");
    expect(
      buildWatchQuery({ setup: "base", universe: "nifty500", timeframe: "1D", minBaseDays: 0 }),
    ).toBe("?setup=base&universe=nifty500&timeframe=1D&min_base_days=0");
  });
});
