// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";
import {
  buildGexProfile,
  gexProfileStats,
  gexSideCopy,
  gexSideLevels,
  nearestStrikeIndex,
  selectGexBand,
  trimGexProfile,
} from "./NiftyGexProfile";
import { gex } from "./NiftyGexProfile.fixtures";

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
    { strike: 22350, netGex: 3 },
    { strike: 22400, netGex: 92 },
    { strike: 22450, netGex: 0 },
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
    expect(s.peakStrike).toBe(22800);
    expect(s.troughStrike).toBe(22800);
  });
});

describe("gexSideLevels (spot-relative)", () => {
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
    expect(sides.below).toEqual({
      strike: 22500,
      netGex: -20,
      kind: "fuel",
      side: "below",
    });
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
