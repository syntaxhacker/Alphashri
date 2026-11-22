import { fetchWithAuth } from "../state/auth";
import { API_BASE } from "@/api/config";
import { finiteNumber, finiteText } from "./wireParse";
import { MARKET_ROW_CAP, MARKET_SYMBOL_CAP } from "../config/apiLimits";
import { MARKET_UNIVERSE_DESCRIPTORS } from "../config/marketUniverses";
import type { MarketRow, MarketSnapshot, MarketUniverse } from "../types/marketScreener";
import { apiErrorFromResponse } from "./apiError";
import { isRecord } from "../utils/isRecord";

const MARKET_API = `${API_BASE}/api/market`;

export const DEFAULT_MARKET_UNIVERSE: MarketUniverse = "all_equity";
export const MARKET_SNAPSHOT_LIMIT = MARKET_ROW_CAP;
/** Backend hard cap on symbols per /api/market/snapshot request. */
export const MARKET_SYMBOLS_MAX = MARKET_SYMBOL_CAP;

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

/** Dropdown options come from the same descriptors the formatters read. */
export const MARKET_UNIVERSES: { value: MarketUniverse; label: string }[] =
  MARKET_UNIVERSE_DESCRIPTORS.map(({ value, label }) => ({ value, label }));

export interface MarketSnapshotParams {
  universe?: MarketUniverse;
  limit?: number;
  force?: boolean;
  /** Optional symbol filter (≤20); applied after the cached snapshot is built. */
  symbols?: string[];
  /** Columnar wire layout. Omitted requests the plain JSON rows envelope. */
  format?: "columns";
}

export function buildMarketSnapshotUrl(params: MarketSnapshotParams = {}): string {
  const search = new URLSearchParams();
  search.set("universe", params.universe ?? DEFAULT_MARKET_UNIVERSE);
  search.set("limit", String(params.limit ?? MARKET_SNAPSHOT_LIMIT));
  if (params.force) search.set("force", "true");
  if (params.symbols?.length) search.set("symbols", params.symbols.join(","));
  if (params.format === "columns") search.set("format", "columns");
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
  /** Backend emits camelCase; accept the snake_case spelling too. */
  marketCapUsdB?: unknown;
  market_cap_usd_b?: unknown;
  currency?: unknown;
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
  pe_ratio?: unknown;
  pb_ratio?: unknown;
  dividend_yield?: unknown;
  roe?: unknown;
  ps_ratio?: unknown;
  fcf_yield?: unknown;
  revenue?: unknown;
  net_income?: unknown;
  debt_to_equity?: unknown;
  current_ratio?: unknown;
  gross_margin?: unknown;
  operating_margin?: unknown;
  rev_yoy?: unknown;
  eps_yoy?: unknown;
  volume?: unknown;
  avg_volume?: unknown;
  gap?: unknown;
  atr?: unknown;
  high?: unknown;
  low?: unknown;
  value_traded?: unknown;
  to_52w_high_pct?: unknown;
  from_52w_low_pct?: unknown;
  range_vs_atr?: unknown;
  fno?: unknown;
  etf?: unknown;
}

interface RawMarketSnapshot {
  as_of?: unknown;
  universe?: unknown;
  total?: unknown;
  update_mode?: unknown;
  rows?: unknown;
  stale?: unknown;
  age_sec?: unknown;
  cached?: unknown;
}

function toBool(value: unknown): boolean {
  return value === true || value === 1 || value === "true";
}

/** Legacy/partial payloads are INR; only an explicit USD marker flips it. */
function toCurrency(value: unknown): "INR" | "USD" {
  return typeof value === "string" && value.trim().toUpperCase() === "USD" ? "USD" : "INR";
}

