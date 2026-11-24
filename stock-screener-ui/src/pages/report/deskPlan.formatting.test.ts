// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";
import type {
  NiftyIntradayCandle,
  NiftyOptionSide,
  NiftyReport,
  NiftyStrike,
} from "@/types/niftyReport";
import { buildDeskPlan, DESK_REASON_TAGS } from "./deskPlan";

function leg(overrides: Partial<NiftyOptionSide> = {}): NiftyOptionSide {
  return {
    ltp: 0,
    close: 0,
    oi: 0,
    prevOi: 0,
    oiChange: 0,
    priceChange: 0,
    sentiment: "Neutral",
    ...overrides,
  };
}

function strike(
  level: number,
  ce: Partial<NiftyOptionSide>,
  pe: Partial<NiftyOptionSide>,
): NiftyStrike {
  return { strike: level, ce: leg(ce), pe: leg(pe) };
}

function intraday(opts: {
  base: number;
  lowAt: Record<number, number>;
  closeAt?: Record<number, number>;
}): NiftyIntradayCandle[] {
  return Array.from({ length: 30 }, (_, index) => {
    const close = opts.closeAt?.[index] ?? opts.base;
    return {
      time: `09:${String(15 + index).padStart(2, "0")}`,
      open: close,
      high: close + 5,
      low: opts.lowAt[index] ?? close - 4,
      close,
    };
  });
}

function baseReport(overrides: Partial<NiftyReport> = {}): NiftyReport {
  return {
    mode: "live",
    date: "2026-10-21",
    expiry: "2026-10-23",
    spot: 22_728,
    ohlc: { open: 22_900, high: 23_020, low: 22_690, close: 22_728 },
    pcrOi: 1.02,
    pcrVol: 1.1,
    maxPain: 22_900,
    walls: { calls: [], puts: [] },
    strikes: [],
    timeline: [],
    ...overrides,
  };
}

function bearishReport(): NiftyReport {
  return baseReport({
    spot: 22_728,
    pivots: {
      type: "classic",
      pp: 22_969,
      r1: 23_100,
      r2: 23_600,
      r3: 23_800,
      s1: 22_700,
      s2: 22_450,
      s3: 22_200,
      prev: { date: "2026-10-20", high: 23_180, low: 22_820, close: 22_969 },
    },
    gex: {
      strikes: [],
      netTotal: -12.4,
      regime: "short",
      topPositive: [],
      topNegative: [],
      zeroCross: 23_050,
      levels: {
        support: { strike: 22_700, netGex: 1.2 },
        resistance: { strike: 23_000, netGex: 2.4 },
        fuelDown: { strike: 22_550, netGex: -1.8 },
        fuelUp: { strike: 23_700, netGex: -2.2 },
      },
    },
    walls: {
      calls: [
        { strike: 23_000, oi: 8_400_000 },
        { strike: 23_200, oi: 12_400_000 },
      ],
      puts: [
        { strike: 22_650, oi: 9_100_000 },
        { strike: 22_500, oi: 6_200_000 },
      ],
    },
    strikes: [
      strike(22_700, { oi: 4_000_000, oiChange: 610_000, sentiment: "SB" }, { oi: 5_000_000, oiChange: 420_000, sentiment: "LB" }),
      strike(22_750, { oi: 3_800_000, oiChange: 390_000, sentiment: "SB" }, { oi: 4_400_000, oiChange: 310_000, sentiment: "LB" }),
      strike(22_800, { oi: 3_200_000, oiChange: 260_000, sentiment: "SB" }, { oi: 3_100_000, sentiment: "Neutral" }),
      strike(23_000, { oi: 8_400_000, oiChange: 720_000, sentiment: "SB" }, { oi: 2_400_000, sentiment: "Neutral" }),
      strike(22_650, { oi: 2_100_000, sentiment: "Neutral" }, { oi: 9_100_000, oiChange: 540_000, sentiment: "SB" }),
      strike(23_200, { oi: 12_400_000, oiChange: 980_000, sentiment: "SB" }, { oi: 1_900_000, sentiment: "Neutral" }),
    ],
    control: {
      verdict: "call_writers",
      ce_doi: 5_530_000,
      pe_doi: -1_200_000,
      atm_ce_iv: 14.8,
      atm_pe_iv: 15.2,
      skew: -2.4,
      gex_regime: "short",
    },
    regime: {
      verdict: "range_sell_premium",
      range_pts: 180,
      range_baseline_pts: 210,
      range_pct: 0.79,
      rv: 12.8,
      iv: 15.0,
      straddle_open: 150,
      straddle_now: 160,
      straddle_pct: 6.67,
      bars: 30,
      warmup: false,
    },
    vix: { ltp: 13.45, prev_close: 13.2, change_pct: 1.89, day_high: 13.9, day_low: 13.2 },
    strength: {
      verdict: "weak",
      score: 31.2,
      ema9: 22_840,
      ema20: 22_793,
      ema50: 22_850,
      rsi: 38.2,
      pos_in_range: 0.22,
    },
    market: { is_open: true, session_date: "2026-10-21", as_of: "2026-10-21T14:05:00+05:30" },
    reference: {
      strike: 22_750,
      ce_open: 128,
      pe_open: 151,
      ce_ltp: 96,
      pe_ltp: 160,
      ce_change: -25,
      pe_change: 5.96,
      since: "2026-10-21T09:20:00+05:30",
    },
    intraday: intraday({
      base: 22_740,
      lowAt: { 5: 22_700, 6: 22_690, 12: 22_700, 18: 22_700, 29: 22_700 },
      closeAt: { 24: 22_770, 29: 22_728 },
    }),
  });
}

