import { describe, expect, test } from "vitest";
import type { ChainRow, ChainSide } from "./optionChainMetrics";
import {
  chainSummary,
  formatLegChange,
  oiChangePct,
  rowFlags,
  sortChainRows,
} from "./optionChainMetrics";

const MINUS = "−";

function leg(overrides: Partial<ChainSide> = {}): ChainSide {
  return {
    ltp: 100,
    close_price: 100,
    oi: 0,
    prev_oi: 0,
    oi_change: 0,
    volume: 0,
    sentiment: { label: "Neutral" },
    ...overrides,
  };
}

function row(
  strike: number,
  ce: Partial<ChainSide> = {},
  pe: Partial<ChainSide> = {},
): ChainRow {
  return { strike, ce: leg(ce), pe: leg(pe) };
}

describe("formatLegChange", () => {
  test("reports the desk example in points and percent", () => {
    const change = formatLegChange({ ltp: 2476, close_price: 2584.55 });
    expect(change.points).toBeCloseTo(-108.55, 6);
    expect(change.pct).toBeCloseTo(-4.1999, 3);
    expect(change.label).toBe(`${MINUS}108.55 (${MINUS}4.2%)`);
  });

  test("prefixes gains with a plus sign", () => {
    const change = formatLegChange({ ltp: 112.4, close_price: 100 });
    expect(change.points).toBeCloseTo(12.4, 6);
    expect(change.pct).toBeCloseTo(12.4, 6);
    expect(change.label).toBe("+12.40 (+12.4%)");
  });

  test("close_price 0 keeps the points move but reports —%", () => {
    const change = formatLegChange({ ltp: 12.5, close_price: 0 });
    expect(change.points).toBeCloseTo(12.5, 6);
    expect(change.pct).toBe(0);
    expect(change.label).toBe("+12.50 (—%)");
  });

  test("missing close behaves like a zero close", () => {
    const change = formatLegChange({ ltp: 12.5 });
    expect(change.points).toBeCloseTo(12.5, 6);
    expect(change.pct).toBe(0);
    expect(change.label).toBe("+12.50 (—%)");
  });

  test("a flat leg renders without a signed zero", () => {
    const change = formatLegChange({ ltp: 75, close_price: 75 });
    expect(change.points).toBe(0);
    expect(change.pct).toBe(0);
    expect(change.label).toBe("0.00 (0.0%)");
    expect(change.label).not.toContain(MINUS);
  });

  test("accepts the camel-case close alias", () => {
    const change = formatLegChange({ ltp: 90, close: 100 });
    expect(change.points).toBeCloseTo(-10, 6);
    expect(change.label).toBe(`${MINUS}10.00 (${MINUS}10.0%)`);
  });
});

describe("oiChangePct", () => {
  test("divides today's build by yesterday's OI", () => {
    expect(oiChangePct({ oi: 1200, oi_change: 200 })).toBeCloseTo(20, 6);
  });

  test("uses the camel-case ΔOI alias", () => {
    expect(oiChangePct({ oi: 1000, oiChange: 100 })).toBeCloseTo(11.1111, 3);
  });

  test("a flat day is 0%, not null", () => {
    expect(oiChangePct({ oi: 500, oi_change: 0 })).toBe(0);
  });

  test("clamps the base to 1 when yesterday's OI is zero", () => {
    expect(oiChangePct({ oi: 100, oi_change: 100 })).toBeCloseTo(10000, 6);
  });

  test("returns null when oi is missing", () => {
    expect(oiChangePct({ oi_change: 500 })).toBeNull();
  });

  test("returns null when oi_change is missing", () => {
    expect(oiChangePct({ oi: 500 })).toBeNull();
  });

  test("returns null for non-finite inputs", () => {
    expect(oiChangePct({ oi: Number.NaN, oi_change: 10 })).toBeNull();
    expect(oiChangePct({ oi: 500, oi_change: Number.POSITIVE_INFINITY })).toBeNull();
  });

  test("returns null for an empty leg", () => {
    expect(oiChangePct({})).toBeNull();
  });
});

describe("rowFlags", () => {
  const walls = {
    calls: [{ strike: 23000 }, { strike: 23500 }],
    puts: [{ strike: 22500 }],
  };

  test("marks the strikes within half a step of spot as ATM", () => {
    expect(rowFlags(row(22750), 22738, walls).atm).toBe(true);
    expect(rowFlags(row(22725), 22738, walls).atm).toBe(true);
    expect(rowFlags(row(22700), 22738, walls).atm).toBe(false);
    expect(rowFlags(row(22800), 22738, walls).atm).toBe(false);
  });

  test("honours a custom ATM step", () => {
    expect(rowFlags(row(22700), 22738, walls, 100).atm).toBe(true);
    expect(rowFlags(row(22700), 22738, walls, 50).atm).toBe(false);
  });

  test("flags only the configured top wall strikes", () => {
    expect(rowFlags(row(23000), 22738, walls).callWall).toBe(true);
    expect(rowFlags(row(23500), 22738, walls).callWall).toBe(true);
    expect(rowFlags(row(22500), 22738, walls).putWall).toBe(true);
    expect(rowFlags(row(22750), 22738, walls).callWall).toBe(false);
    expect(rowFlags(row(22750), 22738, walls).putWall).toBe(false);
  });

  test("is safe with absent walls", () => {
    const flags = rowFlags(row(23000), 22738, {});
    expect(flags.callWall).toBe(false);
    expect(flags.putWall).toBe(false);
  });

  test("calls below spot are ITM, puts above spot are ITM", () => {
    expect(rowFlags(row(22700), 22738, walls).itmCe).toBe(true);
    expect(rowFlags(row(22700), 22738, walls).itmPe).toBe(false);
    expect(rowFlags(row(22800), 22738, walls).itmCe).toBe(false);
    expect(rowFlags(row(22800), 22738, walls).itmPe).toBe(true);
  });

  test("the exact spot strike is neither side's ITM", () => {
    const flags = rowFlags(row(22738), 22738, walls);
    expect(flags.itmCe).toBe(false);
    expect(flags.itmPe).toBe(false);
    expect(flags.atm).toBe(true);
  });

  test("non-finite spot disables the spot-relative flags", () => {
    const flags = rowFlags(row(22750), Number.NaN, walls);
    expect(flags.atm).toBe(false);
    expect(flags.itmCe).toBe(false);
    expect(flags.itmPe).toBe(false);
    expect(flags.callWall).toBe(false);
  });
});