export function mapMarketRow(raw: RawMarketRow | null | undefined): MarketRow {
  const r = raw ?? {};
  const currency = toCurrency(r.currency);
  const usdCap = finiteNumber(r.marketCapUsdB) ?? finiteNumber(r.market_cap_usd_b);
  return {
    symbol: finiteText(r.symbol) ?? "",
    name: finiteText(r.name) ?? "",
    sector: finiteText(r.sector),
    exchange: finiteText(r.exchange),
    close: finiteNumber(r.close),
    change: finiteNumber(r.change),
    relativeVolume: finiteNumber(r.relative_volume),
    // One cap unit per currency: never let a stale field leak a ₹ figure into a
    // USD row (or the reverse). The backend already emits the other as null.
    marketCapCr: currency === "USD" ? null : finiteNumber(r.market_cap_cr),
    marketCapUsdB: currency === "USD" ? usdCap : null,
    currency,
    capTier: finiteText(r.cap_tier)?.toLowerCase() ?? null,
    rsi: finiteNumber(r.rsi),
    adx: finiteNumber(r.adx),
    sma20: finiteNumber(r.sma20),
    sma50: finiteNumber(r.sma50),
    sma200: finiteNumber(r.sma200),
    perfW: finiteNumber(r.perf_w),
    perf1m: finiteNumber(r.perf_1m),
    high52w: finiteNumber(r.high_52w),
    low52w: finiteNumber(r.low_52w),
    pos52w: finiteNumber(r.pos_52w),
    peRatio: finiteNumber(r.pe_ratio),
    pbRatio: finiteNumber(r.pb_ratio),
    dividendYield: finiteNumber(r.dividend_yield),
    roe: finiteNumber(r.roe),
    psRatio: finiteNumber(r.ps_ratio),
    // Derived server-side from FCF / market cap; null where the source has no
    // FCF coverage (India reports ~3.5%, the US ~85-90%).
    fcfYield: finiteNumber(r.fcf_yield),
    revenue: finiteNumber(r.revenue),
    netIncome: finiteNumber(r.net_income),
    debtToEquity: finiteNumber(r.debt_to_equity),
    currentRatio: finiteNumber(r.current_ratio),
    grossMargin: finiteNumber(r.gross_margin),
    operatingMargin: finiteNumber(r.operating_margin),
    revYoy: finiteNumber(r.rev_yoy),
    epsYoy: finiteNumber(r.eps_yoy),
    volume: finiteNumber(r.volume),
    avgVolume: finiteNumber(r.avg_volume),
    gap: finiteNumber(r.gap),
    atr: finiteNumber(r.atr),
    high: finiteNumber(r.high),
    low: finiteNumber(r.low),
    valueTraded: finiteNumber(r.value_traded),
    to52wHighPct: finiteNumber(r.to_52w_high_pct),
    from52wLowPct: finiteNumber(r.from_52w_low_pct),
    rangeVsAtr: finiteNumber(r.range_vs_atr),
    fno: toBool(r.fno),
    etf: toBool(r.etf),
  };
}

export function mapMarketSnapshot(raw: RawMarketSnapshot | null | undefined): MarketSnapshot {
  const r = raw ?? {};
  const rows = Array.isArray(r.rows) ? r.rows.map((row) => mapMarketRow(row as RawMarketRow)) : [];
  return {
    asOf: finiteText(r.as_of),
    universe: finiteText(r.universe) ?? DEFAULT_MARKET_UNIVERSE,
    total: finiteNumber(r.total) ?? rows.length,
    updateMode: finiteText(r.update_mode) ?? "unknown",
    rows,
    stale: r.stale === true,
    ageSec: finiteNumber(r.age_sec),
    cached: r.cached === true,
  };
}

/** Columnar wire version this client understands — anything else is an error. */
export const MARKET_COLUMNS_WIRE_FORMAT = "columns-v1";

interface RawColumnarSnapshot {
  format?: unknown;
  meta?: unknown;
  fields?: unknown;
  columns?: unknown;
}

function malformedColumnar(reason: string): Error {
  return new Error(`Malformed columnar market snapshot: ${reason}`);
}

