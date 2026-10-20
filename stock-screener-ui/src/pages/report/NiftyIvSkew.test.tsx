// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { UIProvider } from "@/ui";
import * as palette from "@/ui/palette";
import type { NiftyStrike } from "@/types/niftyReport";
import {
  IV_DASH,
  IV_MAX_PCT,
  NiftyIvSkew,
  buildIvSkewChart,
  buildIvSkewPoints,
  formatIv,
  formatVolPts,
  ivSkewRead,
  ivSkewStats,
  ivSkewTone,
  legIvAtDelta,
  nearestIvPoint,
} from "./NiftyIvSkew";

afterEach(cleanup);

function TestWrapper({ children }: { children: React.ReactNode }) {
  return <UIProvider>{children}</UIProvider>;
}

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: TestWrapper });
}

function leg(iv: number | null, delta: number | null) {
  return {
    ltp: 100,
    close: 100,
    oi: 1000,
    prevOi: 900,
    oiChange: 100,
    priceChange: 1,
    sentiment: "Neutral",
    iv,
    delta,
  };
}

function strike(
  value: number,
  ceIv: number | null,
  peIv: number | null,
  ceDelta: number | null,
  peDelta: number | null,
): NiftyStrike {
  return { strike: value, ce: leg(ceIv, ceDelta), pe: leg(peIv, peDelta) };
}

/** Sparse-but-realistic smile: ATM, both wings, the 25Δ strikes and a far row. */
const CHAIN: NiftyStrike[] = [
  strike(27000, 40, 42, 0.95, -0.05),
  strike(25750, 18, 19, 0.5, -0.5),
  strike(25000, 24, 30, 0.05, -0.95),
  strike(26050, 17, 17.8, 0.7, -0.3),
  strike(25300, 16.5, 24, 0.22, -0.78),
  strike(26200, 18.2, 20.5, 0.78, -0.25),
  strike(25450, 16.8, 21, 0.3, -0.7),
];

describe("buildIvSkewPoints", () => {
  test("sorts ascending and drops rows with no IV at all", () => {
    const points = buildIvSkewPoints(
      [...CHAIN, strike(25600, null, null, 0.4, -0.6)],
      25750,
    );
    expect(points.map((p) => p.strike)).toEqual([
      25000, 25300, 25450, 25750, 26050, 26200,
    ]);
  });

  test("windows to ±750 around spot", () => {
    const points = buildIvSkewPoints(CHAIN, 25750);
    expect(points.some((p) => p.strike === 27000)).toBe(false);
    expect(points[0].strike).toBe(25000);
    expect(points[points.length - 1].strike).toBe(26200);
  });

  test("keeps a one-legged strike (one side's greeks are missing)", () => {
    const points = buildIvSkewPoints([strike(25750, 18, null, 0.5, null)], 25750);
    expect(points).toEqual([{ strike: 25750, ceIv: 18, peIv: null }]);
  });

  test("treats 0 / null IV as missing, never as a real 0% vol", () => {
    const points = buildIvSkewPoints([strike(25750, 0, null, 0.5, null)], 25750);
    expect(points).toEqual([]);
  });

  test("no spot keeps the whole chain instead of going blank", () => {
    const points = buildIvSkewPoints(CHAIN, null);
    expect(points.map((p) => p.strike)).toContain(27000);
  });

  test("empty / malformed input yields []", () => {
    expect(buildIvSkewPoints([], 25750)).toEqual([]);
    expect(buildIvSkewPoints(undefined as never, 25750)).toEqual([]);
  });
});

describe("nearestIvPoint", () => {
  const points = buildIvSkewPoints(CHAIN, 25750);

  test("returns the closest strike", () => {
    expect(nearestIvPoint(points, 25440)?.strike).toBe(25450);
    expect(nearestIvPoint(points, 25990)?.strike).toBe(26050);
  });

  test("absent target or empty list returns null", () => {
    expect(nearestIvPoint(points, null)).toBeNull();
    expect(nearestIvPoint([], 25750)).toBeNull();
  });
});

