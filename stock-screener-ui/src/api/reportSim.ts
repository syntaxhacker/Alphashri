/**
 * Index Report strategy simulator API client.
 *
 * The backend owns the simulation (same no-lookahead rules as the paper
 * options engine), so this module only ships the request and normalizes the
 * result. The engine is written in Python and speaks snake_case; the UI types
 * are camelCase, so every payload passes through the normalizers below. A
 * partial payload must still render — missing arrays become `[]`, missing
 * numbers become `0` — never throw.
 */

import { fetchWithAuth } from "../state/auth";
import type {
  SimAction,
  SimCombinedResult,
  SimCoverage,
  SimExecSpec,
  SimLegSpec,
  SimOpenLeg,
  SimOpenPosition,
  SimOpt,
  SimPayoff,
  SimResolvedLeg,
  SimRunRequest,
  SimRunResult,
  SimStats,
  SimStrategyResult,
  SimTemplate,
  SimTrade,
} from "../types/reportSim";

import { API_BASE } from "./config";

const SIM_API_BASE = `${API_BASE}/api/reports/sim`;

type Raw = Record<string, unknown>;

function asRecord(value: unknown): Raw {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Raw)
    : {};
}

/** First present key wins; `null`/`undefined` are skipped so aliases still work. */
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
  if (typeof value === "number") {
    return Number.isFinite(value) ? value !== 0 : fallback;
  }
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "true" || v === "1" || v === "yes") return true;
    if (v === "false" || v === "0" || v === "no") return false;
  }
  return fallback;
}

function str(value: unknown, fallback = ""): string {
  if (value === null || value === undefined) return fallback;
  return typeof value === "string" ? value : String(value);
}

