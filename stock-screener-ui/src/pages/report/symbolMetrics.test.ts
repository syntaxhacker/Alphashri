import { describe, expect, test } from "vitest";
import { symbolMetrics, maxPainTouchTol, pinEdgeHigh, pinEdgeMedium, pinPainPts, wallMaxDist, wallMinOi, levelMaxDist, heatmapWidthPts, atmWindowPts, flowNoiseFor, squeezeRangePts, squeezePriceBreakPts, squeezeAtWallPts, TEST_FIXTURES } from "./symbolMetrics";
import type { NiftyReport, NiftyStrike, NiftyWall } from "@/types/niftyReport";

function makeReport(overrides: Partial<NiftyReport> = {}): NiftyReport {
  const spot = overrides.spot ?? 22_800;
  const strikes: NiftyStrike[] = overrides.strikes ?? [
    { strike: 22_500, ce: { oi: 2_000_000, ltp: 0, close: 0, prevOi: 0, oiChange: 0, priceChange: 0, sentiment: "Neutral", volume: 0, delta: 0.5, gamma: 0, theta: 0, vega: 0, iv: 0 }, pe: { oi: 2_000_000, ltp: 0, close: 0, prevOi: 0, oiChange: 0, priceChange: 0, sentiment: "Neutral", volume: 0, delta: -0.5, gamma: 0, theta: 0, vega: 0, iv: 0 } },
    { strike: 22_550, ce: { oi: 2_000_000, ltp: 0, close: 0, prevOi: 0, oiChange: 0, priceChange: 0, sentiment: "Neutral", volume: 0, delta: 0.5, gamma: 0, theta: 0, vega: 0, iv: 0 }, pe: { oi: 2_000_000, ltp: 0, close: 0, prevOi: 0, oiChange: 0, priceChange: 0, sentiment: "Neutral", volume: 0, delta: -0.5, gamma: 0, theta: 0, vega: 0, iv: 0 } },
    { strike: 22_600, ce: { oi: 2_000_000, ltp: 0, close: 0, prevOi: 0, oiChange: 0, priceChange: 0, sentiment: "Neutral", volume: 0, delta: 0.5, gamma: 0, theta: 0, vega: 0, iv: 0 }, pe: { oi: 2_000_000, ltp: 0, close: 0, prevOi: 0, oiChange: 0, priceChange: 0, sentiment: "Neutral", volume: 0, delta: -0.5, gamma: 0, theta: 0, vega: 0, iv: 0 } },
    { strike: 22_650, ce: { oi: 2_000_000, ltp: 0, close: 0, prevOi: 0, oiChange: 0, priceChange: 0, sentiment: "Neutral", volume: 0, delta: 0.5, gamma: 0, theta: 0, vega: 0, iv: 0 }, pe: { oi: 2_000_000, ltp: 0, close: 0, prevOi: 0, oiChange: 0, priceChange: 0, sentiment: "Neutral", volume: 0, delta: -0.5, gamma: 0, theta: 0, vega: 0, iv: 0 } },
    { strike: 22_700, ce: { oi: 2_000_000, ltp: 0, close: 0, prevOi: 0, oiChange: 0, priceChange: 0, sentiment: "Neutral", volume: 0, delta: 0.5, gamma: 0, theta: 0, vega: 0, iv: 0 }, pe: { oi: 2_000_000, ltp: 0, close: 0, prevOi: 0, oiChange: 0, priceChange: 0, sentiment: "Neutral", volume: 0, delta: -0.5, gamma: 0, theta: 0, vega: 0, iv: 0 } },
  ];
  const walls: { calls: NiftyWall[]; puts: NiftyWall[] } = overrides.walls ?? {
    calls: [{ strike: 22_700, oi: 11_000_000, distance: 200 }],
    puts: [{ strike: 22_400, oi: 10_000_000, distance: -200 }],
  };
  const positioning = { lotSize: 65, verdict: "balanced" as const, state: 0, flow: 0, initiated: 0, bullCr: 0, bearCr: 0, splitPct: 0, ceDoi: 0, peDoi: 0, deltaFlip: null, strikes: [] };
  return {
    mode: "live",
    date: "2026-11-05",
    expiry: "2026-11-06",
    spot,
    ohlc: { open: spot, high: spot, low: spot, close: spot },
    pcrOi: 1,
    pcrVol: 1,
    maxPain: 22_650,
    walls,
    wallsNear: { calls: [], puts: [] },
    strikes,
    timeline: [],
    positioning,
    ...overrides,
  } as NiftyReport;
}

