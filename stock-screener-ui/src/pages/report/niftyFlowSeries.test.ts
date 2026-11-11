import { describe, expect, test } from "vitest";
import { buildFlowSeries } from "./niftyFlowSeries";

function rows(net: Array<[string, number, number | null]>) {
  return net.map(([t, netPct, gex]) => ({
    t: `2026-10-23T${t}:00+05:30`,
    net_pct: netPct,
    net_gex: gex,
  }));
}

describe("buildFlowSeries", () => {
  test("keeps the cumulative flow and signs the gamma regime", () => {
    const s = buildFlowSeries(rows([
      ["09:15", 0.2, -5],
      ["09:16", 0.5, -6],
      ["09:17", 0.4, 3],
    ]));
    expect(s.points.map((p) => p.net)).toEqual([0, 0.3, 0.2]);
    expect(s.points.map((p) => p.regime)).toEqual(["short", "short", "long"]);
    expect(s.flips).toEqual(["09:17"]);
    expect(s.shortShare).toBeCloseTo(2 / 3, 5);
  });

  test("includes zero in the range so the zero line is drawable", () => {
    const s = buildFlowSeries(rows([["09:15", 2.5, -1], ["09:16", 3.1, -1]]));
    expect(s.min).toBe(0);
    expect(s.max).toBeCloseTo(0.6, 5);
  });

  test("a degraded gex block leaves the regime null, never a fake sign", () => {
    const s = buildFlowSeries([
      { t: "2026-10-23T09:15:00+05:30", net_pct: 0.1, net_gex: -5, gex_degraded: true },
    ]);
    expect(s.points[0].regime).toBeNull();
    expect(s.shortShare).toBe(0);
  });

  test("falls back to net when net_pct is absent, and skips rows with neither", () => {
    const s = buildFlowSeries([
      { t: "2026-10-23T09:15:00+05:30", net: 1_000 },
      { t: "2026-10-23T09:16:00+05:30" },
      { t: "2026-10-23T09:17:00+05:30", net: 1_500 },
    ]);
    expect(s.points).toHaveLength(2);
    expect(s.points.map((p) => p.net)).toEqual([0, 500]);
  });
});