describe("ivSkewStats", () => {
  const points = buildIvSkewPoints(CHAIN, 25750);
  const stats = ivSkewStats(points, CHAIN, 25750);

  test("ATM averages the two legs at the nearest strike", () => {
    expect(stats.atmStrike).toBe(25750);
    expect(stats.atmCe).toBe(18);
    expect(stats.atmPe).toBe(19);
    expect(stats.atmIv).toBe(18.5);
  });

  test("25Δ anchors use the strike closest to |delta| 0.25", () => {
    expect(legIvAtDelta(CHAIN, "ce", 0.25)).toBe(16.5);
    expect(legIvAtDelta(CHAIN, "pe", 0.25)).toBe(20.5);
    expect(stats.call25).toBe(16.5);
    expect(stats.put25).toBe(20.5);
    expect(stats.rr25).toBeCloseTo(4.0, 10);
  });

  test("missing deltas / IV degrade to null rather than 0", () => {
    const bare = CHAIN.map((s) => ({
      ...s,
      ce: { ...s.ce, delta: null },
      pe: { ...s.pe, delta: null },
    }));
    const s = ivSkewStats(points, bare, 25750);
    expect(s.rr25).toBeNull();
    expect(s.put25).toBeNull();
    expect(s.call25).toBeNull();
    expect(s.atmIv).toBe(18.5);
  });

  test("empty input yields an all-null stat block", () => {
    const s = ivSkewStats([], [], 25750);
    expect(s).toEqual({
      atmStrike: null,
      atmIv: null,
      atmCe: null,
      atmPe: null,
      put25: null,
      call25: null,
      rr25: null,
    });
  });
});

describe("formatters + read", () => {
  test("formatIv is one decimal with a percent sign, dash when absent", () => {
    expect(formatIv(18)).toBe("18.0%");
    expect(formatIv(18.456)).toBe("18.5%");
    expect(formatIv(null)).toBe(IV_DASH);
    expect(formatIv(Number.NaN)).toBe(IV_DASH);
  });

  test("formatVolPts signs the value and keeps plain zero", () => {
    expect(formatVolPts(4)).toBe("+4.0 vp");
    expect(formatVolPts(-0.4)).toBe("-0.4 vp");
    expect(formatVolPts(0)).toBe("0.0 vp");
    expect(formatVolPts(null)).toBe(IV_DASH);
  });

  test("skew tone follows the richer wing (orange puts / blue calls)", () => {
    expect(ivSkewTone(2)).toBe(palette.TERM_PE);
    expect(ivSkewTone(-2)).toBe(palette.TERM_CE);
    expect(ivSkewTone(0)).toBe(palette.TEXT_MUTED);
    expect(ivSkewTone(null)).toBe(palette.TEXT_MUTED);
  });

  test("read names the richer 25Δ wing, flat wings, or nothing", () => {
    const points = buildIvSkewPoints(CHAIN, 25750);
    const stats = ivSkewStats(points, CHAIN, 25750);
    expect(ivSkewRead(stats)).toBe(
      "25Δ puts 4.0 vp over calls — downside hedging is bid",
    );
    expect(ivSkewRead({ ...stats, rr25: 0 })).toBe(
      "25Δ wings flat — no directional vol bid",
    );
    expect(ivSkewRead({ ...stats, rr25: -2 })).toBe(
      "25Δ calls 2.0 vp over puts — upside calls are richer",
    );
    expect(ivSkewRead({ ...stats, rr25: null })).toBeNull();
  });
});

