import { fetchWithAuth } from "../state/auth";
import { jsonOrThrow } from "./utils/request";
import { API_ENDPOINTS } from "./config";
import type { SectorHistoryMarket, SectorHistoryResponse } from "../types/sectorHistory";

export interface FetchSectorHistoryParams {
  market: SectorHistoryMarket;
  years: number;
  signal?: AbortSignal;
}

export async function fetchSectorHistory({
  market,
  years,
  signal,
}: FetchSectorHistoryParams): Promise<SectorHistoryResponse> {
  const params = new URLSearchParams({
    market,
    years: String(years),
  });
  const response = await fetchWithAuth(`${API_ENDPOINTS.SECTOR}/history?${params.toString()}`, {
    signal,
  });
  return jsonOrThrow<SectorHistoryResponse>(response, "Failed to fetch sector history");
}
