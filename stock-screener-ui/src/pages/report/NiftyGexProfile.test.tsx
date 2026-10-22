// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { UIProvider } from "@/ui";
import * as palette from "@/ui/palette";
import type { NiftyGex } from "@/types/niftyReport";
import {
  NiftyGexProfile,
  buildGexChart,
  buildGexProfile,
  formatGexCr,
  formatGexStrike,
  gexProfileStats,
  gexSideCopy,
  gexSideLevels,
  gexTone,
  nearestStrikeIndex,
  selectGexBand,
  trimGexProfile,
} from "./NiftyGexProfile";

afterEach(cleanup);

function TestWrapper({ children }: { children: React.ReactNode }) {
  return <UIProvider>{children}</UIProvider>;
}

function gex(overrides?: Partial<NiftyGex>): NiftyGex {
  return {
    strikes: [
      // deliberately unsorted to prove buildGexProfile sorts ascending
      { strike: 22700, callGex: 5, putGex: -3, netGex: -2 },
      { strike: 22600, callGex: 1, putGex: 2, netGex: 12 },
      { strike: 22800, callGex: 9, putGex: -9, netGex: -8 },
    ],
    netTotal: 7.5,
    regime: "long",
    topPositive: [{ strike: 22600, netGex: 12 }],
    topNegative: [{ strike: 22800, netGex: -8 }],
    zeroCross: 22650,
    ...overrides,
  };
}

describe("buildGexProfile", () => {
  test("sorts strikes ascending from an unsorted payload", () => {
    expect(buildGexProfile(gex()).map((p) => p.strike)).toEqual([22600, 22700, 22800]);
  });

  test("undefined / empty / malformed input yields []", () => {
    expect(buildGexProfile(undefined)).toEqual([]);
    expect(buildGexProfile(gex({ strikes: [] }))).toEqual([]);
  });

  test("drops rows with non-finite strike or netGex", () => {
    const profile = buildGexProfile(
      gex({
        strikes: [
          { strike: 22600, callGex: 0, putGex: 0, netGex: 3 },
          { strike: Number.NaN, callGex: 0, putGex: 0, netGex: 4 },
          { strike: 22700, callGex: 0, putGex: 0, netGex: Number.NaN },
        ],
      }),
    );
    expect(profile).toEqual([{ strike: 22600, netGex: 3 }]);
  });
});

describe("trimGexProfile / selectGexBand", () => {
  // Mirrors the real payload: a long tail of tiny far-OTM gammas around a few
  // real walls, plus a dead zero run at each end.
  const wide = [
    { strike: 20050, netGex: 0 },
    { strike: 20100, netGex: 0 },
    { strike: 22350, netGex: 3 }, // dust: < 1% of the 25,976 peak
    { strike: 22400, netGex: 92 }, // still dust
    { strike: 22450, netGex: 0 }, // genuine flat spot inside the band
    { strike: 22500, netGex: -349 },
    { strike: 22550, netGex: 25976 },
    { strike: 24000, netGex: 2 },
    { strike: 25200, netGex: 0 },
  ];

  test("drops the dust wings but keeps everything between the walls", () => {
    expect(trimGexProfile(wide)).toEqual([
      { strike: 22500, netGex: -349 },
      { strike: 22550, netGex: 25976 },
    ]);
  });

  test("minShare 0 reproduces the plain non-zero trim", () => {
    expect(trimGexProfile(wide, { minShare: 0 })).toEqual([
      { strike: 22350, netGex: 3 },
      { strike: 22400, netGex: 92 },
      { strike: 22450, netGex: 0 },
      { strike: 22500, netGex: -349 },
      { strike: 22550, netGex: 25976 },
      { strike: 24000, netGex: 2 },
    ]);
  });

  test("reports the significance cut and how many strikes clear it", () => {
    const band = selectGexBand(wide);
    expect(band.threshold).toBeCloseTo(259.76);
    expect(band.significant).toBe(2);
    expect(band.points.map((p) => p.strike)).toEqual([22500, 22550]);
  });

  test("include widens the window so the flip level stays on the chart", () => {
    const band = selectGexBand(wide, { include: [22350] });
    expect(band.points[0].strike).toBe(22350);
    expect(band.points[band.points.length - 1].strike).toBe(22550);
  });

  test("all-zero profile yields an empty band (chart empty state)", () => {
    expect(selectGexBand([{ strike: 22600, netGex: 0 }])).toEqual({
      points: [],
      threshold: 0,
      significant: 0,
    });
    expect(trimGexProfile([])).toEqual([]);
  });
});

