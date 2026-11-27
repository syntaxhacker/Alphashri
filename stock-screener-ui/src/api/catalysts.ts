/**
 * `GET /api/catalysts/today` — the Home Monitor's single catalyst feed.
 *
 * Transport + normalization only: no polling, no caching, no advice text. The
 * payload names the market it was built for (the contract pins `india`), so the
 * URL carries it explicitly rather than leaning on a backend default.
 */

import { fetchWithAuth } from "../state/auth";
import { apiErrorFromResponse } from "./apiError";
import { API_BASE } from "./config";

export type CatalystScore = "high" | "medium" | "low";
export type CatalystState = "scheduled" | "breaking" | "confirmed" | "fading";
export type CatalystKind = "news" | "event" | "positioning";

export interface CatalystIndexQuote {
  last: number | null;
  change_pct: number | null;
}

export interface CatalystMarket {
  nifty: CatalystIndexQuote | null;
  sensex: CatalystIndexQuote | null;
  vix: number | null;
}

export interface CatalystBreadth {
  advancing: number | null;
  declining: number | null;
  total: number | null;
}

export interface CatalystSector {
  id: string | null;
  label: string | null;
  change_pct: number | null;
  relative_strength_pct: number | null;
  breadth: CatalystBreadth | null;
}

export interface CatalystSectorOption {
  id: string;
  label: string;
  count: number | null;
}

export interface CatalystRow {
  symbol: string;
  name: string | null;
  sector: string | null;
  kind: CatalystKind;
  /** Null only for a positioning row; news/event rows must carry a headline. */
  headline: string | null;
  source: string | null;
  source_url: string | null;
  /** When this build first saw the item — not the article date. */
  first_seen: string | null;
  event_at: string | null;
  state: CatalystState;
  score: CatalystScore;
  confidence: number | null;
  move_pct: number | null;
  rel_volume: number | null;
  reasons: string[];
  invalidates: string[];
}

/** A count is `null` when the backend omitted it — never a zero-filled guess. */
export interface CatalystCounts {
  high: number | null;
  medium: number | null;
  low: number | null;
  total: number | null;
}

export interface CatalystToday {
  as_of: string | null;
  market: CatalystMarket | null;
  sector: CatalystSector | null;
  available_sectors: CatalystSectorOption[];
  /** Explicitly empty when no source produced a row. */
  rows: CatalystRow[];
  counts: CatalystCounts | null;
  /** Names of sources that failed; the payload is still usable. */
  warnings: string[];
}

export const CATALYST_MARKET = "india";
export const CATALYST_DEFAULT_SECTOR = "all";

function catalystsTodayUrl(sector: string): string {
  const params = new URLSearchParams({
    market: CATALYST_MARKET,
    sector: sector || CATALYST_DEFAULT_SECTOR,
  });
  return `${API_BASE}/api/catalysts/today?${params.toString()}`;
}

const SCORES = ["high", "medium", "low"] as const satisfies readonly CatalystScore[];
const STATES = [
  "scheduled",
  "breaking",
  "confirmed",
  "fading",
] as const satisfies readonly CatalystState[];
const KINDS = [
  "news",
  "event",
  "positioning",
] as const satisfies readonly CatalystKind[];

type Raw = Record<string, unknown>;

function asObject(value: unknown): Raw | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Raw)
    : null;
}

/** Non-finite / absent number → `null` so the UI renders a dash, not a 0. */
function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function textList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is string => typeof entry === "string" && entry.trim() !== "",
  );
}

function requiredText(value: unknown, path: string): string {
  const valueText = text(value);
  if (valueText === null) {
    throw new Error(`Catalysts payload is malformed: ${path} is missing`);
  }
  return valueText;
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): T {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new Error(
    `Catalysts payload is malformed: ${path} must be one of ${allowed.join(", ")}`,
  );
}

function normalizeQuote(raw: unknown): CatalystIndexQuote | null {
  const quote = asObject(raw);
  if (!quote) return null;
  return {
    last: num(quote.last),
    change_pct: num(quote.change_pct ?? quote.changePct),
  };
}