function bullishReport(): NiftyReport {
  return baseReport({
    spot: 23_272,
    pivots: {
      type: "classic",
      pp: 22_969,
      r1: 23_400,
      r2: 23_600,
      r3: 23_800,
      s1: 23_100,
      s2: 22_900,
      s3: 22_700,
      prev: { date: "2026-10-20", high: 23_180, low: 22_820, close: 22_969 },
    },
    gex: {
      strikes: [],
      netTotal: 18.2,
      regime: "long",
      topPositive: [],
      topNegative: [],
      zeroCross: 23_050,
      levels: {
        support: { strike: 23_100, netGex: 3.1 },
        resistance: { strike: 23_350, netGex: 2.8 },
        fuelDown: { strike: 23_000, netGex: -1.4 },
        fuelUp: { strike: 23_700, netGex: -2.6 },
      },
    },
    walls: {
      calls: [
        { strike: 23_500, oi: 12_400_000 },
        { strike: 23_800, oi: 7_100_000 },
      ],
      puts: [
        { strike: 23_050, oi: 9_100_000 },
        { strike: 22_900, oi: 6_400_000 },
      ],
    },
    strikes: [
      strike(23_100, { oi: 3_100_000, sentiment: "LB" }, { oi: 5_200_000, sentiment: "SB" }),
      strike(23_250, { oi: 3_800_000, sentiment: "LB" }, { oi: 4_100_000, sentiment: "SB" }),
      strike(23_350, { oi: 4_400_000, sentiment: "LB" }, { oi: 3_300_000, sentiment: "SB" }),
      strike(23_500, { oi: 12_400_000, sentiment: "LB" }, { oi: 2_600_000, sentiment: "Neutral" }),
      strike(23_050, { oi: 2_100_000, sentiment: "Neutral" }, { oi: 9_100_000, sentiment: "SB" }),
      strike(22_900, { oi: 1_900_000, sentiment: "Neutral" }, { oi: 6_400_000, sentiment: "SB" }),
    ],
    control: {
      verdict: "put_writers",
      ce_doi: 1_400_000,
      pe_doi: 4_300_000,
      atm_ce_iv: 14.8,
      atm_pe_iv: 15.2,
      skew: -1.8,
      gex_regime: "long",
    },
    regime: {
      verdict: "trend_buy",
      range_pts: 240,
      range_baseline_pts: 190,
      range_pct: 1.03,
      rv: 12.8,
      iv: 15.0,
      straddle_open: 150,
      straddle_now: 160,
      straddle_pct: 6.67,
      bars: 30,
      warmup: false,
    },
    vix: { ltp: 13.1, prev_close: 13.45, change_pct: -2.6, day_high: 13.5, day_low: 13.0 },
    strength: {
      verdict: "strong",
      score: 74.1,
      ema9: 23_250,
      ema20: 23_193,
      ema50: 23_050,
      rsi: 63.4,
      pos_in_range: 0.72,
    },
    market: { is_open: true, session_date: "2026-10-21", as_of: "2026-10-21T14:05:00+05:30" },
    reference: {
      strike: 23_250,
      ce_open: 120,
      pe_open: 150,
      ce_ltp: 128,
      pe_ltp: 140,
      ce_change: 6.67,
      pe_change: -6.67,
      since: "2026-10-21T09:20:00+05:30",
    },
    intraday: intraday({
      base: 23_250,
      lowAt: { 0: 23_050, 5: 23_100, 12: 23_100, 18: 23_100 },
      closeAt: { 24: 23_230, 29: 23_272 },
    }),
  });
}

