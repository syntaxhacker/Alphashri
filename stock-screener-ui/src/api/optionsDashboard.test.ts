// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../state/auth", async () => (await import("./apiTestMocks")).fetchWithAuthModuleMock());

import { ANALYTICS_MAX_EXPIRIES } from "../config/optionsAnalytics";
import { fetchWithAuth } from "../state/auth";
import { errorResponse, okResponse } from "./apiTestMocks";
import { fetchDashboard, normalizeDashboard, OptionDockError } from "./optionsDashboard";

const mockedFetch = vi.mocked(fetchWithAuth);

function wire(): Record<string, unknown> {
  return {
    symbol: "nifty",
    asOf: "2026-11-16T15:00:00+05:30",
    spot: 25215.7,
    quotesLive: true,
    marketState: "closed",
    sessionDate: "2026-11-16",
    rv: { current: 11.2, rv_5: 9.1, rv10: 10.4, rv20: 12.3, rv30: 13.5, source: "daily" },
    warnings: ["quotes_not_live", { code: "custom", message: "Thin book" }],
    expiries: [
      {
        date: "2026-11-19",
        dteDays: 3,
        atmIv: 12.4,
        metrics: { rr25: 0.8, fly25: 0.5, slope: -0.04, r2: 0.93, n: 24 },
        iv: [
          { strike: 25200, ceIv: 12.4, peIv: 12.4, ceDelta: 0.5, peDelta: -0.5, ceOi: 400, peOi: 420 },
          { strike: 25400, ceIv: 12.1, peIv: null, ceDelta: 0.24, peDelta: null, ceOi: 1200, peOi: null },
        ],
        levels: {
          call_wall: { strike: 25500, side: "above", strength: 0.42 },
          put_wall: { strike: 25000, side: "below", strength: 0.38 },
          max_pain: { strike: 25200, side: null, strength: 0.7 },
          gex: { support: { strike: 25000 }, resistance: { strike: 25500 }, fuel_up: null },
        },
        // New blocks arrive snake_case on the wire.
        positioning: {
          net_dealer_delta: 120,
          net_client_delta: -80,
          pcr_oi: 1.12,
          top_strikes: [{ strike: 25200, net_delta: 45, oi_change: 900 }],
        },
        dealer: { net_gex: 340, gamma_flip: 25100, regime: "positive", fuel_up: 25600, degraded: false },
        liquidity: { total_oi: 50000, total_volume: 12000, avg_spread_pct: 0.4, liquid_strikes: 18, thin: false },
        rnd: {
          model: "skew-normal",
          mean: 25240,
          std_dev: 320,
          expected_move: 1.4,
          density: [{ spot: 25200, prob: 0.12 }],
          quantiles: { p05: 24700, p50: 25240, p95: 25800 },
        },
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("fetchDashboard", () => {
  it("uppercases the symbol and requests the expiry ladder exactly once", async () => {
    mockedFetch.mockResolvedValue(okResponse(wire()));

    const data = await fetchDashboard("nifty");

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(mockedFetch.mock.calls[0][0]).toContain(
      `/api/options/analytics/NIFTY?expiries=${ANALYTICS_MAX_EXPIRIES}`,
    );
    expect(data?.symbol).toBe("NIFTY");
  });

  it("forwards the abort signal and resolves null when it is already aborted", async () => {
    mockedFetch.mockResolvedValue(okResponse(wire()));
    const controller = new AbortController();

    await fetchDashboard("NIFTY", controller.signal);
    expect(mockedFetch.mock.calls[0][1]).toMatchObject({ signal: expect.anything() });

    mockedFetch.mockClear();
    controller.abort();
    expect(await fetchDashboard("NIFTY", controller.signal)).toBeNull();
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("surfaces a non-retryable HTTP failure as a typed OptionDockError", async () => {
    mockedFetch.mockResolvedValue(errorResponse(400, { detail: "Bad symbol" }));

    await expect(fetchDashboard("NOPE")).rejects.toMatchObject({
      name: "OptionDockError",
      kind: "upstream",
      message: "Bad symbol",
    });
  });

  it("retries a 503 once and returns the successful payload", async () => {
    vi.useFakeTimers();
    mockedFetch
      .mockResolvedValueOnce(errorResponse(503, { detail: "busy" }))
      .mockResolvedValueOnce(okResponse(wire()));

    const pending = fetchDashboard("NIFTY");
    await vi.advanceTimersByTimeAsync(300);
    const data = await pending;

    expect(mockedFetch).toHaveBeenCalledTimes(2);
    expect(data?.symbol).toBe("NIFTY");
  });

  it("returns null for an empty symbol without fetching", async () => {
    expect(await fetchDashboard("  ")).toBeNull();
    expect(mockedFetch).not.toHaveBeenCalled();
  });
});

describe("normalizeDashboard", () => {
  const data = normalizeDashboard(wire());

  it("reads the camelCase envelope and maps bare warning codes to messages", () => {
    expect(data).toMatchObject({
      symbol: "NIFTY",
      spot: 25215.7,
      asOf: "2026-11-16T15:00:00+05:30",
      quotesLive: true,
      marketState: "closed",
      sessionDate: "2026-11-16",
    });
    expect(data.warnings[0]).toMatchObject({ code: "quotes_not_live" });
    expect(data.warnings[0].message.length).toBeGreaterThan(0);
    expect(data.warnings[1]).toMatchObject({ code: "custom", message: "Thin book" });
  });

  it("maps the realised-volatility term from both spellings", () => {
    expect(data.rv).toMatchObject({
      current: 11.2,
      rv5: 9.1,
      rv10: 10.4,
      rv20: 12.3,
      rv30: 13.5,
      source: "daily",
    });
    expect(data.realisedVol).toEqual([
      { dte: 5, value: 9.1 },
      { dte: 10, value: 10.4 },
      { dte: 20, value: 12.3 },
      { dte: 30, value: 13.5 },
    ]);
    expect(data.rv.cone.tenors).toEqual([]);
  });

  it("reads volatility metrics, expands CE/PE rows and keeps missing legs null", () => {
    const expiry = data.expiries[0];
    expect(expiry).toMatchObject({ date: "2026-11-19", dte: 3, atmIv: 12.4, rr25: 0.8, bf25: 0.5, fitR2: 0.93, n: 24 });
    expect(expiry.points).toHaveLength(4);
    const missingLeg = expiry.points.find((p) => p.strike === 25400 && p.delta === null);
    expect(missingLeg).toMatchObject({ iv: null, oi: null });
    expect(expiry.levels.callWall).toBe(25500);
    expect(expiry.levels.gex.fuelUp).toBeNull();
  });

  it("normalizes the new per-expiry blocks from snake_case", () => {
    const expiry = data.expiries[0];
    expect(expiry.positioning).toMatchObject({
      netDealerDelta: 120,
      netClientDelta: -80,
      pcrOi: 1.12,
    });
    expect(expiry.positioning.topStrikes[0]).toMatchObject({ strike: 25200, netDelta: 45, oiChange: 900 });
    expect(expiry.dealer).toMatchObject({ netGex: 340, gammaFlip: 25100, regime: "positive", fuelUp: 25600, degraded: false });
    expect(expiry.liquidity).toMatchObject({ totalOi: 50000, totalVolume: 12000, avgSpreadPct: 0.4, liquidStrikes: 18, thin: false });
    expect(expiry.rnd).toMatchObject({ model: "skew-normal", stdDev: 320, expectedMove: 1.4 });
    expect(expiry.rnd.density).toHaveLength(1);
    expect(expiry.rnd.quantiles.p05).toBe(24700);
  });

  it("never invents numbers for absent blocks", () => {
    const bare = normalizeDashboard({ symbol: "X" });
    expect(bare.expiries).toEqual([]);
    expect(bare.rv.current).toBeNull();
    expect(bare.probability.quantiles.p50).toBeNull();
    expect(bare.surface.iv).toEqual([]);
  });

  it("exposes OptionDockError for callers", () => {
    expect(new OptionDockError("network", "x").kind).toBe("network");
  });
});

/** A payload carrying the full per-strike arrays from all four engines. */
function profileWire(spell: "camel" | "snake" = "camel"): Record<string, unknown> {
  const k = (camel: string, snake: string) => (spell === "camel" ? camel : snake);
  const strikes = [100, 101, 102];
  const expiry = {
    date: "2026-11-19",
    positioning: {
      [k("netDealerDelta", "net_dealer_delta")]: 120,
      [k("topStrikes", "top_strikes")]: [
        { strike: 100, [k("netDelta", "net_delta")]: 45, [k("oiChange", "oi_change")]: 900 },
      ],
      strikes,
      [k("ceOi", "ce_oi")]: [10, null, 30],
      [k("peOi", "pe_oi")]: [5, 20, null],
      [k("ceOiChange", "ce_oi_change")]: [1, null, 3],
      [k("peOiChange", "pe_oi_change")]: [-1, 2, null],
      [k("ceVolume", "ce_volume")]: [100, null, 300],
      [k("peVolume", "pe_volume")]: [50, 200, null],
      [k("pcrByStrike", "pcr_by_strike")]: [0.5, null, null],
      [k("pcrVolumeByStrike", "pcr_volume_by_strike")]: [0.5, null, null],
      [k("maxPainCurve", "max_pain_curve")]: strikes.map((strike, i) => ({ strike, payout: i * 10 })),
      [k("maxPain", "max_pain")]: 101,
      walls: { callWall: { strike: 102 }, putWall: { strike: 100 } },
      totals: {
        [k("ceOi", "ce_oi")]: 40,
        [k("peOi", "pe_oi")]: 25,
        [k("ceVolume", "ce_volume")]: 400,
        [k("peVolume", "pe_volume")]: 250,
      },
      warnings: ["missing_quotes"],
    },
    dealer: {
      [k("netGex", "net_gex")]: 5,
      [k("netDex", "net_dex")]: -2,
      [k("zeroGamma", "zero_gamma")]: 101,
      [k("gammaFlip", "gamma_flip")]: { level: 101, regime: "short", flipped: true },
      vanna: 1,
      charm: -1,
      theta: -3,
      strikes: strikes.map((strike, i) => ({
        strike,
        [k("netGex", "net_gex")]: i === 1 ? null : i,
        [k("netDex", "net_dex")]: -(i + 1),
        vanna: i,
        charm: -(i + 1),
        theta: -(i + 1),
        [k("ceOi", "ce_oi")]: 10,
        [k("peOi", "pe_oi")]: 5,
        [k("ceIv", "ce_iv")]: 0.2,
        [k("peIv", "pe_iv")]: 0.22,
      })),
      [k("thetaByDte", "theta_by_dte")]: [
        { [k("dteDays", "dte_days")]: 1, theta: -3 },
        { [k("dteDays", "dte_days")]: 7, theta: -1 },
      ],
      warnings: ["partial_chain"],
    },
    liquidity: {
      strikes,
      [k("ceSpreadPct", "ce_spread_pct")]: [0.1, null, 0.3],
      [k("peSpreadPct", "pe_spread_pct")]: [0.2, 0.25, null],
      [k("ceSpreadAbs", "ce_spread_abs")]: [1, null, 3],
      [k("peSpreadAbs", "pe_spread_abs")]: [2, 2.5, null],
      [k("ceVolOi", "ce_vol_oi")]: [0.5, null, 0.9],
      [k("peVolOi", "pe_vol_oi")]: [0.4, 0.6, null],
      [k("medianSpreadPct", "median_spread_pct")]: 0.2,
      [k("illiquidCount", "illiquid_count")]: 2,
      warnings: ["illiquid"],
    },
    rnd: {
      model: "rnd",
      strikes,
      density: [0.1, null, 0.3],
      cdf: [0.1, 0.5, 0.9],
      mean: 101,
      forward: 101.2,
    },
  };
  return {
    symbol: "AAPL",
    spot: 101,
    quotesLive: true,
    expiries: [expiry],
    rv: { current: 18, rv5: 17, rv10: 18, rv20: 19, rv30: 20, source: "daily" },
  };
}

describe("normalizeDashboard — per-strike profiles", () => {
  for (const spell of ["camel", "snake"] as const) {
    it(`preserves every raw array (length, values and nulls) — ${spell}`, () => {
      const expiry = normalizeDashboard(profileWire(spell)).expiries[0];

      expect(expiry.positioning.strikes).toEqual([100, 101, 102]);
      expect(expiry.positioning.ceOi).toEqual([10, null, 30]);
      expect(expiry.positioning.peOi).toEqual([5, 20, null]);
      expect(expiry.positioning.ceOiChange).toEqual([1, null, 3]);
      expect(expiry.positioning.peOiChange).toEqual([-1, 2, null]);
      expect(expiry.positioning.ceVolume).toEqual([100, null, 300]);
      expect(expiry.positioning.peVolume).toEqual([50, 200, null]);
      expect(expiry.positioning.pcrByStrike).toEqual([0.5, null, null]);
      expect(expiry.positioning.pcrVolumeByStrike).toEqual([0.5, null, null]);
      expect(expiry.positioning.maxPainCurve).toEqual([
        { strike: 100, payout: 0 },
        { strike: 101, payout: 10 },
        { strike: 102, payout: 20 },
      ]);
      expect(expiry.positioning.warnings).toEqual(["missing_quotes"]);

      expect(expiry.dealer.strikes.map((row) => row.netGex)).toEqual([0, null, 2]);
      expect(expiry.dealer.strikes.map((row) => row.netDex)).toEqual([-1, -2, -3]);
      expect(expiry.dealer.strikes.map((row) => row.vanna)).toEqual([0, 1, 2]);
      expect(expiry.dealer.strikes.map((row) => row.charm)).toEqual([-1, -2, -3]);
      expect(expiry.dealer.strikes.map((row) => row.theta)).toEqual([-1, -2, -3]);
      expect(expiry.dealer.strikes.map((row) => row.ceOi)).toEqual([10, 10, 10]);
      expect(expiry.dealer.strikes.map((row) => row.peIv)).toEqual([0.22, 0.22, 0.22]);
      expect(expiry.dealer.thetaByDte).toEqual([
        { dteDays: 1, theta: -3 },
        { dteDays: 7, theta: -1 },
      ]);

      expect(expiry.liquidity.strikes).toEqual([100, 101, 102]);
      expect(expiry.liquidity.ceSpreadPct).toEqual([0.1, null, 0.3]);
      expect(expiry.liquidity.peSpreadPct).toEqual([0.2, 0.25, null]);
      expect(expiry.liquidity.ceSpreadAbs).toEqual([1, null, 3]);
      expect(expiry.liquidity.peSpreadAbs).toEqual([2, 2.5, null]);
      expect(expiry.liquidity.ceVolOi).toEqual([0.5, null, 0.9]);
      expect(expiry.liquidity.peVolOi).toEqual([0.4, 0.6, null]);
      expect(expiry.liquidity.medianSpreadPct).toBe(0.2);
      expect(expiry.liquidity.illiquidCount).toBe(2);

      expect(expiry.rnd.strikes).toEqual([100, 101, 102]);
      expect(expiry.rnd.density).toEqual([
        { spot: 100, prob: 0.1 },
        { spot: 101, prob: null },
        { spot: 102, prob: 0.3 },
      ]);
      expect(expiry.rnd.cdf).toEqual([0.1, 0.5, 0.9]);
      expect(expiry.rnd.forward).toBe(101.2);
    });
  }

  it("projects chart-ready arrays onto the top-level blocks the panels read", () => {
    const data = normalizeDashboard(profileWire("camel"));

    expect(data.positioning.deltaOi).toEqual([
      { strike: 100, ce: 1, pe: -1 },
      { strike: 101, ce: null, pe: 2 },
      { strike: 102, ce: 3, pe: null },
    ]);
    expect(data.positioning.volume).toEqual([
      { strike: 100, ce: 100, pe: 50 },
      { strike: 101, ce: null, pe: 200 },
      { strike: 102, ce: 300, pe: null },
    ]);
    expect(data.dealer.gex).toEqual([
      { strike: 100, value: 0 },
      { strike: 101, value: null },
      { strike: 102, value: 2 },
    ]);
    expect(data.dealer.dex).toHaveLength(3);
    expect(data.dealer.vanna).toHaveLength(3);
    expect(data.dealer.charm).toHaveLength(3);
    expect(data.dealer.theta).toEqual([
      { dte: 1, value: -3 },
      { dte: 7, value: -1 },
    ]);
    expect(data.liquidity.volumeOi).toEqual([
      { strike: 100, value: 0.45 },
      { strike: 101, value: 0.6 },
      { strike: 102, value: 0.9 },
    ]);
    expect(data.liquidity.spread).toHaveLength(3);
    expect(data.liquidity.spread[0].expiry).toBe("2026-11-19");
    expect(data.liquidity.spread[0].spread).toBeCloseTo(0.15);
    expect(data.realisedVol).toEqual([
      { dte: 5, value: 17 },
      { dte: 10, value: 18 },
      { dte: 20, value: 19 },
      { dte: 30, value: 20 },
    ]);
  });

  it("reads gammaFlip as a number or a rich object", () => {
    const numeric = normalizeDashboard({
      symbol: "X",
      expiries: [{ date: "2026-01-01", dealer: { gammaFlip: 1420 } }],
    });
    expect(numeric.expiries[0].dealer.gammaFlip).toBe(1420);

    const rich = normalizeDashboard(profileWire("camel")).expiries[0].dealer;
    expect(rich.gammaFlip).toBe(101);
    expect(rich.gammaFlipRegime).toBe("short");
    expect(rich.gammaFlipFlipped).toBe(true);
  });

  it("never zero-fills arrays for absent blocks", () => {
    const data = normalizeDashboard({
      symbol: "X",
      expiries: [{ date: "2026-01-01" }],
    });
    const expiry = data.expiries[0];
    expect(expiry.positioning.ceOi).toEqual([]);
    expect(expiry.dealer.strikes).toEqual([]);
    expect(expiry.dealer.thetaByDte).toEqual([]);
    expect(expiry.liquidity.ceSpreadPct).toEqual([]);
    expect(expiry.rnd.density).toEqual([]);
    expect(expiry.rnd.cdf).toEqual([]);
    expect(data.positioning.deltaOi).toEqual([]);
    expect(data.dealer.gex).toEqual([]);
    expect(data.liquidity.spread).toEqual([]);
    expect(data.realisedVol).toEqual([]);
  });
});

/** The live RV block: `cone.tenors` + `ivVsRv.rows`, no rv5/rv30 scalars. */
function coneWire(withValues: boolean): Record<string, unknown> {
  const tenors = withValues
    ? [
        { days: 7, current: 17.2, p10: 12, p25: 14, p50: 16, p75: 19, p90: 22, rank_pct: 55 },
        { days: 30, current: 18.4, p10: 13, p25: 15, p50: 17, p75: 20, p90: 24, rank_pct: 68 },
        { days: 60, current: null, p10: null, p25: null, p50: null, p75: null, p90: null, rank_pct: null },
      ]
    : [
        { days: 7, current: null, p10: null, p25: null, p50: null, p75: null, p90: null, rank_pct: null },
      ];
  return {
    symbol: "AAPL",
    expiries: [],
    rv: {
      cone: {
        symbol: "AAPL",
        as_of: "2026-11-17",
        tenors,
        warnings: withValues ? [] : ["short_history_for_tenor_7"],
      },
      ivVsRv: {
        rows: withValues
          ? [{
              date: "2026-11-26", dte: 9, atm_iv: 22.4, tenor_days: 7,
              rv_p50: 16, iv_minus_rv: 6.4, iv_rank_in_cone: 90,
            }]
          : [],
        warnings: withValues ? [] : ["cone_no_rv"],
      },
    },
  };
}

describe("normalizeDashboard — RV cone", () => {
  it("projects rv.cone.tenors into realisedVol and preserves the raw RV block", () => {
    const data = normalizeDashboard(coneWire(true));

    expect(data.realisedVol).toEqual([
      { dte: 7, value: 17.2 },
      { dte: 30, value: 18.4 },
    ]);
    expect(data.rv.cone.tenors).toHaveLength(3);
    expect(data.rv.cone.tenors[0]).toMatchObject({
      days: 7, current: 17.2, p10: 12, p25: 14, p50: 16, p75: 19, p90: 22, rankPct: 55,
    });
    expect(data.rv.cone.asOf).toBe("2026-11-17");
    expect(data.rv.ivVsRv.rows[0]).toMatchObject({
      date: "2026-11-26", dte: 9, atmIv: 22.4, tenorDays: 7,
      rvP50: 16, ivMinusRv: 6.4, ivRankInCone: 90,
    });
  });

  it("leaves realisedVol empty when the cone is null/empty, with no 0-fill", () => {
    const data = normalizeDashboard(coneWire(false));

    expect(data.realisedVol).toEqual([]);
    expect(data.rv.cone.tenors[0].current).toBeNull();
    expect(data.rv.cone.tenors[0].p50).toBeNull();
    expect(data.rv.cone.warnings).toEqual(["short_history_for_tenor_7"]);
    expect(data.rv.ivVsRv.rows).toEqual([]);
  });
});
