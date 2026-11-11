/**
 * Index Movers API client.
 * GET /api/reports/movers?index=NIFTY|SENSEX&limit=3|all
 */

import { fetchWithAuth } from "../state/auth";
import { API_BASE } from "./config";

export interface IndexMoverRow {
  symbol: string;
  ltp: number;
  change_pct: number;
  contribution_pct?: number;
  volume: number;
}

export interface IndexMoversResponse {
  index: "NIFTY" | "SENSEX";
  as_of: string;
  stale: boolean;
  source: string;
  gainers: IndexMoverRow[];
  losers: IndexMoverRow[];
  live_only?: boolean;
}

export interface IndexMoversError {
  code: "movers_unavailable";
  message: string;
}

export async function fetchIndexMovers(
  index: "NIFTY" | "SENSEX",
  limit: number | "all" = 3,
  signal?: AbortSignal,
): Promise<IndexMoversResponse> {
  const limitParam = limit === "all" ? "all" : String(limit);
  const url = `${API_BASE}/api/reports/movers?index=${index}&limit=${limitParam}`;
  const response = await fetchWithAuth(url, { signal });

  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as
      | { detail?: IndexMoversError | string }
      | null;
    const detail = error?.detail;
    if (detail && typeof detail === "object" && detail.code === "movers_unavailable") {
      throw new Error("MOVERS_UNAVAILABLE");
    }
    throw new Error(
      typeof detail === "string"
        ? detail
        : `Failed to fetch ${index} movers: ${response.status}`,
    );
  }

  return (await response.json()) as IndexMoversResponse;
}

export async function fetchIndexMoversAll(
  index: "NIFTY" | "SENSEX",
  signal?: AbortSignal,
): Promise<IndexMoversResponse> {
  return fetchIndexMovers(index, "all", signal);
}