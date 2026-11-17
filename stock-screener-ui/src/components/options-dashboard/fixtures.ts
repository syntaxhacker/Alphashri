/**
 * Test fixtures for the dashboard panels.
 *
 * These build the *wire* payload the fixed dashboard client consumes
 * (`src/api/optionsDashboard.ts#normalizeDashboard`) so panel tests exercise the
 * real DTO → projection → chart path. The old fixtures handed panels pre-built
 * panel-local arrays directly, which hid the fact that a payload without the
 * engine's parallel arrays renders every enriched chart as a fail-soft reason.
 *
 * `fullFixture()` carries all raw engine arrays (GEX/DEX/vanna/charm/theta,
 * spread/VolOI, OI/ΔOI/volume/PCR/max-pain, RND density/CDF, RV term).
 * `withoutBlocks()` is the shipped analytics DTO: IV + RND density + RV scalars
 * but no per-strike blocks. `emptyFixture()` has no usable quotes anywhere.
 */

import { normalizeDashboard } from "@/api/optionsDashboard";
import type { OptionsDashboardData } from "@/types/optionsDashboard";

const STRIKES = [1380, 1400, 1420, 1440, 1460];
const DATES = ["2026-11-26", "2026-12-31"];

function ivRows() {
  return STRIKES.map((strike, i) => {
    const iv = 22 + Math.abs(strike - 1420) * 0.02;
    return {
      strike,
      ceIv: Number((iv + 0.15).toFixed(2)),
      peIv: Number((iv - 0.15).toFixed(2)),
      ceDelta: Number((0.9 - i * 0.18).toFixed(2)),
      peDelta: Number((-(0.9 - i * 0.18)).toFixed(2)),
      ceOi: 20_000 + i * 3_000,
      peOi: 18_000 + i * 2_000,
    };
  });
}

function density() {
  return STRIKES.map((strike, i) => ({
    spot: strike,
    prob: 0.04 + Math.exp(-Math.pow(i - 2, 2)) * 0.09,
  }));
}

interface WireOptions {
  /** Omit the enriched engine arrays to emulate the shipped analytics DTO. */
  blocks?: boolean;
  /** Omit the realised-vol term (an additive block of the fixed DTO). */
  rv?: boolean;
}

