/**
 * Screener dashboard API client (StockEdge-style market overview).
 */

import { fetchWithAuth } from "../state/auth";
import type { ScreenerDashboardResponse } from "../types/screenerDashboard";

import { API_BASE } from "./config";

const DASHBOARD_API_BASE = `${API_BASE}/api/screener/dashboard`;

/** Default rows per panel requested from the backend. */
export const DASHBOARD_DEFAULT_LIMIT = 8;
/** Maximum rows per panel the backend accepts. */
export const DASHBOARD_MAX_LIMIT = 30;
/** Default minimum market-cap filter (₹ crore). */
export const DASHBOARD_DEFAULT_MIN_MCAP_CR = 500;

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
  const params = new URLSearchParams({ universe });
  if (options?.limit != null) {
    params.set("limit", String(options.limit));
  }
  if (options?.minMarketCapCr != null) {
    params.set("min_market_cap_cr", String(options.minMarketCapCr));
  }
  if (options?.refresh) {
    params.set("refresh", "1");
  }
  const response = await fetchWithAuth(`${DASHBOARD_API_BASE}?${params.toString()}`, {
    signal,
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Failed to fetch screener dashboard");
  }
  return response.json();
}