describe("buildDeskPlan — bearish tape formatting", () => {
  const plan = buildDeskPlan(bearishReport());

  test("reasons are ordered by weight and every tag appears", () => {
    expect(plan.bear.reasons.map((r) => r.tag)).toEqual([...DESK_REASON_TAGS]);
    expect(plan.bull.reasons.map((r) => r.tag)).toEqual([...DESK_REASON_TAGS]);
  });

  test("reason text carries the actual numbers", () => {
    const byTag = new Map(plan.bear.reasons.map((r) => [r.tag, r.text]));
    expect(byTag.get("trend")).toContain("22,728");
    expect(byTag.get("trend")).toContain("22,969");
    expect(byTag.get("trend")).toContain("38.2");
    expect(byTag.get("gamma")).toContain("short gamma");
    expect(byTag.get("gamma")).toContain("23,050");
    expect(byTag.get("oi")).toContain("23,200");
    expect(byTag.get("oi")).toContain("1.24 Cr");
    expect(byTag.get("vol")).toContain("IV/RV 1.17");
    expect(byTag.get("vol")).toContain("25Δ skew -2.40");
    expect(byTag.get("structure")).toContain("held 4 tests");
    expect(byTag.get("structure")).toContain("22,690");
  });

  test("DON'T bullets warn about support, the chase and a third leg", () => {
    expect(plan.bear.doNots).toHaveLength(3);
    const text = plan.bear.doNots.join(" | ");
    expect(text).toContain("Don't buy puts into 22,700 support");
    expect(text).toContain("IV/RV 1.17");
    expect(text).toContain("5 min");
    expect(text).toContain("PE 151.0→160.0");
    expect(text).toContain("third long-premium leg");
  });
});

describe("buildDeskPlan — bullish tape formatting", () => {
  const plan = buildDeskPlan(bullishReport());

  test("reasons keep the same weight order and numeric text", () => {
    expect(plan.bull.reasons.map((r) => r.tag)).toEqual([...DESK_REASON_TAGS]);
    const byTag = new Map(plan.bull.reasons.map((r) => [r.tag, r.text]));
    expect(byTag.get("trend")).toContain("23,272");
    expect(byTag.get("trend")).toContain("all trend markers below spot");
    expect(byTag.get("gamma")).toContain("long gamma");
    expect(byTag.get("vol")).toContain("IV/RV 1.17");
    expect(byTag.get("structure")).toContain("resistance 23,277");
  });

  test("DON'T bullets mirror the bear side around resistance", () => {
    expect(plan.bull.doNots).toHaveLength(3);
    const text = plan.bull.doNots.join(" | ");
    expect(text).toContain("Don't buy calls into 23,277 resistance");
    expect(text).toContain("spot +42 pts in 5 min");
    expect(text).toContain("CE 120.0→128.0");
    expect(text).toContain("third long-premium leg");
  });
});

