import { describe, expect, test } from "vitest";
import type { WallsPayload, WallsRow } from "@/api/reportNifty";
import {
  erosionArrow,
  flowLabel,
  flowTone,
  fmtRate,
  fmtTimeToBreak,
  fmtVolMult,
  fmtPremChange,
  statusTone,
} from "./niftyWallsFormat";
import {
  fuelTone,
  isPreBlast,
  pickNearestWalls,
  sparkPoints,
  wallErosionView,
} from "./wallErosion";

function wallRow(overrides: Partial<WallsRow> = {}): WallsRow {
  return {
    strike: 74000,
    oi: 5_923_820,
    distance_pts: 120,
    ...overrides,
  };
}

function wallsPayload(overrides: Partial<WallsPayload> = {}): WallsPayload {
  return {
    symbol: "NIFTY",
    date: "2026-11-10",
    expiry: "2026-11-10",
    dte: 0,
    spot: 73880,
    max_pain: 73800,
    max_pain_drift: 0,
    atm: 73900,
    net_gex: -1.2,
    flip: 73950,
    regime: "SHORT",
    gex_degraded: false,
    pin_distance_pts: 20,
    pin_distance_pct: 0.03,
    state: "WALL_WATCH",
    expiry_day: true,
    alert_eligible: false,
    alert: null,
    reasons: [],
    call_wall: { strike: 74000, oi: 5_923_820 },
    put_wall: { strike: 73500, oi: 6_000_000 },
    tracked_call_erosion_30m: null,
    tracked_call_erosion_5m: null,
    tracked_put_build_30m: null,
    near: true,
    cross: false,
    calls: [],
    puts: [],
    events: [],
    history: [],
    freshness: { last_t: "2026-11-10T10:00:00+05:30", age_sec: 4, stale: false, rows: 10, gaps: [] },
    window_min: 30,
    top: 5,
    ...overrides,
  };
}

describe("erosionArrow", () => {
  test("CALL eroding and breached point up", () => {
    expect(erosionArrow("CALL", "ERODING")).toBe("▲");
    expect(erosionArrow("CALL", "BREACHED")).toBe("▲");
  });
  test("PUT eroding and breached point down", () => {
    expect(erosionArrow("PUT", "ERODING")).toBe("▼");
    expect(erosionArrow("PUT", "BREACHED")).toBe("▼");
  });
  test("BUILDING flips to the side opposite", () => {
    expect(erosionArrow("CALL", "BUILDING")).toBe("▼");
    expect(erosionArrow("PUT", "BUILDING")).toBe("▲");
  });
  test("STABLE and unknown render a dash", () => {
    expect(erosionArrow("CALL", "STABLE")).toBe("—");
    expect(erosionArrow("PUT", "STABLE")).toBe("—");
    expect(erosionArrow("CALL", "???")).toBe("—");
    expect(erosionArrow("CALL", null)).toBe("—");
    expect(erosionArrow("CALL", undefined)).toBe("—");
  });
});

describe("flowLabel / flowTone", () => {
  test.each([
    ["WRITERS_COVERING", "WRITERS COVERING", "bull"],
    ["LONG_UNWIND", "LONG UNWIND", "bear"],
    ["WRITERS_ADDING", "WRITERS ADDING", "bear"],
    ["LONG_BUILD", "LONG BUILD", "bull"],
    ["UNKNOWN", "—", "muted"],
  ] as const)("%s → %s (%s)", (flow, label, tone) => {
    expect(flowLabel(flow)).toBe(label);
    expect(flowTone(flow)).toBe(tone);
  });
  test("null/undefined/case-insensitive inputs fall back safely", () => {
    expect(flowLabel(null)).toBe("—");
    expect(flowLabel(undefined)).toBe("—");
    expect(flowTone(null)).toBe("muted");
    expect(flowTone(undefined)).toBe("muted");
    expect(flowLabel("writers_covering")).toBe("WRITERS COVERING");
  });
});

describe("statusTone", () => {
  test.each([
    ["BUILDING", "positive"],
    ["STABLE", "muted"],
    ["ERODING", "warning"],
    ["BREACHED", "negative"],
  ] as const)("%s → %s", (status, tone) => {
    expect(statusTone(status)).toBe(tone);
  });
  test("unknown statuses are muted", () => {
    expect(statusTone("???")).toBe("muted");
    expect(statusTone(null)).toBe("muted");
    expect(statusTone(undefined)).toBe("muted");
  });
});

