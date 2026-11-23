/**
 * Client for the options paper book. The backend speaks snake_case in some
 * places and camelCase in others, so every payload passes through the
 * normalizers below. Missing arrays become [], missing numbers become 0 —
 * a partial response must still render rather than throw.
 */

import { fetchWithAuth } from "../state/auth";
import type {
  ChainSnapshot,
  ChainSnapshotLeg,
  OptionAction,
  OptionPaperLeg,
  OptionPaperOrderRequest,
  OptionPaperOrderResult,
  OptionPaperPosition,
  OptionPaperSource,
  OptionPaperStatus,
  OptionReplayResult,
  OptionType,
  ReplayCoverage,
  ReplayFrame,
  ReplaySession,
} from "../types/optionsPaper";
import { API_BASE } from "./config";

const BASE = `${API_BASE}/api/options-paper`;

type Raw = Record<string, unknown>;

function asRecord(value: unknown): Raw {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Raw)
    : {};
}

function pick(row: Raw, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function num(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === "") return fallback;
  const n = typeof value === "string" ? Number(value) : (value as number);
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

function bool(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value !== 0;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "true" || v === "1" || v === "yes") return true;
    if (v === "false" || v === "0" || v === "no") return false;
  }
  return fallback;
}

function str(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : fallback;
  if (typeof value === "boolean") return value ? "true" : "false";
  return fallback;
}

