/**
 * Multi-expiry options analytics client (`GET /api/options/analytics/{symbol}`).
 *
 * The transport is shared with the chain client: one `requestJson` call, the
 * same typed `OptionDockError` kinds and the same single 250 ms retry. What is
 * different is the tolerance for missing data — a smile point with no greek is
 * still a point, but its iv/delta are `null`, never `0`. A fabricated `0` would
 * read as a real 0-vol wing and silently corrupt every downstream fit.
 *
 * The wire contract is camelCase (`api/options_analytics.py`): each expiry owns
 * an `iv` grid of CE/PE legs plus a `metrics` block, and levels are rich
 * objects whose `.strike` is the number the DTO exposes. The older snake_case
 * fixture shape (`points`, `atm_iv`, bare numeric levels) is still accepted so
 * existing tests and cached payloads keep working.
 *
 * An aborted request resolves `null`; switching tabs is not an error.
 */

import { ANALYTICS_DEFAULT_EXPIRIES, ANALYTICS_MAX_EXPIRIES } from "../config/optionsAnalytics";
import { API_BASE } from "./config";
import { requestJson } from "./optionsDock";
import { finiteNumber, finiteText } from "./wireParse";

export { OptionDockError, type DockErrorKind } from "./optionsDock";

const ANALYTICS_BASE = `${API_BASE}/api/options`;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface AnalyticsIvPoint {
  strike: number;
  moneyness: number | null;
  iv: number | null;
  delta: number | null;
  oi: number | null;
}

export interface AnalyticsExpiry {
  date: string;
  dte: number | null;
  atmIv: number | null;
  rr25: number | null;
  bf25: number | null;
  slope: number | null;
  fitR2: number | null;
  /** Number of usable smile points behind the backend fit. */
  n?: number | null;
  points: AnalyticsIvPoint[];
}

export interface AnalyticsTermPoint {
  dte: number | null;
  atmIv: number | null;
  rr25: number | null;
  bf25: number | null;
}

export interface AnalyticsSurface {
  strikes: number[];
  expiries: string[];
  /** Nullable cells: a missing intersection is `null`, never `0`. */
  iv: Array<Array<number | null>>;
  missing: boolean[][];
}

/** A backend level object: the DTO keeps `.strike`, this keeps the rest. */
export interface AnalyticsLevelDetail {
  strike: number | null;
  side: string | null;
  strength: number | null;
}

export interface AnalyticsLevels {
  callWall: number | null;
  putWall: number | null;
  maxPain: number | null;
  gex: {
    support: number | null;
    resistance: number | null;
    fuelUp: number | null;
    fuelDown: number | null;
  };
  /** Side/strength carried on the backend's rich level objects. */
  details?: {
    callWall?: AnalyticsLevelDetail | null;
    putWall?: AnalyticsLevelDetail | null;
    maxPain?: AnalyticsLevelDetail | null;
    gex?: {
      support?: AnalyticsLevelDetail | null;
      resistance?: AnalyticsLevelDetail | null;
      fuelUp?: AnalyticsLevelDetail | null;
      fuelDown?: AnalyticsLevelDetail | null;
    } | null;
  };
}

export interface AnalyticsDensityPoint {
  spot: number | null;
  prob: number | null;
}

export interface AnalyticsQuantiles {
  p05: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p95: number | null;
}

export interface AnalyticsConePoint extends AnalyticsQuantiles {
  dte: number | null;
}

export interface AnalyticsProbability {
  model: string | null;
  flatPop: number | null;
  skewPop: number | null;
  expectedPnl: number | null;
  sigma: number | null;
  density: AnalyticsDensityPoint[];
  quantiles: AnalyticsQuantiles;
  cone: AnalyticsConePoint[];
}

export interface AnalyticsWarning {
  code: string | null;
  message: string;
}

