import { fetchWithAuth } from "../state/auth";
import { API_BASE } from "@/api/config";
import type { MarketRow, MarketSnapshot, MarketUniverse } from "../types/marketScreener";

const MARKET_API = `${API_BASE}/api/market`;

export const DEFAULT_MARKET_UNIVERSE: MarketUniverse = "all_equity";
export const MARKET_SNAPSHOT_LIMIT = 4000;

const MARKET_SNAPSHOT_CACHE_PREFIX = "alphashri.market_snapshot.v1.";
/** sessionStorage quota is ~5MB; stay well under it — an oversized entry is skipped, never truncated mid-row. */
const MARKET_SNAPSHOT_CACHE_MAX_BYTES = 3_000_000;
/** Rows are only needed to paint the first frame; the total/mode travel alongside. */
const MARKET_SNAPSHOT_CACHE_MAX_ROWS = MARKET_SNAPSHOT_LIMIT;

function marketSnapshotCacheKey(universe: MarketUniverse): string {
  return `${MARKET_SNAPSHOT_CACHE_PREFIX}${universe}`;
}

function safeSessionStorage(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

function isCachedRow(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const symbol = (value as { symbol?: unknown }).symbol;
  return typeof symbol === "string" && symbol.trim() !== "";
}

/**
 * Reads the last persisted snapshot for a universe (camelCase, as written by
 * writeCachedMarketSnapshot). Any malformed entry — wrong universe, bad
 * shape, oversized rows — is discarded and removed.
 */
export function readCachedMarketSnapshot(universe: MarketUniverse): MarketSnapshot | null {
  const storage = safeSessionStorage();
  if (!storage) return null;
  const key = marketSnapshotCacheKey(universe);
  let raw: string | null = null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<MarketSnapshot> & { rows?: unknown };
    if (parsed === null || typeof parsed !== "object") throw new Error("not an object");
    if (parsed.universe !== universe) throw new Error("universe mismatch");
    if (typeof parsed.total !== "number" || !Number.isFinite(parsed.total)) throw new Error("bad total");
    if (typeof parsed.updateMode !== "string") throw new Error("bad updateMode");
    if (parsed.asOf !== null && typeof parsed.asOf !== "string") throw new Error("bad asOf");
    if (!Array.isArray(parsed.rows)) throw new Error("bad rows");
    if (parsed.rows.length > MARKET_SNAPSHOT_CACHE_MAX_ROWS) throw new Error("too many rows");
    if (!parsed.rows.every(isCachedRow)) throw new Error("bad row");
    return {
      asOf: parsed.asOf ?? null,
      universe: parsed.universe,
      total: parsed.total,
      updateMode: parsed.updateMode,
      rows: parsed.rows as MarketRow[],
    };
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      // storage went away mid-read — nothing else to do
    }
    return null;
  }
}

/**
 * Persists a snapshot for instant paint on the next mount. Filters are never
 * cached; oversized payloads are skipped rather than partially written.
 */
export function writeCachedMarketSnapshot(universe: MarketUniverse, snapshot: MarketSnapshot): void {
  const storage = safeSessionStorage();
  if (!storage) return;
  try {
    const rows = snapshot.rows.slice(0, MARKET_SNAPSHOT_CACHE_MAX_ROWS);
    const payload = JSON.stringify({
      asOf: snapshot.asOf,
      universe,
      total: snapshot.total,
      updateMode: snapshot.updateMode,
      rows,
    });
    if (payload.length > MARKET_SNAPSHOT_CACHE_MAX_BYTES) {
      storage.removeItem(marketSnapshotCacheKey(universe));
      return;
    }
    storage.setItem(marketSnapshotCacheKey(universe), payload);
  } catch {
    // Quota exceeded or storage unavailable — caching is best-effort
  }
}

export const MARKET_UNIVERSES: { value: MarketUniverse; label: string }[] = [
  { value: "all_equity", label: "All NSE" },
  { value: "nifty500", label: "Nifty 500" },
  { value: "nifty50", label: "Nifty 50" },
  { value: "nse_fo", label: "F&O" },
];

export interface MarketSnapshotParams {
  universe?: MarketUniverse;
  limit?: number;
  force?: boolean;
}

export function buildMarketSnapshotUrl(params: MarketSnapshotParams = {}): string {
  const search = new URLSearchParams();
  search.set("universe", params.universe ?? DEFAULT_MARKET_UNIVERSE);
  search.set("limit", String(params.limit ?? MARKET_SNAPSHOT_LIMIT));
  if (params.force) search.set("force", "true");
  return `${MARKET_API}/snapshot?${search.toString()}`;
}

/** Wire shape (snake_case) — kept loose; the mapper is the validation boundary. */
interface RawMarketRow {
  symbol?: unknown;
  name?: unknown;
  sector?: unknown;
  exchange?: unknown;
  close?: unknown;
  change?: unknown;
  relative_volume?: unknown;
  market_cap_cr?: unknown;
  cap_tier?: unknown;
  rsi?: unknown;
  adx?: unknown;
  sma20?: unknown;
  sma50?: unknown;
  sma200?: unknown;
  perf_w?: unknown;
  perf_1m?: unknown;
  high_52w?: unknown;
  low_52w?: unknown;
  pos_52w?: unknown;
  fno?: unknown;
  etf?: unknown;
}

interface RawMarketSnapshot {
  as_of?: unknown;
  universe?: unknown;
  total?: unknown;
  update_mode?: unknown;
  rows?: unknown;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toText(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function toBool(value: unknown): boolean {
  return value === true || value === 1 || value === "true";
}

export function mapMarketRow(raw: RawMarketRow | null | undefined): MarketRow {
  const r = raw ?? {};
  return {
    symbol: toText(r.symbol) ?? "",
    name: toText(r.name) ?? "",
    sector: toText(r.sector),
    exchange: toText(r.exchange),
    close: toNumber(r.close),
    change: toNumber(r.change),
    relativeVolume: toNumber(r.relative_volume),
    marketCapCr: toNumber(r.market_cap_cr),
    capTier: toText(r.cap_tier)?.toLowerCase() ?? null,
    rsi: toNumber(r.rsi),
    adx: toNumber(r.adx),
    sma20: toNumber(r.sma20),
    sma50: toNumber(r.sma50),
    sma200: toNumber(r.sma200),
    perfW: toNumber(r.perf_w),
    perf1m: toNumber(r.perf_1m),
    high52w: toNumber(r.high_52w),
    low52w: toNumber(r.low_52w),
    pos52w: toNumber(r.pos_52w),
    fno: toBool(r.fno),
    etf: toBool(r.etf),
  };
}

export function mapMarketSnapshot(raw: RawMarketSnapshot | null | undefined): MarketSnapshot {
  const r = raw ?? {};
  const rows = Array.isArray(r.rows) ? r.rows.map((row) => mapMarketRow(row as RawMarketRow)) : [];
  return {
    asOf: toText(r.as_of),
    universe: toText(r.universe) ?? DEFAULT_MARKET_UNIVERSE,
    total: toNumber(r.total) ?? rows.length,
    updateMode: toText(r.update_mode) ?? "unknown",
    rows,
  };
}

export async function fetchMarketSnapshot(
  params: MarketSnapshotParams = {},
  init?: RequestInit,
): Promise<MarketSnapshot> {
  const response = await fetchWithAuth(buildMarketSnapshotUrl(params), init);
  if (!response.ok) {
    const err = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(err?.detail || `Market snapshot failed (HTTP ${response.status})`);
  }
  return mapMarketSnapshot((await response.json()) as RawMarketSnapshot);
}
