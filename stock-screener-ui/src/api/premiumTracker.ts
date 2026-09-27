import { API_BASE } from "./config";

export type PremiumVerdict = "CHEAP" | "FAIR" | "EXPENSIVE" | "UNKNOWN";

export interface PremiumLeg {
  underlying: string;
  spot: number | null;
  atm_strike: number | null;
  ce_ltp: number | null;
  pe_ltp: number | null;
  straddle_price: number | null;
  straddle_pct: number | null;
  ce_iv_pct: number | null;
  pe_iv_pct: number | null;
  dte_days: number | null;
  hv20_ann_pct: number | null;
  hv20_daily_pct: number | null;
  avg_range20_pct: number | null;
  iv_hv_ratio: number | null;
  verdict: PremiumVerdict;
  error: string | null;
}

export interface PremiumTrackerResponse {
  legs: PremiumLeg[];
  as_of: string | null;
  cached: boolean;
}

const PREMIUM_API_BASE = `${API_BASE}/api/options`;

export async function fetchPremiumTracker(signal?: AbortSignal): Promise<PremiumTrackerResponse> {
  const response = await fetch(`${PREMIUM_API_BASE}/premium-tracker`, { signal });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Failed to fetch premium snapshot" }));
    throw new Error(error.detail || "Failed to fetch premium snapshot");
  }
  return response.json();
}