describe("buildDeskPlan — missing blocks degrade", () => {
  test("an empty report returns a NEUTRAL plan instead of throwing", () => {
    const empty = baseReport({
      spot: 0,
      ohlc: { open: 0, high: 0, low: 0, close: 0 },
      walls: { calls: [], puts: [] },
      strikes: [],
      pivots: null,
      gex: undefined,
      control: undefined,
      regime: undefined,
      vix: undefined,
      strength: undefined,
      market: undefined,
      reference: undefined,
      intraday: undefined,
    });

    expect(() => buildDeskPlan(empty)).not.toThrow();
    const plan = buildDeskPlan(empty);
    expect(plan.bias).toBe("neutral");
    expect(plan.support).toBeNull();
    expect(plan.resistance).toBeNull();
    // No trend/gamma/OI/vol/structure input → every reason bucket is omitted.
    expect(plan.bear.reasons).toEqual([]);
    expect(plan.bull.reasons).toEqual([]);
    expect(plan.bear.entryTrigger).toContain("wait for pivots");
    expect(plan.bear.stop).toBeNull();
    expect(plan.bear.target).toBeNull();
    expect(plan.bear.rr).toBeNull();
    expect(plan.bear.alternate).toBeNull();
    expect(plan.waitNote).toBe("Wait for pivots/GEX levels to print.");
    // Only the "third leg" guard survives without levels.
    expect(plan.bear.doNots).toHaveLength(1);
  });

  test("pivots/gex gone but strength + session low still explain the tape", () => {
    const partial = bearishReport();
    const plan = buildDeskPlan({
      ...partial,
      pivots: null,
      gex: undefined,
      walls: { calls: [], puts: [] },
      strikes: [],
    });
    expect(plan.bias).toBe("neutral");
    expect(plan.support).toBe(22_690); // session low
    // Max pain is the only level above spot left in the payload.
    expect(plan.resistance).toBe(22_900);
    expect(plan.bear.reasons.map((r) => r.tag)).toEqual(["trend", "vol", "structure"]);
    // No structural level below the break: project 2× risk instead.
    expect(plan.bear.target).toBeCloseTo(22_653.7, 1);
    expect(plan.bear.rr).toBeCloseTo(2, 1);
  });
});

describe("deskPlanLevels — nearest level selection", () => {
  test("null, NaN and negative candidates are ignored on both sides", () => {
    const plan = buildDeskPlan(
      baseReport({
        spot: 25_000,
        maxPain: 25_050,
        ohlc: { open: 25_000, high: 25_000, low: 25_000, close: 25_000 },
        pivots: {
          type: "classic",
          pp: 25_000,
          r1: Number.NaN,
          r2: -100,
          r3: 26_000,
          s1: Number.NaN,
          s2: -200,
          s3: 24_000,
          prev: { date: "2026-10-20", high: 25_000, low: 25_000, close: 25_000 },
        },
        gex: {
          strikes: [],
          netTotal: 0,
          regime: "flat",
          topPositive: [],
          topNegative: [],
          zeroCross: null,
          levels: {
            support: { strike: 24_800, netGex: 1 },
            resistance: { strike: 25_200, netGex: 1 },
            fuelDown: null,
            fuelUp: null,
          },
        },
        walls: {
          calls: [{ strike: 25_100, oi: 100 }],
          puts: [{ strike: 24_900, oi: 100 }],
        },
      }),
    );

    expect(plan.resistance).toBe(25_050);
    expect(plan.support).toBe(24_900);
    expect(plan.bull.triggerLevel).toBe(25_050);
    expect(plan.bear.triggerLevel).toBe(24_900);
  });
});