export interface OptionsAnalytics {
  symbol: string;
  spot: number | null;
  asOf: string | null;
  quotesLive: boolean;
  /** Upstream session metadata; absent on the legacy fixture shape. */
  marketState?: string | null;
  sessionDate?: string | null;
  expiries: AnalyticsExpiry[];
  term: AnalyticsTermPoint[];
  surface: AnalyticsSurface;
  levels: AnalyticsLevels;
  probability: AnalyticsProbability;
  warnings: AnalyticsWarning[];
}

/* ------------------------------------------------------------------ */
/* Raw upstream shapes                                                  */
/* ------------------------------------------------------------------ */

/** Both a backend CE/PE row and a legacy single IV point land here. */
interface RawIvRow {
  strike?: unknown;
  ceIv?: unknown;
  peIv?: unknown;
  ceDelta?: unknown;
  peDelta?: unknown;
  ceOi?: unknown;
  peOi?: unknown;
  moneyness?: unknown;
  iv?: unknown;
  delta?: unknown;
  oi?: unknown;
}

interface RawMetrics {
  rr25?: unknown;
  fly25?: unknown;
  slope?: unknown;
  r2?: unknown;
  n?: unknown;
}

interface RawExpiry {
  date?: unknown;
  dteDays?: unknown;
  dte?: unknown;
  spot?: unknown;
  atmIv?: unknown;
  atm_iv?: unknown;
  metrics?: RawMetrics | null;
  rr25?: unknown;
  bf25?: unknown;
  slope?: unknown;
  fit_r2?: unknown;
  iv?: unknown;
  points?: unknown;
  levels?: RawLevels | null;
}

interface RawTermPoint {
  dte?: unknown;
  atmIv?: unknown;
  atm_iv?: unknown;
  rr25?: unknown;
  bf25?: unknown;
}

interface RawSurface {
  strikes?: unknown;
  expiries?: unknown;
  iv?: unknown;
  missing?: unknown;
}

interface RawLevels {
  callWall?: unknown;
  putWall?: unknown;
  maxPain?: unknown;
  call_wall?: unknown;
  put_wall?: unknown;
  max_pain?: unknown;
  gex?: {
    support?: unknown;
    resistance?: unknown;
    fuelUp?: unknown;
    fuelDown?: unknown;
    fuel_up?: unknown;
    fuel_down?: unknown;
  } | null;
}

interface RawQuantiles {
  p05?: unknown;
  p25?: unknown;
  p50?: unknown;
  p75?: unknown;
  p95?: unknown;
}

interface RawProbability {
  model?: unknown;
  flat_pop?: unknown;
  skew_pop?: unknown;
  expected_pnl?: unknown;
  sigma?: unknown;
  density?: unknown;
  quantiles?: RawQuantiles | null;
  cone?: unknown;
}

interface RawAnalyticsResponse {
  underlying?: unknown;
  symbol?: unknown;
  spot?: unknown;
  asOf?: unknown;
  as_of?: unknown;
  quotesLive?: unknown;
  quotes_live?: unknown;
  marketState?: unknown;
  market_state?: unknown;
  sessionDate?: unknown;
  session_date?: unknown;
  expiries?: unknown;
  term?: unknown;
  surface?: RawSurface | null;
  levels?: RawLevels | null;
  probability?: RawProbability | null;
  warnings?: unknown;
}

/** Backend warning codes arrive as bare strings; give them a readable line. */
const WARNING_MESSAGES: Record<string, string> = {
  quotes_not_live: "Quotes are not live — values may be stale",
  iv_coverage_below_60pct: "IV coverage below 60% — smile metrics degraded",
  gex_degraded: "GEX levels degraded — greeks unavailable",
  thin_chain: "Thin chain — few strikes or low open interest",
  missing_greeks: "Some legs are missing greeks",
};

type IvSide = "CE" | "PE";

/** First non-null/undefined value; `false` and `0` are real values. */
function first(...values: unknown[]): unknown {
  for (const value of values) {
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function finiteArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const out: number[] = [];
  for (const item of value) {
    const parsed = finiteNumber(item);
    if (parsed != null) out.push(parsed);
  }
  return out;
}

function dateArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && DATE_RE.test(item));
}