function nullableStr(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const valueStr = str(value).trim();
  return valueStr === "" ? null : valueStr;
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numArr(value: unknown): number[] {
  return arr(value).map((entry) => num(entry));
}

function action(value: unknown): OptionAction {
  return str(value).toUpperCase() === "SELL" ? "SELL" : "BUY";
}

function opt(value: unknown): OptionType {
  return str(value).toUpperCase() === "PE" ? "PE" : "CE";
}

function source(value: unknown): OptionPaperSource {
  return str(value).toLowerCase() === "replay" ? "replay" : "live";
}

function status(value: unknown): OptionPaperStatus {
  const key = str(value).toLowerCase();
  return key === "closed" || key === "expired" ? key : "open";
}

function normalizeLeg(raw: unknown): OptionPaperLeg {
  const row = asRecord(raw);
  return {
    id: num(pick(row, "id", "legId", "leg_id")),
    positionId: num(pick(row, "positionId", "position_id")),
    action: action(pick(row, "action", "side")),
    optType: opt(pick(row, "optType", "opt_type", "opt", "type")),
    strike: num(pick(row, "strike", "strikePrice", "strike_price")),
    lots: num(row.lots),
    qty: num(pick(row, "qty", "quantity")),
    instrumentKey: nullableStr(pick(row, "instrumentKey", "instrument_key")),
    entryTs: nullableStr(pick(row, "entryTs", "entry_ts")),
    entryPremium: num(pick(row, "entryPremium", "entry_premium")),
    markPremium: num(pick(row, "markPremium", "mark_premium", "mark")),
    markTs: nullableStr(pick(row, "markTs", "mark_ts")),
    exitPremium: nullableStr(pick(row, "exitPremium", "exit_premium")) === null
      ? null
      : num(pick(row, "exitPremium", "exit_premium")),
  };
}

export function normalizeOptionPaperPosition(raw: unknown): OptionPaperPosition {
  const row = asRecord(raw);
  const netDebit = num(pick(row, "netDebit", "net_debit"));
  const unrealized = num(pick(row, "unrealizedPnl", "unrealized_pnl"));
  return {
    id: num(row.id),
    uuid: str(pick(row, "uuid", "id")),
    userId: num(pick(row, "userId", "user_id")),
    source: source(pick(row, "source")),
    status: status(pick(row, "status")),
    underlying: str(pick(row, "underlying", "symbol")),
    expiry: str(row.expiry).slice(0, 10),
    name: str(row.name),
    entryTs: str(pick(row, "entryTs", "entry_ts", "entry_time")),
    entrySpot: num(pick(row, "entrySpot", "entry_spot")),
    lots: num(row.lots),
    netDebit,
    costsEst: num(pick(row, "costsEst", "costs_est")),
    maxProfit: num(pick(row, "maxProfit", "max_profit")),
    maxLoss: num(pick(row, "maxLoss", "max_loss")),
    breakevens: numArr(pick(row, "breakevens", "breakeven")),
    realizedPnl: num(pick(row, "realizedPnl", "realized_pnl")),
    closeReason: nullableStr(pick(row, "closeReason", "close_reason")),
    closedAt: nullableStr(pick(row, "closedAt", "closed_at")),
    notes: str(row.notes),
    legs: arr(pick(row, "legs", "options", "optionLegs")).map(normalizeLeg),
    unrealizedPnl: unrealized,
    totalPnl: num(pick(row, "totalPnl", "total_pnl"), unrealized),
    markSpot: num(pick(row, "markSpot", "mark_spot")),
    markTs: nullableStr(pick(row, "markTs", "mark_ts")),
    dte: num(pick(row, "dte", "daysToExpiry", "days_to_expiry")),
    createdAt: str(pick(row, "createdAt", "created_at")),
    updatedAt: str(pick(row, "updatedAt", "updated_at")),
  };
}

function normalizeCoverage(raw: unknown): ReplayCoverage {
  const row = asRecord(raw);
  return {
    frames: num(row.frames),
    first: nullableStr(pick(row, "first", "first_t")),
    last: nullableStr(pick(row, "last", "last_t")),
    gaps: num(row.gaps),
  };
}

function normalizeFrame(raw: unknown): ReplayFrame {
  const row = asRecord(raw);
  const marksRaw = asRecord(pick(row, "marks", "premiums"));
  const marks: Record<string, number> = {};
  for (const key of Object.keys(marksRaw)) marks[key] = num(marksRaw[key]);
  const activeRaw = asRecord(pick(row, "active", "activeLegs"));
  const active: Record<string, boolean> = {};
  for (const key of Object.keys(activeRaw)) active[key] = bool(activeRaw[key]);
  return {
    t: str(pick(row, "t", "time", "ts")),
    spot: num(row.spot),
    marks,
    active,
    priced: bool(pick(row, "priced", "isPriced"), true),
    grossPnl: num(pick(row, "grossPnl", "gross_pnl")),
    netPnl: num(pick(row, "netPnl", "net_pnl")),
    netDebit: num(pick(row, "netDebit", "net_debit")),
    equity: num(pick(row, "equity", "pnl")),
  };
}

export function normalizeOptionReplayResult(raw: unknown): OptionReplayResult {
  const row = asRecord(raw);
  const payoff = asRecord(row.payoff);
  const summary = asRecord(row.summary);
  return {
    positionId: nullableStr(pick(row, "positionId", "position_id")) === null
      ? null
      : num(pick(row, "positionId", "position_id")),
    underlying: str(pick(row, "underlying", "symbol")),
    expiry: str(row.expiry).slice(0, 10),
    source: source(pick(row, "source")),
    frames: arr(pick(row, "frames", "timeline")).map(normalizeFrame),
    legs: arr(row.legs).map((entry) => {
      const leg = asRecord(entry);
      return {
        action: action(pick(leg, "action", "side")),
        opt: opt(pick(leg, "opt", "optType", "opt_type")),
        strike: num(pick(leg, "strike")),
        lots: num(leg.lots),
        qty: num(pick(leg, "qty", "quantity")),
        entryPremium: num(pick(leg, "entryPremium", "entry_premium")),
      };
    }),
    netDebit: num(pick(row, "netDebit", "net_debit")),
    summary: {
      realized: num(pick(summary, "realized")),
      unrealized: num(pick(summary, "unrealized")),
      total: num(pick(summary, "total")),
      maxDrawdown: num(pick(summary, "maxDrawdown", "max_drawdown")),
      costs: num(pick(summary, "costs", "costTotal", "cost_total")),
    },
    coverage: normalizeCoverage(row.coverage),
    payoff: {
      spots: numArr(pick(payoff, "spots", "strikes")),
      expiry: numArr(pick(payoff, "expiry", "pnl", "values")),
    },
    breakevens: numArr(pick(row, "breakevens", "breakeven")),
    maxProfit: num(pick(row, "maxProfit", "max_profit")),
    maxLoss: num(pick(row, "maxLoss", "max_loss")),
    skipped: nullableStr(row.skipped),
  };
}

export function normalizeOptionPaperOrderResult(raw: unknown): OptionPaperOrderResult {
  const row = asRecord(raw);
  const wrappedPosition = pick(row, "position", "order");
  const wrappedReplay = pick(row, "replay", "preview");
  const looksLikePosition =
    pick(row, "id", "positionId", "position_id", "underlying", "legs", "options") !== undefined;
  const directPosition = wrappedPosition ??
    (wrappedReplay === undefined && looksLikePosition ? row : undefined);
  return {
    dryRun: bool(pick(row, "dryRun", "dry_run")),
    position: directPosition == null ? null : normalizeOptionPaperPosition(directPosition),
    replay: wrappedReplay == null ? null : normalizeOptionReplayResult(wrappedReplay),
  };
}

function normalizeReplaySession(raw: unknown): ReplaySession {
  const row = asRecord(raw);
  return {
    underlying: str(pick(row, "underlying", "symbol")),
    expiry: str(row.expiry).slice(0, 10),
    date: str(pick(row, "date", "session_date")),
    source: (() => {
      const value = str(pick(row, "source", "provider"));
      return value === "snapshot" || value === "chain10s" || value === "upstox"
        ? value
        : "snapshot";
    })(),
    frames: num(pick(row, "frames", "count")),
  };
}

function normalizeChainSnapshot(raw: unknown): ChainSnapshot {
  const row = asRecord(raw);
  const legs: ChainSnapshotLeg[] = arr(pick(row, "legs", "rows", "strikes")).map((entry) => {
    if (Array.isArray(entry)) {
      return {
        strike: num(entry[0]),
        ceLtp: num(entry[1]),
        peLtp: num(entry[4]),
        ceOi: num(entry[2]),
        peOi: num(entry[5]),
      };
    }
    const leg = asRecord(entry);
    return {
      strike: num(pick(leg, "strike", "strikePrice", "strike_price")),
      ceLtp: num(pick(leg, "ceLtp", "ce_ltp", "ceLtp")),
      peLtp: num(pick(leg, "peLtp", "pe_ltp")),
      ceOi: num(pick(leg, "ceOi", "ce_oi")),
      peOi: num(pick(leg, "peOi", "pe_oi")),
    };
  });
  return {
    t: str(pick(row, "t", "time", "ts")),
    spot: num(pick(row, "spot", "underlyingSpotPrice")),
    expiry: str(row.expiry).slice(0, 10),
    legs,
    source: str(pick(row, "source", "provider")),
    gaps: num(row.gaps),
  };
}

async function bodySlice(response: Response, limit = 200): Promise<string> {
  const text = await response.text().catch(() => "");
  const trimmed = text.trim();
  return trimmed.length > limit ? `${trimmed.slice(0, limit)}…` : trimmed;
}

async function throwHttpError(response: Response, label: string): Promise<never> {
  const slice = await bodySlice(response);
  throw new Error(`${label} (HTTP ${response.status})${slice ? `: ${slice}` : ""}`);
}

async function jsonBody(response: Response, label: string): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new Error(`${label}: the server returned an unreadable response`);
  }
}