function normalizeMarket(raw: unknown): CatalystMarket | null {
  const market = asObject(raw);
  if (!market) return null;
  return {
    nifty: normalizeQuote(market.nifty),
    sensex: normalizeQuote(market.sensex),
    vix: num(market.vix),
  };
}

function normalizeSector(raw: unknown): CatalystSector | null {
  const sector = asObject(raw);
  if (!sector) return null;
  const breadth = asObject(sector.breadth);
  return {
    id: text(sector.id),
    label: text(sector.label),
    change_pct: num(sector.change_pct ?? sector.changePct),
    relative_strength_pct: num(
      sector.relative_strength_pct ?? sector.relativeStrengthPct,
    ),
    breadth: breadth
      ? {
          advancing: num(breadth.advancing),
          declining: num(breadth.declining),
          total: num(breadth.total),
        }
      : null,
  };
}

function normalizeSectorOptions(raw: unknown): CatalystSectorOption[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const option = asObject(entry);
    const id = text(option?.id);
    const label = text(option?.label);
    return id && label ? [{ id, label, count: num(option?.count) }] : [];
  });
}

function normalizeCounts(raw: unknown): CatalystCounts | null {
  const counts = asObject(raw);
  if (!counts) return null;
  return {
    high: num(counts.high),
    medium: num(counts.medium),
    low: num(counts.low),
    total: num(counts.total),
  };
}

/**
 * A row without a symbol or headline cannot be rendered or linked, and a
 * fabricated replacement would be worse than none — so the payload is rejected
 * instead of silently shrinking the radar.
 */
function normalizeRow(raw: unknown, index: number): CatalystRow {
  const row = asObject(raw);
  const path = `rows[${index}]`;
  if (!row) throw new Error(`Catalysts payload is malformed: ${path} must be an object`);
  const kind = oneOf(row.kind, KINDS, `${path}.kind`);
  const headline = text(row.headline);
  if (kind !== "positioning" && headline === null) {
    throw new Error(`Catalysts payload is malformed: ${path}.headline is missing`);
  }
  return {
    symbol: requiredText(row.symbol, `${path}.symbol`),
    headline,
    name: text(row.name),
    sector: text(row.sector),
    kind,
    source: text(row.source),
    source_url: text(row.source_url ?? row.sourceUrl),
    first_seen: text(row.first_seen ?? row.firstSeen),
    event_at: text(row.event_at ?? row.eventAt),
    state: oneOf(row.state, STATES, `${path}.state`),
    score: oneOf(row.score, SCORES, `${path}.score`),
    confidence: num(row.confidence),
    move_pct: num(row.move_pct ?? row.movePct),
    rel_volume: num(row.rel_volume ?? row.relVolume),
    reasons: textList(row.reasons),
    invalidates: textList(row.invalidates),
  };
}

export function normalizeCatalystToday(raw: unknown): CatalystToday {
  const payload = asObject(raw);
  if (!payload) {
    throw new Error("Catalysts payload is malformed: expected an object");
  }
  if (!Array.isArray(payload.rows)) {
    throw new Error("Catalysts payload is malformed: rows must be an array");
  }
  return {
    as_of: text(payload.as_of ?? payload.asOf),
    market: normalizeMarket(payload.market),
    sector: normalizeSector(payload.sector),
    available_sectors: normalizeSectorOptions(
      payload.available_sectors ?? payload.availableSectors,
    ),
    rows: payload.rows.map(normalizeRow),
    counts: normalizeCounts(payload.counts),
    warnings: textList(payload.warnings),
  };
}

/**
 * One day's catalyst rows for the Home Monitor.
 *
 * Throws on a non-2xx response and on a payload that cannot be rendered: an
 * empty radar and a dead feed must not look the same to the caller.
 */
export async function fetchCatalystsToday(
  signal?: AbortSignal,
  sector: string = CATALYST_DEFAULT_SECTOR,
): Promise<CatalystToday> {
  const response = await fetchWithAuth(catalystsTodayUrl(sector), { signal });
  if (!response.ok) {
    throw await apiErrorFromResponse(response, "Failed to load today's catalysts");
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Catalysts response was not valid JSON");
  }
  return normalizeCatalystToday(payload);
}