describe("numeric formatters", () => {
  test("fmtRate prints a signed fraction/min", () => {
    expect(fmtRate(-0.0011)).toBe("-0.11%/min");
    expect(fmtRate(0.002)).toBe("+0.20%/min");
    expect(fmtRate(null)).toBe("—");
    expect(fmtRate(Number.NaN)).toBe("—");
  });
  test("fmtVolMult prints one decimal with the × glyph", () => {
    expect(fmtVolMult(1.26)).toBe("1.3×");
    expect(fmtVolMult(0)).toBe("0.0×");
    expect(fmtVolMult(null)).toBe("—");
    expect(fmtVolMult(-1)).toBe("—");
    expect(fmtVolMult(Number.POSITIVE_INFINITY)).toBe("—");
  });
  test("fmtTimeToBreak prints ~Nm, <1m or a dash", () => {
    expect(fmtTimeToBreak(0.4)).toBe("<1m");
    expect(fmtTimeToBreak(0)).toBe("<1m");
    expect(fmtTimeToBreak(3.7)).toBe("~4m");
    expect(fmtTimeToBreak(12)).toBe("~12m");
    expect(fmtTimeToBreak(null)).toBe("—");
    expect(fmtTimeToBreak(Number.NaN)).toBe("—");
  });
  test("fmtPremChange prints a signed fraction as a percent", () => {
    expect(fmtPremChange(0.012)).toBe("+1.2%");
    expect(fmtPremChange(-0.03)).toBe("-3.0%");
    expect(fmtPremChange(0)).toBe("+0.0%");
    expect(fmtPremChange(null)).toBe("—");
  });
});

describe("sparkPoints", () => {
  test("keeps finite numbers, drops everything else", () => {
    expect(sparkPoints([1, Number.NaN, 2, Number.POSITIVE_INFINITY, 3])).toEqual([1, 2, 3]);
    expect(sparkPoints([])).toEqual([]);
  });
});

describe("fuelTone", () => {
  test(">=70 is warning (pre-blast), 45-69 positive, below muted", () => {
    expect(fuelTone(70)).toBe("warning");
    expect(fuelTone(95)).toBe("warning");
    expect(fuelTone(69)).toBe("positive");
    expect(fuelTone(45)).toBe("positive");
    expect(fuelTone(44)).toBe("muted");
    expect(fuelTone(1)).toBe("muted");
    expect(fuelTone(0)).toBe("muted");
    expect(fuelTone(Number.NaN)).toBe("muted");
  });
});

