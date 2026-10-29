// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi } from "vitest";
import * as palette from "@/ui/palette";

vi.mock("@/state/auth", () => ({ fetchWithAuth: vi.fn() }));

import { normalizeReport } from "@/api/reportNifty";
import {
  REGIME_LABELS,
  VERDICT_DASH,
  controlAccent,
  controlLabel,
  fmtVerdictChange,
  fmtVerdictNum,
  regimeAccent,
  regimeDetail,
  resolveRegimeLabel,
  strengthAccent,
  vixAccent,
} from "./NiftyVerdictStrip";
import type { NiftyRegimeBlock } from "@/types/niftyReport";

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

  test("accepts buyer and neutral OI-build verdicts", () => {
    for (const verdict of [
      "put_buyers",
      "call_buyers",
      "net_put_build",
      "net_call_build",
    ]) {
      const rep = normalizeReport({
        control: { verdict },
      } as Record<string, unknown>);
      expect(rep.control?.verdict).toBe(verdict);
    }
  });

  test("accepts the direction-agnostic trend regime", () => {
    const rep = normalizeReport({
      regime: { verdict: "trend" },
    } as Record<string, unknown>);
    expect(rep.regime?.verdict).toBe("trend");
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
  test("regimeDetail carries the vol vote and the straddle's move from open", () => {
    const detail = regimeDetail({
      verdict: "range_sell_premium",
      range_pts: 180,
      range_baseline_pts: 210,
      range_pct: 0.7,
      rv: 12.5,
      iv: 15,
      straddle_open: 150,
      straddle_now: 120,
      straddle_pct: -20,
    });
    expect(detail).toContain("180 vs ~210 pts");
    expect(detail).toContain("RV 12.50 / IV 15.00");
    expect(detail).toContain("straddle -20.00%");
    expect(detail).toContain("Δ -30.00 pts");
  });

  test("regimeDetail omits the RV/IV and Δ clauses when inputs are absent", () => {
    const detail = regimeDetail(null);
    expect(detail).toContain("— vs ~— pts");
    expect(detail).toContain("straddle —%");
    expect(detail).not.toContain("RV");
    expect(detail).not.toContain("Δ");
  });

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

describe("resolveRegimeLabel (trend_buy follows the live RV/IV vote)", () => {
  const block = (rv: number | null, iv: number | null): NiftyRegimeBlock => ({
    verdict: "trend_buy",
    range_pts: null,
    range_baseline_pts: null,
    range_pct: null,
    rv,
    iv,
    straddle_open: null,
    straddle_now: null,
    straddle_pct: null,
  });

  test("rv > iv keeps the buy-premium read", () => {
    expect(resolveRegimeLabel("trend_buy", block(15.0, 12.5))).toBe(
      "BUY PREMIUM · RV > IV",
    );
  });

  test("iv > rv reuses the sell-premium vocabulary (premium-rich tape)", () => {
    // Live tape 2026-10-21: RV 12.5 < IV 15.0 rendered "BUY PREMIUM · RV > IV".
    expect(resolveRegimeLabel("trend_buy", block(12.5, 15.0))).toBe(
      "SELL PREMIUM · IV > RV",
    );
  });

  test("tied or absent vote falls back to TREND", () => {
    expect(resolveRegimeLabel("trend_buy", block(12.5, 12.5))).toBe("TREND");
    expect(resolveRegimeLabel("trend_buy", block(null, 15.0))).toBe("TREND");
    expect(resolveRegimeLabel("trend_buy", block(12.5, null))).toBe("TREND");
    expect(resolveRegimeLabel("trend_buy", null)).toBe("TREND");
  });

  test("other verdicts keep the static mapping", () => {
    expect(resolveRegimeLabel("range_sell_premium", block(15.0, 12.5))).toBe(
      "SELL PREMIUM",
    );
    expect(resolveRegimeLabel("neutral", block(15.0, 12.5))).toBe("NEUTRAL");
    expect(resolveRegimeLabel("trend", block(15.0, 12.5))).toBe("TREND");
    expect(resolveRegimeLabel(null, block(15.0, 12.5))).toBe(VERDICT_DASH);
  });

  test("the trend verdict has its own label (never blank)", () => {
    expect(REGIME_LABELS.trend).toBe("TREND");
  });
});

describe("control verdict labels", () => {
  test("buyer verdicts name the participant", () => {
    expect(controlLabel("put_buyers")).toBe("PUT BUYERS IN CONTROL");
    expect(controlLabel("call_buyers")).toBe("CALL BUYERS IN CONTROL");
  });

  test("missing flow degrades to a neutral OI-build label", () => {
    expect(controlLabel("net_put_build")).toBe("PUT OI BUILDING");
    expect(controlLabel("net_call_build")).toBe("CALL OI BUILDING");
  });

  test("known verdicts keep their existing labels, absent -> dash", () => {
    expect(controlLabel("call_writers")).toBe("CALL WRITERS IN CONTROL");
    expect(controlLabel("put_writers")).toBe("PUT WRITERS IN CONTROL");
    expect(controlLabel("balanced")).toBe("BALANCED");
    expect(controlLabel(null)).toBe(VERDICT_DASH);
    expect(controlLabel(undefined)).toBe(VERDICT_DASH);
  });
});

describe("verdict accent colours (from palette tokens)", () => {
  test("control: call writers bearish, put writers bullish, else muted", () => {
    expect(controlAccent("call_writers")).toBe(palette.NEGATIVE);
    expect(controlAccent("put_writers")).toBe(palette.POSITIVE);
    expect(controlAccent("balanced")).toBe(palette.TEXT_MUTED);
    expect(controlAccent(null)).toBe(palette.TEXT_MUTED);
  });

  test("control: call buyers bullish, put buyers bearish", () => {
    expect(controlAccent("call_buyers")).toBe(palette.POSITIVE);
    expect(controlAccent("put_buyers")).toBe(palette.NEGATIVE);
  });

  test("control: neutral OI builds stay muted", () => {
    expect(controlAccent("net_call_build")).toBe(palette.TEXT_MUTED);
    expect(controlAccent("net_put_build")).toBe(palette.TEXT_MUTED);
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