describe("nearestStrikeIndex", () => {
  const band = [
    { strike: 22600, netGex: 1 },
    { strike: 22700, netGex: 2 },
    { strike: 22800, netGex: 3 },
  ];

  test("snaps a continuous spot to the closest strike inside the band", () => {
    // 22,873.55 is 73.55 from 22,800 and 26.45 from 22,900 — but the band
    // fixture tops out at 22,800, so 22,660 snaps to 22,700 instead.
    expect(nearestStrikeIndex(band, 22660)).toBe(1);
    expect(nearestStrikeIndex(band, 22700)).toBe(1);
  });

  test("returns -1 when spot sits outside the band or is not finite", () => {
    expect(nearestStrikeIndex(band, 22999)).toBe(-1);
    expect(nearestStrikeIndex(band, 20000)).toBe(-1);
    expect(nearestStrikeIndex(band, Number.NaN)).toBe(-1);
    expect(nearestStrikeIndex([], 22700)).toBe(-1);
  });
});

describe("gexProfileStats", () => {
  test("passes through netTotal / zeroCross and finds peak / trough strikes", () => {
    const s = gexProfileStats(gex(), 22700);
    expect(s.netTotal).toBe(7.5);
    expect(s.zeroCross).toBe(22650);
    expect(s.regime).toBe("LONG");
    expect(s.peakStrike).toBe(22600);
    expect(s.troughStrike).toBe(22800);
  });

  test("absent gex -> nulls and empty regime", () => {
    expect(gexProfileStats(undefined, 22700)).toEqual({
      netTotal: null,
      zeroCross: null,
      regime: "",
      peakStrike: null,
      troughStrike: null,
    });
  });

  test("null zeroCross stays null; regime is normalised to uppercase", () => {
    // No profile to re-derive from -> the payload's own regime is used.
    const s = gexProfileStats(gex({ strikes: [], zeroCross: null, regime: "short" }), 22700);
    expect(s.zeroCross).toBeNull();
    expect(s.regime).toBe("SHORT");
  });

  test("drops a stale flip that disagrees with the sign at spot", () => {
    const stale = gex({
      strikes: [
        { strike: 22600, callGex: 0, putGex: 0, netGex: -6 },
        { strike: 22700, callGex: 0, putGex: 0, netGex: -4 },
        { strike: 22800, callGex: 0, putGex: 0, netGex: 20 },
      ],
      zeroCross: 22600, // below a 22,700 spot, but cum there is -10 -> stale
    });
    expect(gexProfileStats(stale, 22700).zeroCross).toBeNull();
    // Above the flip with cum positive -> the flip is consistent, keep it.
    expect(gexProfileStats(stale, 22800).zeroCross).toBe(22600);
  });

  test("regime is re-derived from the cumulative sign at spot", () => {
    // Stale payload says "long" (netTotal > 0) but spot sits below the flip:
    // cumulative through 22,700 is +12 - 2 = +10 there, so this fixture needs
    // a genuinely short book at spot to prove the re-derivation.
    const stale = gex({
      strikes: [
        { strike: 22600, callGex: 0, putGex: 0, netGex: -6 },
        { strike: 22700, callGex: 0, putGex: 0, netGex: -4 },
        { strike: 22800, callGex: 0, putGex: 0, netGex: 20 },
      ],
      regime: "long",
      zeroCross: 22800,
    });
    expect(gexProfileStats(stale, 22700).regime).toBe("SHORT");
    expect(gexProfileStats(stale, 22800).regime).toBe("LONG");
  });

  test("ties on peak/trough break toward the strike nearest spot", () => {
    const s = gexProfileStats(
      gex({
        strikes: [
          { strike: 22600, callGex: 0, putGex: 0, netGex: 5 },
          { strike: 22800, callGex: 0, putGex: 0, netGex: 5 },
        ],
        zeroCross: null,
      }),
      22750,
    );
    // 22,800 is 50pts from spot vs 150pts for 22,600 -> 22,800 wins the tie.
    expect(s.peakStrike).toBe(22800);
    expect(s.troughStrike).toBe(22800);
  });
});

