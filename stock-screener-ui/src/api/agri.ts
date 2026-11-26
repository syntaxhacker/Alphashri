import { API_BASE } from "./config";
import { AGRI_SOURCE_LOCAL } from "@/config/agri";
import { jsonOrThrow } from "./utils/request";
import type {
  AgriCommoditiesResponse,
  AgriFiltersResponse,
  AgriPricesParams,
  AgriPricesResponse,
  AgriSourcesResponse,
} from "@/types/agri";

const AGRI_API_BASE = `${API_BASE}/api/agri`;

function setTextParam(params: URLSearchParams, key: string, value: string | null | undefined): void {
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  if (trimmed) params.set(key, trimmed);
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return typeof AbortSignal !== "undefined" && value instanceof AbortSignal;
}

/** The default origin is the absence of a source filter, in URLs and requests. */
function setSourceParam(params: URLSearchParams, value: string | null | undefined): void {
  if (typeof value === "string" && value.trim() === AGRI_SOURCE_LOCAL) return;
  setTextParam(params, "source", value);
}

export interface AgriFiltersParams {
  source?: string;
}

export function buildAgriFiltersUrl(params: AgriFiltersParams = {}): string {
  const search = new URLSearchParams();
  setSourceParam(search, params.source);
  const qs = search.toString();
  return `${AGRI_API_BASE}/filters${qs ? `?${qs}` : ""}`;
}

export function buildAgriPricesUrl(params: AgriPricesParams | string = {}): string {
  const query: AgriPricesParams = typeof params === "string" ? { commodity: params } : params;
  const search = new URLSearchParams();

  setTextParam(search, "commodity", query.commodity);
  setTextParam(search, "group", query.group);
  setTextParam(search, "state", query.state);
  setTextParam(search, "district", query.district);
  setTextParam(search, "market", query.market);
  setSourceParam(search, query.source);
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

export function fetchAgriFilters(signal?: AbortSignal, source?: string): Promise<AgriFiltersResponse>;
export function fetchAgriFilters(source?: string, signal?: AbortSignal): Promise<AgriFiltersResponse>;
/**
 * Both argument orders are accepted: older callers pass only a signal, source
 * selectors pass a signal plus the selected origin.
 */
export async function fetchAgriFilters(
  first?: AbortSignal | string,
  second?: string | AbortSignal,
): Promise<AgriFiltersResponse> {
  const signal = isAbortSignal(first) ? first : isAbortSignal(second) ? second : undefined;
  const source = typeof first === "string" ? first : typeof second === "string" ? second : undefined;
  const response = await fetch(buildAgriFiltersUrl({ source }), { signal });
  return jsonOrThrow<AgriFiltersResponse>(response, "Failed to fetch agri filters");
}

export async function fetchAgriSources(signal?: AbortSignal): Promise<AgriSourcesResponse> {
  const response = await fetch(`${AGRI_API_BASE}/sources`, { signal });
  return jsonOrThrow<AgriSourcesResponse>(response, "Failed to fetch agri sources");
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
