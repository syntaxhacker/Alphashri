import { describe, expect, test } from "vitest";
import {
  PIN_EDGE_HIGH_PTS,
  PIN_EDGE_MEDIUM_PTS,
  PIN_PAIN_PTS,
  PIN_WALL_MIN_OI_FRACTION,
  pinHint,
  pinRisk as pinRiskBase,
} from "./niftyPin";
import type { PinInput } from "./niftyPin";
import { symbolMetrics, type SymbolMetrics } from "./symbolMetrics";

function makeMetrics(spot: number, strikeStep: number) {
  return symbolMetrics({
    spot,
    strikes: Array.from({ length: 5 }, (_, i) => ({ strike: spot + (i - 2) * strikeStep })) as any,
    positioning: { lotSize: strikeStep === 100 ? 20 : 65 },
  } as any);
}

const wallsNear = {
  calls: [{ strike: 22700, oi: 7_900_000 }],
  puts: [{ strike: 22500, oi: 14_800_000 }],
};

const defaultMetrics = makeMetrics(22_800, 50);
/** Tests that exercise symbol scaling pass their own metrics; legacy cases
 *  use the NIFTY defaults explicitly (never the old fake-report fallback). */
function pinRisk(input: Omit<PinInput, "metrics"> & { metrics?: SymbolMetrics }) {
  return pinRiskBase({ ...input, metrics: input.metrics ?? defaultMetrics });
}

