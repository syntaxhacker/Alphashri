/**
 * Additive network fixtures for the `/screener/screener` evidence capture.
 *
 * The shared `setupApiMocks` covers `/api/screener(s)` and `/api/sector`, but
 * the Screener tab also calls `/api/sector/groups` (the lazy
 * GroupPerformancePanel) and `/api/user-configs/table.screener.trending.*`
 * (per-table sort/order prefs). Without those two and a snapshot mock the route
 * logs "Failed to fetch" and renders an error shell instead of the real table.
 *
 * The snapshot rows are copied from `market-screener.spec.ts` so the payload is
 * the shape the app actually consumes. Registration order matters: Playwright
 * gives later handlers priority, so the specific `/api/sector/groups` handler
 * is registered after `setupSectorMocks`' broad `/api/sector` handler.
 */
import type { Page } from "@playwright/test";
import { setupSectorMocks, setupUserConfigMocks } from "./apiResponses";
import { apiRoute } from "./routeHelper";

export const SCREENER_EVIDENCE_PATH = "/screener/screener";

/** `SectorGroupsPayload` — mirrors `GroupPerformancePanel.test.tsx`'s fixture shape. */
export const SCREENER_EVIDENCE_GROUPS = {
  classify: "sector",
  period: "1D",
  market: "india",
  last_updated: new Date().toISOString(),
  groups: [
    { name: "IT", change: 2.45, stock_count: 20, advances: 14, declines: 6 },
    { name: "Banks", change: 1.2, stock_count: 18, advances: 12, declines: 6 },
    { name: "Energy", change: -0.85, stock_count: 12, advances: 5, declines: 7 },
    { name: "Pharma", change: 0.64, stock_count: 9, advances: 6, declines: 3 },
    { name: "Auto", change: -1.35, stock_count: 11, advances: 3, declines: 8 },
    { name: "FMCG", change: 0.28, stock_count: 8, advances: 5, declines: 3 },
  ],
};

// Copied from tests/e2e/market-screener.spec.ts (MOCK_ROWS).
const MARKET_SNAPSHOT_ROWS = [
  { symbol: "RELIANCE", name: "Reliance Industries", sector: "Energy", exchange: "NSE", close: 1412.5, change: 1.2, relative_volume: 1.8, market_cap_cr: 1900000, cap_tier: "large", rsi: 62, adx: 28, pos_52w: 0.82, fno: true, etf: false },
  { symbol: "TCS", name: "Tata Consultancy Services", sector: "IT", exchange: "NSE", close: 3288.0, change: -0.4, relative_volume: 1.1, market_cap_cr: 1200000, cap_tier: "large", rsi: 45, adx: 22, pos_52w: 0.61, fno: true, etf: false },
  { symbol: "HDFCBANK", name: "HDFC Bank", sector: "Banks", exchange: "NSE", close: 1712.3, change: 0.6, relative_volume: 0.9, market_cap_cr: 1300000, cap_tier: "large", rsi: 55, adx: 25, pos_52w: 0.74, fno: false, etf: false },
  { symbol: "PERSISTENT", name: "Persistent Systems", sector: "IT", exchange: "NSE", close: 5120.0, change: 2.1, relative_volume: 2.4, market_cap_cr: 78000, cap_tier: "mid", rsi: 71, adx: 31, pos_52w: 0.88, fno: true, etf: false },
  { symbol: "COFORGE", name: "Coforge", sector: "IT", exchange: "NSE", close: 6890.5, change: -1.3, relative_volume: 1.5, market_cap_cr: 41000, cap_tier: "mid", rsi: 38, adx: 19, pos_52w: 0.42, fno: false, etf: false },
  { symbol: "KPITTECH", name: "KPIT Technologies", sector: "IT", exchange: "NSE", close: 1834.75, change: 0.9, relative_volume: 1.3, market_cap_cr: 32000, cap_tier: "small", rsi: 52, adx: 24, pos_52w: 0.66, fno: false, etf: false },
  { symbol: "NIFTYBEES", name: "Nippon India ETF Nifty BeES", sector: "ETF", exchange: "NSE", close: 264.1, change: 0.5, relative_volume: 0.7, market_cap_cr: null, cap_tier: "etf", rsi: 48, adx: 18, pos_52w: 0.57, fno: false, etf: true },
  { symbol: "MICROCO", name: "Micro Co", sector: "Services", exchange: "NSE", close: 87.6, change: -2.2, relative_volume: 3.1, market_cap_cr: 900, cap_tier: "micro", rsi: 22, adx: 33, pos_52w: 0.18, fno: false, etf: false },
  { symbol: "LIQUIDBEES", name: "Nippon India ETF Liquid BeES", sector: "ETF", exchange: "NSE", close: 1130.2, change: 0.01, relative_volume: 0.3, market_cap_cr: null, cap_tier: "etf", rsi: 50, adx: 12, pos_52w: 0.51, fno: false, etf: true },
];

const MARKET_SNAPSHOT = {
  as_of: new Date().toISOString(),
  universe: "all_equity",
  total: MARKET_SNAPSHOT_ROWS.length,
  update_mode: "streaming",
  rows: MARKET_SNAPSHOT_ROWS,
};

const json = (body: object) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify(body),
});

/** Call after `setupApiMocks` + `loginAsTestUser`, before `page.goto()`. */
export async function setupScreenerEvidenceMocks(page: Page): Promise<void> {
  await setupSectorMocks(page);
  await setupUserConfigMocks(page);
  await page.route(apiRoute("sector/groups"), (route) =>
    route.fulfill(json(SCREENER_EVIDENCE_GROUPS)),
  );
  await page.route(apiRoute("market/snapshot"), (route) => route.fulfill(json(MARKET_SNAPSHOT)));
}