describe("symbolMetrics", () => {
  test("NIFTY defaults: strikeStep=50, all derived thresholds scale correctly", () => {
    const report = makeReport({ spot: 22_800 });
    const m = symbolMetrics(report);

    expect(m.spot).toBe(22_800);
    expect(m.strikeStep).toBe(50);
    expect(m.lotSize).toBe(65);
    expect(m.totalOi).toBe(20_000_000);
    expect(m.maxWallOi).toBe(11_000_000);

    // Point thresholds
    expect(m.maxPainTouchTol).toBe(10); // 50 * 0.2
    expect(m.pinEdgeHigh).toBe(50);
    expect(m.pinEdgeMedium).toBe(100);
    expect(m.pinPainPts).toBe(100);
    expect(m.wallMaxDist).toBe(100);
    // wallMinOi: max(500k, 11M * 0.25) = max(500k, 2.75M) = 2.75M
    expect(m.wallMinOi).toBe(2_750_000);
    expect(m.levelMaxDist).toBe(60); // round(50 * 1.2)
    expect(m.heatmapWidthPts).toBe(250); // 50 * 5
    expect(m.atmWindowPts).toBe(750); // 50 * 15

    // Flow noise: absolute floor 50k, relative 0.1%
    expect(m.flowNoise).toBe(50_000);
    expect(m.flowNoiseRel).toBe(0.001);
    // totalOi = 20M * 0.1% = 20k, max(50k, 20k) = 50k
    expect(m.effectiveFlowNoise).toBe(50_000);

    // Squeeze radar (bps preserved from NIFTY calibration)
    expect(m.squeezeRangeBps).toBe(Math.round((120 / 22_800) * 10000)); // ~52.6 -> 53
    expect(m.squeezePriceBreakBps).toBe(Math.round((10 / 22_800) * 10000)); // ~4.4 -> 4
    expect(m.squeezeAtWallBps).toBe(Math.round((5 / 22_800) * 10000)); // ~2.2 -> 2
    expect(m.squeezeRangePts).toBe(Math.max(1, Math.round((22_800 * m.squeezeRangeBps) / 10000)));
    expect(m.squeezePriceBreakPts).toBe(Math.max(1, Math.round((22_800 * m.squeezePriceBreakBps) / 10000)));
    expect(m.squeezeAtWallPts).toBe(Math.max(1, Math.round((22_800 * m.squeezeAtWallBps) / 10000)));
  });

  test("SENSEX: 79k spot, 100-pt step, lot 20 — thresholds scale up", () => {
    const strikes: NiftyStrike[] = [
      { strike: 78_500, ce: { oi: 100_000, ltp: 0, close: 0, prevOi: 0, oiChange: 0, priceChange: 0, sentiment: "Neutral", volume: 0, delta: 0.5, gamma: 0, theta: 0, vega: 0, iv: 0 }, pe: { oi: 100_000, ltp: 0, close: 0, prevOi: 0, oiChange: 0, priceChange: 0, sentiment: "Neutral", volume: 0, delta: -0.5, gamma: 0, theta: 0, vega: 0, iv: 0 } },
      { strike: 78_600, ce: { oi: 200_000, ltp: 0, close: 0, prevOi: 0, oiChange: 0, priceChange: 0, sentiment: "Neutral", volume: 0, delta: 0.5, gamma: 0, theta: 0, vega: 0, iv: 0 }, pe: { oi: 200_000, ltp: 0, close: 0, prevOi: 0, oiChange: 0, priceChange: 0, sentiment: "Neutral", volume: 0, delta: -0.5, gamma: 0, theta: 0, vega: 0, iv: 0 } },
      { strike: 78_700, ce: { oi: 300_000, ltp: 0, close: 0, prevOi: 0, oiChange: 0, priceChange: 0, sentiment: "Neutral", volume: 0, delta: 0.5, gamma: 0, theta: 0, vega: 0, iv: 0 }, pe: { oi: 300_000, ltp: 0, close: 0, prevOi: 0, oiChange: 0, priceChange: 0, sentiment: "Neutral", volume: 0, delta: -0.5, gamma: 0, theta: 0, vega: 0, iv: 0 } },
      { strike: 78_800, ce: { oi: 200_000, ltp: 0, close: 0, prevOi: 0, oiChange: 0, priceChange: 0, sentiment: "Neutral", volume: 0, delta: 0.5, gamma: 0, theta: 0, vega: 0, iv: 0 }, pe: { oi: 200_000, ltp: 0, close: 0, prevOi: 0, oiChange: 0, priceChange: 0, sentiment: "Neutral", volume: 0, delta: -0.5, gamma: 0, theta: 0, vega: 0, iv: 0 } },
      { strike: 78_900, ce: { oi: 100_000, ltp: 0, close: 0, prevOi: 0, oiChange: 0, priceChange: 0, sentiment: "Neutral", volume: 0, delta: 0.5, gamma: 0, theta: 0, vega: 0, iv: 0 }, pe: { oi: 100_000, ltp: 0, close: 0, prevOi: 0, oiChange: 0, priceChange: 0, sentiment: "Neutral", volume: 0, delta: -0.5, gamma: 0, theta: 0, vega: 0, iv: 0 } },
    ];
    const walls: { calls: NiftyWall[]; puts: NiftyWall[] } = {
      calls: [{ strike: 79_100, oi: 7_500_000, distance: 100 }],
      puts: [{ strike: 79_000, oi: 7_500_000, distance: 0 }],
    };
    const report = makeReport({ spot: 79_000, strikes, walls, positioning: { ...makeReport().positioning!, lotSize: 20 } });
    const m = symbolMetrics(report);

    expect(m.spot).toBe(79_000);
    expect(m.strikeStep).toBe(100);
    expect(m.lotSize).toBe(20);
    expect(m.maxWallOi).toBe(7_500_000);

    // Point thresholds scale with strikeStep (2x NIFTY)
    expect(m.maxPainTouchTol).toBe(20); // 100 * 0.2
    expect(m.pinEdgeHigh).toBe(100);
    expect(m.pinEdgeMedium).toBe(200);
    expect(m.pinPainPts).toBe(200);
    expect(m.wallMaxDist).toBe(200);
    // wallMinOi: max(500k, 7.5M * 0.25) = max(500k, 1.875M) = 1.875M
    expect(m.wallMinOi).toBe(1_875_000);
    expect(m.levelMaxDist).toBe(120); // round(100 * 1.2)
    expect(m.heatmapWidthPts).toBe(500); // 100 * 5
    expect(m.atmWindowPts).toBe(1_500); // 100 * 15

    // Flow noise: SENSEX totalOi = 1.8M * 0.1% = 1.8k, max(50k, 1.8k) = 50k
    // (Note: chain OI is lower than tape OI; real SENSEX totalOi ~170M would give 170k)
    expect(m.flowNoise).toBe(50_000);
    expect(m.flowNoiseRel).toBe(0.001);
    expect(m.effectiveFlowNoise).toBe(50_000);

    // Squeeze radar: bps preserved, points scale with spot
    expect(m.squeezeRangeBps).toBe(Math.round((120 / 22_800) * 10000));
    expect(m.squeezePriceBreakBps).toBe(Math.round((10 / 22_800) * 10000));
    expect(m.squeezeAtWallBps).toBe(Math.round((5 / 22_800) * 10000));
    expect(m.squeezeRangePts).toBe(Math.max(1, Math.round((79_000 * m.squeezeRangeBps) / 10000)));
    expect(m.squeezePriceBreakPts).toBe(Math.max(1, Math.round((79_000 * m.squeezePriceBreakBps) / 10000)));
    expect(m.squeezeAtWallPts).toBe(Math.max(1, Math.round((79_000 * m.squeezeAtWallBps) / 10000)));

    // Verify SENSEX range is ~3.46x NIFTY (79k/22.8k)
    const niftyReport = makeReport({ spot: 22_800 });
    const niftyMetrics = symbolMetrics(niftyReport);
    expect(m.squeezeRangePts / niftyMetrics.squeezeRangePts).toBeCloseTo(79_000 / 22_800, 1);
  });

  test("RELIANCE: 1.4k spot, 50-pt step, lot 500 — thresholds scale down", () => {
    const strikes: NiftyStrike[] = [
      { strike: 1_350, ce: { oi: 50_000, ltp: 0, close: 0, prevOi: 0, oiChange: 0, priceChange: 0, sentiment: "Neutral", volume: 0, delta: 0.5, gamma: 0, theta: 0, vega: 0, iv: 0 }, pe: { oi: 50_000, ltp: 0, close: 0, prevOi: 0, oiChange: 0, priceChange: 0, sentiment: "Neutral", volume: 0, delta: -0.5, gamma: 0, theta: 0, vega: 0, iv: 0 } },
      { strike: 1_400, ce: { oi: 100_000, ltp: 0, close: 0, prevOi: 0, oiChange: 0, priceChange: 0, sentiment: "Neutral", volume: 0, delta: 0.5, gamma: 0, theta: 0, vega: 0, iv: 0 }, pe: { oi: 100_000, ltp: 0, close: 0, prevOi: 0, oiChange: 0, priceChange: 0, sentiment: "Neutral", volume: 0, delta: -0.5, gamma: 0, theta: 0, vega: 0, iv: 0 } },
      { strike: 1_450, ce: { oi: 50_000, ltp: 0, close: 0, prevOi: 0, oiChange: 0, priceChange: 0, sentiment: "Neutral", volume: 0, delta: 0.5, gamma: 0, theta: 0, vega: 0, iv: 0 }, pe: { oi: 50_000, ltp: 0, close: 0, prevOi: 0, oiChange: 0, priceChange: 0, sentiment: "Neutral", volume: 0, delta: -0.5, gamma: 0, theta: 0, vega: 0, iv: 0 } },
    ];
    const walls: { calls: NiftyWall[]; puts: NiftyWall[] } = {
      calls: [{ strike: 1_300, oi: 14_000_000, distance: -100 }],
      puts: [{ strike: 1_200, oi: 9_000_000, distance: -200 }],
    };
    const report = makeReport({ spot: 1_400, strikes, walls, positioning: { ...makeReport().positioning!, lotSize: 500 } });
    const m = symbolMetrics(report);

    expect(m.spot).toBe(1_400);
    expect(m.strikeStep).toBe(50);
    expect(m.lotSize).toBe(500);
    expect(m.maxWallOi).toBe(14_000_000);

    // Point thresholds same as NIFTY (same strike step)
    expect(m.maxPainTouchTol).toBe(10);
    expect(m.pinEdgeHigh).toBe(50);
    expect(m.pinEdgeMedium).toBe(100);
    expect(m.pinPainPts).toBe(100);
    expect(m.wallMaxDist).toBe(100);
    // wallMinOi: max(500k, 14M * 0.25) = max(500k, 3.5M) = 3.5M
    expect(m.wallMinOi).toBe(3_500_000);
    expect(m.levelMaxDist).toBe(60);
    expect(m.heatmapWidthPts).toBe(250);
    expect(m.atmWindowPts).toBe(750);

    // Flow noise: RELIANCE totalOi = 0.6M * 0.1% = 600, max(50k, 600) = 50k
    // (Note: real RELIANCE totalOi ~50M would give 50k)
    expect(m.flowNoise).toBe(50_000);
    expect(m.flowNoiseRel).toBe(0.001);
    expect(m.effectiveFlowNoise).toBe(50_000);

    // Squeeze radar: bps preserved, points scale with spot (1.4k vs 22.8k)
    expect(m.squeezeRangePts).toBe(Math.max(1, Math.round((1_400 * m.squeezeRangeBps) / 10000)));
    expect(m.squeezePriceBreakPts).toBe(Math.max(1, Math.round((1_400 * m.squeezePriceBreakBps) / 10000)));
    expect(m.squeezeAtWallPts).toBe(Math.max(1, Math.round((1_400 * m.squeezeAtWallBps) / 10000)));

    // Verify RELIANCE range is ~0.061x NIFTY (1.4k/22.8k)
    const niftyReport = makeReport({ spot: 22_800 });
    const niftyMetrics = symbolMetrics(niftyReport);
    expect(m.squeezeRangePts / niftyMetrics.squeezeRangePts).toBeCloseTo(1_400 / 22_800, 1);
  });

  test("Fallback strike step when chain has <2 unique strikes", () => {
    const strikes: NiftyStrike[] = [
      { strike: 22_650, ce: { oi: 1_000_000, ltp: 0, close: 0, prevOi: 0, oiChange: 0, priceChange: 0, sentiment: "Neutral", volume: 0, delta: 0.5, gamma: 0, theta: 0, vega: 0, iv: 0 }, pe: { oi: 1_000_000, ltp: 0, close: 0, prevOi: 0, oiChange: 0, priceChange: 0, sentiment: "Neutral", volume: 0, delta: -0.5, gamma: 0, theta: 0, vega: 0, iv: 0 } },
    ];
    const report = makeReport({ strikes, walls: { calls: [], puts: [] } });
    const m = symbolMetrics(report);
    expect(m.strikeStep).toBe(50); // DEFAULT_STRIKE_STEP
    expect(m.wallMinOi).toBe(500_000); // floor when no walls
  });

  test("Backward-compatible helpers return same values as symbolMetrics", () => {
    const report = makeReport({ spot: 22_800 });
    const m = symbolMetrics(report);

    expect(maxPainTouchTol(report)).toBe(m.maxPainTouchTol);
    expect(pinEdgeHigh(report)).toBe(m.pinEdgeHigh);
    expect(pinEdgeMedium(report)).toBe(m.pinEdgeMedium);
    expect(pinPainPts(report)).toBe(m.pinPainPts);
    expect(wallMaxDist(report)).toBe(m.wallMaxDist);
    expect(wallMinOi(report)).toBe(m.wallMinOi);
    expect(levelMaxDist(report)).toBe(m.levelMaxDist);
    expect(heatmapWidthPts(report)).toBe(m.heatmapWidthPts);
    expect(atmWindowPts(report)).toBe(m.atmWindowPts);
    expect(flowNoiseFor(report)).toBe(m.effectiveFlowNoise);
    expect(squeezeRangePts(report)).toBe(m.squeezeRangePts);
    expect(squeezePriceBreakPts(report)).toBe(m.squeezePriceBreakPts);
    expect(squeezeAtWallPts(report)).toBe(m.squeezeAtWallPts);
  });

  test("TEST_FIXTURES constants match expected values", () => {
    expect(TEST_FIXTURES.sensex).toEqual({ spot: 79_000, strikeStep: 100, lotSize: 20 });
    expect(TEST_FIXTURES.reliance).toEqual({ spot: 1_400, strikeStep: 50, lotSize: 500 });
    expect(TEST_FIXTURES.nifty).toEqual({ spot: 22_800, strikeStep: 50, lotSize: 65 });
  });
});