/**
 * Rebuilds the row envelope from the opt-in columnar payload. The decoder is
 * the whole validation boundary: a bad field list or a ragged column must fail
 * loudly instead of yielding half-mapped rows (a short column would silently
 * shift every following value onto the wrong symbol).
 */
export function decodeColumnarSnapshot(payload: unknown): MarketSnapshot {
  if (!isRecord(payload)) {
    throw malformedColumnar("expected a JSON object");
  }
  const raw = payload as RawColumnarSnapshot;
  if (raw.format !== MARKET_COLUMNS_WIRE_FORMAT) {
    throw malformedColumnar(
      `unsupported format ${JSON.stringify(raw.format)} (expected "${MARKET_COLUMNS_WIRE_FORMAT}")`,
    );
  }
  if (!isRecord(raw.meta)) {
    throw malformedColumnar("meta must be an object");
  }
  if (!Array.isArray(raw.fields)) {
    throw malformedColumnar("fields must be an array");
  }
  if (!isRecord(raw.columns)) {
    throw malformedColumnar("columns must be an object");
  }
  if (raw.fields.length === 0) {
    if (Object.keys(raw.columns).length > 0) {
      throw malformedColumnar("columns must be empty when fields is empty");
    }
    return mapMarketSnapshot({ ...(raw.meta as RawMarketSnapshot), rows: [] });
  }

  const fields: string[] = [];
  const seen = new Set<string>();
  for (const field of raw.fields) {
    if (typeof field !== "string" || field.trim() === "") {
      throw malformedColumnar("fields must contain only non-empty strings");
    }
    if (seen.has(field)) throw malformedColumnar(`duplicate field "${field}"`);
    seen.add(field);
    fields.push(field);
  }

  const table = raw.columns;
  const columns: unknown[][] = [];
  let rowCount: number | null = null;
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(table, field)) {
      throw malformedColumnar(`missing column "${field}"`);
    }
    const column = table[field];
    if (!Array.isArray(column)) {
      throw malformedColumnar(`column "${field}" must be an array`);
    }
    if (rowCount === null) {
      rowCount = column.length;
    } else if (column.length !== rowCount) {
      throw malformedColumnar(`column "${field}" has ${column.length} values, expected ${rowCount}`);
    }
    columns.push(column);
  }

  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < (rowCount ?? 0); i += 1) {
    const row: Record<string, unknown> = {};
    // Insertion order follows `fields`; the mapped row keeps its own fixed order.
    for (let f = 0; f < fields.length; f += 1) {
      row[fields[f]] = columns[f][i];
    }
    rows.push(row);
  }

  return mapMarketSnapshot({ ...(raw.meta as RawMarketSnapshot), rows });
}

function isColumnarPayload(payload: unknown): boolean {
  return isRecord(payload) && payload.format === MARKET_COLUMNS_WIRE_FORMAT;
}

function isPlainSnapshotPayload(payload: unknown): payload is RawMarketSnapshot {
  return isRecord(payload) && Array.isArray(payload.rows);
}

export async function fetchMarketSnapshot(
  params: MarketSnapshotParams = {},
  init?: RequestInit,
): Promise<MarketSnapshot> {
  const response = await fetchWithAuth(buildMarketSnapshotUrl(params), init);
  if (!response.ok) {
    throw await apiErrorFromResponse(response, `Market snapshot failed (HTTP ${response.status})`);
  }
  const payload = (await response.json()) as unknown;
  // A columnar body is decoded even when the caller did not ask for it — mapping
  // it as plain rows would yield an empty table.
  if (isColumnarPayload(payload)) return decodeColumnarSnapshot(payload);
  // A `format=columns` request may still be answered by a backend (or a mock)
  // that only speaks the plain envelope; that is the documented JSON fallback,
  // not a broken payload. Anything else routed here is left to the decoder so
  // it fails with the precise malformed-columnar reason.
  if (params.format === "columns" && !isPlainSnapshotPayload(payload)) {
    return decodeColumnarSnapshot(payload);
  }
  // A 200 without either envelope used to map to an empty snapshot, so a proxy
  // error page or a truncated body rendered as "no rows for this universe".
  if (!isPlainSnapshotPayload(payload)) {
    console.error(
      `[api] Market snapshot returned no rows array (universe=${params.universe ?? DEFAULT_MARKET_UNIVERSE}, status=${response.status})`,
    );
  }
  return mapMarketSnapshot(payload as RawMarketSnapshot);
}


