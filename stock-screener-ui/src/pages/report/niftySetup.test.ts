import { describe, expect, test } from "vitest";
import { COIL_MAX_RATIO, WALL_MIN_OI, setupRadar as setupRadarBase } from "./niftySetup";
import type { SetupInput } from "./niftySetup";
import { symbolMetrics, type SymbolMetrics } from "./symbolMetrics";
import type { PressureSeries } from "./niftyPressure";
import type { NiftyStrike } from "@/types/niftyReport";

/** A quiet, coiled tape: wide swings early, the last 30 minutes in a 20-pt box. */
function coilRows() {
  const out: Array<{ t: string; spot: number }> = [];
  for (let i = 0; i < 90; i++) {
    const minutes = 9 * 60 + 15 + i;
    const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
    const mm = String(minutes % 60).padStart(2, "0");
    const spot = i < 60 ? 22_300 + (i % 2 === 0 ? 0 : 200) : 22_400 + (i % 5) * 4;
    out.push({ t: `2026-10-23T${hh}:${mm}:00`, spot });
  }
  return out;
}

function pressure(last3Ratio = 3): PressureSeries {
  return {
    points: [],
    median: 1,
    maxRatio: last3Ratio,
    bursts: 1,
    last3Ratio,
    lastRatio: last3Ratio,
  };
}

const walls = {
  calls: [{ strike: 22_450, oi: 15_000_000, distance: 30 }],
  puts: [{ strike: 22_350, oi: 9_000_000, distance: -70 }],
};

const coveringStrike = [
  {
    strike: 22_450,
    ce: { sentiment: "Short Cover" },
    pe: { sentiment: "Long Buildup" },
  },
];

const defaultMetrics = makeMetrics(22_800, 50);
/** Tests that exercise symbol scaling pass their own metrics; legacy cases
 *  use the NIFTY defaults explicitly (never the old fake-report fallback). */
function setupRadar(input: Omit<SetupInput, "metrics"> & { metrics?: SymbolMetrics }) {
  return setupRadarBase({ ...input, metrics: input.metrics ?? defaultMetrics });
}

/** Arrange for the symbol-scaling cases: coiled tape shifted onto the symbol's
 *  spot, short-gamma book, pressure ratio 3. Only walls/pivots/strikes/metrics
 *  differ between symbols. */
function symbolRead({
  spot,
  wallsNear,
  pivots,
  strikes,
  metrics,
}: {
  spot: number;
  wallsNear: SetupInput["wallsNear"];
  pivots: SetupInput["pivots"];
  strikes: SetupInput["strikes"];
  metrics: SymbolMetrics;
}) {
  return setupRadar({
    rows: coilRows().map((r) => ({ ...r, spot: r.spot - 22_400 + spot })),
    spot,
    wallsNear,
    gex: { regime: "short" } as never,
    pivots,
    strikes,
    pressure: pressure(3),
    metrics,
  });
}

function makeMetrics(spot: number, strikeStep: number, lotSize: number = 65, maxWallOi: number = 11_000_000) {
  return symbolMetrics({
    spot,
    strikes: Array.from({ length: 5 }, (_, i) => ({
      strike: spot + (i - 2) * strikeStep,
      ce: { oi: 10_000_000, ltp: 0, close: 0, prevOi: 0, oiChange: 0, priceChange: 0, sentiment: "Neutral", volume: 0, delta: 0.5, gamma: 0, theta: 0, vega: 0, iv: 0 },
      pe: { oi: 10_000_000, ltp: 0, close: 0, prevOi: 0, oiChange: 0, priceChange: 0, sentiment: "Neutral", volume: 0, delta: -0.5, gamma: 0, theta: 0, vega: 0, iv: 0 },
    })) as NiftyStrike[],
    walls: {
      calls: [{ strike: spot + strikeStep * 2, oi: maxWallOi, distance: strikeStep * 2 }],
      puts: [{ strike: spot - strikeStep * 2, oi: maxWallOi, distance: -strikeStep * 2 }],
    },
    positioning: { lotSize },
  } as any);
}