describe("buildGexChart", () => {
  test("labels track strikes in ascending order with Indian grouping", () => {
    const profile = buildGexProfile(gex());
    const chart = buildGexChart(profile, gexProfileStats(gex(), 22700), 22700);
    expect(chart.labels).toEqual(["22,600", "22,700", "22,800"]);
  });

  test("single Net GEX series carries netGex values in strike order", () => {
    const profile = buildGexProfile(gex());
    const chart = buildGexChart(profile, gexProfileStats(gex(), 22700), 22700);
    expect(chart.series).toHaveLength(1);
    expect(chart.series[0].name).toBe("Net GEX");
    expect(chart.series[0].points).toEqual([12, -2, -8]);
    expect(chart.series[0].area).toBe(true);
  });

  test("trims the dead strike wings so labels span only the gamma band", () => {
    const padded = gex({
      strikes: [
        { strike: 20050, callGex: 0, putGex: 0, netGex: 0 },
        { strike: 22600, callGex: 1, putGex: 2, netGex: 12 },
        { strike: 22700, callGex: 5, putGex: -3, netGex: -2 },
        { strike: 25200, callGex: 0, putGex: 0, netGex: 0 },
      ],
    });
    const profile = buildGexProfile(padded);
    const chart = buildGexChart(profile, gexProfileStats(padded, 22650), 22650);
    expect(chart.labels).toEqual(["22,600", "22,700"]);
    expect(chart.series[0].points).toEqual([12, -2]);
  });

  test("SPOT snaps to the strike nearest a continuous spot", () => {
    // 22,690 is not on the strike grid; without snapping the marker never drew.
    const profile = buildGexProfile(gex());
    const chart = buildGexChart(profile, gexProfileStats(gex(), 22690), 22690);
    const spot = chart.markers.find((m) => m.label === "SPOT");
    expect(spot?.index).toBe(1);
  });

  test("ZERO is skipped when it would stack on the SPOT strike", () => {
    const same = gex({ zeroCross: 22700 });
    const profile = buildGexProfile(same);
    const chart = buildGexChart(profile, gexProfileStats(same, 22700), 22700);
    expect(chart.markers.map((m) => m.label)).toEqual(["SPOT"]);
  });

  test("zeroLine is always true", () => {
    const profile = buildGexProfile(gex());
    const chart = buildGexChart(profile, gexProfileStats(gex(), 22700), 22700);
    expect(chart.zeroLine).toBe(true);
  });

  test("SPOT marker sits on the spot strike index", () => {
    const profile = buildGexProfile(gex());
    const chart = buildGexChart(profile, gexProfileStats(gex(), 22700), 22700);
    const spot = chart.markers.find((m) => m.label === "SPOT");
    expect(spot?.index).toBe(1);
    expect(spot?.color).toBe(palette.TERM_SPOT);
  });

  test("ZERO marker exists when zeroCross matches a profile strike", () => {
    // Consistent book: cum is -10 at spot and crosses to +10 at 22,800, so
    // the flip sits above spot (spot below flip = short gamma).
    const withZero = gex({
      strikes: [
        { strike: 22600, callGex: 0, putGex: 0, netGex: -6 },
        { strike: 22700, callGex: 0, putGex: 0, netGex: -4 },
        { strike: 22800, callGex: 0, putGex: 0, netGex: 20 },
      ],
      zeroCross: 22800,
    });
    const profile = buildGexProfile(withZero);
    const chart = buildGexChart(profile, gexProfileStats(withZero, 22700), 22700);
    const zero = chart.markers.find((m) => m.label === "ZERO");
    expect(zero?.index).toBe(2);
    expect(zero?.color).toBe(palette.TERM_FLIP);
  });

  test("default fixture zeroCross (off-profile) yields no ZERO marker", () => {
    // 22,650 is not one of the profile strikes, so it is skipped.
    const profile = buildGexProfile(gex());
    const chart = buildGexChart(profile, gexProfileStats(gex(), 22700), 22700);
    expect(chart.markers.map((m) => m.label)).not.toContain("ZERO");
  });

  test("ZERO omitted when zeroCross is null; SPOT omitted when off-profile", () => {
    const nullable = gex({ zeroCross: null });
    const profile = buildGexProfile(nullable);
    const stats = gexProfileStats(nullable, 22700);
    const chart = buildGexChart(profile, stats, 22700);
    const names = chart.markers.map((m) => m.label);
    expect(names).not.toContain("ZERO");
    expect(names).toContain("SPOT");

    const offProfile = buildGexChart(profile, stats, 22999);
    expect(offProfile.markers.map((m) => m.label)).not.toContain("SPOT");
  });
});

