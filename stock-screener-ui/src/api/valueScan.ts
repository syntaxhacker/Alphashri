import { fetchWithAuth } from "../state/auth";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8765";
const VALUE_SCAN_API = `${API_BASE}/api/value/scan`;

export type ValueMarket = "india" | "usa" | "global";

export type ValuePresetName =
  | "SERIOUS"
  | "DEEP"
  | "GARP_VALUE"
  | "YIELD"
  | "TURNAROUND"
  | "NO_GATE";

export interface ValueSubscores {
  value: number;
  quality: number;
  growth: number;
  health: number;
}

export interface ValuePeer {
  bucket: string;
  pe_median: number | null;
  roe_median: number | null;
  fcf_yield_median: number | null;
}

export interface ValueDerived {
  fcf_yield: number | null;
  earnings_yield: number | null;
  vs_200dma: number | null;
  off_52w_high: number | null;
  distorted_pe: boolean;
}

export interface ValueRow {
  symbol: string;
  name: string;
  exchange: string;
  currency: string;
  price: number;
  change: number;
  mcap_bn: number;
  rev_bn: number;
  pe: number | null;
  ps: number | null;
  pb: number | null;
  fcf_yield: number | null;
  div_yield: number | null;
  roe: number | null;
  gross_margin: number | null;
  op_margin: number | null;
  rev_yoy: number | null;
  eps_yoy: number | null;
  debt_to_equity: number | null;
  current_ratio: number | null;
  rsi: number | null;
  vs_200dma: number | null;
  off_52w_high: number | null;
  score: number;
  subscores: ValueSubscores;
  peer: ValuePeer;
  flags: string[];
  derived: ValueDerived;
}

export interface ValueSector {
  name: string;
  count: number;
  avg_score: number;
}

export interface ValueScanResponse {
  market: string;
  currency: string;
  as_of: string;
  scanned: number;
  matched: number;
  fields_complete: boolean;
  filters_applied: Record<string, unknown>;
  warnings: string[];
  rows: ValueRow[];
  sectors: ValueSector[];
}

export interface ValueFilters {
  market?: ValueMarket;
  preset?: ValuePresetName | string;
  limit?: number;
  max_pe?: number;
  min_pe?: number;
  max_ps?: number;
  max_pb?: number;
  min_roe?: number;
  min_fcf_yield?: number;
  min_rev_yoy?: number;
  min_eps_yoy?: number;
  min_div_yield?: number;
  max_de?: number;
  min_mcap_bn?: number;
  max_mcap_bn?: number;
  require_low_de?: boolean;
  exclude_negative_fcf?: boolean;
  exclude_negative_eps?: boolean;
  above_200dma?: boolean;
  sectors?: string[];
  min_price?: number;
  min_volume?: number;
  max_rsi?: number;
  exclude_loss_making?: boolean;
  sort?: string;
}

export const VALUE_PRESETS: Record<string, { label: string; description: string }> = {
  SERIOUS: { label: "Serious", description: "Quality compounders at a fair price" },
  DEEP: { label: "Deep", description: "Cheapest multiples, cigar-butt value" },
  GARP_VALUE: { label: "GARP Value", description: "Growth at a reasonable price" },
  YIELD: { label: "Yield", description: "Dividend + free-cash-flow yield" },
  TURNAROUND: { label: "Turnaround", description: "Improving profitability, still cheap" },
  NO_GATE: { label: "No gate", description: "No quality gates, pure ranking" },
};

export const VALUE_MARKETS: { value: ValueMarket; label: string }[] = [
  { value: "india", label: "INDIA" },
  { value: "usa", label: "USA" },
  { value: "global", label: "GLOBAL" },
];

function setNumberParam(params: URLSearchParams, key: string, value: number | undefined): void {
  if (value === undefined || value === null || Number.isNaN(value)) return;
  params.set(key, String(value));
}

export function buildValueScanUrl(filters: ValueFilters = {}): string {
  const params = new URLSearchParams();
  params.set("market", filters.market ?? "india");
  params.set("limit", String(filters.limit ?? 100));
  if (filters.preset) params.set("preset", filters.preset);
  setNumberParam(params, "max_pe", filters.max_pe);
  setNumberParam(params, "min_pe", filters.min_pe);
  setNumberParam(params, "max_ps", filters.max_ps);
  setNumberParam(params, "max_pb", filters.max_pb);
  setNumberParam(params, "min_roe", filters.min_roe);
  setNumberParam(params, "min_fcf_yield", filters.min_fcf_yield);
  setNumberParam(params, "min_rev_yoy", filters.min_rev_yoy);
  setNumberParam(params, "min_eps_yoy", filters.min_eps_yoy);
  setNumberParam(params, "min_div_yield", filters.min_div_yield);
  setNumberParam(params, "max_de", filters.max_de);
  setNumberParam(params, "min_mcap_bn", filters.min_mcap_bn);
  setNumberParam(params, "max_mcap_bn", filters.max_mcap_bn);
  setNumberParam(params, "min_price", filters.min_price);
  setNumberParam(params, "min_volume", filters.min_volume);
  setNumberParam(params, "max_rsi", filters.max_rsi);
  if (filters.require_low_de) params.set("require_low_de", "true");
  if (filters.exclude_negative_fcf) params.set("exclude_negative_fcf", "true");
  if (filters.exclude_negative_eps) params.set("exclude_negative_eps", "true");
  if (filters.above_200dma) params.set("above_200dma", "true");
  if (filters.exclude_loss_making) params.set("exclude_loss_making", "true");
  if (filters.sectors && filters.sectors.length > 0) params.set("sectors", filters.sectors.join(","));
  if (filters.sort) params.set("sort", filters.sort);
  return `${VALUE_SCAN_API}?${params.toString()}`;
}

export async function valueScan(
  filters: ValueFilters = {},
  init?: RequestInit,
): Promise<ValueScanResponse> {
  const response = await fetchWithAuth(buildValueScanUrl(filters), init);
  if (!response.ok) {
    const err = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(err?.detail || `Value scan failed (HTTP ${response.status})`);
  }
  return (await response.json()) as ValueScanResponse;
}