describe("pickNearestWalls", () => {
  test("null payload yields nulls", () => {
    expect(pickNearestWalls(null)).toEqual({ call: null, put: null });
  });
  test("prefers backend nearest_call/nearest_put when present", () => {
    const nearestCall = wallRow({ strike: 74100, distance_pts: 220, nearest: true });
    const nearestPut = wallRow({ strike: 73700, distance_pts: -180, nearest: true });
    const walls = wallsPayload({
      calls: [wallRow({ strike: 74000, distance_pts: 120 })],
      puts: [wallRow({ strike: 73600, distance_pts: -280 })],
      nearest_call: nearestCall,
      nearest_put: nearestPut,
    });
    const { call, put } = pickNearestWalls(walls);
    expect(call).toBe(nearestCall);
    expect(put).toBe(nearestPut);
  });
  test("falls back to calls/puts by abs(distance_pts) when nearest_* is absent", () => {
    const walls = wallsPayload({
      spot: 73880,
      calls: [
        wallRow({ strike: 74200, distance_pts: 320 }),
        wallRow({ strike: 74000, distance_pts: 120 }),
      ],
      puts: [
        wallRow({ strike: 73300, distance_pts: -580 }),
        wallRow({ strike: 73600, distance_pts: -280 }),
      ],
    });
    const { call, put } = pickNearestWalls(walls);
    expect(call?.strike).toBe(74000);
    expect(put?.strike).toBe(73600);
  });
  test("distance_pts missing falls back to strike − spot", () => {
    const walls = wallsPayload({
      spot: 73880,
      calls: [
        { strike: 74100, oi: 100 }, // |220|
        { strike: 74000, oi: 100 }, // |120|
      ],
    });
    expect(pickNearestWalls(walls).call?.strike).toBe(74000);
  });
  test("ignores off-side strikes when on-side candidates exist", () => {
    const walls = wallsPayload({
      spot: 73880,
      calls: [
        wallRow({ strike: 73000, distance_pts: -880 }), // below spot — not a candidate
        wallRow({ strike: 74500, distance_pts: 620 }),
      ],
    });
    expect(pickNearestWalls(walls).call?.strike).toBe(74500);
  });
  test("empty walls lists yield nulls", () => {
    expect(pickNearestWalls(wallsPayload())).toEqual({ call: null, put: null });
  });
  test("BREACHED call below spot beats an intact backend nearest_call", () => {
    // The 2026-11-09 11:36 tape: 25,500 intact (fuel 40) is the backend's
    // nearest, but 25,000 below spot is BREACHED (fuel 98) and is the event.
    const walls = wallsPayload({
      spot: 25007,
      nearest_call: wallRow({ strike: 25500, distance_pts: 493, status: "BUILDING", fuel_score: 40 }),
      calls: [
        wallRow({ strike: 25000, distance_pts: -7, status: "BREACHED", fuel_score: 98, erosion_30m: -0.0689 }),
        wallRow({ strike: 25500, distance_pts: 493, status: "BUILDING", fuel_score: 40 }),
      ],
    });
    expect(pickNearestWalls(walls).call?.strike).toBe(25000);
  });
  test("ERODING call with fuel >= 60 beats a stronger-building neighbour", () => {
    const walls = wallsPayload({
      spot: 24967,
      calls: [
        wallRow({ strike: 25000, distance_pts: 33, status: "ERODING", fuel_score: 75 }),
        wallRow({ strike: 25500, distance_pts: 533, status: "BUILDING", fuel_score: 28 }),
      ],
    });
    expect(pickNearestWalls(walls).call?.strike).toBe(25000);
  });
  test("a STABLE set keeps the nearest wall", () => {
    const stable = wallRow({ strike: 25500, distance_pts: 493, status: "STABLE", fuel_score: 10 });
    const walls = wallsPayload({
      spot: 25007,
      nearest_call: stable,
      calls: [
        wallRow({ strike: 25000, distance_pts: -7, status: "STABLE", fuel_score: 10 }),
        stable,
      ],
    });
    expect(pickNearestWalls(walls).call).toBe(stable);
  });
  test("a BREACHED put below spot beats the stable nearby put", () => {
    const walls = wallsPayload({
      spot: 24967,
      puts: [
        wallRow({ strike: 24800, distance_pts: -167, status: "STABLE", fuel_score: 30 }),
        wallRow({ strike: 24500, distance_pts: -467, status: "BREACHED", fuel_score: 80 }),
      ],
    });
    expect(pickNearestWalls(walls).put?.strike).toBe(24500);
  });
  test("active ERODING loses to a higher-fuel nearest", () => {
    const walls = wallsPayload({
      spot: 25007,
      nearest_call: wallRow({ strike: 25500, distance_pts: 493, status: "BUILDING", fuel_score: 80 }),
      calls: [
        wallRow({ strike: 25000, distance_pts: -7, status: "ERODING", fuel_score: 70 }),
      ],
    });
    expect(pickNearestWalls(walls).call?.strike).toBe(25500);
  });
  test("ERODING below the 60 fuel floor is not active", () => {
    const walls = wallsPayload({
      spot: 25007,
      nearest_call: wallRow({ strike: 25500, distance_pts: 493, status: "BUILDING", fuel_score: 70 }),
      calls: [
        wallRow({ strike: 25000, distance_pts: -7, status: "ERODING", fuel_score: 59 }),
      ],
    });
    expect(pickNearestWalls(walls).call?.strike).toBe(25500);
  });
  test("calls and puts select independently — an active call does not leak into the put side", () => {
    const walls = wallsPayload({
      spot: 24967,
      calls: [
        wallRow({ strike: 25000, distance_pts: 33, status: "ERODING", fuel_score: 75 }),
      ],
      puts: [
        wallRow({ strike: 24800, distance_pts: -167, status: "STABLE", fuel_score: 30 }),
      ],
    });
    const { call, put } = pickNearestWalls(walls);
    expect(call?.strike).toBe(25000);
    expect(put?.strike).toBe(24800);
  });
});

