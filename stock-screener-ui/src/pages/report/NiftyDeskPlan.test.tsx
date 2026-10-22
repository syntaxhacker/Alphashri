// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { UIProvider } from "@/ui";
import type {
  NiftyIntradayCandle,
  NiftyOptionSide,
  NiftyReport,
  NiftyStrike,
} from "@/types/niftyReport";
import { NiftyDeskPlan } from "./NiftyDeskPlan";

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

function bars(): NiftyIntradayCandle[] {
  return [
    { time: "09:15", open: 22_760, high: 22_765, low: 22_736, close: 22_760 },
    { time: "09:16", open: 22_760, high: 22_765, low: 22_700, close: 22_755 },
    { time: "09:17", open: 22_755, high: 22_760, low: 22_690, close: 22_750 },
    { time: "09:18", open: 22_750, high: 22_755, low: 22_736, close: 22_748 },
    { time: "09:19", open: 22_748, high: 22_753, low: 22_736, close: 22_746 },
    { time: "09:20", open: 22_746, high: 22_751, low: 22_700, close: 22_728 },
  ];
}

function bearishReport(): NiftyReport {
  return {
    mode: "live",
    date: "2026-10-21",
    expiry: "2026-10-23",
    spot: 22_728,
    ohlc: { open: 22_900, high: 23_020, low: 22_690, close: 22_728 },
    pcrOi: 1.02,
    pcrVol: 1.1,
    maxPain: 22_900,
    walls: {
      calls: [{ strike: 23_200, oi: 12_400_000 }],
      puts: [{ strike: 22_650, oi: 9_100_000 }],
    },
    strikes: [
      strike(22_700, { oi: 4_000_000, sentiment: "SB" }, { oi: 5_000_000, sentiment: "LB" }),
      strike(23_000, { oi: 8_400_000, sentiment: "SB" }, { oi: 2_400_000, sentiment: "Neutral" }),
      strike(22_650, { oi: 2_100_000, sentiment: "Neutral" }, { oi: 9_100_000, sentiment: "SB" }),
    ],
    timeline: [],
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
      bars: 6,
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
    intraday: bars(),
  };
}

function emptyReport(): NiftyReport {
  return {
    mode: "live",
    date: "2026-10-21",
    expiry: "",
    spot: 0,
    ohlc: { open: 0, high: 0, low: 0, close: 0 },
    pcrOi: 0,
    pcrVol: 0,
    maxPain: 0,
    walls: { calls: [], puts: [] },
    strikes: [],
    timeline: [],
  };
}

function renderPlan(report: NiftyReport) {
  return render(
    <UIProvider>
      <NiftyDeskPlan report={report} />
    </UIProvider>,
  );
}

