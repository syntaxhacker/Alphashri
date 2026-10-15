/** Pattern-profitability API client (GET /api/reports/profitability). */

import { fetchWithAuth } from "../state/auth";
import type { ProfitabilityResponse } from "../types/profitability";
import { API_BASE } from "./config";

const PROFITABILITY_URL = `${API_BASE}/api/reports/profitability`;

export async function fetchProfitability(
  weeks: number = 4,
  universe: string = "nifty500",
  signal?: AbortSignal,
): Promise<ProfitabilityResponse> {
  const params = new URLSearchParams({
    weeks: String(weeks),
    universe,
  });
  const response = await fetchWithAuth(`${PROFITABILITY_URL}?${params.toString()}`, {
    signal,
  });
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const error = await response.json();
      if (error?.detail) detail = String(error.detail);
    } catch {
      // keep status fallback
    }
    throw new Error(detail || "Failed to fetch pattern profitability");
  }
  return response.json();
}