function wire(opts: WireOptions = {}): Record<string, unknown> {
  const blocks = opts.blocks !== false;
  const withRv = opts.rv !== false;
  const levels = {
    call_wall: { strike: 1460, side: "above", strength: 0.8 },
    put_wall: { strike: 1380, side: "below", strength: 0.7 },
    max_pain: { strike: 1420, side: "at", strength: 0.55 },
    gex: {
      support: { strike: 1400, side: "below", strength: 0.5 },
      resistance: { strike: 1440, side: "above", strength: 0.6 },
    },
  };

  const expiries = DATES.map((date, index) => {
    const raw: Record<string, unknown> = {
      date,
      dteDays: 9 + index * 25,
      spot: 1420,
      atmIv: 22.4 - index * 0.9,
      metrics: { rr25: 0.8, fly25: 0.6, slope: -0.02, r2: 0.94, n: STRIKES.length * 2 },
      iv: ivRows(),
      levels: index === 0 ? levels : undefined,
      rnd: {
        model: "rnd-svi",
        mean: 1420,
        stdDev: 39,
        skew: -0.2,
        kurtosis: 0.4,
        expectedMove: 24,
        strikes: STRIKES,
        density: density(),
        cdf: [0.02, 0.1, 0.5, 0.9, 0.98],
        forward: 1421,
      },
    };
    if (blocks) {
      raw.positioning = {
        netDealerDelta: 1_200,
        netClientDelta: -900,
        callWriterOi: 34_000,
        putWriterOi: 26_000,
        pcr: 1.05,
        pcrVolume: 0.98,
        initiativeRatio: 0.6,
        topStrikes: STRIKES.map((strike) => ({ strike, netDelta: 400, oiChange: 1_200 })),
        strikes: STRIKES,
        ceOi: [22_000, 25_000, 28_000, 31_000, 34_000],
        peOi: [18_000, 20_000, 22_000, 24_000, 26_000],
        ceOiChange: [1_200, -800, 1_500, -400, 900],
        peOiChange: [-1_000, 700, -1_100, 600, -500],
        ceVolume: [4_000, 3_700, 3_400, 3_100, 2_800],
        peVolume: [3_500, 3_300, 3_100, 2_900, 2_700],
        pcrByStrike: [0.8, 0.9, 1.0, 1.1, 1.2],
        pcrVolumeByStrike: [0.9, 0.95, 1.0, 1.05, 1.1],
        maxPainCurve: STRIKES.map((strike, i) => ({ strike, payout: 1_000 - i * 100 })),
        maxPain: 1420,
        walls: { callWall: { strike: 1460 }, putWall: { strike: 1380 } },
        totals: { ceOi: 140_000, peOi: 110_000, ceVolume: 16_000, peVolume: 15_000 },
      };
      raw.dealer = {
        netGex: 2_400,
        netDex: 900,
        vanna: 40,
        charm: -25,
        theta: -12,
        gammaFlip: { level: 1420, regime: "positive", flipped: false },
        regime: "positive",
        support: 1400,
        resistance: 1440,
        fuelUp: null,
        fuelDown: null,
        degraded: false,
        zeroGamma: 1420,
        strikes: STRIKES.map((strike, i) => ({
          strike,
          netGex: i < 2 ? -1_200 : 1_500 + i * 100,
          netDex: i < 2 ? -800 : 900,
          vanna: 40,
          charm: -25,
          theta: -12 - i * 2,
          ceOi: 20_000 + i * 3_000,
          peOi: 18_000 + i * 2_000,
          ceIv: 22,
          peIv: 22,
        })),
        thetaByDte: DATES.map((_, i) => ({ dteDays: 9 + i * 25, theta: -12 - i * 2 })),
      };
      raw.liquidity = {
        totalOi: 100_000,
        totalVolume: 30_000,
        avgSpreadPct: 0.3,
        medianSpreadPct: 0.25,
        liquidStrikes: 8,
        maxOiStrike: 1460,
        thin: false,
        strikes: STRIKES,
        // The front expiry's first strike has no two-sided quote -> a null cell.
        ceSpreadPct: index === 0 ? [null, 0.15, 0.2, 0.25, 0.3] : [0.28, 0.32, 0.35, 0.4, 0.45],
        peSpreadPct: index === 0 ? [null, 0.15, 0.2, 0.25, 0.3] : [0.28, 0.32, 0.35, 0.4, 0.45],
        ceSpreadAbs: [0.5, 0.6, 0.7, 0.8, 0.9],
        peSpreadAbs: [0.5, 0.6, 0.7, 0.8, 0.9],
        ceVolOi: [0.36, 0.44, 0.52, 0.6, 0.68],
        peVolOi: [0.4, 0.48, 0.56, 0.64, 0.76],
      };
    } else {
      raw.positioning = {};
      raw.dealer = {};
      raw.liquidity = {};
    }
    return raw;
  });

  return {
    symbol: "AAPL",
    spot: 1420,
    asOf: "2026-11-17T11:20:00+05:30",
    marketState: "open",
    quotesLive: true,
    sessionDate: "2026-11-17",
    warnings: [],
    expiries,
    term: DATES.map((_, index) => ({
      dte: 9 + index * 25,
      atmIv: 22.4 - index * 0.9,
      rr25: 0.8,
      bf25: 0.6,
    })),
    surface: {
      strikes: STRIKES,
      expiries: DATES,
      iv: DATES.map(() => STRIKES.map((strike) => 22 + Math.abs(strike - 1420) * 0.02)),
      missing: DATES.map(() => STRIKES.map(() => false)),
    },
    probability: {
      model: "rnd-svi",
      flatPop: 0.61,
      skewPop: 0.58,
      expectedPnl: -268,
      sigma: 39,
      density: [],
      quantiles: { p05: 1360, p25: 1400, p50: 1420, p75: 1440, p95: 1480 },
      cone: DATES.map((_, index) => ({
        dte: 9 + index * 25,
        p05: 1360 - index * 5,
        p25: 1400,
        p50: 1420,
        p75: 1440 + index * 5,
        p95: 1480 + index * 10,
      })),
    },
    ...(withRv
      ? { rv: { current: 18.2, rv5: 17.4, rv10: 17.8, rv20: 18.1, rv30: 18.4, source: "daily" } }
      : {}),
  };
}

/** Fully populated payload: real per-strike arrays across all four pillars. */
export function fullFixture(): OptionsDashboardData {
  return normalizeDashboard(wire());
}

/** Shipped analytics DTO: IV + RND density + RV scalars, no per-strike blocks. */
export function withoutBlocks(): OptionsDashboardData {
  return normalizeDashboard(wire({ blocks: false, rv: false }));
}

/** A payload with no usable quotes in any block. */
export function emptyFixture(): OptionsDashboardData {
  return normalizeDashboard({
    symbol: "AAPL",
    spot: null,
    expiries: [],
    term: [],
    surface: { strikes: [], expiries: [], iv: [], missing: [] },
    probability: { density: [], quantiles: {}, cone: [] },
    levels: {},
    warnings: [],
  });
}