describe("NiftyDeskPlan", () => {
  test("renders both sides with their bias badges", () => {
    renderPlan(bearishReport());
    expect(screen.getByTestId("nifty-desk-plan")).toBeInTheDocument();
    expect(screen.getByTestId("desk-side-bull")).toBeInTheDocument();
    expect(screen.getByTestId("desk-side-bear")).toBeInTheDocument();
    expect(screen.getByTestId("desk-bias-bear")).toHaveTextContent("BEARISH");
    expect(screen.getByTestId("desk-bias-bull")).toHaveTextContent("NEUTRAL");
  });

  test("renders the DO block with action, both triggers, inline stop/target/R:R", () => {
    renderPlan(bearishReport());
    expect(screen.getByTestId("desk-do-bear-action")).toHaveTextContent(
      "Sell rallies / buy puts on a failed retest",
    );
    const trigger = screen.getByTestId("desk-do-bear-trigger");
    expect(trigger).toHaveTextContent("22,690");
    expect(trigger).toHaveTextContent("reject 22,900");
    expect(screen.getByTestId("desk-do-bear-stop")).toHaveTextContent("22,708");
    expect(screen.getByTestId("desk-do-bear-target")).toHaveTextContent("22,650");
    expect(screen.getByTestId("desk-do-bear-rr")).toHaveTextContent("2.2");
    // The bull side is the counter-case: its break trigger is above spot.
    expect(screen.getByTestId("desk-do-bull-trigger")).toHaveTextContent("22,900");
    expect(screen.getByTestId("desk-do-bull-stop")).toHaveTextContent("22,882");
    expect(screen.getByTestId("desk-do-bull-target")).toHaveTextContent("23,000");
    expect(screen.getByTestId("desk-do-bull-rr")).toHaveTextContent("5.5");
    // No nested stop/target cards — one inline stats row per side.
    expect(screen.getByTestId("desk-do-bear-stats")).toBeInTheDocument();
    expect(screen.queryByText(/5 reasons/)).not.toBeInTheDocument();
  });

  test("renders the numbered reasons in weight order", () => {
    renderPlan(bearishReport());
    const tags = [0, 1, 2, 3, 4].map((index) =>
      within(screen.getByTestId(`desk-reason-bear-${index}`))
        .getByTestId(`desk-reason-tag-bear-${index}`)
        .textContent,
    );
    expect(tags).toEqual(["trend", "gamma", "oi", "vol", "structure"]);

    expect(screen.getByTestId("desk-reason-bear-0")).toHaveTextContent("1.");
    expect(screen.getByTestId("desk-reason-bear-4")).toHaveTextContent("5.");
    expect(screen.getByTestId("desk-reason-bear-0")).toHaveTextContent("22,728");
    expect(screen.getByTestId("desk-reason-bear-3")).toHaveTextContent("IV/RV 1.17");
  });

  test("renders the DON'T bullets for both sides", () => {
    renderPlan(bearishReport());
    expect(screen.getByTestId("desk-dont-label-bear")).toHaveTextContent(/don't/i);
    expect(screen.getByTestId("desk-dont-bear-0")).toHaveTextContent("22,700");
    expect(screen.getByTestId("desk-dont-bear-1")).toHaveTextContent("5 min");
    expect(screen.getByTestId("desk-dont-bear-2")).toHaveTextContent("third long-premium leg");
    expect(screen.getByTestId("desk-dont-bull-0")).toHaveTextContent("22,900");
    // The bearish tape has no bullish chase, so this side carries two bullets:
    // the rich-IV resistance warning and the third-leg guard.
    expect(screen.getByTestId("desk-dont-bull-1")).toHaveTextContent("third long-premium leg");
    expect(screen.queryByTestId("desk-dont-bull-2")).not.toBeInTheDocument();
  });

  test("a neutral tape shows one wait note, Wait actions and em-dash stats", () => {
    renderPlan(emptyReport());
    expect(screen.getByTestId("nifty-desk-plan")).toBeInTheDocument();
    expect(screen.getByTestId("desk-bias-bull")).toHaveTextContent("NEUTRAL");
    expect(screen.getByTestId("desk-bias-bear")).toHaveTextContent("NEUTRAL");
    expect(screen.getByTestId("desk-wait-note")).toHaveTextContent(
      "Wait for pivots/GEX levels to print.",
    );
    expect(screen.getByTestId("desk-do-bear-action")).toHaveTextContent("Wait");
    expect(screen.getByTestId("desk-do-bull-action")).toHaveTextContent("Wait");
    expect(screen.getByTestId("desk-do-bear-trigger")).toHaveTextContent("NO TRADE — wait");
    expect(screen.getByTestId("desk-do-bear-stop")).toHaveTextContent("—");
    expect(screen.getByTestId("desk-do-bear-target")).toHaveTextContent("—");
    expect(screen.getByTestId("desk-do-bear-rr")).toHaveTextContent("—");
    expect(screen.queryByTestId("desk-reasons-bear")).not.toBeInTheDocument();
    expect(screen.getByTestId("desk-dont-bear-0")).toHaveTextContent("third long-premium leg");
  });

  test("the header chevron collapses and reopens the body", () => {
    renderPlan(bearishReport());
    const toggle = screen.getByTestId("desk-plan-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("desk-plan-body")).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("desk-plan-body")).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("desk-plan-body")).toBeInTheDocument();
  });
});
