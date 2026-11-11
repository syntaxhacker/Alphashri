// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";
import type {
  NiftyIntradayCandle,
  NiftyOptionSide,
  NiftyReport,
  NiftyStrike,
} from "@/types/niftyReport";
import { buildDeskPlan, deskBias, DESK_REASON_TAGS } from "./deskPlan";

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

/** 30 one-minute bars with explicit lows and closes; session low = 22,690. */
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

function neutralReport(): NiftyReport {
  return baseReport({
    spot: 22_950,
    // Day-OHLC stays coherent with the chart candles (low = candle min,
    // high above the candle max) so the combined session extremes match.
    ohlc: { open: 22_920, high: 23_060, low: 22_860, close: 22_950 },
    pivots: {
      type: "classic",
      pp: 22_940,
      r1: 23_100,
      r2: 23_300,
      r3: 23_500,
      s1: 22_800,
      s2: 22_650,
      s3: 22_500,
      prev: { date: "2026-10-20", high: 23_100, low: 22_800, close: 22_940 },
    },
    gex: {
      strikes: [],
      netTotal: 0.4,
      regime: "flat",
      topPositive: [],
      topNegative: [],
      zeroCross: null,
      levels: {
        support: { strike: 22_800, netGex: 0.2 },
        resistance: { strike: 23_050, netGex: 0.1 },
        fuelDown: null,
        fuelUp: null,
      },
    },
    walls: {
      calls: [{ strike: 23_200, oi: 8_000_000 }],
      puts: [{ strike: 22_850, oi: 7_400_000 }],
    },
    strikes: [
      strike(22_900, { oi: 3_000_000, sentiment: "LB" }, { oi: 3_200_000, sentiment: "LB" }),
      strike(23_000, { oi: 4_000_000, sentiment: "SB" }, { oi: 2_900_000, sentiment: "SB" }),
    ],
    control: {
      verdict: "balanced",
      ce_doi: 120_000,
      pe_doi: 80_000,
      atm_ce_iv: 12.6,
      atm_pe_iv: 12.8,
      skew: -0.4,
      gex_regime: "flat",
    },
    regime: {
      verdict: "neutral",
      range_pts: 120,
      range_baseline_pts: 130,
      range_pct: 0.52,
      rv: 12.0,
      iv: 12.7,
      straddle_open: 110,
      straddle_now: 108,
      straddle_pct: -1.8,
      bars: 30,
      warmup: false,
    },
    vix: { ltp: 12.4, prev_close: 12.5, change_pct: -0.8, day_high: 12.6, day_low: 12.3 },
    strength: {
      verdict: "neutral",
      score: 50.4,
      ema9: 22_945,
      ema20: 22_930,
      ema50: 22_935,
      rsi: 50.1,
      pos_in_range: 0.5,
    },
    market: { is_open: true, session_date: "2026-10-21", as_of: "2026-10-21T14:05:00+05:30" },
    reference: null,
    intraday: intraday({
      base: 22_950,
      lowAt: { 0: 22_860, 10: 22_860 },
      closeAt: { 24: 22_948, 29: 22_950 },
    }),
  });
}

