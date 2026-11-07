import { describe, expect, test } from "vitest";
import {
  PRESSURE_BURST_RATIO,
  PRESSURE_CLIMAX_RATIO,
  buildPressure,
} from "./niftyPressure";

/** Cumulative volume rows: each row's value is the running total. */
function rows(cum: Array<[string, number, number]>) {
  return cum.map(([t, ce, pe]) => ({ t: `2026-10-23T${t}:00+05:30`, ce_vol: ce, pe_vol: pe }));
}

/** Rows carrying spot + ATM premium so the aggressor split can be computed. */
function flowRows(
  cum: Array<[string, number, number, number, number, number]>,
) {
  return cum.map(([t, ce, pe, spot, cePrem, pePrem]) => ({
    t: `2026-10-26T${t}:00+05:30`,
    ce_vol: ce,
    pe_vol: pe,
    spot,
    // Fixed reference strike (nearest 50 to the last spot). The helper keeps
    // the three strikes the fixtures can resolve to, all with the same premium
    // series, so the test exercises the residual and not the strike lookup.
    chain: {
      "22550": [cePrem, pePrem, 0, 0, 0, 0],
      "22600": [cePrem, pePrem, 0, 0, 0, 0],
      "22650": [cePrem, pePrem, 0, 0, 0, 0],
    },
  }));
}

describe("buildPressure", () => {
  test("turns cumulative volume into minute deltas", () => {
    const s = buildPressure(
      rows([
        ["09:15", 100, 50],
        ["09:16", 160, 90],
        ["09:17", 260, 120],
      ]),
    );
    expect(s.points.map((p) => p.ce)).toEqual([100, 60, 100]);
    expect(s.points.map((p) => p.pe)).toEqual([50, 40, 30]);
    expect(s.points.map((p) => p.total)).toEqual([150, 100, 130]);
  });

  test("a premium move that matches the delta move is not flow", () => {
    // Spot +20 with delta 0.5 → CE +10 / PE −10 is pure delta, no aggression.
    const s = buildPressure(
      flowRows([
        ["09:15", 100, 100, 22_600, 100, 100],
        ["09:16", 200, 200, 22_620, 110, 90],
      ]),
    );
    expect(s.points[1].ceFlow).toBeNull();
    expect(s.points[1].peFlow).toBeNull();
    expect(s.flow).toEqual({ ceBuy: 0, ceSell: 0, peBuy: 0, peSell: 0 });
  });

  test("richer-than-implied calls are aggressive buying, cheaper are selling", () => {
    const s = buildPressure(
      flowRows([
        ["09:15", 100, 100, 22_600, 100, 100],
        ["09:16", 200, 200, 22_620, 125, 75], // CE +25 vs +10 implied
        ["09:17", 300, 300, 22_640, 127, 50], // CE +2 vs +10 implied
      ]),
    );
    expect(s.points[1].ceFlow).toBe("buy");
    expect(s.points[2].ceFlow).toBe("sell");
    expect(s.flow.ceBuy).toBe(100);
    expect(s.flow.ceSell).toBe(100);
  });

  test("put buying is a richer put, put writing a cheaper one", () => {
    const s = buildPressure(
      flowRows([
        ["09:15", 100, 100, 22_600, 100, 100],
        ["09:16", 200, 200, 22_620, 110, 75], // PE −25 vs −10 implied → sell (writers)
        ["09:17", 300, 300, 22_620, 110.2, 75.2], // +0.2 on a flat spot → noise
        ["09:18", 400, 400, 22_620, 110.2, 90], // PE +14.8 with flat spot → buy
      ]),
    );
    expect(s.points[1].peFlow).toBe("sell");
    expect(s.points[3].peFlow).toBe("buy");
    expect(s.flow.peSell).toBe(100);
    expect(s.flow.peBuy).toBe(100);
  });

  test("clamps a volume reset to zero instead of printing a negative bar", () => {
    const s = buildPressure(
      rows([
        ["09:15", 500, 500],
        ["09:16", 100, 100],
        ["09:17", 180, 140],
      ]),
    );
    expect(s.points[1].ce).toBe(0);
    expect(s.points[1].total).toBe(0);
  });

  test("flags a 13:33-style burst against the 20-min median", () => {
    // Ten quiet minutes at ~3.7M, then 17.5M — today's first volume tell.
    const quiet = Array.from({ length: 10 }, (_, i) => {
      const t = `09:${String(20 + i).padStart(2, "0")}`;
      return [t, (i + 1) * 3_700_000, 0] as [string, number, number];
    });
    const s = buildPressure(rows([...quiet, ["09:30", 10 * 3_700_000 + 17_500_000, 0]]));
    const last = s.points[s.points.length - 1];
    expect(last.ce).toBe(17_500_000);
    expect(last.ratio).toBeGreaterThan(PRESSURE_BURST_RATIO);
    expect(last.state).not.toBe("normal");
    expect(s.lastRatio).toBeGreaterThan(PRESSURE_BURST_RATIO);
  });

  test("a 4x minute is a climax, a 2x minute is a burst", () => {
    const base = Array.from({ length: 10 }, (_, i) => {
      const t = `10:${String(10 + i).padStart(2, "0")}`;
      return [t, (i + 1) * 2_000_000, 0] as [string, number, number];
    });
    const burst = buildPressure(rows([...base, ["10:20", 10 * 2_000_000 + 4_000_000, 0]]));
    expect(burst.points[burst.points.length - 1].state).toBe("burst");
    const climax = buildPressure(rows([...base, ["10:20", 10 * 2_000_000 + 10_000_000, 0]]));
    expect(climax.points[climax.points.length - 1].ratio).toBeGreaterThanOrEqual(
      PRESSURE_CLIMAX_RATIO,
    );
    expect(climax.points[climax.points.length - 1].state).toBe("climax");
  });

  test("falls back to per-strike chain volumes when totals are absent", () => {
    const s = buildPressure([
      { t: "2026-10-23T09:15:00+05:30", chain: { "22500": [1, 1, 10, 10, 500, 300] } },
      { t: "2026-10-23T09:16:00+05:30", chain: { "22500": [1, 1, 10, 10, 900, 400] } },
    ]);
    expect(s.points).toHaveLength(2);
    expect(s.points[1].ce).toBe(400);
    expect(s.points[1].pe).toBe(100);
  });

  test("empty tape yields no points; an all-zero tape is a zero series", () => {
    expect(buildPressure([]).points).toHaveLength(0);
    const zero = buildPressure(rows([["09:15", 0, 0]]));
    expect(zero.median).toBe(0);
    expect(zero.maxRatio).toBe(0);
    expect(zero.points.every((p) => p.total === 0)).toBe(true);
  });
});
