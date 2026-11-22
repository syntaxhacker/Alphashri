import { fetchWithAuth } from "../state/auth";
import { jsonOrThrow } from "./utils/request";
import type { ScreenerDashboardResponse } from "../types/screenerDashboard";

import { API_BASE } from "./config";

const DASHBOARD_API_BASE = `${API_BASE}/api/screener/dashboard`;

/** Default rows per panel requested from the backend. */
export const DASHBOARD_DEFAULT_LIMIT = 8;
/** Maximum rows per panel the backend accepts. */
export const DASHBOARD_MAX_LIMIT = 30;
/** Default minimum market-cap filter (₹ crore). */
export const DASHBOARD_DEFAULT_MIN_MCAP_CR = 500;

/** Client cache window. Shorter than the backend's 60 s snapshot TTL so a hit
 * never outlives the server snapshot it mirrors. */
export const DASHBOARD_CLIENT_CACHE_TTL_MS = 30_000;

interface DashboardCacheEntry {
  at: number;
  payload: ScreenerDashboardResponse;
}

const snapshotCache = new Map<string, DashboardCacheEntry>();

/** Parity with the backend's (universe, limit, min_market_cap_cr) cache scope.
 * The dashboard is India-only upstream, so the market is a fixed part of the
 * endpoint rather than a colliding dimension here. */
function dashboardCacheKey(universe: string, limit: number, minMarketCapCr: number): string {
  return `${universe}|limit=${limit}|mincap=${minMarketCapCr}`;
}

/** Explicit invalidation for upstream changes and tests. */
export function clearDashboardClientCache(): void {
  snapshotCache.clear();
}

export interface ScreenerDashboardFetchOptions {
  /** Rows per panel (default 8, max 30). */
  limit?: number;
  /** Minimum market cap in ₹ crore (default 500). */
  minMarketCapCr?: number;
  /** Bypass a cached snapshot when the backend supports it. */
  refresh?: boolean;
}

export async function fetchScreenerDashboard(
  universe: string = "nifty500",
  signal?: AbortSignal,
  options?: ScreenerDashboardFetchOptions,
): Promise<ScreenerDashboardResponse> {
  const limit = options?.limit ?? DASHBOARD_DEFAULT_LIMIT;
  const minMarketCapCr = options?.minMarketCapCr ?? DASHBOARD_DEFAULT_MIN_MCAP_CR;
  const refresh = options?.refresh === true;
  const key = dashboardCacheKey(universe, limit, minMarketCapCr);

  if (!refresh) {
    const hit = snapshotCache.get(key);
    if (hit && Date.now() - hit.at < DASHBOARD_CLIENT_CACHE_TTL_MS) {
      return hit.payload;
    }
  }

  const params = new URLSearchParams({ universe });
  if (options?.limit != null) {
    params.set("limit", String(options.limit));
  }
  if (options?.minMarketCapCr != null) {
    params.set("min_market_cap_cr", String(options.minMarketCapCr));
  }
  if (refresh) {
    params.set("refresh", "1");
  }
  const response = await fetchWithAuth(`${DASHBOARD_API_BASE}?${params.toString()}`, {
    signal,
  });
  const payload = await jsonOrThrow<ScreenerDashboardResponse>(
    response,
    "Failed to fetch screener dashboard",
  );
  snapshotCache.set(key, { at: Date.now(), payload });
  return payload;
}
