/** Pattern-profitability API client (GET /api/reports/profitability). */

import type { ProfitabilityResponse } from "../types/profitability";
import { API_BASE } from "./config";
import { fetchReportJson } from "./report";

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
  return fetchReportJson<ProfitabilityResponse>(
    `${PROFITABILITY_URL}?${params.toString()}`,
    signal,
    "Failed to fetch pattern profitability",
  );
}
