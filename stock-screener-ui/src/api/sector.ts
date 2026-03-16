/**
 * Sector API Client
 */

import { fetchWithAuth } from "../state/auth";
import type { SectorResponse } from "../types/sector";

import { API_BASE } from "./config";

const SECTOR_API_BASE = `${API_BASE}/api/sector`;

export async function fetchSectorPerformance(market: string = "india"): Promise<SectorResponse> {
  const response = await fetchWithAuth(`${SECTOR_API_BASE}?market=${market}`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Failed to fetch sector performance");
  }
  return response.json();
}
