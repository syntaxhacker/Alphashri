/**
 * Network fixtures for the /home floating-window desk, shared with the
 * design-evidence route captures. They mirror the setup in home-desk.spec.ts
 * so the evidence renders the same real panels instead of an error shell.
 *
 * Registration order matters: Playwright gives later handlers priority, so the
 * broad sector handler stays ahead of the correlation/rotation ones.
 */
import type { Page, Route } from "@playwright/test";
import { apiRoute } from "./routeHelper";

export const HOME_CHAIN_EXPIRY = "2026-11-27";

const MARKET_SNAPSHOT = {
  as_of: new Date().toISOString(),
  universe: "all_equity",
  total: 3,
  update_mode: "streaming",
  rows: [
    { symbol: "RELIANCE", name: "Reliance Industries", sector: "Energy", close: 1412.5, change: 1.2, relative_volume: 1.8, market_cap_cr: 1900000, cap_tier: "large", rsi: 62, adx: 28, pos_52w: 0.82, fno: true, etf: false },
    { symbol: "TCS", name: "Tata Consultancy Services", sector: "IT", close: 3288.0, change: -0.4, relative_volume: 1.1, market_cap_cr: 1200000, cap_tier: "large", rsi: 45, adx: 22, pos_52w: 0.61, fno: true, etf: false },
    { symbol: "INFY", name: "Infosys", sector: "IT", close: 1534.0, change: 2.1, relative_volume: 2.4, market_cap_cr: 780000, cap_tier: "large", rsi: 71, adx: 31, pos_52w: 0.88, fno: true, etf: false },
  ],
};

const OPTION_CHAIN = {
  expiry: HOME_CHAIN_EXPIRY,
  spot: 24000.5,
  timestamp: new Date().toISOString(),
  spot_change_pct: 0.4,
  summary: { pcr: 0.95 },
  levels: null,
  chain: [
    {
      strike: 24000,
      ce: {
        instrument_key: "NSE_FO|NIFTY26NOV24000CE",
        market_data: { ltp: 80, oi: 10000, prev_oi: 8000, volume: 2000, bid_price: 78, ask_price: 82 },
        option_greeks: { iv: 17, delta: 0.5, gamma: 0.002, theta: -6, vega: 12 },
      },
      pe: {
        instrument_key: "NSE_FO|NIFTY26NOV24000PE",
        market_data: { ltp: 80, oi: 8000, prev_oi: 7500, volume: 1500, bid_price: 78, ask_price: 82 },
        option_greeks: { iv: 19, delta: -0.5, gamma: 0.002, theta: -5, vega: 11 },
      },
    },
  ],
};

const SECTOR_RESPONSE = {
  sectors: [
    { sector: "Technology", avg_change: 2.45, stock_count: 45, advances: 35, declines: 10, avg_rsi: 62.5, avg_adx: 28.3, top_movers: "TCS(+3.2%) INFY(+2.8%) WIPRO(+1.9%)" },
    { sector: "Finance", avg_change: 1.2, stock_count: 38, advances: 25, declines: 13, avg_rsi: 58.0, avg_adx: 22.1, top_movers: "HDFC(+2.1%) ICICI(+1.5%) SBI(+0.8%)" },
    { sector: "Energy", avg_change: -0.85, stock_count: 22, advances: 8, declines: 14, avg_rsi: 45.2, avg_adx: 18.5, top_movers: "RELIANCE(+0.5%) ONGC(-1.2%) BPCL(-2.0%)" },
  ],
  top_stock_movers: [
    { symbol: "TCS", change: 3.2, prev_change: 1.28 },
    { symbol: "INFY", change: 2.8, prev_change: 1.12 },
    { symbol: "HDFC", change: 2.1, prev_change: 0.84 },
    { symbol: "WIPRO", change: 1.9, prev_change: 0.76 },
    { symbol: "ICICI", change: 1.5, prev_change: 0.6 },
  ],
  last_updated: new Date().toISOString(),
  market: "india",
};

const json = (body: object) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify(body),
});

