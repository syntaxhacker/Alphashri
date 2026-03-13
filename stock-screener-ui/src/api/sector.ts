/**
 * Sector API Client
 */

import { fetchWithAuth } from "../state/auth";
import type { SectorResponse } from "../types/sector";

const API_BASE = "http://localhost:8765/api/sector";

export async function fetchSectorPerformance(market: string = "india"): Promise<SectorResponse> {
  const response = await fetchWithAuth(`${API_BASE}?market=${market}`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Failed to fetch sector performance");
  }
  return response.json();
}
