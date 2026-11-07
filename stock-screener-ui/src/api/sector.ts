/**
 * Sector API Client
 */

import { fetchWithAuth } from "../state/auth";
import { jsonOrThrow } from "./utils/request";
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
  force = false,
): Promise<SectorResponse> {
  const params = new URLSearchParams({ market });
  if (force) params.set("force", "true");
  const response = await fetchWithAuth(`${SECTOR_API_BASE}?${params.toString()}`, { signal });
  return jsonOrThrow<SectorResponse>(response, "Failed to fetch sector performance");
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
  return jsonOrThrow<SectorGroupsPayload>(response, "Failed to fetch group performance");
}