function logMoneyness(strike: number, spot: number | null): number | null {
  if (spot == null || !(spot > 0) || !(strike > 0)) return null;
  const value = Math.log(strike / spot);
  return Number.isFinite(value) ? value : null;
}

/**
 * A legacy point or one side of a backend `iv` row. For a CE/PE side the
 * iv/delta/oi come from that leg only; `null` greeks stay `null`.
 */
function normalizeIvPoint(
  raw: unknown,
  spot: number | null,
  side: IvSide | null = null,
): AnalyticsIvPoint | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as RawIvRow;
  const strike = finiteNumber(row.strike);
  if (strike == null || !(strike > 0)) return null;

  if (side) {
    const call = side === "CE";
    return {
      strike,
      moneyness: logMoneyness(strike, spot),
      iv: finiteNumber(call ? row.ceIv : row.peIv),
      delta: finiteNumber(call ? row.ceDelta : row.peDelta),
      oi: finiteNumber(call ? row.ceOi : row.peOi),
    };
  }

  return {
    strike,
    moneyness: finiteNumber(row.moneyness),
    iv: finiteNumber(row.iv),
    delta: finiteNumber(row.delta),
    oi: finiteNumber(row.oi),
  };
}

/** Backend `iv` rows expand to two points; legacy `points` stay one each. */
function normalizeIvRows(raw: unknown, spot: number | null): AnalyticsIvPoint[] {
  if (!Array.isArray(raw)) return [];
  const points: AnalyticsIvPoint[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const candidate = row as RawIvRow;
    const backendRow =
      "ceIv" in candidate || "peIv" in candidate ||
      "ceDelta" in candidate || "peDelta" in candidate ||
      "ceOi" in candidate || "peOi" in candidate;
    if (backendRow) {
      const ce = normalizeIvPoint(row, spot, "CE");
      const pe = normalizeIvPoint(row, spot, "PE");
      if (ce) points.push(ce);
      if (pe) points.push(pe);
    } else {
      const point = normalizeIvPoint(row, spot);
      if (point) points.push(point);
    }
  }
  return points.sort((a, b) => a.strike - b.strike);
}

function normalizeExpiry(raw: unknown, topSpot: number | null): AnalyticsExpiry | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as RawExpiry;
  const date = typeof row.date === "string" && DATE_RE.test(row.date) ? row.date : null;
  if (!date) return null;

  const metrics = row.metrics ?? {};
  const spot = finiteNumber(row.spot) ?? topSpot;
  const rows = [
    ...(Array.isArray(row.iv) ? row.iv : []),
    ...(Array.isArray(row.points) ? row.points : []),
  ];
  const points = normalizeIvRows(rows, spot);

  return {
    date,
    dte: finiteNumber(first(row.dteDays, row.dte)),
    atmIv: finiteNumber(first(row.atmIv, row.atm_iv)),
    rr25: finiteNumber(first(metrics.rr25, row.rr25)),
    bf25: finiteNumber(first(metrics.fly25, row.bf25)),
    slope: finiteNumber(first(metrics.slope, row.slope)),
    fitR2: finiteNumber(first(metrics.r2, row.fit_r2)),
    n: finiteNumber(metrics.n),
    points,
  };
}

function normalizeTermPoint(raw: unknown): AnalyticsTermPoint | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as RawTermPoint;
  return {
    dte: finiteNumber(row.dte),
    atmIv: finiteNumber(first(row.atmIv, row.atm_iv)),
    rr25: finiteNumber(row.rr25),
    bf25: finiteNumber(row.bf25),
  };
}

function normalizeSurface(raw: RawSurface | null | undefined): AnalyticsSurface {
  const source = raw ?? {};
  const strikes = finiteArray(source.strikes);
  const expiries = dateArray(source.expiries);
  const matrix = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
  const ivRows = matrix(source.iv);
  const missingRows = matrix(source.missing);
  return {
    strikes,
    expiries,
    iv: ivRows.map((row) => matrix(row).map(finiteNumber)),
    missing: missingRows.map((row) => matrix(row).map(Boolean)),
  };
}

