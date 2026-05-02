/**
 * Sector Correlation API Client
 */

import { fetchWithAuth } from "../state/auth";
import { API_ENDPOINTS } from "./config";
import type { SectorCorrelationResponse } from "../types/sector";

export type { SectorCorrelationSector, SectorCorrelationResponse } from "../types/sector";

export async function fetchSectorCorrelation(params: {
  market: "india" | "america";
  lookback_days: number;
}): Promise<SectorCorrelationResponse> {
  const url = `${API_ENDPOINTS.SECTOR}/correlation?market=${params.market}&lookback_days=${params.lookback_days}`;
  const response = await fetchWithAuth(url);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || "Failed to fetch sector correlation data");
  }
  return response.json();
}
