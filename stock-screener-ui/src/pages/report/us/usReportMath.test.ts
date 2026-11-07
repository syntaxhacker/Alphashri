import { describe, expect, it } from "vitest";

import type { UsRow, UsStrike } from "../../../types/usReport";
import { buildChart, buildLadder, fmtPct, fmtTime, toBars } from "./usReportMath";

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

describe("toBars", () => {
  it("turns flat tape rows into close-to-close bodies", () => {
    const frames = [
      row({ t: "2026-10-22T14:00:00-04:00", spot: 29_100, o: 29_100, h: 29_100, l: 29_100, c: 29_100 }),
      row({ t: "2026-10-22T14:01:00-04:00", spot: 29_140, o: 29_140, h: 29_140, l: 29_140, c: 29_140 }),
    ];
    const bars = toBars(frames);
    expect(bars).toHaveLength(2);
    expect(bars[1].o).toBe(29_100);
    expect(bars[1].c).toBe(29_140);
    expect(bars[1].h).toBe(29_140);
    expect(bars[1].l).toBe(29_100);
  });

  it("keeps real OHLC when the sampler wrote it", () => {
    const bars = toBars([row({ o: 29_100, h: 29_160, l: 29_080, c: 29_140 })]);
    expect(bars[0]).toMatchObject({ o: 29_100, h: 29_160, l: 29_080, c: 29_140 });
  });

  it("aggregates into 5-minute buckets", () => {
    const frames = [0, 1, 2, 3, 4, 5].map((i) =>
      row({
        t: `2026-10-22T14:0${i}:00-04:00`,
        spot: 29_100 + i,
        o: 29_100 + i,
        h: 29_100 + i,
        l: 29_100 + i,
        c: 29_100 + i,
      }),
    );
    const bars = toBars(frames, 5);
    expect(bars).toHaveLength(2);
    expect(bars[0].o).toBe(29_100);
    expect(bars[0].c).toBe(29_104);
    expect(bars[1].c).toBe(29_105);
  });
});

describe("buildChart", () => {
  it("returns null without bars", () => {
    expect(buildChart([], 0)).toBeNull();
  });

  it("scales to the traded range and places the cursor on the last bar", () => {
    const frames = [row({ t: "2026-10-22T14:00:00-04:00", spot: 29_050 }), row({ t: "2026-10-22T14:01:00-04:00", spot: 29_150 })];
    const bars = toBars(frames);
    const g = buildChart(bars, 1);
    expect(g).not.toBeNull();
    expect(g!.min).toBeLessThan(29_050);
    expect(g!.max).toBeGreaterThan(29_150);
    expect(g!.cursorX).toBe(1000);
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