describe("format helpers", () => {
  test("formatGexCr signs and fixes to 2 dp with the Cr/pt unit, dashes absent values", () => {
    expect(formatGexCr(7.5)).toBe("+7.50 Cr/pt");
    expect(formatGexCr(-8)).toBe("-8.00 Cr/pt");
    expect(formatGexCr(0)).toBe("0.00 Cr/pt");
    expect(formatGexCr(null)).toBe("—");
  });

  test("formatGexStrike groups Indian-style and dashes absent values", () => {
    expect(formatGexStrike(22650)).toBe("22,650");
    expect(formatGexStrike(null)).toBe("—");
  });

  test("gexTone maps sign to palette tokens", () => {
    expect(gexTone(3)).toBe(palette.TERM_GAMMA);
    expect(gexTone(-3)).toBe(palette.TERM_GAMMA_NEG);
    expect(gexTone(0)).toBe(palette.TEXT_MUTED);
    expect(gexTone(null)).toBe(palette.TEXT_MUTED);
  });
});

describe("gexSideLevels (spot-relative)", () => {
  // 2026-10-21 repro: spot 22,952; the biggest positive gamma sits at 23,200
  // (ABOVE spot) and the deepest negative at 22,700 (BELOW spot). The old
  // labels called the former "support" and the latter "resistance".
  const repro = gex({
    strikes: [
      { strike: 22500, callGex: 0, putGex: -20, netGex: -20 },
      { strike: 22700, callGex: 0, putGex: -10, netGex: -10 },
      { strike: 23000, callGex: 8, putGex: -1, netGex: 7 },
      { strike: 23200, callGex: 13, putGex: -2, netGex: 11 },
    ],
    zeroCross: 23400,
  });

  test("derives sides from the profile on legacy payloads", () => {
    const sides = gexSideLevels(repro, 22952);
    // No positive gamma below spot -> support is null; the deepest negative
    // below spot (22,500, -20) is the fuel level.
    expect(sides.below).toEqual({
      strike: 22500,
      netGex: -20,
      kind: "fuel",
      side: "below",
    });
    // 23,200 positive gamma above spot -> resistance.
    expect(sides.above).toEqual({
      strike: 23200,
      netGex: 11,
      kind: "resistance",
      side: "above",
    });
  });

  test("never calls a below-spot strike resistance or an above-spot one support", () => {
    const sides = gexSideLevels(repro, 22952);
    for (const level of [sides.below, sides.above]) {
      if (!level) continue;
      if (level.side === "below") {
        expect(level.strike).toBeLessThanOrEqual(22952);
        expect(level.kind).not.toBe("resistance");
      } else {
        expect(level.strike).toBeGreaterThanOrEqual(22952);
        expect(level.kind).not.toBe("support");
      }
    }
  });

  test("prefers the backend levels block when present", () => {
    const payload = gex({
      strikes: repro.strikes,
      levels: {
        support: { strike: 22900, netGex: 4, side: "below" },
        resistance: { strike: 23200, netGex: 11, side: "above" },
        fuelDown: { strike: 22500, netGex: -20, side: "below" },
        fuelUp: { strike: 23000, netGex: -7, side: "above" },
      },
    });
    const sides = gexSideLevels(payload, 22952);
    expect(sides.below?.strike).toBe(22900);
    expect(sides.below?.kind).toBe("support");
    expect(sides.above?.strike).toBe(23200);
    expect(sides.above?.kind).toBe("resistance");
  });

  test("falls back to fuel on a side with no pin magnet", () => {
    const payload = gex({
      strikes: repro.strikes,
      levels: {
        support: null,
        resistance: null,
        fuelDown: { strike: 22500, netGex: -20, side: "below" },
        fuelUp: { strike: 23000, netGex: -7, side: "above" },
      },
    });
    const sides = gexSideLevels(payload, 22952);
    expect(sides.below?.kind).toBe("fuel");
    expect(sides.above?.kind).toBe("fuel");
    expect(sides.above?.strike).toBe(23000);
  });

  test("labels pin magnets and fuel without inverting a side", () => {
    expect(gexSideCopy(null, "below")).toEqual({
      label: "γ support",
      hint: "pin magnet · below",
    });
    expect(gexSideCopy(null, "above")).toEqual({
      label: "γ resistance",
      hint: "pin magnet · above",
    });
    expect(
      gexSideCopy({ strike: 22700, netGex: -10, kind: "fuel", side: "below" }, "below"),
    ).toEqual({ label: "γ fuel ↓", hint: "breakdown fuel · below" });
    expect(
      gexSideCopy({ strike: 23000, netGex: -7, kind: "fuel", side: "above" }, "above"),
    ).toEqual({ label: "γ fuel ↑", hint: "squeeze fuel · above" });
  });

  test("undefined gex yields no levels", () => {
    expect(gexSideLevels(undefined, 22952)).toEqual({ below: null, above: null });
  });

  test("ignores a near-zero wing instead of calling it support", () => {
    // 2026-10-21 live shape: +0.07 at 22,500 is the only positive below spot,
    // while the real pins sit above it. 0.07 is <10% of the 15.15 peak.
    const wing = gex({
      strikes: [
        { strike: 22500, callGex: 0, putGex: 0, netGex: 0.07 },
        { strike: 23200, callGex: 0, putGex: 0, netGex: 15.15 },
        { strike: 23500, callGex: 0, putGex: 0, netGex: 11.99 },
        { strike: 24700, callGex: 0, putGex: 0, netGex: -0.04 },
      ],
    });
    const sides = gexSideLevels(wing, 22962.6);
    expect(sides.below).toBeNull();
    expect(sides.above).toEqual({
      strike: 23200,
      netGex: 15.15,
      kind: "resistance",
      side: "above",
    });
  });

  test("re-validates a stale backend levels block", () => {
    // Snapshots written by the previous build still carry the +0.07 support
    // and the -0.04 fuel; the UI must gate them again, not trust them.
    const stale = gex({
      strikes: [
        { strike: 22500, callGex: 0, putGex: 0, netGex: 0.07 },
        { strike: 23200, callGex: 0, putGex: 0, netGex: 15.15 },
        { strike: 24700, callGex: 0, putGex: 0, netGex: -0.04 },
      ],
      levels: {
        support: { strike: 22500, netGex: 0.07, side: "below" },
        resistance: { strike: 23200, netGex: 15.15, side: "above" },
        fuelDown: null,
        fuelUp: { strike: 24700, netGex: -0.04, side: "above" },
      },
    });
    const sides = gexSideLevels(stale, 22962.6);
    expect(sides.below).toBeNull();
    expect(sides.above).toEqual({
      strike: 23200,
      netGex: 15.15,
      kind: "resistance",
      side: "above",
    });
  });

  test("keeps a real pin below spot inside the band", () => {
    const real = gex({
      strikes: [
        { strike: 22500, callGex: 0, putGex: 0, netGex: 0.07 },
        { strike: 22700, callGex: 0, putGex: 0, netGex: 2 },
        { strike: 23200, callGex: 0, putGex: 0, netGex: 15.15 },
      ],
    });
    expect(gexSideLevels(real, 22962.6).below).toEqual({
      strike: 22700,
      netGex: 2,
      kind: "support",
      side: "below",
    });
  });
});