async function post<T>(
  path: string,
  body: unknown,
  label: string,
  normalize: (payload: unknown) => T,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetchWithAuth(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) await throwHttpError(response, label);
  return normalize(await jsonBody(response, label));
}

async function get<T>(
  path: string,
  label: string,
  normalize: (payload: unknown) => T,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetchWithAuth(`${BASE}${path}`, { signal });
  if (!response.ok) await throwHttpError(response, label);
  return normalize(await jsonBody(response, label));
}

function normalizePositionList(payload: unknown): OptionPaperPosition[] {
  const row = asRecord(payload);
  const source = Array.isArray(payload) ? payload : pick(row, "positions", "items", "results");
  return arr(source).map(normalizeOptionPaperPosition);
}

function normalizeSessionList(payload: unknown): ReplaySession[] {
  const row = asRecord(payload);
  const source = Array.isArray(payload) ? payload : pick(row, "sessions", "items", "results");
  return arr(source).map(normalizeReplaySession);
}

export async function placeOptionPaperOrder(
  req: OptionPaperOrderRequest,
  signal?: AbortSignal,
): Promise<OptionPaperOrderResult> {
  return post("/orders", req, "Failed to place paper order", normalizeOptionPaperOrderResult, signal);
}

export async function previewOptionPaperOrder(
  req: OptionPaperOrderRequest,
  signal?: AbortSignal,
): Promise<OptionReplayResult> {
  const result = await placeOptionPaperOrder({ ...req, dryRun: true }, signal);
  if (!result.replay || result.replay.frames.length === 0) {
    throw new Error("The paper order preview returned no replay frames");
  }
  return result.replay;
}

export async function fetchOptionPaperPositions(
  filterStatus?: OptionPaperStatus | "all",
  signal?: AbortSignal,
): Promise<OptionPaperPosition[]> {
  const query = filterStatus && filterStatus !== "all" ? `?status=${filterStatus}` : "";
  return get(`/positions${query}`, "Failed to fetch option positions", normalizePositionList, signal);
}

export async function fetchOptionPaperPosition(
  positionId: number,
  signal?: AbortSignal,
): Promise<OptionPaperPosition> {
  return get(`/positions/${positionId}`, "Failed to fetch option position", normalizeOptionPaperPosition, signal);
}

export async function addOptionPaperLeg(
  positionId: number,
  leg: {
    action: "BUY" | "SELL";
    opt: "CE" | "PE";
    strike: number | string;
    lots: number;
    instrumentKey?: string;
    entryTs?: string;
  },
  signal?: AbortSignal,
): Promise<OptionPaperPosition> {
  return post(
    `/positions/${positionId}/legs`,
    leg,
    "Failed to add option leg",
    normalizeOptionPaperPosition,
    signal,
  );
}

export async function closeOptionPaperPosition(
  positionId: number,
  premiums?: Record<string, number>,
  signal?: AbortSignal,
): Promise<OptionPaperPosition> {
  return post(
    `/positions/${positionId}/close`,
    { premiums: premiums ?? {} },
    "Failed to close option position",
    normalizeOptionPaperPosition,
    signal,
  );
}

export async function fetchReplaySessions(signal?: AbortSignal): Promise<ReplaySession[]> {
  return get("/replay/sessions", "Failed to fetch replay sessions", normalizeSessionList, signal);
}

export async function fetchReplayFrames(
  positionId: number,
  signal?: AbortSignal,
): Promise<OptionReplayResult> {
  return get(`/replay/${positionId}`, "Failed to fetch replay frames", normalizeOptionReplayResult, signal);
}

export async function fetchChainAt(
  underlying: string,
  date: string,
  time: string,
  signal?: AbortSignal,
): Promise<ChainSnapshot> {
  const query = new URLSearchParams({ underlying, date, time });
  return get(`/chain-at?${query.toString()}`, "Failed to fetch chain snapshot", normalizeChainSnapshot, signal);
}
