/**
 * Options dock data client (E1 underlying metadata, E2 option chain).
 *
 * The chain endpoint is Upstox-shaped: per-strike `ce`/`pe` objects nest
 * `market_data` and an `option_greeks` object that is `null` when upstream
 * omits it. Every consumer here works on a flat, nullable-greek DTO, because a
 * `?? 0` on a missing delta silently invents a delta-neutral leg.
 *
 * A request whose `AbortSignal` fires resolves to `null` instead of throwing —
 * closing the dock or switching expiry is a normal event, not an error.
 */

import { fetchWithAuth } from "../state/auth";
import { API_BASE } from "./config";

const OPTIONS_BASE = `${API_BASE}/api/options`;

/** One retry at most, and only for a failure that can plausibly succeed again. */
const RETRY_DELAY_MS = 250;

export interface DockExpiry {
  date: string;
  weekly: boolean;
  dteDays: number;
  lotSize: number;
  tickSize: number;
}

export interface UnderlyingInfo {
  symbol: string;
  exchange: string;
  fno: boolean;
  instrumentKey: string;
  spot: number;
  expiries: DockExpiry[];
  defaultExpiry: string | null;
  marketState: "open" | "closed" | "pre_open";
}

export type DockErrorKind = "not_fno" | "auth" | "rate_limited" | "upstream" | "network";

export class OptionDockError extends Error {
  readonly kind: DockErrorKind;
  readonly status: number | null;
  readonly retryAfterMs: number | null;

  constructor(kind: DockErrorKind, message: string, status: number | null = null, retryAfterMs: number | null = null) {
    super(message);
    this.name = "OptionDockError";
    this.kind = kind;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export interface ChainLeg {
  ltp: number | null;
  oi: number;
  prevOi: number;
  volume: number;
  iv: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  pop: number | null;
  bid: number | null;
  ask: number | null;
  instrumentKey: string;
}

export interface ChainRow {
  strike: number;
  ce: ChainLeg;
  pe: ChainLeg;
}

export interface OptionDockChain {
  expiry: string;
  spot: number;
  /** Put/call OI ratio, `null` when CE OI is 0 (0/0 must never render 0.00). */
  pcr: number | null;
  /** ATM implied vol in vol points, `null` when unavailable. */
  atmIv: number | null;
  spotChangePct: number | null;
  rows: ChainRow[];
  asOf: string | null;
}

interface RawMarketData {
  ltp?: unknown;
  oi?: unknown;
  prev_oi?: unknown;
  volume?: unknown;
  bid_price?: unknown;
  ask_price?: unknown;
}

interface RawGreeks {
  iv?: unknown;
  delta?: unknown;
  gamma?: unknown;
  theta?: unknown;
  vega?: unknown;
  pop?: unknown;
}

interface RawContract {
  instrument_key?: unknown;
  market_data?: RawMarketData | null;
  option_greeks?: RawGreeks | null;
}

interface RawChainRow {
  strike?: unknown;
  ce?: RawContract | null;
  pe?: RawContract | null;
}

interface RawChainResponse {
  expiry?: unknown;
  spot?: unknown;
  timestamp?: unknown;
  spot_change_pct?: unknown;
  chain?: unknown;
  summary?: { pcr?: unknown } | null;
}

interface RawUnderlyingResponse {
  symbol?: unknown;
  exchange?: unknown;
  fno?: unknown;
  instrument_key?: unknown;
  spot?: unknown;
  default_expiry?: unknown;
  market_state?: unknown;
  expiries?: unknown;
}

function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** OI/volume legitimately default to 0; IV and greeks never do. */
function count(value: unknown): number {
  return num(value) ?? 0;
}

function leg(raw: RawContract | null | undefined): ChainLeg {
  const market = raw?.market_data ?? null;
  const greeks = raw?.option_greeks ?? null;
  return {
    ltp: num(market?.ltp),
    oi: count(market?.oi),
    prevOi: count(market?.prev_oi),
    volume: count(market?.volume),
    iv: num(greeks?.iv),
    delta: num(greeks?.delta),
    gamma: num(greeks?.gamma),
    theta: num(greeks?.theta),
    vega: num(greeks?.vega),
    pop: num(greeks?.pop),
    bid: num(market?.bid_price),
    ask: num(market?.ask_price),
    instrumentKey: String(raw?.instrument_key ?? ""),
  };
}

function normalizeExpiry(raw: unknown): DockExpiry | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const date = String(row.date ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return {
    date,
    weekly: Boolean(row.weekly),
    dteDays: count(row.dte_days),
    lotSize: count(row.lot_size),
    tickSize: num(row.tick_size) ?? 0.05,
  };
}

export function normalizeUnderlying(raw: RawUnderlyingResponse | null | undefined): UnderlyingInfo {
  const expiries = Array.isArray(raw?.expiries)
    ? raw.expiries.map(normalizeExpiry).filter((e): e is DockExpiry => e !== null)
    : [];
  expiries.sort((a, b) => a.date.localeCompare(b.date));
  const state = String(raw?.market_state ?? "closed");
  const marketState: UnderlyingInfo["marketState"] =
    state === "open" || state === "pre_open" ? state : "closed";
  const defaultExpiry = typeof raw?.default_expiry === "string" ? raw.default_expiry : null;
  return {
    symbol: String(raw?.symbol ?? "").toUpperCase(),
    exchange: String(raw?.exchange ?? "NSE").toUpperCase(),
    fno: raw?.fno !== false && expiries.length > 0,
    instrumentKey: String(raw?.instrument_key ?? ""),
    spot: num(raw?.spot) ?? 0,
    expiries,
    defaultExpiry,
    marketState,
  };
}

/** ATM IV = the IV at the strike nearest spot; `null` when no strike quotes one. */
function atmIvOf(rows: ChainRow[], spot: number): number | null {
  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    const distance = Math.abs(row.strike - spot);
    if (distance >= bestDistance) continue;
    const iv = row.ce.iv ?? row.pe.iv;
    if (iv == null || !(iv > 0)) continue;
    bestDistance = distance;
    best = iv;
  }
  return best;
}

export function normalizeChain(raw: RawChainResponse | null | undefined): OptionDockChain {
  const rows: ChainRow[] = [];
  if (Array.isArray(raw?.chain)) {
    for (const item of raw.chain as RawChainRow[]) {
      const strike = num(item?.strike);
      if (strike == null) continue;
      rows.push({ strike, ce: leg(item?.ce), pe: leg(item?.pe) });
    }
  }
  rows.sort((a, b) => a.strike - b.strike);

  const spot = num(raw?.spot) ?? 0;
  const summaryPcr = num(raw?.summary?.pcr);
  const ceOi = rows.reduce((sum, row) => sum + row.ce.oi, 0);
  const peOi = rows.reduce((sum, row) => sum + row.pe.oi, 0);
  const pcr = ceOi > 0 ? peOi / ceOi : summaryPcr;

  return {
    expiry: String(raw?.expiry ?? ""),
    spot,
    pcr: pcr != null && Number.isFinite(pcr) ? pcr : null,
    atmIv: atmIvOf(rows, spot),
    spotChangePct: num(raw?.spot_change_pct),
    rows,
    asOf: typeof raw?.timestamp === "string" ? raw.timestamp : null,
  };
}

function retryAfterMsOf(response: Response): number | null {
  const header = response.headers?.get?.("Retry-After");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  }
  return null;
}

