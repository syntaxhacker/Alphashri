import { describe, expect, it } from "vitest";

import type { UsRow, UsStrike } from "../../../types/usReport";
import { buildChart, buildLadder, fmtPct, fmtTime } from "./usReportMath";

function strike(k: number, c = 0, p = 0): UsStrike {
  return { k, c_oi: c, c_vol: 0, p_oi: p, p_vol: 0, g: 0 };
}

function row(overrides: Partial<UsRow> = {}): UsRow {
  return {
    t: "2026-10-22T14:00:00-04:00",
    root: "NQ",
    contract: "NQZ26",
    series: "MQ4V26",
    expiry: "2026-10-23",
    spot: 29_100,
    change_pct: -3,
    change_pts: -900,
    call_oi: 100,
    put_oi: 200,
    call_vol: 10,
    put_vol: 20,
    pcr_oi: 2,
    pcr_vol: 2,
    max_pain: 29_500,
    call_wall: 30_500,
    call_wall_oi: 371,
    put_wall: 29_000,
    put_wall_oi: 1_004,
    exp_move_pct: 1.5,
    atm_strike: 29_100,
    net_gex: -2_900,
    gex_flip: null,
    n_strikes: 5,
    strikes: [strike(29_000, 20, 1_004), strike(29_100, 40, 300), strike(29_200, 60, 200), strike(29_500, 90, 80), strike(30_500, 371, 10)],
    ...overrides,
  };
}

describe("buildLadder", () => {
  it("keeps the walls even when the call wall sits outside the window", () => {
    const ladder = buildLadder(row());
    const strikes = ladder.rows.map((r) => r.k);
    expect(strikes).toContain(30_500);
    expect(strikes).toContain(29_000);
    expect(strikes).toContain(29_500);
  });

  it("inserts exactly one spot row and marks the walls", () => {
    const ladder = buildLadder(row());
    expect(ladder.rows.filter((r) => r.isSpot)).toHaveLength(1);
    expect(ladder.rows.find((r) => r.k === 29_000)?.isPutWall).toBe(true);
    expect(ladder.rows.find((r) => r.k === 30_500)?.isCallWall).toBe(true);
    expect(ladder.rows.find((r) => r.k === 29_500)?.isMaxPain).toBe(true);
    expect(ladder.maxOi).toBe(1_004);
  });

  it("is sorted high to low with the spot marker in place", () => {
    const ks = buildLadder(row()).rows.map((r) => r.k);
    expect([...ks].sort((a, b) => b - a)).toEqual(ks);
    const spotIdx = buildLadder(row()).rows.findIndex((r) => r.isSpot);
    expect(ks[spotIdx - 1]).toBeGreaterThanOrEqual(29_100);
    expect(ks[spotIdx + 1]).toBeLessThan(29_100);
  });
});

describe("buildChart", () => {
  it("returns null without frames", () => {
    expect(buildChart([], 0)).toBeNull();
  });

  it("spans the traded range and keeps far walls out of the scale", () => {
    const frames = [row(), row({ t: "2026-10-22T14:01:00-04:00", spot: 29_050 })];
    const g = buildChart(frames, 1);
    expect(g).not.toBeNull();
    expect(g!.min).toBeLessThan(29_050);
    expect(g!.max).toBeGreaterThan(29_100);
    // 30,500 is >2.5% away — it must not flatten the chart
    expect(g!.max).toBeLessThan(29_800);
    expect(g!.cursorX).toBe(1000);
    expect(g!.spot.split(" ")).toHaveLength(2);
  });

  it("includes a wall that sits close to spot", () => {
    const near = row({ call_wall: 29_200, put_wall: 29_000, max_pain: 29_150 });
    const g = buildChart([near], 0);
    expect(g!.max).toBeGreaterThan(29_200);
    expect(g!.min).toBeLessThan(29_000);
  });
});

describe("formatters", () => {
  it("formats percentages and New York time", () => {
    expect(fmtPct(-3.02)).toBe("-3.02%");
    expect(fmtPct(1.2)).toBe("+1.20%");
    expect(fmtPct(null)).toBe("–");
    expect(fmtTime("2026-10-22T14:00:00-04:00")).toBe("14:00");
  });
});
