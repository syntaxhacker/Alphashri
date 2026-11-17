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
import { finiteNumber } from "./wireParse";

const OPTIONS_BASE = `${API_BASE}/api/options`;

/** One retry at most, and only for a failure that can plausibly succeed again. */
const RETRY_DELAY_MS = 250;
/** Overall deadline for a single attempt. A hung upstream must reach the UI as
 * a typed timeout (and its Retry banner), never as an eternal `loading` state. */
export const REQUEST_TIMEOUT_MS = 10_000;

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

export type DockErrorKind = "not_fno" | "auth" | "rate_limited" | "upstream" | "network" | "timeout";

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

/** One labelled strike level from the chain's `levels` block. */
export interface ChainLevel {
  strike: number;
  side: "above" | "below" | null;
  /** 0..1 within its family. `null` when the denominator is 0 — never 0. */
  strength: number | null;
  /** OI for walls, payout for max pain, net GEX for gamma levels. */
  oi: number | null;
  payout: number | null;
  netGex: number | null;
}

export interface OptionChainGexLevels {
  support: ChainLevel | null;
  resistance: ChainLevel | null;
  fuelUp: ChainLevel | null;
  fuelDown: ChainLevel | null;
  flip: number | null;
  regime: string | null;
  degraded: boolean | null;
}

/** Top-level levels object added by `/api/options/chain` (see docs/OPTIONS_LEVELS_CONTRACT.md). */
export interface OptionChainLevels {
  spot: number | null;
  step: number | null;
  thin: boolean | null;
  callWall: ChainLevel | null;
  putWall: ChainLevel | null;
  callWalls: ChainLevel[];
  putWalls: ChainLevel[];
  maxPain: ChainLevel | null;
  gex: OptionChainGexLevels;
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
  /** `null` for a legacy payload with no levels block. */
  levels?: OptionChainLevels | null;
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

interface RawChainLevel {
  strike?: unknown;
  side?: unknown;
  strength?: unknown;
  oi?: unknown;
  payout?: unknown;
  net_gex?: unknown;
}

interface RawGexLevels {
  support?: unknown;
  resistance?: unknown;
  fuel_up?: unknown;
  fuel_down?: unknown;
  flip?: unknown;
  regime?: unknown;
  degraded?: unknown;
}

interface RawLevels {
  spot?: unknown;
  step?: unknown;
  thin?: unknown;
  call_wall?: unknown;
  put_wall?: unknown;
  call_walls?: unknown;
  put_walls?: unknown;
  max_pain?: unknown;
  gex?: RawGexLevels | null;
}

interface RawChainResponse {
  expiry?: unknown;
  spot?: unknown;
  timestamp?: unknown;
  spot_change_pct?: unknown;
  chain?: unknown;
  levels?: unknown;
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

/** OI/volume legitimately default to 0; IV and greeks never do. */
function count(value: unknown): number {
  return finiteNumber(value) ?? 0;
}

function leg(raw: RawContract | null | undefined): ChainLeg {
  const market = raw?.market_data ?? null;
  const greeks = raw?.option_greeks ?? null;
  return {
    ltp: finiteNumber(market?.ltp),
    oi: count(market?.oi),
    prevOi: count(market?.prev_oi),
    volume: count(market?.volume),
    iv: finiteNumber(greeks?.iv),
    delta: finiteNumber(greeks?.delta),
    gamma: finiteNumber(greeks?.gamma),
    theta: finiteNumber(greeks?.theta),
    vega: finiteNumber(greeks?.vega),
    pop: finiteNumber(greeks?.pop),
    bid: finiteNumber(market?.bid_price),
    ask: finiteNumber(market?.ask_price),
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
    tickSize: finiteNumber(row.tick_size) ?? 0.05,
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
    spot: finiteNumber(raw?.spot) ?? 0,
    expiries,
    defaultExpiry,
    marketState,
  };
}

/**
 * A level is a plain object; every field is read with `finiteNumber()` so an absent
 * strength/payout/OI stays `null`. No level object ever becomes `{}` or `0`.
 */
function normalizeLevel(raw: unknown): ChainLevel | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as RawChainLevel;
  const strike = finiteNumber(row.strike);
  if (strike == null) return null;
  return {
    strike,
    side: row.side === "above" || row.side === "below" ? row.side : null,
    strength: finiteNumber(row.strength),
    oi: finiteNumber(row.oi),
    payout: finiteNumber(row.payout),
    netGex: finiteNumber(row.net_gex),
  };
}

function normalizeLevels(raw: unknown): OptionChainLevels | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as RawLevels;
  const gex = row.gex && typeof row.gex === "object" ? row.gex : null;
  const walls = (value: unknown): ChainLevel[] =>
    Array.isArray(value)
      ? value.map(normalizeLevel).filter((level): level is ChainLevel => level != null)
      : [];
  return {
    spot: finiteNumber(row.spot),
    step: finiteNumber(row.step),
    thin: typeof row.thin === "boolean" ? row.thin : null,
    callWall: normalizeLevel(row.call_wall),
    putWall: normalizeLevel(row.put_wall),
    callWalls: walls(row.call_walls),
    putWalls: walls(row.put_walls),
    maxPain: normalizeLevel(row.max_pain),
    gex: {
      support: normalizeLevel(gex?.support),
      resistance: normalizeLevel(gex?.resistance),
      fuelUp: normalizeLevel(gex?.fuel_up),
      fuelDown: normalizeLevel(gex?.fuel_down),
      flip: finiteNumber(gex?.flip),
      regime: typeof gex?.regime === "string" ? gex.regime : null,
      degraded: typeof gex?.degraded === "boolean" ? gex.degraded : null,
    },
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
      const strike = finiteNumber(item?.strike);
      if (strike == null) continue;
      rows.push({ strike, ce: leg(item?.ce), pe: leg(item?.pe) });
    }
  }
  rows.sort((a, b) => a.strike - b.strike);

  const spot = finiteNumber(raw?.spot) ?? 0;
  const summaryPcr = finiteNumber(raw?.summary?.pcr);
  const ceOi = rows.reduce((sum, row) => sum + row.ce.oi, 0);
  const peOi = rows.reduce((sum, row) => sum + row.pe.oi, 0);
  const pcr = ceOi > 0 ? peOi / ceOi : summaryPcr;

  return {
    expiry: String(raw?.expiry ?? ""),
    spot,
    pcr: pcr != null && Number.isFinite(pcr) ? pcr : null,
    atmIv: atmIvOf(rows, spot),
    spotChangePct: finiteNumber(raw?.spot_change_pct),
    rows,
    asOf: typeof raw?.timestamp === "string" ? raw.timestamp : null,
    levels: normalizeLevels(raw?.levels),
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

/** A raceable deadline. `cancel()` must run on every settled attempt so a
 * resolved fetch does not leave a timer that can reject an already-finished
 * request (fake timers make that leak visible). */
function deadline(): { promise: Promise<never>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const promise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new OptionDockError("timeout", "The options service took too long to respond"));
    }, REQUEST_TIMEOUT_MS);
  });
  return {
    promise,
    cancel: () => {
      if (timer != null) clearTimeout(timer);
    },
  };
}