/** The only snapshot fields the pattern dock needs for its live-price line. */
export interface MarketQuote {
  symbol: string;
  close: number | null;
  change: number | null;
}

/**
 * Trim symbols and dedupe case-insensitively (first occurrence wins, original
 * casing preserved). Empty/whitespace-only entries are dropped.
 */
function dedupeSymbols(symbols: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of symbols) {
    const sym = s.trim();
    if (!sym) continue;
    const key = sym.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(sym);
  }
  return out;
}

/**
 * Fetch live quotes for a single batch (≤20 symbols) via the cached
 * snapshot's `symbols` filter.
 */
async function fetchQuotesBatch(symbols: string[], init?: RequestInit): Promise<MarketQuote[]> {
  const response = await fetchWithAuth(buildMarketSnapshotUrl({ symbols }), init);
  if (!response.ok) {
    const err = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(err?.detail || `Market quotes failed (HTTP ${response.status})`);
  }
  const raw = (await response.json()) as RawMarketSnapshot;
  const rows = Array.isArray(raw.rows) ? raw.rows : [];
  return rows.map((row) => {
    const r = row as RawMarketRow;
    return {
      symbol: finiteText(r.symbol) ?? "",
      close: finiteNumber(r.close),
      change: finiteNumber(r.change),
    };
  });
}

/**
 * Fetch live quotes for a handful of symbols via the cached snapshot's
 * `symbols` filter. An empty list short-circuits to `[]` (no network call).
 *
 * The backend caps the `symbols` filter at 20, so a longer list is deduped,
 * chunked into batches of ≤20, fetched in parallel, and merged in input order.
 * A single symbol still makes exactly one request.
 */
export async function fetchQuotes(symbols: string[], init?: RequestInit): Promise<MarketQuote[]> {
  const clean = dedupeSymbols(symbols);
  if (clean.length === 0) return [];
  if (clean.length <= MARKET_SYMBOLS_MAX) return fetchQuotesBatch(clean, init);
  const batches: string[][] = [];
  for (let i = 0; i < clean.length; i += MARKET_SYMBOLS_MAX) {
    batches.push(clean.slice(i, i + MARKET_SYMBOLS_MAX));
  }
  // One failed batch must not reject the whole quote set: settle every batch,
  // merge the successes in input order, and only rethrow when every batch fails.
  const outcomes = await Promise.allSettled(
    batches.map((batch) => fetchQuotesBatch(batch, init)),
  );
  const merged: MarketQuote[] = [];
  const seen = new Set<string>();
  const failedBatches: number[] = [];
  let firstError: unknown;
  for (let i = 0; i < outcomes.length; i += 1) {
    const outcome = outcomes[i];
    if (outcome.status === "fulfilled") {
      for (const quote of outcome.value) {
        if (seen.has(quote.symbol)) continue;
        seen.add(quote.symbol);
        merged.push(quote);
      }
    } else {
      failedBatches.push(i);
      if (firstError === undefined) firstError = outcome.reason;
    }
  }
  if (merged.length === 0 && firstError !== undefined) {
    throw firstError;
  }
  // A partial set is returned on purpose, but the dropped symbols must not look
  // like a symbol with no quote: the dock would silently omit live prices.
  if (failedBatches.length > 0) {
    console.warn(
      `[api] Market quotes: ${failedBatches.length}/${batches.length} batches failed, returning ${merged.length}/${clean.length} symbols`,
      firstError,
    );
  }
  return merged;
}
