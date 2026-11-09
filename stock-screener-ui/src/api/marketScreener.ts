import { fetchWithAuth } from "../state/auth";
import { API_BASE } from "@/api/config";
import type { MarketRow, MarketSnapshot, MarketUniverse } from "../types/marketScreener";

const MARKET_API = `${API_BASE}/api/market`;

export const DEFAULT_MARKET_UNIVERSE: MarketUniverse = "all_equity";
export const MARKET_SNAPSHOT_LIMIT = 4000;

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
  industry?: unknown;
  exchange?: unknown;
  close?: unknown;
  change?: unknown;
  volume?: unknown;
  relative_volume?: unknown;
  market_cap?: unknown;
  market_cap_cr?: unknown;
  cap_tier?: unknown;
  rsi?: unknown;
  adx?: unknown;
  atr?: unknown;
  sma20?: unknown;
  sma50?: unknown;
  sma200?: unknown;
  perf_w?: unknown;
  perf_1m?: unknown;
  perf_3m?: unknown;
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
    industry: toText(r.industry),
    exchange: toText(r.exchange),
    close: toNumber(r.close),
    change: toNumber(r.change),
    volume: toNumber(r.volume),
    relativeVolume: toNumber(r.relative_volume),
    marketCap: toNumber(r.market_cap),
    marketCapCr: toNumber(r.market_cap_cr),
    capTier: toText(r.cap_tier)?.toLowerCase() ?? null,
    rsi: toNumber(r.rsi),
    adx: toNumber(r.adx),
    atr: toNumber(r.atr),
    sma20: toNumber(r.sma20),
    sma50: toNumber(r.sma50),
    sma200: toNumber(r.sma200),
    perfW: toNumber(r.perf_w),
    perf1m: toNumber(r.perf_1m),
    perf3m: toNumber(r.perf_3m),
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
