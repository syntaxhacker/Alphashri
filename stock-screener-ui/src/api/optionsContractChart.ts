/**
 * Contract chart client for a single CE/PE instrument.
 *
 * The wire payload is `{t,o,h,l,c,v,oi}` per candle. Every consumer here gets a
 * camelCase candle with a real ISO timestamp; a candle missing a finite OHLC
 * value is dropped rather than zero-filled, because a `?? 0` would draw a fake
 * premium collapse. An unreadable envelope is an error — never an empty chart.
 *
 * Aborts are propagated with their original `AbortError` name: the panel aborts
 * on interval change/unmount and must not render that as a failure.
 */

import { fetchWithAuth } from "../state/auth";
import { API_BASE } from "./config";
import { finiteNumber, finiteText } from "./wireParse";

const CONTRACT_CHART_PATH = "/api/options/contract-chart";

/** Codes emitted by `api/options_contract_chart.py`, turned into actionable copy. */
const DETAIL_MESSAGES: Record<string, string> = {
  upstox_auth_required: "Reconnect Upstox in Settings",
  upstox_rate_limited: "Option chart is rate limited — try again shortly",
  options_contract_chart_unavailable: "The option chart service is unavailable right now",
  options_contract_chart_timeout: "The option chart service took too long to respond",
  invalid_instrument_key: "This contract key is not valid",
  invalid_interval: "That interval is not supported",
  invalid_days: "That history window is not supported",
};

export type ContractInterval = "1m" | "5m" | "15m";
export type ContractDays = 1 | 2 | 3;

const CONTRACT_INTERVALS: readonly ContractInterval[] = ["1m", "5m", "15m"];

export interface ContractCandle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  oi: number;
}

export interface ContractCandles {
  instrumentKey: string;
  interval: ContractInterval;
  candles: ContractCandle[];
  source: string;
  cached: boolean;
  emptyReason: string | null;
}

export interface ContractChartParams {
  instrumentKey: string;
  interval: ContractInterval;
  days?: ContractDays;
}

export type ContractChartErrorKind = "auth" | "http" | "malformed" | "network" | "invalid";

export class ContractChartError extends Error {
  readonly kind: ContractChartErrorKind;
  readonly status: number | null;

  constructor(kind: ContractChartErrorKind, message: string, status: number | null = null) {
    super(message);
    this.name = "ContractChartError";
    this.kind = kind;
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAbortError(error: unknown): boolean {
  return (
    (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function intervalOf(value: unknown): ContractInterval | null {
  return CONTRACT_INTERVALS.includes(value as ContractInterval) ? (value as ContractInterval) : null;
}

/** Epoch milliseconds for a timestamp that actually resolves; `null` otherwise. */
function timestampMs(value: unknown): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Volume/OI are counts: absent means 0, present-but-unusable means "bad candle". */
function count(value: unknown): number | null {
  if (value == null) return 0;
  const parsed = finiteNumber(value);
  return parsed != null && parsed >= 0 ? parsed : null;
}

function decodeCandle(raw: unknown): { ms: number; candle: ContractCandle } | null {
  if (!isRecord(raw)) return null;
  const timestamp = typeof raw.t === "string" ? raw.t.trim() : "";
  const ms = timestampMs(timestamp);
  if (ms == null) return null;

  const open = finiteNumber(raw.o);
  const high = finiteNumber(raw.h);
  const low = finiteNumber(raw.l);
  const close = finiteNumber(raw.c);
  if (open == null || high == null || low == null || close == null) return null;
  if (high < low) return null;

  const volume = count(raw.v);
  const oi = count(raw.oi);
  if (volume == null || oi == null) return null;

  return { ms, candle: { timestamp, open, high, low, close, volume, oi } };
}

/**
 * Validates and normalizes one `contract-chart` payload.
 *
 * A malformed row is skipped so one bad tick cannot blank the whole series; a
 * malformed envelope throws so the UI can offer Retry instead of claiming the
 * contract never traded.
 */
export function decodeContractCandles(
  raw: unknown,
  fallback?: Partial<Pick<ContractChartParams, "instrumentKey" | "interval">>,
): ContractCandles {
  if (!isRecord(raw)) {
    throw new ContractChartError("malformed", "The option chart response was not an object");
  }

  const instrumentKey = finiteText(raw.instrument_key)?.trim() || fallback?.instrumentKey?.trim() || "";
  if (!instrumentKey) {
    throw new ContractChartError("malformed", "The option chart response did not identify the contract");
  }

  const interval = intervalOf(raw.interval) ?? fallback?.interval ?? null;
  if (!interval) {
    throw new ContractChartError("malformed", "The option chart response used an unknown interval");
  }

  if (!Array.isArray(raw.candles)) {
    throw new ContractChartError("malformed", "The option chart response did not contain a candle list");
  }

  // A repeated minute can appear when a range is stitched across cache windows;
  // the later row is the complete one, so it wins.
  const byTime = new Map<number, ContractCandle>();
  for (const item of raw.candles) {
    const decoded = decodeCandle(item);
    if (decoded) byTime.set(decoded.ms, decoded.candle);
  }
  const candles = [...byTime.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, candle]) => candle);

  return {
    instrumentKey,
    interval,
    candles,
    source: finiteText(raw.source) ?? "",
    cached: raw.cached === true,
    emptyReason: finiteText(raw.empty_reason),
  };
}

async function detailOf(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as unknown;
    if (!isRecord(body)) return "";
    if (typeof body.detail === "string") return body.detail;
    if (isRecord(body.detail) && typeof body.detail.detail === "string") return body.detail.detail;
    if (typeof body.message === "string") return body.message;
  } catch {
    // Upstream failures are frequently HTML; the status still carries the meaning.
  }
  return "";
}

async function toContractChartError(response: Response): Promise<ContractChartError> {
  if (response.status === 401) {
    return new ContractChartError("auth", "Reconnect Upstox in Settings", 401);
  }
  const detail = await detailOf(response);
  // The backend sends short codes; the raw code is not a sentence a trader can act on.
  const message = DETAIL_MESSAGES[detail] ?? detail;
  if (response.status === 429) {
    return new ContractChartError("http", message || "The option chart service is rate limited", 429);
  }
  return new ContractChartError("http", message || "Could not load this contract's chart", response.status);
}

export async function fetchContractCandles(
  params: ContractChartParams,
  init: RequestInit = {},
): Promise<ContractCandles> {
  const instrumentKey = params.instrumentKey?.trim();
  if (!instrumentKey) {
    throw new ContractChartError("invalid", "An instrument key is required");
  }

  const query = new URLSearchParams({
    instrument_key: instrumentKey,
    interval: params.interval,
    days: String(params.days ?? 1),
  });

  let response: Response;
  try {
    response = await fetchWithAuth(`${API_BASE}${CONTRACT_CHART_PATH}?${query.toString()}`, init);
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ContractChartError("network", "Could not reach the option chart service");
  }

  if (!response.ok) throw await toContractChartError(response);

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ContractChartError("malformed", "The option chart response was not readable JSON", response.status);
  }

  return decodeContractCandles(body, { instrumentKey, interval: params.interval });
}