describe("buildIvSkewChart", () => {
  const points = buildIvSkewPoints(CHAIN, 25750);
  const stats = ivSkewStats(points, CHAIN, 25750);
  const chart = buildIvSkewChart(points, stats);

  test("labels are grouped strikes and series keep the leg hues", () => {
    expect(chart.labels[0]).toBe("25,000");
    expect(chart.series.map((s) => s.name)).toEqual(["CE IV", "PE IV"]);
    expect(chart.series[0].color).toBe(palette.TERM_CE);
    expect(chart.series[1].color).toBe(palette.TERM_PE);
  });

  test("plots the OTM smile: calls at/above ATM, puts at/below it", () => {
    const atmIdx = chart.band.findIndex((p) => p.strike === 25750);
    expect(atmIdx).toBe(3);
    // Below ATM: CE is masked (ITM), PE is kept.
    expect(chart.series[0].points.slice(0, atmIdx)).toEqual([null, null, null]);
    expect(chart.series[1].points.slice(0, atmIdx)).toEqual([30, 24, 21]);
    // Above ATM: CE is kept, PE is masked.
    expect(chart.series[0].points.slice(atmIdx + 1)).toEqual([17, 18.2]);
    expect(chart.series[1].points.slice(atmIdx + 1)).toEqual([null, null]);
    // Both legs survive at the ATM strike.
    expect(chart.series[0].points[atmIdx]).toBe(18);
    expect(chart.series[1].points[atmIdx]).toBe(19);
  });

  test("drops legs above the IV sanity cut and counts them", () => {
    const wild = [
      ...points,
      { strike: 26250, ceIv: 466.8, peIv: null },
      { strike: 25050, ceIv: null, peIv: IV_MAX_PCT + 10 },
    ];
    const c = buildIvSkewChart(
      wild,
      { ...stats, atmStrike: 25750 },
    );
    expect(c.clipped).toBe(2);
    expect(c.band.some((p) => p.strike === 26250)).toBe(false);
    expect(c.band.some((p) => p.strike === 25050)).toBe(false);
  });

  test("ATM marker lands on the ATM strike index", () => {
    const idx = chart.band.findIndex((p) => p.strike === 25750);
    expect(chart.markers).toEqual([
      { index: idx, label: "ATM", color: palette.TERM_FLIP },
    ]);
  });

  test("no ATM strike means no marker", () => {
    expect(buildIvSkewChart([], ivSkewStats([], [], null)).markers).toEqual([]);
  });
});

describe("NiftyIvSkew render", () => {
  test("renders all four stats, the read line and the coverage caption", () => {
    r(<NiftyIvSkew strikes={CHAIN} spot={25750} />);
    const panel = screen.getByTestId("nifty-iv-skew-panel");
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveTextContent("IV skew");

    expect(screen.getByTestId("nifty-iv-skew-atm")).toHaveTextContent("18.5%");
    expect(screen.getByTestId("nifty-iv-skew-atm")).toHaveTextContent(
      "CE 18.0% · PE 19.0%",
    );
    expect(screen.getByTestId("nifty-iv-skew-rr")).toHaveTextContent("+4.0 vp");
    expect(screen.getByTestId("nifty-iv-skew-put")).toHaveTextContent("20.5%");
    expect(screen.getByTestId("nifty-iv-skew-call")).toHaveTextContent("16.5%");
    expect(screen.getByTestId("nifty-iv-skew-read")).toHaveTextContent(
      "25Δ puts 4.0 vp over calls",
    );
    expect(screen.getByTestId("nifty-iv-skew-coverage")).toHaveTextContent(
      "25,000–26,200",
    );
    expect(screen.getByTestId("nifty-iv-skew-chart")).toBeInTheDocument();
  });

  test("legend explains the leg hues and ATM", () => {
    r(<NiftyIvSkew strikes={CHAIN} spot={25750} />);
    expect(screen.getByText("CALL IV")).toBeInTheDocument();
    expect(screen.getByText("PUT IV")).toBeInTheDocument();
    expect(screen.getByText("ATM")).toBeInTheDocument();
  });

  test("no strikes renders dashes and the chart empty state", () => {
    r(<NiftyIvSkew strikes={[]} spot={25750} />);
    expect(screen.getByTestId("nifty-iv-skew-atm")).toHaveTextContent(IV_DASH);
    expect(screen.getByTestId("nifty-iv-skew-rr")).toHaveTextContent(IV_DASH);
    expect(screen.getByText("No IV in this expiry")).toBeInTheDocument();
    expect(screen.queryByTestId("nifty-iv-skew-coverage")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nifty-iv-skew-read")).not.toBeInTheDocument();
  });

  test("undefined props do not crash", () => {
    r(<NiftyIvSkew />);
    expect(screen.getByTestId("nifty-iv-skew-panel")).toBeInTheDocument();
    expect(screen.getByText("No IV in this expiry")).toBeInTheDocument();
  });
});