function nullableStr(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = typeof value === "string" ? value : String(value);
  return s.trim() === "" ? null : s;
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numArr(value: unknown): number[] {
  return arr(value).map((v) => num(v));
}

function action(value: unknown): SimAction {
  return String(value ?? "").toUpperCase() === "SELL" ? "SELL" : "BUY";
}

function opt(value: unknown): SimOpt {
  return String(value ?? "").toUpperCase() === "PE" ? "PE" : "CE";
}

function normalizeExec(raw: unknown): SimExecSpec {
  const r = asRecord(raw);
  return {
    entryTime: str(pick(r, "entryTime", "entry_time")),
    slPct: num(pick(r, "slPct", "sl_pct")),
    tpPct: num(pick(r, "tpPct", "tp_pct")),
    maxHoldMin: num(pick(r, "maxHoldMin", "max_hold_min")),
    trailPct: num(pick(r, "trailPct", "trail_pct")),
    eodExit: str(pick(r, "eodExit", "eod_exit")),
  };
}

function normalizeLegSpec(raw: unknown): SimLegSpec {
  const r = asRecord(raw);
  return {
    action: action(pick(r, "action", "side")),
    opt: opt(pick(r, "opt", "option", "leg")),
    strike: str(pick(r, "strike", "strikeRef", "strike_ref")),
    lots: num(r.lots),
  };
}

function normalizeResolvedLeg(raw: unknown): SimResolvedLeg {
  const r = asRecord(raw);
  return {
    action: action(pick(r, "action", "side")),
    opt: opt(pick(r, "opt", "option", "leg")),
    strike: num(r.strike),
    lots: num(r.lots),
    qty: num(pick(r, "qty", "quantity")),
    entryPremium: num(pick(r, "entryPremium", "entry_premium", "premium")),
  };
}

function normalizeOpenLeg(raw: unknown): SimOpenLeg {
  const r = asRecord(raw);
  return {
    action: action(pick(r, "action", "side")),
    opt: opt(pick(r, "opt", "option", "leg")),
    strike: num(r.strike),
    lots: num(r.lots),
    qty: num(pick(r, "qty", "quantity")),
    entryPremium: num(pick(r, "entryPremium", "entry_premium", "premium")),
    mark: num(pick(r, "mark", "markPremium", "mark_premium", "ltp")),
    pnl: num(pick(r, "pnl", "netPnl", "net_pnl")),
  };
}

function normalizeTrade(raw: unknown): SimTrade {
  const r = asRecord(raw);
  return {
    id: str(r.id),
    strategyId: str(pick(r, "strategyId", "strategy_id")),
    strategyName: str(pick(r, "strategyName", "strategy_name")),
    legs: arr(r.legs).map(normalizeResolvedLeg),
    entryTime: str(pick(r, "entryTime", "entry_time")),
    exitTime: str(pick(r, "exitTime", "exit_time")),
    entrySpot: num(pick(r, "entrySpot", "entry_spot")),
    exitSpot: num(pick(r, "exitSpot", "exit_spot")),
    entryPremium: num(pick(r, "entryPremium", "entry_premium")),
    exitPremium: num(pick(r, "exitPremium", "exit_premium")),
    lots: num(r.lots),
    qty: num(r.qty),
    grossPnl: num(pick(r, "grossPnl", "gross_pnl")),
    costs: num(r.costs),
    netPnl: num(pick(r, "netPnl", "net_pnl")),
    points: num(r.points),
    exitReason: str(pick(r, "exitReason", "exit_reason", "reason")),
    holdMin: num(pick(r, "holdMin", "hold_min")),
    // A booked trade is priced unless the engine explicitly says otherwise.
    priced: bool(r.priced, true),
  };
}

function normalizeOpenPosition(raw: unknown): SimOpenPosition {
  const r = asRecord(raw);
  return {
    strategyId: str(pick(r, "strategyId", "strategy_id")),
    strategyName: str(pick(r, "strategyName", "strategy_name")),
    legs: arr(r.legs).map(normalizeOpenLeg),
    entryTime: str(pick(r, "entryTime", "entry_time")),
    entrySpot: num(pick(r, "entrySpot", "entry_spot")),
    markTime: str(pick(r, "markTime", "mark_time")),
    markSpot: num(pick(r, "markSpot", "mark_spot")),
    entryPremium: num(pick(r, "entryPremium", "entry_premium")),
    markPremium: num(pick(r, "markPremium", "mark_premium")),
    grossPnl: num(pick(r, "grossPnl", "gross_pnl")),
    netPnl: num(pick(r, "netPnl", "net_pnl")),
    points: num(r.points),
    priced: bool(r.priced, true),
  };
}

/** Equity points may arrive as `{t, pnl}` objects or `[t, pnl]` tuples. */
function normalizeEquity(raw: unknown): Array<{ t: string; pnl: number }> {
  return arr(raw).map((entry) => {
    if (Array.isArray(entry)) {
      return { t: str(entry[0]), pnl: num(entry[1]) };
    }
    const r = asRecord(entry);
    return { t: str(pick(r, "t", "time")), pnl: num(pick(r, "pnl", "value")) };
  });
}

function normalizePayoff(raw: unknown): SimPayoff {
  const r = asRecord(raw);
  return {
    spots: numArr(pick(r, "spots", "strikes")),
    expiry: numArr(pick(r, "expiry", "pnl", "values")),
  };
}

function normalizeStats(raw: unknown): SimStats {
  const r = asRecord(raw);
  return {
    trades: num(r.trades),
    winRate: num(pick(r, "winRate", "win_rate")),
    profitFactor: num(pick(r, "profitFactor", "profit_factor")),
    avgHoldMin: num(pick(r, "avgHoldMin", "avg_hold_min")),
    maxDrawdown: num(pick(r, "maxDrawdown", "max_drawdown")),
  };
}

function normalizeSkipped(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizeStrategyResult(raw: unknown): SimStrategyResult {
  const r = asRecord(raw);
  return {
    id: str(r.id),
    name: str(r.name),
    legs: arr(r.legs).map(normalizeResolvedLeg),
    netDebit: num(pick(r, "netDebit", "net_debit")),
    maxProfit: num(pick(r, "maxProfit", "max_profit")),
    maxLoss: num(pick(r, "maxLoss", "max_loss")),
    breakevens: numArr(pick(r, "breakevens", "breakeven")),
    marginEst: num(pick(r, "marginEst", "margin_est")),
    trades: arr(r.trades).map(normalizeTrade),
    open: arr(pick(r, "open", "openPositions", "open_positions")).map(
      normalizeOpenPosition,
    ),
    realized: num(r.realized),
    unrealized: num(r.unrealized),
    total: num(r.total),
    stats: normalizeStats(r.stats),
    equity: normalizeEquity(r.equity),
    payoff: normalizePayoff(r.payoff),
    skipped: normalizeSkipped(r.skipped),
  };
}

function normalizeCombined(raw: unknown): SimCombinedResult {
  const r = asRecord(raw);
  return {
    realized: num(r.realized),
    unrealized: num(r.unrealized),
    total: num(r.total),
    equity: normalizeEquity(r.equity),
  };
}

function normalizeCoverage(raw: unknown): SimCoverage {
  const r = asRecord(raw);
  return {
    frames: num(r.frames),
    first: nullableStr(pick(r, "first", "first_t")),
    last: nullableStr(pick(r, "last", "last_t")),
    gaps: num(r.gaps),
  };
}

export function normalizeSimTemplates(payload: unknown): SimTemplate[] {
  const rows = Array.isArray(payload)
    ? payload
    : arr(pick(asRecord(payload), "templates", "strategies"));
  return rows
    .filter((row) => row !== null && typeof row === "object")
    .map((row) => {
      const r = row as Raw;
      return {
        id: str(r.id),
        name: str(r.name),
        blurb: str(r.blurb),
        legs: arr(r.legs).map(normalizeLegSpec),
        exec: normalizeExec(r.exec),
      };
    });
}

export function normalizeSimRunResult(payload: unknown): SimRunResult {
  const r = asRecord(payload);
  return {
    symbol: str(r.symbol),
    date: str(r.date),
    expiry: str(r.expiry),
    dte: num(pick(r, "dte", "daysToExpiry", "days_to_expiry")),
    asOf: nullableStr(pick(r, "asOf", "as_of")),
    spot: num(r.spot),
    lotSize: num(pick(r, "lotSize", "lot_size")),
    lotVerified: bool(pick(r, "lotVerified", "lot_verified")),
    coverage: normalizeCoverage(r.coverage),
    strategies: arr(pick(r, "strategies", "results")).map(normalizeStrategyResult),
    combined: normalizeCombined(r.combined),
    tapeLagSec: num(pick(r, "tapeLagSec", "tape_lag_sec")),
    fillModel: str(pick(r, "fillModel", "fill_model")),
  };
}

/**
 * A FastAPI error body is JSON, but a proxy may answer plain text or HTML.
 * Keep a short slice so the message stays readable in a toast.
 */
async function bodySlice(response: Response, limit = 200): Promise<string> {
  let text = "";
  try {
    text = typeof response.text === "function" ? await response.text() : "";
  } catch {
    text = "";
  }
  if (!text.trim() && typeof response.json === "function") {
    const payload = await response.json().catch(() => null);
    if (payload !== null && payload !== undefined) text = JSON.stringify(payload);
  }
  const trimmed = text.trim();
  if (!trimmed) return "";
  return trimmed.length > limit ? `${trimmed.slice(0, limit)}…` : trimmed;
}

async function throwHttpError(response: Response, label: string): Promise<never> {
  const slice = await bodySlice(response);
  throw new Error(
    `${label} (HTTP ${response.status})${slice ? `: ${slice}` : ""}`,
  );
}

export async function fetchSimStrategies(
  signal?: AbortSignal,
): Promise<SimTemplate[]> {
  const response = await fetchWithAuth(`${SIM_API_BASE}/strategies`, { signal });
  if (!response.ok) await throwHttpError(response, "Failed to fetch sim strategies");
  const payload = await response.json().catch(() => null);
  return normalizeSimTemplates(payload);
}

export async function runSim(
  req: SimRunRequest,
  signal?: AbortSignal,
): Promise<SimRunResult> {
  const response = await fetchWithAuth(`${SIM_API_BASE}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal,
  });
  if (!response.ok) await throwHttpError(response, "Sim run failed");
  const payload = await response.json().catch(() => null);
  return normalizeSimRunResult(payload);
}
