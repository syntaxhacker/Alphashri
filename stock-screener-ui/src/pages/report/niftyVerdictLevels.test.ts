import { describe, expect, test } from "vitest";
import * as palette from "@/ui/palette";
import type { NiftyGex, NiftyReport } from "@/types/niftyReport";
import { buildDeskPlan } from "./deskPlan";
import { CHART_HEIGHTS } from "./NiftyChartPanel.constants";
import { labelGapPctFor } from "./niftyChartMath";
import { verdictMarkLines } from "./niftyVerdictLevels";

function gexBlock(regime: "long" | "short"): NiftyGex {
  return {
    strikes: [],
    netTotal: regime === "short" ? -10 : 10,
    regime,
    topPositive: [],
    topNegative: [],
    zeroCross: null,
  };
}

function baseReport(overrides: Record<string, unknown> = {}): NiftyReport {
  return {
    mode: "live",
    date: "2026-11-24",
    spot: 25540,
    ohlc: { open: 25600, high: 25640, low: 25520, close: 25540 },
    maxPain: 25450,
    walls: { calls: [], puts: [] },
    strikes: [],
    timeline: [],
    intraday: [],
    candles: [],
    pivots: null,
    gex: null,
    ...overrides,
  } as unknown as NiftyReport;
}

function pivots(overrides: Record<string, number | null> = {}) {
  return {
    type: "classic",
    pp: 25600,
    r1: 25700,
    r2: 25800,
    r3: 25900,
    s1: 25500,
    s2: 25400,
    s3: 25300,
    prev: null,
    ...overrides,
  };
}

function strength(ema20: number) {
  return {
    verdict: "weak" as const,
    score: 20,
    ema9: ema20 - 20,
    ema20,
    ema50: ema20 + 60,
    rsi: 40,
    pos_in_range: 0.2,
  };
}

function bearReport(overrides: Record<string, unknown> = {}): NiftyReport {
  return baseReport({
    strength: strength(25620),
    gex: gexBlock("short"),
    pivots: pivots(),
    ...overrides,
  });
}

function bullReport(overrides: Record<string, unknown> = {}): NiftyReport {
  return baseReport({
    spot: 25680,
    ohlc: { open: 25640, high: 25730, low: 25650, close: 25680 },
    maxPain: 25750,
    strength: strength(25620),
    gex: gexBlock("long"),
    pivots: pivots(),
    ...overrides,
  });
}

describe("verdictMarkLines", () => {
  test("verdictMarkLines emits only finite active-side trigger/stop/target", () => {
    const bear = bearReport();
    const bearPlan = buildDeskPlan(bear);
    const lines = verdictMarkLines(bear);

    expect(bearPlan.bias).toBe("bearish");
    expect(lines).toHaveLength(3);
    expect(lines.map((line) => line.yAxis)).toEqual([
      bearPlan.bear.triggerLevel,
      bearPlan.bear.stop,
      bearPlan.bear.target,
    ]);
    expect(lines.every((line) => Number.isFinite(line.yAxis))).toBe(true);
    expect(lines.map((line) => line.label.formatter)).toEqual([
      "SELL 25,520",
      "CUT 25,540",
      "TGT 25,450",
    ]);
    expect(lines.every((line) => typeof line.label.formatter === "string")).toBe(true);
    expect(
      lines.every((line) =>
        [palette.NEGATIVE, palette.POSITIVE].includes(line.lineStyle.color),
      ),
    ).toBe(true);
    expect(lines.some((line) => line.label.formatter.includes("BUY"))).toBe(false);

    const bull = bullReport();
    const bullPlan = buildDeskPlan(bull);
    const bullLines = verdictMarkLines(bull);
    expect(bullPlan.bias).toBe("bullish");
    expect(bullLines).toHaveLength(3);
    expect(bullLines.map((line) => line.yAxis)).toEqual([
      bullPlan.bull.triggerLevel,
      bullPlan.bull.stop,
      bullPlan.bull.target,
    ]);
    expect(bullLines.map((line) => line.label.formatter)).toEqual([
      "BUY 25,700",
      "CUT 25,679",
      "TGT 25,750",
    ]);
    expect(bullLines.some((line) => line.label.formatter.includes("SELL"))).toBe(false);
  });

  test("empty, neutral and non-finite plans produce no lines", () => {
    expect(verdictMarkLines(baseReport())).toEqual([]);
    expect(verdictMarkLines(baseReport({ spot: Number.NaN }))).toEqual([]);
    expect(
      verdictMarkLines(
        bearReport({
          pivots: pivots({ s1: Number.NaN, s2: Number.NaN, s3: Number.NaN }),
          ohlc: { open: Number.NaN, high: Number.NaN, low: Number.NaN, close: Number.NaN },
          maxPain: Number.NaN,
        }),
      ),
    ).toEqual([]);
    expect(
      verdictMarkLines(
        bearReport({
          walls: { calls: [{ strike: Number.NaN, oi: 10 }], puts: [] },
          intraday: [{ time: "2026-11-24T09:15:00", open: Number.NaN, high: Number.NaN, low: Number.NaN, close: Number.NaN }],
        }),
      ).some((line) => !Number.isFinite(line.yAxis)),
    ).toBe(false);
  });

  test("compact height merges colliding verdict labels via the shared helper", () => {
    const compact = bearReport({
      spot: 25500,
      ohlc: { open: 25550, high: 25600, low: 25500, close: 25500 },
      maxPain: 25300,
      pivots: pivots({ s1: 25400, s2: 25350, s3: 25300 }),
    });
    expect(verdictMarkLines(compact)).toHaveLength(3);

    const merged = verdictMarkLines(compact, labelGapPctFor(compact, CHART_HEIGHTS.s));
    expect(merged).toHaveLength(2);
    expect(
      merged.some(
        (line) =>
          line.label.formatter.includes("SELL") && line.label.formatter.includes("CUT"),
      ),
    ).toBe(true);
    expect(merged.some((line) => line.label.formatter.includes("TGT"))).toBe(true);
  });
});