describe("pinRisk", () => {
  test("2026-10-23: at the 22,500 wall with max pain 197 pts above is HIGH (NIFTY)", () => {
    const read = pinRisk({ spot: 22503, maxPain: 22700, wallsNear });
    expect(read).not.toBeNull();
    expect(read?.level).toBe("HIGH");
    expect(read?.magnet).toBe("above");
    expect(read?.contained).toBe(true);
    expect(Math.round(read!.maxPainDistance)).toBe(197);
    expect(read?.edgeStrike).toBe(22500);
    expect(Math.round(read!.edgeDistance!)).toBe(3);
    expect(read?.detail).toContain("PINNED");
    expect(read?.detail).toContain("two consecutive 1-min closes");
  });

  test("2026-10-23 10:58: 70 pts under the heavy wall is MEDIUM, never HIGH", () => {
    const read = pinRisk({
      spot: 22430,
      maxPain: 22700,
      wallsNear: {
        calls: [{ strike: 22700, oi: 12_000_000 }],
        puts: [
          { strike: 22500, oi: 15_200_000 },
          { strike: 22450, oi: 5_700_000 },
        ],
      },
    });
    expect(read?.level).toBe("MEDIUM");
    expect(read?.contained).toBe(false);
    expect(read?.edgeStrike).toBe(22500);
    expect(Math.round(read!.edgeDistance!)).toBe(70);
    expect(read?.detail).toContain("below the 22,500 put wall");
    expect(pinHint(read)).toBe("MP +270 · 22,500 (70)");
    expect(PIN_WALL_MIN_OI_FRACTION).toBe(0.5);
  });

  test("a wall 80 pts away is MEDIUM, not HIGH (NIFTY)", () => {
    const read = pinRisk({
      spot: 22580,
      maxPain: 22700,
      wallsNear: {
        calls: [{ strike: 22700, oi: 1, distance: 120 }],
        puts: [{ strike: 22500, oi: 1, distance: -80 }],
      },
    });
    expect(read?.level).toBe("MEDIUM");
    expect(PIN_EDGE_HIGH_PTS).toBe(50);
    expect(PIN_EDGE_MEDIUM_PTS).toBe(100);
  });

  test("max pain under the 100-pt pain threshold never pins (NIFTY)", () => {
    const read = pinRisk({
      spot: 25650,
      maxPain: 25700,
      wallsNear: {
        calls: [{ strike: 25660, oi: 1, distance: 10 }],
        puts: [{ strike: 25640, oi: 1, distance: -10 }],
      },
    });
    expect(read?.level).toBe("LOW");
    expect(PIN_PAIN_PTS).toBe(100);
  });

  test("far walls read LOW and say so", () => {
    const read = pinRisk({
      spot: 22645,
      maxPain: 22800,
      wallsNear: {
        calls: [{ strike: 23000, oi: 1, distance: 355 }],
        puts: [{ strike: 22500, oi: 1, distance: -145 }],
      },
    });
    expect(read?.level).toBe("LOW");
    expect(read?.contained).toBe(true);
    expect(read?.detail).toContain("Not pinned");
  });

  test("missing spot or max pain returns null (dash, never a fake level)", () => {
    expect(pinRisk({ spot: null, maxPain: 22700, wallsNear })).toBeNull();
    expect(pinRisk({ spot: 22492, maxPain: null, wallsNear })).toBeNull();
    expect(pinRisk({})).toBeNull();
  });

  test("wallsNear wins over the full board; full board is the fallback", () => {
    const near = pinRisk({
      spot: 22503,
      maxPain: 22700,
      wallsNear,
      walls: { calls: [{ strike: 24000, oi: 1 }], puts: [{ strike: 20000, oi: 1 }] },
    });
    expect(near?.edgeStrike).toBe(22500);
    const fallback = pinRisk({
      spot: 22503,
      maxPain: 22700,
      walls: { calls: [{ strike: 22700, oi: 1 }], puts: [{ strike: 22500, oi: 1 }] },
    });
    expect(fallback?.edgeStrike).toBe(22500);
    expect(fallback?.level).toBe("HIGH");
  });

  test("the heaviest wall sets the edge, not the nearest strike", () => {
    const read = pinRisk({
      spot: 22530,
      maxPain: 22700,
      wallsNear: {
        calls: [
          { strike: 22700, oi: 12_000_000 },
          { strike: 22540, oi: 10_000 },
        ],
        puts: [
          { strike: 22500, oi: 15_000_000 },
          { strike: 22525, oi: 5_000 },
        ],
      },
    });
    expect(read?.edgeStrike).toBe(22500);
    expect(Math.round(read!.edgeDistance!)).toBe(30);
    expect(read?.level).toBe("HIGH");
  });

  test("zero max pain distance is reported as 'at'", () => {
    const read = pinRisk({
      spot: 22500,
      maxPain: 22500,
      wallsNear: { calls: [], puts: [{ strike: 22500, oi: 1, distance: 0 }] },
    });
    expect(read?.magnet).toBe("at");
    expect(read?.level).toBe("LOW");
  });

  // --- Symbol-aware thresholds (new) ---

  test("SENSEX: 100-pt strike step -> pinEdgeHigh=100, pinEdgeMedium=200, pinPainPts=200", () => {
    const metrics = makeMetrics(79_000, 100);
    expect(metrics.pinEdgeHigh).toBe(100);
    expect(metrics.pinEdgeMedium).toBe(200);
    expect(metrics.pinPainPts).toBe(200);

    // Spot 79,000, max pain 79,200 (200 pts above = at pain threshold)
    // Wall at 79,100 (100 pts away = HIGH threshold for SENSEX)
    const read = pinRisk({
      spot: 79_000,
      maxPain: 79_200,
      wallsNear: { calls: [{ strike: 79_100, oi: 10_000_000 }], puts: [] },
      metrics,
    });
    expect(read?.level).toBe("HIGH");
    expect(read?.edgeDistance).toBe(100);

    // Wall at 79,150 (150 pts away = MEDIUM for SENSEX)
    const read2 = pinRisk({
      spot: 79_000,
      maxPain: 79_200,
      wallsNear: { calls: [{ strike: 79_150, oi: 10_000_000 }], puts: [] },
      metrics,
    });
    expect(read2?.level).toBe("MEDIUM");

    // Wall at 79,250 (250 pts away = LOW for SENSEX)
    const read3 = pinRisk({
      spot: 79_000,
      maxPain: 79_200,
      wallsNear: { calls: [{ strike: 79_250, oi: 10_000_000 }], puts: [] },
      metrics,
    });
    expect(read3?.level).toBe("LOW");
  });

  test("RELIANCE: 50-pt strike step -> same as NIFTY (pinEdgeHigh=50, pinEdgeMedium=100, pinPainPts=100)", () => {
    const metrics = makeMetrics(1_400, 50);
    expect(metrics.pinEdgeHigh).toBe(50);
    expect(metrics.pinEdgeMedium).toBe(100);
    expect(metrics.pinPainPts).toBe(100);

    const read = pinRisk({
      spot: 1_400,
      maxPain: 1_500,
      wallsNear: { calls: [{ strike: 1_450, oi: 10_000_000 }], puts: [] },
      metrics,
    });
    expect(read?.level).toBe("HIGH");
    expect(read?.edgeDistance).toBe(50);
  });

  test("NIFTY: 50-pt strike step -> unchanged behavior (pinEdgeHigh=50, pinEdgeMedium=100, pinPainPts=100)", () => {
    const metrics = makeMetrics(22_800, 50);
    expect(metrics.pinEdgeHigh).toBe(50);
    expect(metrics.pinEdgeMedium).toBe(100);
    expect(metrics.pinPainPts).toBe(100);

    const read = pinRisk({
      spot: 22_500,
      maxPain: 22_700,
      wallsNear: { calls: [{ strike: 22_550, oi: 10_000_000 }], puts: [] },
      metrics,
    });
    expect(read?.level).toBe("HIGH");
    expect(read?.edgeDistance).toBe(50);
  });

  test("without metrics, legacy defaults apply (backward compat)", () => {
    const read = pinRisk({
      spot: 22_500,
      maxPain: 22_700,
      wallsNear: { calls: [{ strike: 22_550, oi: 10_000_000 }], puts: [] },
    });
    expect(read?.level).toBe("HIGH");
    expect(read?.edgeDistance).toBe(50);
  });
});

describe("pinHint", () => {
  test("renders the compact label the cell shows in its tooltip", () => {
    const read = pinRisk({ spot: 22503, maxPain: 22700, wallsNear });
    expect(pinHint(read)).toBe("MP +197 · 22,500 (3)");
    expect(pinHint(null)).toBe("spot / max pain missing");
  });
});