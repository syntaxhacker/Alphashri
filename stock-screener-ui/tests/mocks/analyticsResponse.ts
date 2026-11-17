/**
 * Wire-shape stand-in for `GET /api/options/analytics/{symbol}`.
 *
 * Captured from the live endpoint on 2026-11-16. The envelope is camelCase
 * (`marketState` / `quotesLive` / `sessionDate`), per-expiry metrics use
 * `rr25` / `fly25`, and the rich level objects are snake_case (`call_wall`,
 * `put_wall`, `max_pain`, `gex.fuel_up` / `gex.fuel_down`). Those names are a
 * contract: the normalizer's camelCase level branch is only a legacy fallback
 * for old cached payloads, not the shape the backend actually sends.
 *
 * Only fields the UI consumes are kept — the live `gex.flip` / `regime` /
 * `gamma_coverage`, the `*_walls` arrays and per-level `oi` / `payout` /
 * `net_gex` are deliberately absent.
 */

export const ANALYTICS_EXPIRIES = ["2026-11-26", "2026-12-31", "2027-01-28"] as const;
export const ANALYTICS_STRIKES = [1360, 1380, 1400, 1420, 1440, 1460, 1480] as const;

/** Stable three-expiry frame: IV wings, metrics, levels, term, surface and RND. */
export function analyticsBody() {
  const levels = {
    thin: false,
    call_wall: { strike: 1450, side: "above", strength: 0.82 },
    put_wall: { strike: 1400, side: "below", strength: 0.74 },
    max_pain: { strike: 1420, side: "at", strength: 0.55 },
    gex: {
      support: { strike: 1395, side: "below", strength: 0.51 },
      resistance: { strike: 1445, side: "above", strength: 0.63 },
      fuel_up: { strike: 1470, side: "above", strength: 0.42 },
      fuel_down: { strike: 1370, side: "below", strength: 0.33 },
    },
  };

  const expiries = ANALYTICS_EXPIRIES.map((date, index) => {
    const dte = 10 + index * 35;
    const atmIv = 22.4 - index * 0.9;
    const iv = ANALYTICS_STRIKES.map((strike, strikeIndex) => {
      const off = Math.abs(strike - 1420);
      const wing = atmIv + off * 0.004;
      return {
        strike,
        // A leg with no greek stays null on the wire — never a fabricated 0.
        ceIv: index === 0 && strikeIndex === 0 ? null : Number((wing + 0.15).toFixed(2)),
        peIv: Number((wing - 0.15).toFixed(2)),
        ceDelta: Number(Math.max(0.05, 0.9 - strikeIndex * 0.12).toFixed(2)),
        peDelta: Number((-Math.max(0.05, 0.9 - strikeIndex * 0.12)).toFixed(2)),
        ceOi: 20_000 + strikeIndex * 3_000,
        peOi: 18_000 + strikeIndex * 2_000,
      };
    });
    return {
      date,
      dteDays: dte,
      spot: 1417.4,
      atmIv,
      metrics: {
        rr25: Number((0.8 + index * 0.1).toFixed(2)),
        fly25: Number((0.6 + index * 0.1).toFixed(2)),
        slope: Number((-0.02 - index * 0.01).toFixed(3)),
        r2: Number((0.94 - index * 0.02).toFixed(2)),
        n: iv.length * 2,
      },
      iv,
      levels: index === 0 ? levels : undefined,
    };
  });

  return {
    symbol: "RELIANCE",
    spot: 1417.4,
    asOf: "2026-11-16T11:20:00+05:30",
    marketState: "closed",
    quotesLive: false,
    sessionDate: "2026-11-16",
    warnings: [],
    expiries,
    term: ANALYTICS_EXPIRIES.map((_, index) => ({
      dte: 10 + index * 35,
      atmIv: Number((22.4 - index * 0.9).toFixed(2)),
      rr25: Number((0.8 + index * 0.1).toFixed(2)),
      bf25: Number((0.6 + index * 0.1).toFixed(2)),
    })),
    surface: {
      strikes: [...ANALYTICS_STRIKES],
      expiries: [...ANALYTICS_EXPIRIES],
      iv: ANALYTICS_EXPIRIES.map((_, expiryIndex) =>
        ANALYTICS_STRIKES.map((strike) =>
          Number((22.4 - expiryIndex * 0.9 + Math.abs(strike - 1420) * 0.004).toFixed(2)),
        ),
      ),
      missing: ANALYTICS_EXPIRIES.map(() => ANALYTICS_STRIKES.map(() => false)),
    },
    probability: {
      model: "rnd-svi",
      flat_pop: 0.61,
      skew_pop: 0.58,
      expected_pnl: -268,
      sigma: 39,
      density: ANALYTICS_STRIKES.map((strike, index) => ({
        spot: strike,
        prob: Number((0.04 + Math.exp(-Math.pow(index - 3, 2) / 4) * 0.09).toFixed(4)),
      })),
      quantiles: { p05: 1350, p25: 1390, p50: 1420, p75: 1450, p95: 1490 },
      cone: ANALYTICS_EXPIRIES.map((_, index) => ({
        dte: 10 + index * 35,
        p05: 1350 - index * 5,
        p25: 1390 - index * 2,
        p50: 1420,
        p75: 1450 + index * 2,
        p95: 1490 + index * 5,
      })),
    },
  };
}