export async function requestJson<T>(
  url: string,
  signal: AbortSignal | undefined,
  fallbackMessage: string,
): Promise<T | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (signal?.aborted) return null;

    // Each attempt owns its signal: the deadline can abort the losing fetch
    // without touching a signal shared with other callers. The caller's signal
    // is linked to it, so cancelling the dock still cancels the in-flight call.
    const attemptController = new AbortController();
    const onCallerAbort = () => attemptController.abort();
    signal?.addEventListener("abort", onCallerAbort, { once: true });
    if (signal?.aborted) {
      signal.removeEventListener("abort", onCallerAbort);
      return null;
    }

    const timer = deadline();
    let response: Response;
    try {
      // The deadline is a separate race arm so a hung fetch — one that ignores
      // abort — still surfaces as a typed timeout.
      response = await Promise.race([
        fetchWithAuth(url, { signal: attemptController.signal }),
        timer.promise,
      ]);
    } catch (error) {
      if (error instanceof OptionDockError && error.kind === "timeout") {
        // Stop the losing fetch instead of letting it run to completion.
        attemptController.abort();
        // A caller abort must keep its abort semantics, not become a timeout.
        if (signal?.aborted) return null;
        throw error;
      }
      if (isAbort(error) || signal?.aborted) return null;
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        continue;
      }
      throw new OptionDockError("network", "Could not reach the options service");
    } finally {
      signal?.removeEventListener("abort", onCallerAbort);
      timer.cancel();
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
