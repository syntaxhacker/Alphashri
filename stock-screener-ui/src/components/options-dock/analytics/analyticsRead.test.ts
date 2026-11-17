// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test } from "vitest";
import type { OptionsAnalytics } from "@/api/optionsAnalytics";
import {
  coverageVerdict,
  rrVerdict,
  selectedExpiryLabel,
  termVerdict,
  verdictChips,
} from "./analyticsRead";

describe("rrVerdict", () => {
  test("negative is puts rich with a signed vol-point text", () => {
    expect(rrVerdict(-6.5)).toEqual({
      label: "PUTS RICH",
      tone: "negative",
      text: "-6.5 vp",
    });
  });

  test("positive is calls rich", () => {
    expect(rrVerdict(6.5)).toEqual({
      label: "CALLS RICH",
      tone: "positive",
      text: "+6.5 vp",
    });
  });

  test("inside one vol point is flat, including zero", () => {
    expect(rrVerdict(0).label).toBe("FLAT");
    expect(rrVerdict(0.9).label).toBe("FLAT");
    expect(rrVerdict(-0.9).tone).toBe("neutral");
  });

  test("a missing quote is not a flat signal", () => {
    expect(rrVerdict(null)).toEqual({ label: "FLAT", tone: "neutral", text: "—" });
    expect(rrVerdict(Number.NaN).text).toBe("—");
  });
});

describe("termVerdict", () => {
  test("a falling ATM-IV slope is backwardation", () => {
    expect(termVerdict(-22)).toEqual({
      label: "BACKWARDATION",
      tone: "negative",
      text: "-22 vp/expiry",
    });
  });

  test("a rising slope is contango", () => {
    expect(termVerdict(22)).toEqual({
      label: "CONTANGO",
      tone: "positive",
      text: "+22 vp/expiry",
    });
  });

  test("a near-zero slope is flat, and a missing slope has no number", () => {
    expect(termVerdict(0.5).label).toBe("FLAT");
    expect(termVerdict(null)).toEqual({ label: "FLAT", tone: "neutral", text: "—" });
  });
});

describe("coverageVerdict", () => {
  test("0, 75 and 100 percent carry the expected tone", () => {
    expect(coverageVerdict(0, 12)).toEqual({
      label: "0% QUOTED",
      tone: "negative",
      text: "0/12 cells",
    });
    expect(coverageVerdict(9, 12)).toMatchObject({ label: "75% QUOTED", tone: "warning" });
    expect(coverageVerdict(12, 12)).toMatchObject({ label: "100% QUOTED", tone: "positive" });
  });

  test("an empty grid is 0%, never NaN", () => {
    expect(coverageVerdict(0, 0).label).toBe("0% QUOTED");
    expect(coverageVerdict(0, 0).text).toBe("0/0 cells");
  });
});

describe("selectedExpiryLabel", () => {
  test("renders day, three-letter month and day count", () => {
    expect(selectedExpiryLabel("2026-11-23", 6)).toBe("23 NOV · 6d");
    expect(selectedExpiryLabel({ date: "2026-12-29" }, 42)).toBe("29 DEC · 42d");
  });

  test("a custom separator feeds the compact expiry chips", () => {
    expect(selectedExpiryLabel("2026-11-23", 6, " ")).toBe("23 NOV 6d");
  });

  test("omits the count when there is no DTE", () => {
    expect(selectedExpiryLabel("2026-01-25", null)).toBe("25 JAN");
    expect(selectedExpiryLabel(null, 6)).toBe("—");
  });
});

function payload(): OptionsAnalytics {
  return {
    symbol: "NIFTY",
    spot: 2980,
    asOf: null,
    quotesLive: true,
    expiries: [
      {
        date: "2026-11-23",
        dte: 6,
        atmIv: 79.7,
        rr25: -6.5,
        bf25: 2,
        slope: null,
        fitR2: 0.9,
        points: [
          { strike: 2900, moneyness: null, iv: 86.2, delta: -0.25, oi: 100 },
          { strike: 2980, moneyness: null, iv: 79.7, delta: 0.5, oi: 100 },
          { strike: 3060, moneyness: null, iv: 79.7, delta: 0.25, oi: 100 },
        ],
      },
      {
        date: "2026-12-29",
        dte: 42,
        atmIv: 99.7,
        rr25: null,
        bf25: null,
        slope: null,
        fitR2: null,
        points: [
          { strike: 2900, moneyness: null, iv: 105, delta: -0.25, oi: 100 },
          { strike: 2980, moneyness: null, iv: 99.7, delta: 0.5, oi: 100 },
          { strike: 3060, moneyness: null, iv: 99.7, delta: 0.25, oi: 100 },
        ],
      },
    ],
    term: [],
    surface: {
      strikes: [2900, 2980, 3060],
      expiries: ["2026-11-23", "2026-12-29"],
      iv: [
        [86, 80, 80],
        [105, 100, 100],
      ],
      missing: [
        [false, false, false],
        [false, false, false],
      ],
    },
    levels: {
      callWall: null,
      putWall: null,
      maxPain: 2950,
      gex: { support: null, resistance: null, fuelUp: null, fuelDown: null },
    },
    probability: {
      model: null,
      flatPop: null,
      skewPop: null,
      expectedPnl: null,
      sigma: null,
      density: [],
      quantiles: { p05: null, p25: null, p50: null, p75: null, p95: null },
      cone: [],
    },
    warnings: [],
  };
}

describe("verdictChips", () => {
  test("returns four stable testids with verdicts computed from the payload", () => {
    const chips = verdictChips({
      data: payload(),
      selectedExpiry: "2026-11-23",
      atmIv: 79.7,
      maxPain: 2950,
      spot: 2980,
    });

    expect(chips.map((chip) => chip.testId)).toEqual([
      "analytics-chip-rr",
      "analytics-chip-term",
      "analytics-chip-coverage",
      "analytics-chip-maxpain",
    ]);
    expect(chips[0]).toMatchObject({ value: "PUTS RICH", text: "-6.5 vp", tone: "negative" });
    expect(chips[1]).toMatchObject({ value: "CONTANGO", text: "+20 vp/expiry" });
    expect(chips[2]).toMatchObject({ value: "100% QUOTED", text: "6/6 cells" });
    expect(chips[3]).toMatchObject({ value: "₹2,950", text: "-1.0% below spot" });
  });

  test("a cold payload still yields the same chips with no invented signal", () => {
    const chips = verdictChips({
      data: null,
      selectedExpiry: null,
      atmIv: null,
      maxPain: null,
      spot: 0,
    });
    expect(chips).toHaveLength(4);
    expect(chips.every((chip) => chip.value === "—")).toBe(true);
    expect(chips.every((chip) => chip.tone === "neutral")).toBe(true);
  });
});