describe("buildDeskPlan — bearish tape", () => {
  const plan = buildDeskPlan(bearishReport());

  test("bias is bearish and only the bear column is active", () => {
    expect(plan.bias).toBe("bearish");
    expect(deskBias(bearishReport())).toBe("bearish");
    expect(plan.bear.bias).toBe("bearish");
    expect(plan.bull.bias).toBe("neutral");
  });

  test("nearest support is the 22,700 pivot, the cap is the 22,900 max pain", () => {
    expect(plan.spot).toBe(22_728);
    expect(plan.support).toBe(22_700);
    expect(plan.resistance).toBe(22_900);
    // The 22,690 session low is the level a close has to break, not 22,700.
    expect(plan.downsideBreak).toBe(22_690);
  });

  test("DO block carries the break trigger, stop above it and next support", () => {
    expect(plan.bear.action).toBe("Sell rallies / buy puts on a failed retest");
    expect(plan.bear.entryKind).toBe("break");
    expect(plan.bear.triggerLevel).toBe(22_690);
    expect(plan.bear.entryTrigger).toContain("22,690");
    expect(plan.bear.entryTrigger).toContain("session low");
    // Stop = 22,690 + max(8 pts, 0.08% of 22,690) = 22,690 + 18.15.
    expect(plan.bear.stop).toBeCloseTo(22_708.15, 2);
    // Next level below 22,690 is the 22,650 put wall.
    expect(plan.bear.target).toBe(22_650);
    expect(plan.bear.rr).toBeGreaterThanOrEqual(1.5);
    expect(plan.bear.rr).toBeCloseTo(2.2, 1);
  });

  test("bear counter-case rejects 22,900 with a stop above it", () => {
    expect(plan.bear.alternate?.kind).toBe("rejection");
    expect(plan.bear.alternate?.trigger).toContain("22,900");
    expect(plan.bear.alternate?.stop).toBeCloseTo(22_918.32, 2);
    // A rejection targets the nearest support, not the break level.
    expect(plan.bear.alternate?.target).toBe(22_700);
    expect(plan.bear.alternate?.rr).toBeGreaterThanOrEqual(1.5);
  });

  test("bull trigger is a break above spot, never the support below it", () => {
    expect(plan.bull.entryKind).toBe("break");
    expect(plan.bull.triggerLevel).toBe(22_900);
    expect(plan.bull.triggerLevel).toBeGreaterThan(plan.spot as number);
    expect(plan.bull.entryTrigger).toContain("22,900");
    expect(plan.bull.stop).toBeCloseTo(22_881.68, 2);
    expect(plan.bull.target).toBe(23_000);
    expect(plan.bull.rr).toBeGreaterThanOrEqual(1.5);
  });

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

describe("buildDeskPlan — bullish tape", () => {
  const plan = buildDeskPlan(bullishReport());

  test("bias is bullish and only the bull column is active", () => {
    expect(plan.bias).toBe("bullish");
    expect(plan.bull.bias).toBe("bullish");
    expect(plan.bear.bias).toBe("neutral");
  });

  test("support/resistance and the symmetric DO numbers", () => {
    expect(plan.support).toBe(23_100);
    // The 23,277 session high (chart max 23,277 beats ohlc.high 23,020) is the
    // first supply above spot, so it outranks the 23,350 GEX resistance.
    expect(plan.resistance).toBe(23_277);
    expect(plan.bull.triggerLevel).toBe(23_277);
    expect(plan.bull.entryTrigger).toContain("close above 23,277");
    // Stop = 23,277 − max(8 pts, 0.08% of 23,277) = 23,277 − 18.62.
    expect(plan.bull.stop).toBeCloseTo(23_258.38, 2);
    // Next level above 23,277 is the 23,350 GEX resistance.
    expect(plan.bull.target).toBe(23_350);
    expect(plan.bull.rr).toBeGreaterThanOrEqual(1.5);
  });

  test("bull counter-case buys the failed breakdown at 23,100", () => {
    expect(plan.bull.alternate?.kind).toBe("failed_breakdown");
    expect(plan.bull.alternate?.triggerLevel).toBe(23_100);
    expect(plan.bull.alternate?.stop).toBeCloseTo(23_081.52, 2);
    expect(plan.bull.alternate?.target).toBe(23_277);
    expect(plan.bull.alternate?.rr).toBeGreaterThanOrEqual(1.5);
  });

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

describe("buildDeskPlan — neutral tape", () => {
  const plan = buildDeskPlan(neutralReport());

  test("flat gamma keeps both columns neutral", () => {
    expect(plan.bias).toBe("neutral");
    expect(plan.bull.bias).toBe("neutral");
    expect(plan.bear.bias).toBe("neutral");
  });

  test("both sides still carry ordered reasons and a measurable wait plan", () => {
    expect(plan.support).toBe(22_900);
    expect(plan.resistance).toBe(23_050);
    expect(plan.downsideBreak).toBe(22_860);
    expect(plan.waitNote).toBe(
      "Wait for a reclaim of 23,050 or a close below 22,860.",
    );
    expect(plan.bull.action).toBe("Wait");
    expect(plan.bear.action).toBe("Wait");
    expect(plan.bull.reasons.map((r) => r.tag)).toEqual([...DESK_REASON_TAGS]);
    expect(plan.bear.reasons.map((r) => r.tag)).toEqual([...DESK_REASON_TAGS]);
    expect(plan.bull.triggerLevel).toBe(23_050);
    expect(plan.bear.triggerLevel).toBe(22_860);
  });

  test("a target that pays less than 1.5R is skipped", () => {
    // 22,850 is only 10 pts away against an 18.29-pt stop (0.55R) — too close.
    expect(plan.bear.target).toBe(22_800);
    expect(plan.bear.rr).toBeGreaterThanOrEqual(1.5);
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

describe("buildDeskPlan — stale candles vs fresh day-OHLC (2026-10-21 live bug)", () => {
  // Live screenshot: spot 22,698 with session low 22,695, yet the bear break
  // read "1-min close below 22,500 (below support)". The quote feed had
  // printed ohlc.low 22,695 while the 1-minute chart candles were stale (min
  // low 22,700, above spot), so the candle-only extreme dropped out of the
  // support set and the trigger fell through to the far 22,500 GEX fuel. The
  // desk must fold ohlc.low into the session low and trigger off the nearest
  // support instead.
  function staleCandlesReport(): NiftyReport {
    const bars: NiftyIntradayCandle[] = Array.from({ length: 10 }, (_, index) => ({
      time: `13:${String(32 + index).padStart(2, "0")}`,
      open: 22_704,
      high: 22_709,
      low: 22_700,
      close: 22_703,
    }));
    return baseReport({
      spot: 22_698,
      ohlc: { open: 22_800, high: 22_810, low: 22_695, close: 22_698 },
      maxPain: 22_900,
      pivots: {
        type: "classic",
        pp: 22_750,
        r1: 22_900,
        r2: 23_100,
        r3: 23_300,
        s1: 22_764,
        s2: 22_400,
        s3: 22_200,
        prev: { date: "2026-10-20", high: 22_900, low: 22_600, close: 22_750 },
      },
      gex: {
        strikes: [],
        netTotal: -8.4,
        regime: "short",
        topPositive: [],
        topNegative: [],
        zeroCross: 22_800,
        levels: {
          support: { strike: 22_650, netGex: 1.1 },
          resistance: { strike: 22_950, netGex: 2.1 },
          fuelDown: { strike: 22_500, netGex: -1.8 },
          fuelUp: { strike: 23_700, netGex: -2.2 },
        },
      },
      walls: {
        calls: [{ strike: 23_000, oi: 8_400_000 }],
        puts: [{ strike: 22_000, oi: 9_100_000 }],
      },
      strikes: [],
      strength: {
        verdict: "weak",
        score: 31.2,
        ema9: null,
        ema20: 22_760,
        ema50: 22_780,
        rsi: 38.2,
        pos_in_range: 0.22,
      },
      intraday: bars,
    });
  }

  const plan = buildDeskPlan(staleCandlesReport());

  test("nearest support is the 22,695 session low, not the 22,500 fuel", () => {
    expect(plan.bias).toBe("bearish");
    expect(plan.spot).toBe(22_698);
    expect(plan.support).toBe(22_695);
    expect(plan.downsideBreak).toBe(22_695);
  });

  test("bear trigger sits on the session low with a paying target", () => {
    expect(plan.bear.triggerLevel).toBeGreaterThanOrEqual(22_690);
    expect(plan.bear.triggerLevel).toBeLessThanOrEqual(22_695);
    expect(plan.bear.triggerLevel).toBe(22_695);
    expect(plan.bear.entryTrigger).toContain("22,695");
    expect(plan.bear.entryTrigger).not.toContain("22,500");
    // Stop = 22,695 + max(8 pts, 0.08% of 22,695) = 22,695 + 18.16.
    expect(plan.bear.stop).toBeCloseTo(22_713.16, 2);
    // Next structural level below the trigger is the 22,500 GEX fuel.
    expect(plan.bear.target).toBe(22_500);
    expect(plan.bear.rr).toBeGreaterThanOrEqual(1.5);
  });

  test("bull side stays symmetric around the session high", () => {
    expect(plan.resistance).toBe(22_810);
    expect(plan.bull.triggerLevel).toBe(22_810);
    expect(plan.bull.triggerLevel).toBeGreaterThan(plan.spot as number);
    expect(plan.bull.entryTrigger).toContain("close above 22,810");
    expect(plan.bull.target).toBe(22_900);
    expect(plan.bull.rr).toBeGreaterThanOrEqual(1.5);
  });
});
