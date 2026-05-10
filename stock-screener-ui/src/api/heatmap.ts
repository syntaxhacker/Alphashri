/**
 * Heatmap API Client - P/E Forward Heatmap for Indian Stocks
 */

import { fetchWithAuth } from "../state/auth";
import { API_BASE } from "./config";

export interface HeatmapStock {
  symbol: string;
  name: string;
  sector: string;
  market_cap: number;
  pe_ratio: number;
  price: number;
  change_pct: number;
}

export interface HeatmapResponse {
  stocks: HeatmapStock[];
  count: number;
  cached: boolean;
}

export interface SectorInfo {
  name: string;
  count: number;
  avg_pe: number;
}

export interface SectorsResponse {
  sectors: SectorInfo[];
}

const HEATMAP_API_BASE = `${API_BASE}/api/heatmap`;

export async function fetchHeatmapData(
  minPe?: number,
  maxPe?: number,
  sector?: string,
  limit: number = 500,
  signal?: AbortSignal,
): Promise<HeatmapResponse> {
  const params = new URLSearchParams();
  if (minPe !== undefined) params.set("min_pe", minPe.toString());
  if (maxPe !== undefined) params.set("max_pe", maxPe.toString());
  if (sector) params.set("sector", sector);
  params.set("limit", limit.toString());

  const response = await fetchWithAuth(`${HEATMAP_API_BASE}/pe?${params}`, { signal });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Failed to fetch heatmap data" }));
    throw new Error(error.detail || "Failed to fetch heatmap data");
  }
  return response.json();
}

export async function fetchHeatmapSectors(signal?: AbortSignal): Promise<SectorsResponse> {
  const response = await fetchWithAuth(`${HEATMAP_API_BASE}/sectors`, { signal });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Failed to fetch sectors" }));
    throw new Error(error.detail || "Failed to fetch sectors");
  }
  return response.json();
}

export async function refreshHeatmapCache(signal?: AbortSignal): Promise<{ status: string; count: number }> {
  const response = await fetchWithAuth(`${HEATMAP_API_BASE}/refresh`, { method: "POST", signal });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Failed to refresh cache" }));
    throw new Error(error.detail || "Failed to refresh cache");
  }
  return response.json();
}