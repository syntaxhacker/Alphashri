import { fetchWithAuth } from "../state/auth";
import { API_BASE } from "@/api/config";
import { finiteNumber, finiteText } from "./wireParse";
import type { PatternDirection, PatternQuality, PatternStatus } from "@/types/chartPatterns";

const LOOKUP_API = `${API_BASE}/api/chart-patterns/patterns/lookup`;

/** Hard cap enforced by the endpoint; a request above it is a 422. */
export const PATTERN_LOOKUP_MAX_SYMBOLS = 500;

/** One stored hit, as the lookup endpoint echoes it. */
export interface PatternLookupPattern {
  pattern_id: string;
  name: string;
  direction: PatternDirection | string;
  status: PatternStatus | string;
  quality: PatternQuality | string;
  confidence: number | null;
  bars_ago: number | null;
}

/** Every stored pattern for one symbol. Symbols without a hit are omitted entirely. */
export interface PatternLookupItem {
  symbol: string;
  patterns: PatternLookupPattern[];
  count: number;
}

export interface PatternLookupResponse {
  timeframe: string;
  /** IST session the read was scoped to (`null` on an older backend). */
  session: string | null;
  /** Always `"stored"` — this endpoint cannot detect. */
  source: string;
  /** Last bar date the stored scan covers. */
  data_through: string | null;
  items: PatternLookupItem[];
}

export interface PatternLookupRequest {
  symbols: string[];
  timeframe?: string;
  /** Matrix universe scope; unscoped reads span every stored scan. */
  universe?: string | null;
}

function mapPattern(raw: unknown): PatternLookupPattern | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const patternId = finiteText(r.pattern_id);
  if (patternId === null) return null;
  return {
    pattern_id: patternId,
    name: finiteText(r.name) ?? patternId,
    direction: finiteText(r.direction) ?? "neutral",
    status: finiteText(r.status) ?? "forming",
    quality: finiteText(r.quality) ?? "fair",
    confidence: finiteNumber(r.confidence),
    bars_ago: finiteNumber(r.bars_ago),
  };
}

function mapItem(raw: unknown): PatternLookupItem | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const symbol = finiteText(r.symbol)?.trim().toUpperCase();
  if (symbol === undefined || symbol === "") return null;
  const patterns = Array.isArray(r.patterns)
    ? r.patterns.map(mapPattern).filter((p): p is PatternLookupPattern => p !== null)
    : [];
  // The badge and its tooltip must agree, so the array is the count's source of
  // truth — a server-side `count` that disagrees is dropped, not rendered.
  return { symbol, patterns, count: patterns.length };
}

/** Transport boundary: an unexpected shape degrades to "no stored patterns". */
export function mapPatternLookup(raw: unknown): PatternLookupResponse {
  const r = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const items = Array.isArray(r.items)
    ? r.items.map(mapItem).filter((item): item is PatternLookupItem => item !== null)
    : [];
  return {
    timeframe: finiteText(r.timeframe) ?? "1D",
    session: finiteText(r.session),
    source: finiteText(r.source) ?? "stored",
    data_through: finiteText(r.data_through),
    items,
  };
}

export async function lookupPatterns(
  body: PatternLookupRequest,
  init?: RequestInit,
): Promise<PatternLookupResponse> {
  const response = await fetchWithAuth(LOOKUP_API, {
    ...init,
    method: "POST",
    body: JSON.stringify({
      symbols: body.symbols.slice(0, PATTERN_LOOKUP_MAX_SYMBOLS),
      timeframe: body.timeframe ?? "1D",
      universe: body.universe ?? null,
    }),
  });
  if (!response.ok) {
    const err = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(err?.detail || `Pattern lookup failed (HTTP ${response.status})`);
  }
  return mapPatternLookup(await response.json());
}