function levelDetail(raw: unknown): AnalyticsLevelDetail | null {
  if (raw == null) return null;
  const obj =
    typeof raw === "object"
      ? (raw as { strike?: unknown; side?: unknown; strength?: unknown })
      : null;
  return {
    strike: obj ? finiteNumber(obj.strike) : finiteNumber(raw),
    side: obj && typeof obj.side === "string" ? obj.side : null,
    strength: obj ? finiteNumber(obj.strength) : null,
  };
}

function normalizeGex(raw: RawLevels["gex"]): AnalyticsLevels["gex"] {
  return {
    support: levelDetail(first(raw?.support))?.strike ?? null,
    resistance: levelDetail(first(raw?.resistance))?.strike ?? null,
    fuelUp: levelDetail(first(raw?.fuelUp, raw?.fuel_up))?.strike ?? null,
    fuelDown: levelDetail(first(raw?.fuelDown, raw?.fuel_down))?.strike ?? null,
  };
}

function normalizeLevels(raw: RawLevels | null | undefined): AnalyticsLevels {
  const detail = (camel: unknown, snake: unknown): AnalyticsLevelDetail | null =>
    levelDetail(first(camel, snake));
  const gex = raw?.gex ?? null;
  return {
    callWall: detail(raw?.callWall, raw?.call_wall)?.strike ?? null,
    putWall: detail(raw?.putWall, raw?.put_wall)?.strike ?? null,
    maxPain: detail(raw?.maxPain, raw?.max_pain)?.strike ?? null,
    gex: normalizeGex(gex),
    details: {
      callWall: detail(raw?.callWall, raw?.call_wall),
      putWall: detail(raw?.putWall, raw?.put_wall),
      maxPain: detail(raw?.maxPain, raw?.max_pain),
      gex: {
        support: levelDetail(first(gex?.support)),
        resistance: levelDetail(first(gex?.resistance)),
        fuelUp: levelDetail(first(gex?.fuelUp, gex?.fuel_up)),
        fuelDown: levelDetail(first(gex?.fuelDown, gex?.fuel_down)),
      },
    },
  };
}

function quantileValue(raw: RawQuantiles | null | undefined, key: keyof AnalyticsQuantiles): number | null {
  return finiteNumber(raw?.[key]);
}

function normalizeQuantiles(raw: RawQuantiles | null | undefined): AnalyticsQuantiles {
  return {
    p05: quantileValue(raw, "p05"),
    p25: quantileValue(raw, "p25"),
    p50: quantileValue(raw, "p50"),
    p75: quantileValue(raw, "p75"),
    p95: quantileValue(raw, "p95"),
  };
}

function normalizeDensityPoint(raw: unknown): AnalyticsDensityPoint | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as { spot?: unknown; prob?: unknown };
  return { spot: finiteNumber(row.spot), prob: finiteNumber(row.prob) };
}

function normalizeConePoint(raw: unknown): AnalyticsConePoint | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as RawQuantiles & { dte?: unknown };
  return { dte: finiteNumber(row.dte), ...normalizeQuantiles(row) };
}

function normalizeProbability(raw: RawProbability | null | undefined): AnalyticsProbability {
  const source = raw ?? {};
  return {
    model: finiteText(source.model),
    flatPop: finiteNumber(source.flat_pop),
    skewPop: finiteNumber(source.skew_pop),
    expectedPnl: finiteNumber(source.expected_pnl),
    sigma: finiteNumber(source.sigma),
    density: (Array.isArray(source.density) ? source.density : [])
      .map(normalizeDensityPoint)
      .filter((point): point is AnalyticsDensityPoint => point !== null),
    quantiles: normalizeQuantiles(source.quantiles ?? null),
    cone: (Array.isArray(source.cone) ? source.cone : [])
      .map(normalizeConePoint)
      .filter((point): point is AnalyticsConePoint => point !== null),
  };
}