describe("sortChainRows", () => {
  const rows = [
    row(22700, { oi: 200, volume: 10, oi_change: 5 }, { oi: 100, volume: 5, oi_change: 1 }),
    row(22800, { oi: 50, volume: 90, oi_change: 2 }, { oi: 50, volume: 10, oi_change: 2 }),
    row(22750, { oi: 100, volume: 20, oi_change: 9 }, { oi: 200, volume: 20, oi_change: 3 }),
  ];

  test("sorts strike ascending", () => {
    expect(sortChainRows(rows, "strike").map((r) => r.strike)).toEqual([
      22700, 22750, 22800,
    ]);
  });

  test("sorts total OI descending", () => {
    expect(sortChainRows(rows, "oi").map((r) => r.strike)).toEqual([
      22700, 22750, 22800,
    ]);
  });

  test("sorts total volume descending", () => {
    expect(sortChainRows(rows, "volume").map((r) => r.strike)).toEqual([
      22800, 22750, 22700,
    ]);
  });

  test("sorts total ΔOI descending", () => {
    expect(sortChainRows(rows, "oiChange").map((r) => r.strike)).toEqual([
      22750, 22700, 22800,
    ]);
  });

  test("keeps input order on ties", () => {
    const tied = [
      row(22800, { oi: 100 }),
      row(22700, { oi: 100 }),
      row(22750, { oi: 100 }),
    ];
    expect(sortChainRows(tied, "oi").map((r) => r.strike)).toEqual([
      22800, 22700, 22750,
    ]);
  });

  test("does not mutate the input array", () => {
    const before = rows.map((r) => r.strike);
    sortChainRows(rows, "volume");
    expect(rows.map((r) => r.strike)).toEqual(before);
  });

  test("handles an empty chain", () => {
    expect(sortChainRows([], "oi")).toEqual([]);
  });
});

describe("chainSummary", () => {
  test("mirrors the desk's CE-writers vs PE-buyers read", () => {
    const summary = chainSummary([
      row(23000, { oi_change: 86_900_000, sentiment: { label: "SB" } }, {
        oi_change: 35_200_000,
        sentiment: { label: "LB" },
      }),
    ]);
    expect(summary.ceWriters).toBe(86_900_000);
    expect(summary.peBuyers).toBe(35_200_000);
    expect(summary.ceBuyers).toBe(0);
    expect(summary.peWriters).toBe(0);
    expect(summary.netCe).toBe(86_900_000);
    expect(summary.netPe).toBe(35_200_000);
  });

  test("sums each bucket across strikes", () => {
    const summary = chainSummary([
      row(22800, { oi_change: 10, sentiment: { label: "SB" } }, {
        oi_change: 4,
        sentiment: { label: "LB" },
      }),
      row(22900, { oi_change: 5, sentiment: { label: "SB" } }, {
        oi_change: 6,
        sentiment: { label: "SB" },
      }),
      row(23000, { oi_change: -2, sentiment: { label: "LB" } }, {
        oi_change: 1,
        sentiment: { label: "LU" },
      }),
    ]);
    expect(summary.ceWriters).toBe(15);
    expect(summary.ceBuyers).toBe(-2);
    expect(summary.peWriters).toBe(6);
    expect(summary.peBuyers).toBe(4);
    expect(summary.netCe).toBe(13);
    expect(summary.netPe).toBe(11);
  });

  test("accepts a plain-string sentiment and ignores unknown labels", () => {
    const summary = chainSummary([
      row(22800, { oi_change: 7, sentiment: "lb" }, {
        oi_change: 3,
        sentiment: "Neutral",
      }),
    ]);
    expect(summary.ceBuyers).toBe(7);
    expect(summary.peBuyers).toBe(0);
    expect(summary.peWriters).toBe(0);
    expect(summary.netPe).toBe(3);
  });

  test("counts ΔOI even when sentiment is missing", () => {
    const summary = chainSummary([
      row(22800, { oi_change: 8, sentiment: null }, { oi_change: -3, sentiment: null }),
    ]);
    expect(summary.netCe).toBe(8);
    expect(summary.netPe).toBe(-3);
    expect(summary.ceWriters).toBe(0);
    expect(summary.peWriters).toBe(0);
  });

  test("an empty chain summarises to zeros", () => {
    expect(chainSummary([])).toEqual({
      ceWriters: 0,
      ceBuyers: 0,
      peWriters: 0,
      peBuyers: 0,
      netCe: 0,
      netPe: 0,
    });
  });
});