describe("isPreBlast", () => {
  const base = wallRow({
    status: "ERODING",
    fuel_score: 72,
    vol_mult: 1.6,
  });
  test("short gamma + ERODING + fuel>=60 + vol_mult>=1.2 fires", () => {
    expect(isPreBlast(base, "SHORT")).toBe(true);
  });
  test("BREACHED also fires", () => {
    expect(isPreBlast({ ...base, status: "BREACHED" }, "SHORT")).toBe(true);
  });
  test("LONG regime never fires", () => {
    expect(isPreBlast(base, "LONG")).toBe(false);
    expect(isPreBlast(base, null)).toBe(false);
    expect(isPreBlast(base, undefined)).toBe(false);
  });
  test("non-eroding statuses never fire", () => {
    expect(isPreBlast({ ...base, status: "BUILDING" }, "SHORT")).toBe(false);
    expect(isPreBlast({ ...base, status: "STABLE" }, "SHORT")).toBe(false);
    expect(isPreBlast({ ...base, status: undefined }, "SHORT")).toBe(false);
  });
  test("fuel below 60 does not fire", () => {
    expect(isPreBlast({ ...base, fuel_score: 59 }, "SHORT")).toBe(false);
    expect(isPreBlast({ ...base, fuel_score: undefined }, "SHORT")).toBe(false);
  });
  test("vol_mult below 1.2 does not fire; null/missing vol does not block", () => {
    expect(isPreBlast({ ...base, vol_mult: 1.1 }, "SHORT")).toBe(false);
    expect(isPreBlast({ ...base, vol_mult: null }, "SHORT")).toBe(true);
    expect(isPreBlast({ ...base, vol_mult: undefined }, "SHORT")).toBe(true);
  });
  test("null row never fires", () => {
    expect(isPreBlast(null, "SHORT")).toBe(false);
    expect(isPreBlast(undefined, "SHORT")).toBe(false);
  });
});

describe("wallErosionView", () => {
  test("null row renders all dashes, fuel 0, empty spark, not breached", () => {
    const view = wallErosionView(null, "CALL");
    expect(view).toEqual({
      strikeText: "—",
      distanceText: "—",
      oiText: "—",
      erosion30Text: "—",
      rateText: "—",
      volText: "—",
      flowText: "—",
      flowTone: "muted",
      statusText: "—",
      statusTone: "muted",
      arrow: "—",
      fuelScore: 0,
      timeText: "—",
      premText: "—",
      spark: [],
      breached: false,
    });
  });

  test("full row renders every field", () => {
    const row = wallRow({
      strike: 74000,
      oi: 5_923_820,
      distance_pts: 120,
      erosion_30m: -0.1388,
      erosion_rate_30m: -0.0011,
      vol_mult: 1.26,
      flow: "WRITERS_COVERING",
      status: "ERODING",
      fuel_score: 72,
      time_to_break_min: 3.7,
      prem_chg_5m: 0.012,
      oi_history: [5.8e6, Number.NaN, 5.9e6, 5.92e6],
    });
    const view = wallErosionView(row, "CALL");
    expect(view.strikeText).toBe("74,000");
    expect(view.distanceText).toBe("+120 pts");
    expect(view.oiText).toBe("5.92M");
    expect(view.erosion30Text).toBe("-13.9%");
    expect(view.rateText).toBe("-0.11%/min");
    expect(view.volText).toBe("1.3×");
    expect(view.flowText).toBe("WRITERS COVERING");
    expect(view.flowTone).toBe("bull");
    expect(view.statusText).toBe("ERODING");
    expect(view.statusTone).toBe("warning");
    expect(view.arrow).toBe("▲");
    expect(view.fuelScore).toBe(72);
    expect(view.timeText).toBe("~4m");
    expect(view.premText).toBe("+1.2%");
    expect(view.spark).toEqual([5.8e6, 5.9e6, 5.92e6]);
    expect(view.breached).toBe(false);
  });

  test("PUT breached row flips arrow/breached", () => {
    const view = wallErosionView(
      wallRow({ status: "BREACHED", fuel_score: 91 }),
      "PUT",
    );
    expect(view.arrow).toBe("▼");
    expect(view.statusTone).toBe("negative");
    expect(view.breached).toBe(true);
    expect(view.fuelScore).toBe(91);
  });

  test("fuel_score is clamped to 0-100 and rounded", () => {
    expect(wallErosionView(wallRow({ fuel_score: 250 }), "CALL").fuelScore).toBe(100);
    expect(wallErosionView(wallRow({ fuel_score: -5 }), "CALL").fuelScore).toBe(0);
    expect(wallErosionView(wallRow({ fuel_score: 62.6 }), "CALL").fuelScore).toBe(63);
  });

  test("spark drops non-finite history points", () => {
    const view = wallErosionView(
      wallRow({ oi_history: [1, Number.NaN, Number.POSITIVE_INFINITY, 2] }),
      "CALL",
    );
    expect(view.spark).toEqual([1, 2]);
  });

  test("partial row (no new backend fields) still renders", () => {
    const view = wallErosionView(wallRow(), "PUT");
    expect(view.erosion30Text).toBe("—");
    expect(view.rateText).toBe("—");
    expect(view.volText).toBe("—");
    expect(view.flowText).toBe("—");
    expect(view.statusText).toBe("—");
    expect(view.arrow).toBe("—");
    expect(view.fuelScore).toBe(0);
    expect(view.spark).toEqual([]);
  });
});
