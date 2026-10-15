// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi } from "vitest";
import * as palette from "@/ui/palette";

vi.mock("@/state/auth", () => ({ fetchWithAuth: vi.fn() }));

import { normalizeReport } from "@/api/reportNifty";
import {
  VERDICT_DASH,
  controlAccent,
  fmtVerdictChange,
  fmtVerdictNum,
  regimeAccent,
  strengthAccent,
  vixAccent,
} from "./NiftyVerdictStrip";

describe("normalizeReport verdict blocks (snake_case -> typed, null-safe)", () => {
  const raw = {
    mode: "live",
    control: {
      verdict: "call_writers",
      ce_doi: 5_530_000,
      pe_doi: -1_200_000,
      atm_ce_iv: 12.5,
      atm_pe_iv: 13.1,
      skew: -2.4,
      gex_regime: "short",
    },
    regime: {
      verdict: "range_sell_premium",
      range_pts: 180,
      range_baseline_pts: 210,
      range_pct: 0.7,
      rv: 11.2,
      iv: 12.4,
      straddle_open: 150,
      straddle_now: 120,
      straddle_pct: -20,
    },
    vix: {
      ltp: 13.45,
      prev_close: 13.8,
      change_pct: -2.54,
      day_high: 13.9,
      day_low: 13.2,
    },
    strength: {
      verdict: "strong",
      score: 72.5,
      ema20: 25700,
      ema50: 25600,
      rsi: 61.3,
      pos_in_range: 0.8,
    },
  };

  test("maps every control/regime/vix/strength field", () => {
    const rep = normalizeReport(raw as Record<string, unknown>);
    expect(rep.control).toEqual({
      verdict: "call_writers",
      ce_doi: 5_530_000,
      pe_doi: -1_200_000,
      atm_ce_iv: 12.5,
      atm_pe_iv: 13.1,
      skew: -2.4,
      gex_regime: "short",
    });
    expect(rep.regime?.verdict).toBe("range_sell_premium");
    expect(rep.regime?.straddle_pct).toBe(-20);
    expect(rep.vix).toEqual({
      ltp: 13.45,
      prev_close: 13.8,
      change_pct: -2.54,
      day_high: 13.9,
      day_low: 13.2,
    });
    expect(rep.strength?.verdict).toBe("strong");
    expect(rep.strength?.rsi).toBe(61.3);
  });

  test("accepts camelCase keys too", () => {
    const rep = normalizeReport({
      control: { verdict: "put_writers", ceDoi: 1, peDoi: 2, gexRegime: "long" },
      regime: { rangePts: 10, rangeBaselinePts: 20, straddlePct: 5 },
      vix: { changePct: 1.1, dayHigh: 2, dayLow: 1 },
      strength: { posInRange: 0.5 },
    } as Record<string, unknown>);
    expect(rep.control?.verdict).toBe("put_writers");
    expect(rep.control?.ce_doi).toBe(1);
    expect(rep.regime?.range_pts).toBe(10);
    expect(rep.vix?.change_pct).toBe(1.1);
    expect(rep.strength?.pos_in_range).toBe(0.5);
  });

  test("absent or empty blocks stay undefined", () => {
    const rep = normalizeReport({ mode: "live" } as Record<string, unknown>);
    expect(rep.control).toBeUndefined();
    expect(rep.regime).toBeUndefined();
    expect(rep.vix).toBeUndefined();
    expect(rep.strength).toBeUndefined();
    const empty = normalizeReport({
      control: {},
      regime: {},
      vix: {},
      strength: {},
    } as Record<string, unknown>);
    expect(empty.control).toBeUndefined();
    expect(empty.vix).toBeUndefined();
  });

  test("partial block -> unknown verdict is null, missing fields are null", () => {
    const rep = normalizeReport({
      control: { verdict: "bogus", ce_doi: 1000 },
      regime: { verdict: "TREND_BUY" },
      strength: {},
    } as Record<string, unknown>);
    expect(rep.control?.verdict).toBeNull();
    expect(rep.control?.ce_doi).toBe(1000);
    expect(rep.control?.pe_doi).toBeNull();
    expect(rep.control?.skew).toBeNull();
    expect(rep.regime?.verdict).toBe("trend_buy");
    expect(rep.regime?.range_pts).toBeNull();
    expect(rep.strength).toBeUndefined();
  });

  test("non-finite / empty-string numbers become null", () => {
    const rep = normalizeReport({
      vix: { ltp: "abc", prev_close: "", change_pct: NaN, day_high: null },
    } as Record<string, unknown>);
    expect(rep.vix).toEqual({
      ltp: null,
      prev_close: null,
      change_pct: null,
      day_high: null,
      day_low: null,
    });
  });
});

describe("verdict formatting helpers", () => {
  test("fmtVerdictNum groups (Indian) and dashes absent values", () => {
    expect(fmtVerdictNum(5_530_000)).toBe("55,30,000");
    expect(fmtVerdictNum(-1_200_000)).toBe("-12,00,000");
    expect(fmtVerdictNum(-2.4, 2)).toBe("-2.40");
    expect(fmtVerdictNum(72.5, 1)).toBe("72.5");
    expect(fmtVerdictNum(null)).toBe(VERDICT_DASH);
    expect(fmtVerdictNum(undefined, 2)).toBe(VERDICT_DASH);
    expect(fmtVerdictNum(NaN)).toBe(VERDICT_DASH);
  });

  test("fmtVerdictChange always signs, dashes absent values", () => {
    expect(fmtVerdictChange(2.5)).toBe("+2.50");
    expect(fmtVerdictChange(-2.54)).toBe("-2.54");
    expect(fmtVerdictChange(0)).toBe("0.00");
    expect(fmtVerdictChange(null)).toBe(VERDICT_DASH);
  });
});

describe("verdict accent colours (from palette tokens)", () => {
  test("control: call writers bearish, put writers bullish, else muted", () => {
    expect(controlAccent("call_writers")).toBe(palette.NEGATIVE);
    expect(controlAccent("put_writers")).toBe(palette.POSITIVE);
    expect(controlAccent("balanced")).toBe(palette.TEXT_MUTED);
    expect(controlAccent(null)).toBe(palette.TEXT_MUTED);
  });

  test("regime: trend positive, range warning, else muted", () => {
    expect(regimeAccent("trend_buy")).toBe(palette.POSITIVE);
    expect(regimeAccent("range_sell_premium")).toBe(palette.WARNING);
    expect(regimeAccent("neutral")).toBe(palette.TEXT_MUTED);
  });

  test("vix: rising warns, falling positive, flat/absent muted", () => {
    expect(vixAccent(2.1)).toBe(palette.WARNING);
    expect(vixAccent(-1.2)).toBe(palette.POSITIVE);
    expect(vixAccent(0)).toBe(palette.TEXT_MUTED);
    expect(vixAccent(null)).toBe(palette.TEXT_MUTED);
  });

  test("strength: strong positive, weak negative, else muted", () => {
    expect(strengthAccent("strong")).toBe(palette.POSITIVE);
    expect(strengthAccent("weak")).toBe(palette.NEGATIVE);
    expect(strengthAccent("neutral")).toBe(palette.TEXT_MUTED);
    expect(strengthAccent(undefined)).toBe(palette.TEXT_MUTED);
  });
});