async function readDetail(response: Response): Promise<{ code: string; detail: string }> {
  try {
    const body = (await response.json()) as { detail?: unknown; code?: unknown };
    const rawDetail = body?.detail;
    const nested = rawDetail && typeof rawDetail === "object" ? (rawDetail as Record<string, unknown>) : null;
    const code = nested ? String(nested.code ?? "") : String(body?.code ?? "");
    const detail = nested
      ? String(nested.detail ?? "")
      : typeof rawDetail === "string"
        ? rawDetail
        : "";
    return { code, detail };
  } catch {
    return { code: "", detail: "" };
  }
}

function isAbort(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

async function toDockError(response: Response, fallback: string): Promise<OptionDockError> {
  const { code, detail } = await readDetail(response);
  const message = detail || fallback;
  if (response.status === 401) {
    return new OptionDockError("auth", "Reconnect Upstox in Settings", 401);
  }
  if (response.status === 404 && (code === "not_fno" || /not_fno/i.test(message))) {
    return new OptionDockError("not_fno", message || "No listed options", 404);
  }
  if (response.status === 429) {
    return new OptionDockError("rate_limited", message || "Rate limited", 429, retryAfterMsOf(response));
  }
  if (response.status === 404) {
    return new OptionDockError("not_fno", message || "No listed options", 404);
  }
  return new OptionDockError("upstream", message || fallback, response.status);
}

function isRetryable(error: OptionDockError): boolean {
  return error.kind === "network" || (error.kind === "upstream" && (error.status == null || error.status >= 500));
}

async function requestJson<T>(
  url: string,
  signal: AbortSignal | undefined,
  fallbackMessage: string,
): Promise<T | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (signal?.aborted) return null;
    let response: Response;
    try {
      response = await fetchWithAuth(url, signal ? { signal } : {});
    } catch (error) {
      if (isAbort(error) || signal?.aborted) return null;
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        continue;
      }
      throw new OptionDockError("network", "Could not reach the options service");
    }
    if (!response.ok) {
      const failure = await toDockError(response, fallbackMessage);
      if (attempt === 0 && isRetryable(failure)) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        continue;
      }
      throw failure;
    }
    try {
      return (await response.json()) as T;
    } catch {
      throw new OptionDockError("upstream", fallbackMessage, response.status);
    }
  }
  return null;
}

export async function fetchUnderlying(
  symbol: string,
  signal?: AbortSignal,
): Promise<UnderlyingInfo | null> {
  const body = await requestJson<RawUnderlyingResponse>(
    `${OPTIONS_BASE}/underlying/${encodeURIComponent(symbol)}`,
    signal,
    "Could not load the option listing",
  );
  return body ? normalizeUnderlying(body) : null;
}

export async function fetchChain(
  symbol: string,
  expiry: string,
  signal?: AbortSignal,
): Promise<OptionDockChain | null> {
  const query = `expiry=${encodeURIComponent(expiry)}`;
  const body = await requestJson<RawChainResponse>(
    `${OPTIONS_BASE}/chain/${encodeURIComponent(symbol)}?${query}`,
    signal,
    "Could not load the option chain",
  );
  return body ? normalizeChain(body) : null;
}