/** Seeded panels own their data paths; without these the desk logs fetch errors. */
export async function setupHomeNetworkMocks(page: Page): Promise<void> {
  // The options windows pick an expiry from the real listing rather than
  // typing a date, so the desk needs a listing to pick from.
  await page.route(apiRoute("reports/nifty/expiries"), (route) =>
    route.fulfill(json({ expiries: [{ date: HOME_CHAIN_EXPIRY }] })),
  );
  await page.route(apiRoute("options/expiries"), (route) =>
    route.fulfill(
      json({
        underlying: "NIFTY",
        expiries: [{ date: HOME_CHAIN_EXPIRY, weekly: true, days_to_expiry: 2 }],
      }),
    ),
  );
  await page.route(apiRoute("catalysts/today"), (route) =>
    route.fulfill(
      json({
        as_of: new Date().toISOString(),
        market: { nifty: null, sensex: null, vix: null },
        sector: {
          id: "auto",
          label: "NIFTY AUTO",
          change_pct: null,
          relative_strength_pct: null,
          breadth: { advancing: 0, declining: 0, total: 0 },
        },
        rows: [],
        counts: { high: 0, medium: 0, low: 0, total: 0 },
        warnings: [],
      }),
    ),
  );
  await page.route(apiRoute("market/snapshot"), (route) => route.fulfill(json(MARKET_SNAPSHOT)));
  await page.route(apiRoute("options/chain/NIFTY"), (route) => route.fulfill(json(OPTION_CHAIN)));
  // The positioning panel fetches on mount now that it defaults to an expiry;
  // without this the desk logs a 401 and a console guard fails.
  await page.route(apiRoute("options/positioning"), (route) =>
    route.fulfill(
      json({
        status: "ok",
        underlying: "NIFTY",
        expiry: HOME_CHAIN_EXPIRY,
        spot: 24000.5,
        lot_size: 50,
        timestamp: new Date().toISOString(),
        baseline: "since_open",
        baseline_note: "Since open",
        verdict: { label: "NEUTRAL", tone: "neutral", note: "" },
        initiated_cr: 0,
        lean_pct: 0,
        state: { calls_cr: 0, puts_cr: 0, note: "" },
        flow: { calls_cr: 0, puts_cr: 0, note: "" },
        initiated: { bearish_cr: 0, bullish_cr: 0, note: "" },
        split: { bearish_cr: 0, bearish_pct: 0, bullish_cr: 0, bullish_pct: 0 },
        read: { pct: 0, readable_shares: 0, total_shares: 0 },
        biggest_move: null,
        rows: [],
      }),
    ),
  );
  await page.route(apiRoute("sector"), async (route) => {
    // Preset panels hit /api/sector/* too; only the exact path is ours.
    if (new URL(route.request().url()).pathname !== "/api/sector") {
      await route.fallback();
      return;
    }
    await route.fulfill(json(SECTOR_RESPONSE));
  });

  // Preset tabs mount panels the seeded desk never touches. Registered after
  // the broad sector route so /api/sector/correlation wins.
  await page.route(apiRoute("rotation/overview"), (route) =>
    route.fulfill(
      json({
        market: "india",
        kind: "sector",
        period: "1M",
        benchmark: "NIFTY 50",
        last_updated: new Date().toISOString(),
        regime: {
          benchmark: "NIFTY 50",
          benchmark_change: 0.4,
          benchmark_1m: 1.1,
          vix: null,
          vix_change: null,
          breadth: 0.5,
          label: "Neutral",
        },
        counts: { booming: 0, heating: 0, cooling: 0, dumping: 0, neutral: 0 },
        rows: [],
      }),
    ),
  );
  // An n×n matrix makes ECharts init in a zero-size flex cell before layout
  // settles, so the empty state is the honest fixture here.
  await page.route(apiRoute("sector/correlation"), (route) =>
    route.fulfill(
      json({
        sectors: [],
        correlation_matrix: [],
        sector_names: [],
        last_updated: new Date().toISOString(),
      }),
    ),
  );
}

/**
 * The patterns window bootstraps its catalog and results from
 * `/api/chart-patterns` on mount. Without mocks it reaches whatever backend
 * the run happens to have, which is why it showed an empty state locally and
 * an error banner on a CI runner with an empty DB.
 */
export async function setupHomePatternMocks(page: Page): Promise<void> {
  const empty = (body: object) => (route: Route) => route.fulfill(json(body));
  await page.route(apiRoute("chart-patterns/timeframes"), empty({ timeframes: [{ id: "1d", label: "1D" }] }));
  await page.route(apiRoute("chart-patterns/universes"), empty({ universes: [{ id: "nifty50", label: "NIFTY 50" }], default: "nifty50" }));
  await page.route(apiRoute("chart-patterns/patterns"), empty({ families: [], patterns: [] }));
  await page.route(apiRoute("chart-patterns/results"), empty({ hits: [], total: 0, scanned: 0, as_of: null }));
  // `?active=1` defeats a bare-path route, so match the query explicitly.
  await page.route(/chart-patterns\/jobs(\?|$|\/)/, (route) =>
    route.request().url().includes("active=1")
      ? route.fulfill(json({ jobs: [] }))
      : route.fulfill(json({ job_id: "e2e-job", status: "completed", hits: 0 })),
  );
  // `maybeAutoScan()` fires as soon as an empty view mounts. A null/queued job
  // leaves the store polling forever and the panel stuck on "Scanning…".
  await page.route(apiRoute("chart-patterns/scan"), empty({ job_id: "e2e-job", status: "queued", queue_position: 1 }));
  await page.route(/chart-patterns\/scan\//, empty({ job_id: "e2e-job", status: "completed", hits: 0 }));
  await page.route(apiRoute("chart-patterns/health"), empty({ ok: true }));
  await page.route(apiRoute("chart-patterns/market-status"), empty({ open: false, session: null }));
}
