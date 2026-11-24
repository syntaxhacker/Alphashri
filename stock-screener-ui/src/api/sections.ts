import { fetchWithAuth } from "../state/auth";
import { API_BASE } from "./config";
import { jsonOrThrow } from "./utils/request";
import type { SectionDefinition } from "../state/sections/types";
import type { SectionScanRow } from "../components/market/SectionTable";

export type SectionScanMarket = "india" | "america";

export interface SectionScanResult {
  market: SectionScanMarket;
  generated_at: string;
  row_count: number;
  delayed_rows: number;
  note: string | null;
  rows: SectionScanRow[];
}

/**
 * One scan request per refresh. Definitions travel as a JSON query param so
 * the cache key sees the definitions, not a filter combination.
 */
export async function fetchSectionScan(
  market: SectionScanMarket,
  sections: SectionDefinition[],
  allowDelayed = false,
): Promise<SectionScanResult> {
  const params = new URLSearchParams({
    market,
    sections: JSON.stringify(sections),
    allow_delayed: allowDelayed ? "true" : "false",
  });
  const response = await fetchWithAuth(`${API_BASE}/api/sections/scan?${params.toString()}`);
  return jsonOrThrow<SectionScanResult>(response, "Failed to fetch sections");
}