describe("NiftyGexProfile render", () => {
  test("renders the panel, stat row and SVG chart", () => {
    render(<NiftyGexProfile gex={gex()} spot={22700} />, { wrapper: TestWrapper });

    expect(screen.getByTestId("nifty-gex-profile-panel")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-gex-profile-net")).toHaveTextContent("+7.50 Cr/pt");
    expect(screen.getByTestId("nifty-gex-profile-zero")).toHaveTextContent("22,650");
    expect(screen.getByTestId("nifty-gex-profile-regime")).toHaveTextContent("LONG GAMMA");

    const chart = screen.getByTestId("nifty-gex-profile-chart");
    expect(chart).toBeInTheDocument();
    expect(chart.querySelector("svg")).not.toBeNull();
    expect(screen.queryByText("No per-strike GEX profile")).not.toBeInTheDocument();
  });

  test("names the gamma support/resistance strikes and explains the profile", () => {
    render(<NiftyGexProfile gex={gex()} spot={22700} />, { wrapper: TestWrapper });
    // Peak netGex is 22,600 (+12) — the pin magnet; the trough is 22,800 (−8).
    expect(screen.getByTestId("nifty-gex-profile-support")).toHaveTextContent("22,600");
    expect(screen.getByTestId("nifty-gex-profile-resist")).toHaveTextContent("22,800");
    const regime = screen.getByTestId("nifty-gex-profile-regime");
    expect(regime).toHaveTextContent("magnet");
    expect(regime).toHaveTextContent("Spot 22,700 · 50 pts above flip");
    // The one-line caption stays terse; the full explanation moved into the
    // tooltip so the panel does not spend four lines on prose.
    const caption = screen.getByTestId("nifty-gex-profile-caption");
    expect(caption).toHaveTextContent("above 0 = dampening");
    const explain = caption.getAttribute("title") ?? "";
    expect(explain).toContain("SPOT / ZERO mark today's spot");
    expect(explain).toContain("pin magnets below/above spot");
  });

  test("a negative-gamma strike above spot is fuel, never resistance", () => {
    const inverted = gex({
      strikes: [
        { strike: 22600, callGex: 0, putGex: -6, netGex: -6 },
        { strike: 22700, callGex: 0, putGex: -10, netGex: -10 },
        { strike: 22800, callGex: 0, putGex: -8, netGex: -8 },
      ],
      zeroCross: null,
    });
    render(<NiftyGexProfile gex={inverted} spot={22650} />, { wrapper: TestWrapper });
    const resist = screen.getByTestId("nifty-gex-profile-resist");
    expect(resist).toHaveTextContent("γ fuel ↑");
    // deepest negative above spot (22,700, −10) — the stronger accelerator
    expect(resist).toHaveTextContent("22,700");
    const support = screen.getByTestId("nifty-gex-profile-support");
    expect(support).toHaveTextContent("γ fuel ↓");
    expect(support).toHaveTextContent("22,600");
  });

  test("a near-zero fuel wing renders an em dash, not a fake level", () => {
    const wing = gex({
      strikes: [
        { strike: 22700, callGex: 0, putGex: 0, netGex: 2 },
        { strike: 24700, callGex: 0, putGex: 0, netGex: -0.04 },
      ],
      zeroCross: null,
    });
    render(<NiftyGexProfile gex={wing} spot={22962.6} />, { wrapper: TestWrapper });
    expect(screen.getByTestId("nifty-gex-profile-support")).toHaveTextContent("22,700");
    expect(screen.getByTestId("nifty-gex-profile-resist")).toHaveTextContent("—");
  });

  test("positive gamma below/above spot keeps the support/resistance labels", () => {
    render(<NiftyGexProfile gex={gex()} spot={22700} />, { wrapper: TestWrapper });
    // 22,600 (+12) sits below spot -> support; no positive strike above spot,
    // so the right cell is the above-spot fuel level (22,800, -8).
    expect(screen.getByTestId("nifty-gex-profile-support")).toHaveTextContent("γ support");
    expect(screen.getByTestId("nifty-gex-profile-resist")).toHaveTextContent("γ fuel ↑");
  });

  test("states how many strikes actually carry gamma and the plotted band", () => {
    const padded = gex({
      strikes: [
        { strike: 20050, callGex: 0, putGex: 0, netGex: 0 },
        { strike: 22600, callGex: 1, putGex: 2, netGex: 12 },
        { strike: 22700, callGex: 5, putGex: -3, netGex: -2 },
        { strike: 22800, callGex: 9, putGex: -9, netGex: 0 },
        { strike: 25200, callGex: 0, putGex: 0, netGex: 0 },
      ],
    });
    render(<NiftyGexProfile gex={padded} spot={22690} />, { wrapper: TestWrapper });
    const coverage = screen.getByTestId("nifty-gex-profile-coverage");
    expect(coverage).toHaveTextContent("band 22,600–22,700");
    expect(coverage).toHaveTextContent("2 of 5 strikes carry ≥1% of peak γ");
  });

  test("undefined gex shows the empty state and never crashes", () => {
    render(<NiftyGexProfile spot={22700} />, { wrapper: TestWrapper });

    expect(screen.getByTestId("nifty-gex-profile-panel")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-gex-profile-chart")).toBeInTheDocument();
    expect(screen.getByText("No per-strike GEX profile")).toBeInTheDocument();
    // stat row degrades to dashes
    expect(screen.getByTestId("nifty-gex-profile-net")).toHaveTextContent("—");
    expect(screen.getByTestId("nifty-gex-profile-regime")).toHaveTextContent("—");
  });

  test("empty strike list also renders the empty state", () => {
    render(<NiftyGexProfile gex={gex({ strikes: [] })} spot={22700} />, {
      wrapper: TestWrapper,
    });
    expect(screen.getByTestId("nifty-gex-profile-chart")).toBeInTheDocument();
    expect(screen.getByText("No per-strike GEX profile")).toBeInTheDocument();
  });
});
