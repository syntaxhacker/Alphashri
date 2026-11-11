/**
 * F&O options screener API contract.
 * GET /api/options/screener (backend implemented in parallel).
 */

import { fetchWithAuth } from "../state/auth";
import { API_BASE } from "@/api/config";

const FNO_SCREENER_API = `${API_BASE}/api/options/screener`;

export type FnoScreenerPreset =
  | "cheap_momentum"
  | "max_torque"
  | "balanced"
  | "high_pop"
  | "breakout";

export interface FnoScreenerExpiry {
  date: string;
  days_to_expiry: number;
}

export interface FnoScreenerRow {
  symbol: string;
  spot: number;
  d1: number;
  d5: number;
  vol_ratio: number;
  above20: number;
  setup: "BREAKOUT" | "NEAR HIGH" | "EXTENDED" | "BASE" | "WEAK" | "WATCH";
  call: string;
  strike: number;
  otm_pct: number;
  premium: number;
  cost_lot: number;
  breakeven: number;
  pop: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  iv: number;
  oi: number;
  volume: number;
  spread_pct: number;
  move_2pct_est: number;
}

export interface FnoScreenerResponse {
  status: "ok";
  as_of: string;
  expiry: string;
  expiries: FnoScreenerExpiry[];
  preset: string;
  scanned: number;
  matched: number;
  stale: boolean;
  warnings: string[];
  errors: string[];
  rows: FnoScreenerRow[];
}

export interface FnoScreenerParams {
  expiry?: string;
  preset?: FnoScreenerPreset;
  limit?: number;
  max_cost?: number;
  min_pop?: number;
  min_volume?: number;
  otm_min?: number;
  otm_max?: number;
  refresh?: boolean;
}

export const FNO_PRESETS: Record<FnoScreenerPreset, { label: string; description: string }> = {
  cheap_momentum: { label: "Cheap Momentum", description: "Low-premium setups riding intraday momentum" },
  max_torque: { label: "Max Torque", description: "High gamma/delta leverage for quick scalps" },
  balanced: { label: "Balanced", description: "POP, premium and IV efficiency in one score" },
  high_pop: { label: "High POP", description: "Highest probability-of-profit calls" },
  breakout: { label: "Breakout", description: "Setups triggering on breakout candles" },
};

export const FNO_DEFAULT_LIMIT = 50;

function setNumberParam(params: URLSearchParams, key: string, value: number | undefined): void {
  if (value === undefined || value === null || Number.isNaN(value)) return;
  params.set(key, String(value));
}

/** Build the screener URL from params, omitting empty values (testable seam). */
export function buildFnoScreenerUrl(params: FnoScreenerParams = {}): string {
  const searchParams = new URLSearchParams();
  if (params.expiry) searchParams.set("expiry", params.expiry);
  if (params.preset) searchParams.set("preset", params.preset);
  setNumberParam(searchParams, "limit", params.limit);
  setNumberParam(searchParams, "max_cost", params.max_cost);
  setNumberParam(searchParams, "min_pop", params.min_pop);
  setNumberParam(searchParams, "min_volume", params.min_volume);
  setNumberParam(searchParams, "otm_min", params.otm_min);
  setNumberParam(searchParams, "otm_max", params.otm_max);
  if (params.refresh === true) searchParams.set("refresh", "true");
  return `${FNO_SCREENER_API}?${searchParams.toString()}`;
}

export async function fetchFnoScreener(
  params: FnoScreenerParams = {},
  init?: RequestInit,
): Promise<FnoScreenerResponse> {
  const response = await fetchWithAuth(buildFnoScreenerUrl(params), init);
  if (!response.ok) {
    const err = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(err?.detail || `F&O screener failed (HTTP ${response.status})`);
  }
  return (await response.json()) as FnoScreenerResponse;
}