describe("setupRadar", () => {
  test("today's 13:30 frame is ARMED 6/7 — fuel missing while the wall is SB (NIFTY)", () => {
    const read = setupRadar({
      rows: coilRows(),
      spot: 22_414,
      wallsNear: walls,
      gex: { regime: "short" } as never,
      pivots: { pp: 22_420, r1: 22_600, s1: 22_300, prev: { high: 22_714, low: 22_376 } } as never,
      strikes: [
        {
          strike: 22_450,
          ce: { sentiment: "Short Buildup" },
          pe: { sentiment: "Long Buildup" },
        },
      ],
      pressure: pressure(3),
    });
    expect(read.gates.map((g) => g.key)).toEqual([
      "COIL", "TREND", "RVOL", "LEVEL", "WALL", "GAMMA", "FUEL",
    ]);
    expect(read.gates.find((g) => g.key === "COIL")?.pass).toBe(true);
    expect(read.gates.find((g) => g.key === "RVOL")?.pass).toBe(true);
    expect(read.gates.find((g) => g.key === "WALL")?.pass).toBe(true);
    expect(read.gates.find((g) => g.key === "FUEL")?.pass).toBe(false);
    expect(read.score).toBe(6);
    expect(read.state).toBe("ARMED");
  });

  test("covering at the wall flips FUEL and reaches TRIGGER when all five pass (NIFTY)", () => {
    const read = setupRadar({
      rows: coilRows(),
      spot: 22_414,
      wallsNear: walls,
      strikes: coveringStrike as never,
      pressure: pressure(5),
      gex: { regime: "short" } as never,
      pivots: { pp: 22_420, r1: 22_600, s1: 22_300, prev: { high: 22_714, low: 22_376 } } as never,
    });
    expect(read.gates.find((g) => g.key === "FUEL")?.pass).toBe(true);
    expect(read.score).toBe(7);
    expect(read.state).toBe("TRIGGER");
  });

  test("a far or light wall fails WALL even when trend and volume are hot (NIFTY)", () => {
    const read = setupRadar({
      rows: coilRows(),
      spot: 22_400,
      wallsNear: { calls: [{ strike: 22_700, oi: 5_000_000 }], puts: [] },
      strikes: [],
      pressure: pressure(3),
    });
    expect(read.gates.find((g) => g.key === "WALL")?.pass).toBe(false);
    expect(read.score).toBeLessThan(7);
  });

  test("a wide tape fails COIL and reads QUIET without the rest (NIFTY)", () => {
    const rows = Array.from({ length: 90 }, (_, i) => {
      const m = 9 * 60 + 15 + i;
      const hh = String(Math.floor(m / 60)).padStart(2, "0");
      const mm = String(m % 60).padStart(2, "0");
      return { t: `2026-10-23T${hh}:${mm}:00`, spot: 22_300 + (i % 2 === 0 ? 0 : 200) };
    });
    const read = setupRadar({ rows, spot: 22_400, wallsNear: walls, strikes: [], pressure: pressure(1) });
    expect(read.gates.find((g) => g.key === "COIL")?.pass).toBe(false);
    expect(read.state).toBe("QUIET");
  });

  test("thresholds are exposed and meaningful", () => {
    expect(COIL_MAX_RATIO).toBe(0.7);
    expect(WALL_MIN_OI).toBe(10_000_000);
  });

  // --- Symbol-aware thresholds (new) ---

  test("SENSEX: 100-pt strike step -> wallMaxDist=200, wallMinOi=1.875M (25% of 7.5M), levelMaxDist=120", () => {
    const metrics = makeMetrics(79_000, 100, 20, 7_500_000);
    expect(metrics.wallMaxDist).toBe(200);
    expect(metrics.wallMinOi).toBe(1_875_000); // max(500k, 7.5M * 0.25) = 1.875M
    expect(metrics.levelMaxDist).toBe(120);

    const sensexWalls = { calls: [{ strike: 79_100, oi: 7_500_000, distance: 100 }], puts: [] };
    const sensexPivots = { pp: 79_050, r1: 79_200, s1: 78_900, prev: { high: 79_300, low: 78_800 } };

    const read = symbolRead({
      spot: 79_000,
      wallsNear: sensexWalls,
      pivots: sensexPivots as never,
      strikes: [{ strike: 79_100, ce: { sentiment: "Short Cover" }, pe: { sentiment: "Long Buildup" } }] as never,
      metrics,
    });

    expect(read.gates.find((g) => g.key === "WALL")?.pass).toBe(true);
    expect(read.gates.find((g) => g.key === "LEVEL")?.pass).toBe(true);
  });

  test("SENSEX: wall at 300 pts fails WALL (exceeds 200-pt threshold)", () => {
    const metrics = makeMetrics(79_000, 100, 20, 7_500_000);
    const sensexWalls = { calls: [{ strike: 79_300, oi: 7_500_000, distance: 300 }], puts: [] };

    const read = symbolRead({
      spot: 79_000,
      wallsNear: sensexWalls,
      pivots: { pp: 79_050, r1: 79_200, s1: 78_900, prev: { high: 79_300, low: 78_800 } } as never,
      strikes: [] as never,
      metrics,
    });

    expect(read.gates.find((g) => g.key === "WALL")?.pass).toBe(false);
  });

  test("RELIANCE: 50-pt strike step -> same thresholds as NIFTY (wallMaxDist=100, wallMinOi=3.5M (25% of 14M), levelMaxDist=60)", () => {
    const metrics = makeMetrics(1_400, 50, 500, 14_000_000);
    expect(metrics.wallMaxDist).toBe(100);
    expect(metrics.wallMinOi).toBe(3_500_000); // max(500k, 14M * 0.25) = 3.5M
    expect(metrics.levelMaxDist).toBe(60);

    const relianceWalls = { calls: [{ strike: 1_450, oi: 14_000_000, distance: 50 }], puts: [] };
    const reliancePivots = { pp: 1_420, r1: 1_480, s1: 1_380, prev: { high: 1_500, low: 1_350 } };

    const read = symbolRead({
      spot: 1_400,
      wallsNear: relianceWalls,
      pivots: reliancePivots as never,
      strikes: [{ strike: 1_450, ce: { sentiment: "Short Cover" }, pe: { sentiment: "Long Buildup" } }] as never,
      metrics: makeMetrics(1_400, 50, 500, 14_000_000),
    });

    expect(read.gates.find((g) => g.key === "WALL")?.pass).toBe(true);
    expect(read.gates.find((g) => g.key === "LEVEL")?.pass).toBe(true);
  });

  test("RELIANCE: wall with 1M Oi fails WALL (below 3.5M gate)", () => {
    const metrics = makeMetrics(1_400, 50, 500, 14_000_000);
    const relianceWalls = { calls: [{ strike: 1_450, oi: 1_000_000, distance: 50 }], puts: [] };

    const read = symbolRead({
      spot: 1_400,
      wallsNear: relianceWalls,
      pivots: { pp: 1_420, r1: 1_480, s1: 1_380, prev: { high: 1_500, low: 1_350 } } as never,
      strikes: [] as never,
      metrics,
    });

    expect(read.gates.find((g) => g.key === "WALL")?.pass).toBe(false);
  });

  test("NIFTY: wallMinOi = 2.75M (25% of 11M maxWallOi)", () => {
    const metrics = makeMetrics(22_800, 50, 65, 11_000_000);
    expect(metrics.wallMinOi).toBe(2_750_000);
  });

  test("without metrics, legacy defaults apply (backward compat)", () => {
    const read = setupRadar({
      rows: coilRows(),
      spot: 22_414,
      wallsNear: walls,
      gex: { regime: "short" } as never,
      pivots: { pp: 22_420, r1: 22_600, s1: 22_300, prev: { high: 22_714, low: 22_376 } } as never,
      strikes: coveringStrike as never,
      pressure: pressure(5),
    });
    expect(read.gates.find((g) => g.key === "WALL")?.pass).toBe(true);
    expect(read.score).toBe(7);
    expect(read.state).toBe("TRIGGER");
  });
});