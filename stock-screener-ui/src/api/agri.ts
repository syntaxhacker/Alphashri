import { API_BASE } from "./config";
import { jsonOrThrow } from "./utils/request";
import type {
  AgriCommoditiesResponse,
  AgriFiltersResponse,
  AgriPricesParams,
  AgriPricesResponse,
} from "@/types/agri";

const AGRI_API_BASE = `${API_BASE}/api/agri`;

function setTextParam(params: URLSearchParams, key: string, value: string | null | undefined): void {
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  if (trimmed) params.set(key, trimmed);
}

export function buildAgriPricesUrl(params: AgriPricesParams | string = {}): string {
  const query: AgriPricesParams = typeof params === "string" ? { commodity: params } : params;
  const search = new URLSearchParams();

  setTextParam(search, "commodity", query.commodity);
  setTextParam(search, "group", query.group);
  setTextParam(search, "state", query.state);
  setTextParam(search, "district", query.district);
  setTextParam(search, "market", query.market);
  setTextParam(search, "range", query.range);
  setTextParam(search, "from", query.from);
  setTextParam(search, "to", query.to);

  if (typeof query.compare === "string") {
    setTextParam(search, "compare", query.compare);
  } else if (query.compare) {
    const keys = query.compare
      .map((key) => String(key).trim())
      .filter((key) => key.length > 0);
    if (keys.length > 0) search.set("compare", keys.join(","));
  }

  if (typeof query.limit === "number" && Number.isFinite(query.limit) && query.limit > 0) {
    search.set("limit", String(Math.trunc(query.limit)));
  }

  const qs = search.toString();
  return `${AGRI_API_BASE}/prices${qs ? `?${qs}` : ""}`;
}

export async function fetchAgriFilters(signal?: AbortSignal): Promise<AgriFiltersResponse> {
  const response = await fetch(`${AGRI_API_BASE}/filters`, { signal });
  return jsonOrThrow<AgriFiltersResponse>(response, "Failed to fetch agri filters");
}

export async function fetchAgriPrices(
  params: AgriPricesParams | string = {},
  signal?: AbortSignal,
): Promise<AgriPricesResponse> {
  const response = await fetch(buildAgriPricesUrl(params), { signal });
  return jsonOrThrow<AgriPricesResponse>(response, "Failed to fetch agri prices");
}

/** Legacy commodities endpoint, kept for callers not yet on `/filters`. */
export async function fetchAgriCommodities(signal?: AbortSignal): Promise<AgriCommoditiesResponse> {
  const response = await fetch(`${AGRI_API_BASE}/commodities`, { signal });
  return jsonOrThrow<AgriCommoditiesResponse>(response, "Failed to fetch agri commodities");
}
