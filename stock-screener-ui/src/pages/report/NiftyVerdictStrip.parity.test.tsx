// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("@/state/auth", () => ({ fetchWithAuth: vi.fn() }));

import { UIProvider } from "@/ui";
import { normalizeReport } from "@/api/reportNifty";
import { NiftyVerdictStrip } from "./NiftyVerdictStrip";
import type { NiftyReport } from "@/types/niftyReport";

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: ({ children }) => <UIProvider>{children}</UIProvider> });
}

/**
 * SENSEX EOD-shaped raw payload (snake_case, as the backend sends it).
 * Carries every block the replay frames were dropping: control / regime /
 * vix / strength / pivots / reference / ohlc. Extra backend-only keys
 * (`source`, `rv_iv_ratio`) ride along and must not break normalization.
 */
export function sensexRawPayload() {
  return {
    mode: "live",
    date: "2026-10-28",
    expiry: "2026-10-30",
    spot: 84250.75,
    ohlc: { open: 84000, high: 84500, low: 83900, close: 84250.75 },
    pcrOi: 1.05,
    pcrVol: 0.9,
    maxPain: 84200,
    walls: {
      calls: [{ strike: 84500, oi: 5000 }],
      puts: [{ strike: 84000, oi: 6000 }],
    },
    strikes: [],
    timeline: [],
    control: {
      verdict: "put_writers",
      ce_doi: 1_200_000,
      pe_doi: 5_530_000,
      atm_ce_iv: 12.5,
      atm_pe_iv: 13.1,
      skew: -2.4,
      gex_regime: "long",
    },
    regime: {
      verdict: "trend_buy",
      range_pts: 180,
      range_baseline_pts: 210,
      range_pct: 0.7,
      rv: 14.2,
      iv: 11.8,
      rv_iv_ratio: 1.2,
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
      source: "INDIA_VIX",
    },
    strength: {
      verdict: "strong",
      score: 72.5,
      ema20: 84000,
      ema50: 83800,
      rsi: 61.3,
      pos_in_range: 0.8,
    },
    pivots: {
      type: "classic",
      pp: 84100,
      r1: 84350,
      r2: 84500,
      r3: 84700,
      s1: 83900,
      s2: 83700,
      s3: 83500,
      prev: { date: "2026-10-27", high: 84300, low: 83900, close: 84150 },
    },
    reference: {
      strike: 84200,
      ce_open: 120,
      pe_open: 110,
      ce_ltp: 100.5,
      pe_ltp: 95.25,
      ce_change: -19.5,
      pe_change: -14.75,
      since: "2026-10-28T09:15:00+05:30",
    },
  } as unknown as Record<string, unknown>;
}

describe("NiftyVerdictStrip SENSEX parity (no dashes on enriched frames)", () => {
  test("control / regime / VIX / strength all render values, never —", () => {
    const report = normalizeReport(sensexRawPayload());
    r(<NiftyVerdictStrip report={report} mode="full" />);

    const control = screen.getByTestId("nifty-verdict-control");
    expect(within(control).getByTestId("nifty-verdict-control-primary")).toHaveTextContent(
      "SESSION · PUT WRITING",
    );

    const regime = screen.getByTestId("nifty-verdict-regime");
    expect(within(regime).getByTestId("nifty-verdict-regime-primary")).toHaveTextContent(
      "BUY PREMIUM",
    );
    expect(within(regime).getByTestId("nifty-verdict-regime-secondary")).toHaveTextContent(
      "RV 14.20 / IV 11.80",
    );

    const vix = screen.getByTestId("nifty-verdict-vix");
    expect(within(vix).getByTestId("nifty-verdict-vix-primary")).toHaveTextContent("13.45");
    expect(within(vix).getByTestId("nifty-verdict-vix-primary")).toHaveTextContent("-2.54");
    expect(within(vix).getByTestId("nifty-verdict-vix-secondary")).toHaveTextContent(
      "day 13.20–13.90",
    );

    const strength = screen.getByTestId("nifty-verdict-strength");
    expect(within(strength).getByTestId("nifty-verdict-strength-primary")).toHaveTextContent(
      "STRONG",
    );
    expect(within(strength).getByTestId("nifty-verdict-strength-secondary")).toHaveTextContent(
      "score 72.5",
    );
    expect(within(strength).getByTestId("nifty-verdict-strength-secondary")).toHaveTextContent(
      "RSI 61.3",
    );

    // The bug: replay frames without these blocks rendered every cell as —.
    for (const cell of [control, regime, vix, strength]) {
      expect(cell.textContent ?? "").not.toContain("—");
    }
  });
});

describe("normalizeReport SENSEX guard (backend replay-frame parity)", () => {
  test("carries vix / control / regime / strength / pivots / reference / ohlc", () => {
    const rep: NiftyReport = normalizeReport(sensexRawPayload());
    expect(rep.control?.verdict).toBe("put_writers");
    expect(rep.regime?.verdict).toBe("trend_buy");
    expect(rep.regime?.rv).toBe(14.2);
    expect(rep.regime?.iv).toBe(11.8);
    expect(rep.vix?.ltp).toBe(13.45);
    expect(rep.vix?.change_pct).toBe(-2.54);
    expect(rep.vix?.day_low).toBe(13.2);
    expect(rep.vix?.day_high).toBe(13.9);
    expect(rep.strength?.verdict).toBe("strong");
    expect(rep.strength?.score).toBe(72.5);
    expect(rep.strength?.rsi).toBe(61.3);
    expect(rep.pivots?.pp).toBe(84100);
    expect(rep.reference?.strike).toBe(84200);
    expect(rep.reference?.ce_ltp).toBe(100.5);
    expect(rep.reference?.pe_ltp).toBe(95.25);
    expect(rep.ohlc).toEqual({ open: 84000, high: 84500, low: 83900, close: 84250.75 });
  });
});
