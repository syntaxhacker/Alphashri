/**
 * Sector API Client
 */

import { fetchWithAuth } from "../state/auth";
import type {
  SectorClassify,
  SectorGroupsPayload,
  SectorPeriod,
  SectorResponse,
} from "../types/sector";

import { API_BASE } from "./config";

const SECTOR_API_BASE = `${API_BASE}/api/sector`;

export async function fetchSectorPerformance(
  market: string = "india",
  signal?: AbortSignal,
): Promise<SectorResponse> {
  const response = await fetchWithAuth(`${SECTOR_API_BASE}?market=${market}`, { signal });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Failed to fetch sector performance");
  }
  return response.json();
}

export interface FetchSectorGroupsParams {
  classify?: SectorClassify;
  period?: SectorPeriod;
  market?: string;
  limit?: number;
  signal?: AbortSignal;
}

export async function fetchSectorGroups({
  classify = "sector",
  period = "1D",
  market = "india",
  limit = 800,
  signal,
}: FetchSectorGroupsParams = {}): Promise<SectorGroupsPayload> {
  const params = new URLSearchParams({
    classify,
    period,
    market,
    limit: String(limit),
  });
  const response = await fetchWithAuth(`${API_BASE}/api/sector/groups?${params.toString()}`, {
    signal,
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Failed to fetch group performance");
  }
  return response.json();
}