function normalizeWarning(raw: unknown): AnalyticsWarning | null {
  if (typeof raw === "string") {
    const token = raw.trim();
    if (!token) return null;
    return {
      code: token in WARNING_MESSAGES ? token : null,
      message: WARNING_MESSAGES[token] ?? token,
    };
  }
  if (!raw || typeof raw !== "object") return null;
  const row = raw as { code?: unknown; message?: unknown; detail?: unknown };
  const body = finiteText(row.message) ?? finiteText(row.detail) ?? "";
  if (!body) return null;
  return { code: finiteText(row.code), message: body };
}

/** CamelCase (wire) and snake_case (fixtures) → camelCase DTO; numerics stay null. */
export function normalizeAnalytics(raw: RawAnalyticsResponse | null | undefined): OptionsAnalytics {
  const source = raw ?? {};
  const spot = finiteNumber(source.spot);
  const rawExpiries = Array.isArray(source.expiries) ? source.expiries : [];
  const expiries = rawExpiries
    .map((expiry) => normalizeExpiry(expiry, spot))
    .filter((expiry): expiry is AnalyticsExpiry => expiry !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  // The backend carries levels on each expiry, not at the top level. The front
  // expiry's chain is the one the walls card describes.
  const firstExpiry = rawExpiries.length > 0 ? (rawExpiries[0] as RawExpiry | null) : null;
  const rawLevels = first(source.levels, firstExpiry?.levels);

  const term = (Array.isArray(source.term) ? source.term : [])
    .map(normalizeTermPoint)
    .filter((point): point is AnalyticsTermPoint => point !== null);
  const warnings = (Array.isArray(source.warnings) ? source.warnings : [])
    .map(normalizeWarning)
    .filter((warning): warning is AnalyticsWarning => warning !== null);

  return {
    symbol: String(first(source.symbol, source.underlying) ?? "").trim().toUpperCase(),
    spot,
    asOf: finiteText(first(source.asOf, source.as_of)),
    quotesLive: first(source.quotesLive, source.quotes_live) === true,
    marketState: finiteText(first(source.marketState, source.market_state)),
    sessionDate: finiteText(first(source.sessionDate, source.session_date)),
    expiries,
    term,
    surface: normalizeSurface(source.surface ?? null),
    levels: normalizeLevels(rawLevels as RawLevels | null | undefined),
    probability: normalizeProbability(source.probability ?? null),
    warnings,
  };
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return (
    value != null &&
    typeof value === "object" &&
    "aborted" in value &&
    "addEventListener" in value
  );
}

/**
 * `fetchAnalytics(symbol, signal)` stays valid for the store; callers that want
 * a specific ladder pass `fetchAnalytics(symbol, expiries, signal)`.
 */
export async function fetchAnalytics(
  symbol: string,
  expiriesOrSignal?: number | AbortSignal,
  signalArg?: AbortSignal,
): Promise<OptionsAnalytics | null> {
  const upper = String(symbol ?? "").trim().toUpperCase();
  if (!upper) return null;

  let expiries = ANALYTICS_DEFAULT_EXPIRIES;
  let signal: AbortSignal | undefined;
  if (isAbortSignal(expiriesOrSignal)) {
    signal = expiriesOrSignal;
  } else if (typeof expiriesOrSignal === "number") {
    expiries = expiriesOrSignal;
    signal = signalArg;
  } else {
    signal = signalArg;
  }
  const count = Number.isInteger(expiries) && expiries >= 1 && expiries <= ANALYTICS_MAX_EXPIRIES
    ? expiries
    : ANALYTICS_DEFAULT_EXPIRIES;

  const body = await requestJson<RawAnalyticsResponse>(
    `${ANALYTICS_BASE}/analytics/${encodeURIComponent(upper)}?expiries=${count}`,
    signal,
    "Could not load the options analytics",
  );
  if (!body || signal?.aborted) return null;
  return normalizeAnalytics(body);
}
