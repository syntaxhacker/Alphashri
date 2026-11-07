import { API_BASE } from "./config";
import { jsonOrThrow } from "./utils/request";
import type { AgriCommoditiesResponse, AgriPricesResponse } from "@/types/agri";

const AGRI_API_BASE = `${API_BASE}/api/agri`;

export async function fetchAgriCommodities(signal?: AbortSignal): Promise<AgriCommoditiesResponse> {
  const response = await fetch(`${AGRI_API_BASE}/commodities`, { signal });
  return jsonOrThrow<AgriCommoditiesResponse>(response, "Failed to fetch agri commodities");
}

export async function fetchAgriPrices(
  commodity?: string,
  signal?: AbortSignal,
): Promise<AgriPricesResponse> {
  const params = new URLSearchParams();
  if (commodity) params.set("commodity", commodity);

  const url = `${AGRI_API_BASE}/prices?${params}`;
  const response = await fetch(url, { signal });
  return jsonOrThrow<AgriPricesResponse>(response, "Failed to fetch agri prices");
}
