/**
 * Nifty report API client.
 */

import { fetchWithAuth } from "../state/auth";
import { safeNum } from "../utils/reportParsers";
import type {
  NiftyBurst,
  NiftyBurstFuelState,
  NiftyBurstNews,
  NiftyBurstSignal,
  NiftyBurstStructure,
  NiftyControlBlock,
  NiftyControlVerdict,
  NiftyEmaSeries,
  NiftyFlowLeg,
  NiftyFlowWindow,
  NiftyGex,
  NiftyGexLevel,
  NiftyGexLevels,
  NiftyGexStrike,
  NiftyIntradayCandle,
  NiftyMarketBlock,
  NiftyOptionSide,
  NiftyPivots,
  NiftyPivotPrev,
  NiftyPositioningBlock,
  NiftyPositioningLeg,
  NiftyPositioningStrike,
  NiftyPositioningVerdict,
  NiftyReference,
  NiftyRegimeBlock,
  NiftyRegimeVerdict,
  NiftyReplay,
  NiftyReplayFrame,
  NiftyReport,
  NiftySensex,
  NiftyStrike,
  NiftyStrengthBlock,
  NiftyStrengthVerdict,
  NiftyStructureShift,
  NiftyTape,
  NiftyTapeChainTuple,
  NiftyTapeRow,
  NiftyTimelineEvent,
  NiftyVixBlock,
} from "../types/niftyReport";

import { API_BASE } from "./config";

const NIFTY_API_BASE = `${API_BASE}/api/reports/nifty`;

/** Generic option-report namespace: one recorded history per underlying. */
function optionsApiBase(symbol: string): string {
  return `${API_BASE}/api/reports/options/${encodeURIComponent(symbol)}`;
}

function normalizeSide(raw: Record<string, unknown> = {}): NiftyOptionSide {
  return {
    ltp: safeNum(raw.ltp),
    close: safeNum(raw.close ?? raw.close_price),
    oi: safeNum(raw.oi),
    prevOi: safeNum(raw.prevOi ?? raw.prev_oi),
    oiChange: safeNum(raw.oiChange ?? raw.oi_change),
    priceChange: safeNum(raw.priceChange ?? raw.price_change),
    volume: safeNum(raw.volume),
    delta: nullNum(raw.delta),
    gamma: nullNum(raw.gamma),
    theta: nullNum(raw.theta),
    vega: nullNum(raw.vega),
    iv: nullNum(raw.iv),
    sentiment:
      typeof raw.sentiment === "string"
        ? raw.sentiment
        : typeof (raw.sentiment as { label?: unknown } | null)?.label === "string"
          ? String((raw.sentiment as { label: string }).label)
          : "Neutral",
  };
}

function normalizeTimeline(raw: unknown): NiftyTimelineEvent[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Record<string, unknown>[]).map((e) => ({
    time: String(e.time ?? e.fetched_at ?? ""),
    title: String(e.title ?? e.event ?? ""),
    detail: String(e.detail ?? ""),
  }));
}

/** Backend speaks snake_case for GEX; absent block stays undefined so old snapshots render. */
function normalizeGexLevel(raw: unknown): NiftyGexLevel {
  const row = (raw ?? {}) as Record<string, unknown>;
  const sideRaw = String(row.side ?? "").toLowerCase();
  return {
    strike: safeNum(row.strike),
    netGex: safeNum(row.netGex ?? row.net_gex),
    ...(sideRaw === "above" || sideRaw === "below"
      ? { side: sideRaw as "above" | "below" }
      : {}),
  };
}

/** One nullable spot-relative level (`null` when the backend has no strike). */
function nullableGexLevel(raw: unknown): NiftyGexLevel | null {
  if (raw === null || raw === undefined || typeof raw !== "object") return null;
  const level = normalizeGexLevel(raw);
  return Number.isFinite(level.strike) && level.strike > 0 ? level : null;
}

/** `levels` block — absent/empty → undefined so legacy payloads fall back. */
function normalizeGexLevels(raw: unknown): NiftyGexLevels | undefined {
  if (raw === null || raw === undefined || typeof raw !== "object") return undefined;
  const l = raw as Record<string, unknown>;
  const levels: NiftyGexLevels = {
    support: nullableGexLevel(l.support),
    resistance: nullableGexLevel(l.resistance),
    fuelDown: nullableGexLevel(l.fuel_down ?? l.fuelDown),
    fuelUp: nullableGexLevel(l.fuel_up ?? l.fuelUp),
  };
  const present = Object.values(levels).some((v) => v !== null);
  return present ? levels : undefined;
}

function normalizeGex(raw: unknown): NiftyGex | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw !== "object") return undefined;
  const g = raw as Record<string, unknown>;
  // Treat an empty object as absent so legacy payloads keep gex undefined.
  if (Object.keys(g).length === 0) return undefined;
  const regimeRaw = String(g.regime ?? "flat").toLowerCase();
  const regime: NiftyGex["regime"] =
    regimeRaw === "long" ? "long" : regimeRaw === "short" ? "short" : "flat";
  const zeroRaw = g.zeroCross ?? g.zero_cross;
  return {
    strikes: (Array.isArray(g.strikes) ? g.strikes : []).map(
      (s): NiftyGexStrike => {
        const row = (s ?? {}) as Record<string, unknown>;
        return {
          strike: safeNum(row.strike),
          callGex: safeNum(row.callGex ?? row.call_gex),
          putGex: safeNum(row.putGex ?? row.put_gex),
          netGex: safeNum(row.netGex ?? row.net_gex),
        };
      },
    ),
    netTotal: safeNum(g.netTotal ?? g.net_total),
    regime,
    topPositive: (Array.isArray(g.topPositive ?? g.top_positive)
      ? ((g.topPositive ?? g.top_positive) as unknown[])
      : []
    ).map(normalizeGexLevel),
    topNegative: (Array.isArray(g.topNegative ?? g.top_negative)
      ? ((g.topNegative ?? g.top_negative) as unknown[])
      : []
    ).map(normalizeGexLevel),
    levels: normalizeGexLevels(g.levels),
    ...(g.degraded === true ? { degraded: true } : {}),
    zeroCross:
      zeroRaw === null || zeroRaw === undefined || zeroRaw === ""
        ? null
        : (() => {
            const n =
              typeof zeroRaw === "string" ? Number(zeroRaw) : (zeroRaw as number);
            return typeof n === "number" && Number.isFinite(n) ? n : null;
          })(),
  };
}

/** Non-finite / absent numeric field → null so the UI can render a dash. */
function nullNum(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "string" ? Number(value) : (value as number);
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** Treat a block as present only when it is a non-empty object. */
function asBlock(raw: unknown): Record<string, unknown> | undefined {
  if (raw === null || raw === undefined || typeof raw !== "object") return undefined;
  const row = raw as Record<string, unknown>;
  return Object.keys(row).length === 0 ? undefined : row;
}

/** Coerce a raw verdict string to one of `allowed`, else null (→ dash). */
function coerceVerdict(raw: unknown, allowed: readonly string[]): string | null {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return allowed.includes(v) ? v : null;
}

const CONTROL_VERDICTS = [
  "call_writers",
  "put_writers",
  "call_buyers",
  "put_buyers",
  "net_call_build",
  "net_put_build",
  "balanced",
] as const satisfies readonly NiftyControlVerdict[];

const REGIME_VERDICTS = [
  "range_sell_premium",
  "trend_buy",
  "trend",
  "neutral",
] as const satisfies readonly NiftyRegimeVerdict[];

const STRENGTH_VERDICTS = [
  "strong",
  "neutral",
  "weak",
] as const satisfies readonly NiftyStrengthVerdict[];

/** `control` block — absent/empty → undefined, partial → null fields. */
function normalizeControl(raw: unknown): NiftyControlBlock | undefined {
  const c = asBlock(raw);
  if (!c) return undefined;
  return {
    verdict: coerceVerdict(c.verdict, CONTROL_VERDICTS) as NiftyControlVerdict | null,
    flow_bias: nullNum(c.flow_bias ?? c.flowBias),
    ce_doi: nullNum(c.ce_doi ?? c.ceDoi),
    pe_doi: nullNum(c.pe_doi ?? c.peDoi),
    atm_ce_iv: nullNum(c.atm_ce_iv ?? c.atmCeIv),
    atm_pe_iv: nullNum(c.atm_pe_iv ?? c.atmPeIv),
    skew: nullNum(c.skew),
    gex_regime:
      typeof (c.gex_regime ?? c.gexRegime) === "string"
        ? String(c.gex_regime ?? c.gexRegime)
        : null,
  };
}

/** One rolling OI leg (5m/15m) — missing/partial → undefined. */
function normalizeFlowLeg(raw: unknown): NiftyFlowLeg | undefined {
  const r = asBlock(raw);
  if (!r) return undefined;
  return {
    from: String(r.from ?? ""),
    ce: safeNum(r.ce),
    pe: safeNum(r.pe),
    net: safeNum(r.net),
  };
}

/** `flow_window` — the 5m/15m flip read beside the session control block. */
function normalizeFlowWindow(raw: unknown): NiftyFlowWindow | null | undefined {
  const r = asBlock(raw);
  if (!r) return undefined;
  return {
    as_of: String(r.as_of ?? r.asOf ?? ""),
    "5m": normalizeFlowLeg(r["5m"]),
    "15m": normalizeFlowLeg(r["15m"]),
  };
}

/** `regime` block — absent/empty → undefined, partial → null fields. */
function normalizeRegime(raw: unknown): NiftyRegimeBlock | undefined {
  const r = asBlock(raw);
  if (!r) return undefined;
  return {
    verdict: coerceVerdict(r.verdict, REGIME_VERDICTS) as NiftyRegimeVerdict | null,
    range_pts: nullNum(r.range_pts ?? r.rangePts),
    range_baseline_pts: nullNum(r.range_baseline_pts ?? r.rangeBaselinePts),
    range_pct: nullNum(r.range_pct ?? r.rangePct),
    rv: nullNum(r.rv),
    iv: nullNum(r.iv),
    straddle_open: nullNum(r.straddle_open ?? r.straddleOpen),
    straddle_now: nullNum(r.straddle_now ?? r.straddleNow),
    straddle_pct: nullNum(r.straddle_pct ?? r.straddlePct),
    bars: nullNum(r.bars),
    warmup: typeof r.warmup === "boolean" ? r.warmup : null,
  };
}

/** `vix` block — absent/empty → undefined, partial → null fields. */
function normalizeVix(raw: unknown): NiftyVixBlock | undefined {
  const v = asBlock(raw);
  if (!v) return undefined;
  return {
    ltp: nullNum(v.ltp),
    prev_close: nullNum(v.prev_close ?? v.prevClose),
    change_pct: nullNum(v.change_pct ?? v.changePct),
    day_high: nullNum(v.day_high ?? v.dayHigh),
    day_low: nullNum(v.day_low ?? v.dayLow),
  };
}

/** `strength` block — absent/empty → undefined, partial → null fields. */
function normalizeStrength(raw: unknown): NiftyStrengthBlock | undefined {
  const s = asBlock(raw);
  if (!s) return undefined;
  return {
    verdict: coerceVerdict(s.verdict, STRENGTH_VERDICTS) as NiftyStrengthVerdict | null,
    score: nullNum(s.score),
    ema9: nullNum(s.ema9),
    ema20: nullNum(s.ema20),
    ema50: nullNum(s.ema50),
    rsi: nullNum(s.rsi),
    pos_in_range: nullNum(s.pos_in_range ?? s.posInRange),
  };
}

/** `market` block — absent/empty → undefined (unknown → keep polling). */
function normalizeMarket(raw: unknown): NiftyMarketBlock | undefined {
  const m = asBlock(raw);
  if (!m) return undefined;
  const sessionDate = m.session_date ?? m.sessionDate;
  const asOf = m.as_of ?? m.asOf;
  return {
    is_open: typeof m.is_open === "boolean" ? m.is_open : null,
    session_date: typeof sessionDate === "string" ? sessionDate : null,
    as_of: typeof asOf === "string" ? asOf : null,
  };
}

/** `reference` block — absent/empty → null, partial → null fields. */
function normalizeReference(raw: unknown): NiftyReference | null {
  const r = asBlock(raw);
  if (!r) return null;
  return {
    strike: nullNum(r.strike),
    ce_open: nullNum(r.ce_open ?? r.ceOpen),
    pe_open: nullNum(r.pe_open ?? r.peOpen),
    ce_ltp: nullNum(r.ce_ltp ?? r.ceLtp),
    pe_ltp: nullNum(r.pe_ltp ?? r.peLtp),
    ce_change: nullNum(r.ce_change ?? r.ceChange),
    pe_change: nullNum(r.pe_change ?? r.peChange),
    since: typeof r.since === "string" ? r.since : null,
  };
}

const POSITIONING_VERDICTS = [
  "bullish",
  "bearish",
  "balanced",
] as const satisfies readonly NiftyPositioningVerdict[];

/** One leg of a positioning row — `class`/`doi`/`initiated`, snake_case-tolerant. */
function normalizePositioningLeg(raw: unknown): NiftyPositioningLeg {
  const l = (raw ?? {}) as Record<string, unknown>;
  return {
    class: String(l.class ?? l.sentiment ?? "Neutral"),
    doi: safeNum(l.doi ?? l.oi_change ?? l.oiChange),
    initiated: safeNum(l.initiated),
  };
}

/** `positioning` block — absent/empty → undefined, partial → null fields. */
function normalizePositioning(raw: unknown): NiftyPositioningBlock | undefined {
  const p = asBlock(raw);
  if (!p) return undefined;
  const rows = Array.isArray(p.strikes) ? p.strikes : [];
  return {
    verdict: coerceVerdict(
      p.verdict,
      POSITIONING_VERDICTS,
    ) as NiftyPositioningVerdict | null,
    state: nullNum(p.state),
    flow: nullNum(p.flow),
    initiated: nullNum(p.initiated),
    bullCr: nullNum(p.bull_cr ?? p.bullCr),
    bearCr: nullNum(p.bear_cr ?? p.bearCr),
    splitPct: nullNum(p.split_pct ?? p.splitPct),
    ceDoi: nullNum(p.ce_doi ?? p.ceDoi),
    peDoi: nullNum(p.pe_doi ?? p.peDoi),
    lotSize: nullNum(p.lot_size ?? p.lotSize),
    deltaFlip: nullNum(p.delta_flip ?? p.deltaFlip),
    strikes: rows.map((r): NiftyPositioningStrike => {
      const row = (r ?? {}) as Record<string, unknown>;
      return {
        strike: safeNum(row.strike),
        ce: normalizePositioningLeg(row.ce),
        pe: normalizePositioningLeg(row.pe),
        netInitiated: safeNum(row.net_initiated ?? row.netInitiated),
        netState: nullNum(row.net_state ?? row.netState),
      };
    }),
  };
}

/**
 * One structural shift. `kind`/`severity` are kept as raw strings so a newer
 * detector value still surfaces; the UI maps unknown values gracefully.
 * Non-finite numbers become `null`, and an unknown `side` is dropped.
 */
function normalizeStructureShift(raw: unknown): NiftyStructureShift {
  const s = (raw ?? {}) as Record<string, unknown>;
  const sideRaw = String(s.side ?? "").toLowerCase();
  const levelRaw = s.level;
  return {
    t: String(s.t ?? s.time ?? ""),
    kind: String(s.kind ?? ""),
    detail: String(s.detail ?? ""),
    severity: String(s.severity ?? ""),
    magnitude: nullNum(s.magnitude ?? s.mag),
    ...(sideRaw === "call" || sideRaw === "put"
      ? { side: sideRaw as "call" | "put" }
      : {}),
    ...(levelRaw === undefined || levelRaw === null
      ? {}
      : { level: nullNum(levelRaw) }),
  };
}

/**
 * `structure` block — absent/null/non-array → `undefined` (the UI renders
 * nothing), while an explicit empty array stays `[]` so the UI can show its
 * empty state. Newest is last in the payload; the UI reverses for display.
 */
function normalizeStructure(raw: unknown): NiftyStructureShift[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.map(normalizeStructureShift);
}

/** 1-minute intraday candles — absent/non-array → undefined. */
export function normalizeIntraday(raw: unknown): NiftyIntradayCandle[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.map((c) => {
    const row = (c ?? {}) as Record<string, unknown>;
    return {
      time: String(row.time ?? ""),
      open: safeNum(row.open),
      high: safeNum(row.high),
      low: safeNum(row.low),
      close: safeNum(row.close),
    };
  });
}

/** Non-finite EMA point → null so gaps render instead of breaking the line. */
function nullEmaPoint(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "string" ? Number(value) : (value as number);
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** EMA series — absent/non-array → undefined, snake_case-tolerant. */
export function normalizeEmas(raw: unknown): NiftyEmaSeries[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.map((e) => {
    const row = (e ?? {}) as Record<string, unknown>;
    const dataRaw = Array.isArray(row.data) ? row.data : [];
    return {
      period: safeNum(row.period),
      data: dataRaw.map(nullEmaPoint),
    };
  });
}

/**
 * `pivots` block — classic pivots from the previous session's H/L/C.
 * Null-safe: absent → `null`, non-finite levels → `null`, a partial payload
 * keeps the levels it actually carries. Kept as `null` (not undefined) so a
 * backend that explicitly answers `pivots: null` stays `null` — the chart
 * treats both as "nothing to draw".
 */
export function normalizePivots(raw: unknown): NiftyPivots | null {
  if (raw === null || raw === undefined || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const prevRaw = p.prev;
  const prev: NiftyPivotPrev | null =
    prevRaw !== null && prevRaw !== undefined && typeof prevRaw === "object"
      ? (() => {
          const r = prevRaw as Record<string, unknown>;
          return {
            date: typeof r.date === "string" ? r.date : null,
            high: nullNum(r.high),
            low: nullNum(r.low),
            close: nullNum(r.close),
          };
        })()
      : null;
  return {
    type: typeof p.type === "string" ? p.type : "classic",
    pp: nullNum(p.pp),
    r1: nullNum(p.r1),
    r2: nullNum(p.r2),
    r3: nullNum(p.r3),
    s1: nullNum(p.s1),
    s2: nullNum(p.s2),
    s3: nullNum(p.s3),
    prev,
  };
}

/** Backend speaks snake_case; the panel speaks camelCase. Normalize once here. */
export function normalizeReport(raw: Record<string, unknown>): NiftyReport {
  const walls = (raw.walls ?? {}) as Record<string, { strike: number; oi: number }[]>;
  const wallsNear = (raw.walls_near ?? raw.wallsNear ?? {}) as Record<
    string,
    { strike: number; oi: number }[]
  >;
  const ohlc = (raw.ohlc ?? {}) as Record<string, unknown>;
  return {
    mode: raw.mode === "eod" ? "eod" : "live",
    date: String(raw.date ?? ""),
    expiry: String(raw.expiry ?? ""),
    spot: safeNum(raw.spot),
    ohlc: {
      open: safeNum(ohlc.open),
      high: safeNum(ohlc.high),
      low: safeNum(ohlc.low),
      close: safeNum(ohlc.close),
    },
    pcrOi: safeNum(raw.pcrOi ?? raw.pcr_oi),
    pcrVol: safeNum(raw.pcrVol ?? raw.pcr_vol),
    maxPain: safeNum(raw.maxPain ?? raw.max_pain),
    walls: { calls: walls.calls ?? [], puts: walls.puts ?? [] },
    wallsNear: {
      calls: wallsNear.calls ?? walls.calls ?? [],
      puts: wallsNear.puts ?? walls.puts ?? [],
    },
    strikes: (Array.isArray(raw.strikes) ? raw.strikes : []).map(
      (s): NiftyStrike => {
        const row = s as Record<string, Record<string, unknown>>;
        return {
          strike: safeNum((s as Record<string, unknown>).strike),
          ce: normalizeSide(row.ce),
          pe: normalizeSide(row.pe),
        };
      },
    ),
    timeline: normalizeTimeline(raw.timeline),
    candles: Array.isArray(raw.candles)
      ? (raw.candles as NiftyReport["candles"])
      : undefined,
    intraday: normalizeIntraday(raw.intraday),
    emas: normalizeEmas(raw.emas),
    pivots: normalizePivots(raw.pivots),
    fetchedAt: (raw.fetchedAt ?? raw.fetched_at) as string | undefined,
    snapshotAt: (raw.snapshotAt ?? raw.snapshot_at) as string | undefined,
    gex: normalizeGex(raw.gex),
    control: normalizeControl(raw.control),
    flow_window: normalizeFlowWindow(raw.flow_window ?? raw.flowWindow),
    regime: normalizeRegime(raw.regime),
    vix: normalizeVix(raw.vix),
    strength: normalizeStrength(raw.strength),
    market: normalizeMarket(raw.market),
    reference: normalizeReference(raw.reference),
    positioning: normalizePositioning(raw.positioning),
    structure: normalizeStructure(raw.structure),
  };
}

export function normalizeSensex(raw: Record<string, unknown>): NiftySensex {
  const walls = (raw.walls ?? {}) as Record<string, { strike: number; oi: number }[]>;
  const wallsNear = (raw.walls_near ?? raw.wallsNear ?? {}) as Record<
    string,
    { strike: number; oi: number }[]
  >;
  const ohlc = (raw.ohlc ?? {}) as Record<string, unknown>;
  return {
    symbol: "SENSEX",
    spot: safeNum(raw.spot),
    expiry: String(raw.expiry ?? ""),
    pcrOi: safeNum(raw.pcrOi ?? raw.pcr_oi),
    pcrVol: safeNum(raw.pcrVol ?? raw.pcr_vol),
    maxPain: safeNum(raw.maxPain ?? raw.max_pain),
    walls: { calls: walls.calls ?? [], puts: walls.puts ?? [] },
    wallsNear: {
      calls: wallsNear.calls ?? walls.calls ?? [],
      puts: wallsNear.puts ?? walls.puts ?? [],
    },
    ohlc: {
      open: safeNum(ohlc.open),
      high: safeNum(ohlc.high),
      low: safeNum(ohlc.low),
      close: safeNum(ohlc.close),
    },
    fetchedAt: (raw.fetchedAt ?? raw.fetched_at) as string | undefined,
    market: normalizeMarket(raw.market),
  };
}

/** FastAPI `detail` can be a string, a validation array, or a structured
 *  object (the Nifty 404 sends `{is_trading_day, date, message}`). Passing an
 *  object to `new Error()` leaked "[object Object]" into the report banner. */
function detailMessage(payload: unknown, fallback: string): string {
  const detail = (payload as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const parts = detail
      .map((d) => (typeof d === "string" ? d : (d as { msg?: unknown } | null)?.msg))
      .filter((d): d is string => typeof d === "string" && d.trim() !== "");
    if (parts.length > 0) return parts.join("; ");
  }
  if (detail && typeof detail === "object") {
    const d = detail as {
      is_trading_day?: boolean;
      date?: string;
      message?: unknown;
      msg?: unknown;
    };
    if (d.is_trading_day === false && d.date) {
      return `${d.date} was not a trading day — no snapshot recorded.`;
    }
    const msg = d.message ?? d.msg;
    if (typeof msg === "string" && msg.trim()) return msg;
  }
  return fallback;
}

async function parseNiftyResponse(response: Response): Promise<NiftyReport> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(detailMessage(error, "Failed to fetch Nifty report"));
  }
  return normalizeReport((await response.json()) as Record<string, unknown>);
}

export interface NiftyExpiry {
  date: string;
  weekly?: boolean;
  days_to_expiry?: number;
}

export async function fetchNiftyExpiries(
  signal?: AbortSignal,
): Promise<NiftyExpiry[]> {
  const response = await fetchWithAuth(`${NIFTY_API_BASE}/expiries`, {
    signal,
  });
  if (!response.ok) return [];
  const data = await response.json().catch(() => ({}));
  return (data as { expiries?: NiftyExpiry[] }).expiries ?? [];
}

export async function fetchLiveNifty(
  expiry?: string,
  signal?: AbortSignal,
): Promise<NiftyReport> {
  const url = expiry
    ? `${NIFTY_API_BASE}/live?expiry=${encodeURIComponent(expiry)}`
    : `${NIFTY_API_BASE}/live`;
  const response = await fetchWithAuth(url, { signal });
  return parseNiftyResponse(response);
}

export interface BreadthRow {
  label: string;
  last: number | null;
  close: number | null;
  change_pct: number | null;
}

export interface BreadthPayload {
  available: boolean;
  rows: BreadthRow[];
  up: number;
  count: number;
}

/**
 * Five-index breadth for the desk strip. Cheap on the server (60s cache) and
 * never fatal: the strip simply does not render when the quote path is down.
 */
export async function fetchBreadth(signal?: AbortSignal): Promise<BreadthPayload> {
  const response = await fetchWithAuth(`${API_BASE}/api/reports/breadth`, { signal });
  if (!response.ok) throw new Error("Failed to fetch breadth");
  return (await response.json()) as BreadthPayload;
}

/** Build the options-live URL. `candles` is the opt-in slow path. */
function optionsLiveUrl(
  underlying: string,
  expiry: string | undefined,
  candles: boolean,
): string {
  const params = new URLSearchParams();
  if (expiry) params.set("expiry", expiry);
  if (candles) params.set("candles", "1");
  const qs = params.toString();
  return `${API_BASE}/api/reports/options/${encodeURIComponent(underlying)}/live${qs ? `?${qs}` : ""}`;
}

async function parseOptionsLiveResponse(
  response: Response,
  underlying: string,
): Promise<NiftyReport> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      detailMessage(error, `Failed to fetch ${underlying} option-chain report`),
    );
  }
  return normalizeReport((await response.json()) as Record<string, unknown>);
}

/**
 * `GET /api/reports/options/{underlying}/live` — the same normalized report
 * shape as the Nifty live endpoint, for any option-chain underlying the
 * backend serves (SENSEX, RELIANCE, …). `underlying` is the symbol as the
 * backend knows it (e.g. `NIFTY`, `SENSEX`, `RELIANCE`).
 *
 * This is the FAST path (`candles=false`): the chain renders immediately and
 * `intraday` is empty. Use it for the recurring report poll.
 */
export async function fetchOptionsLive(
  underlying: string,
  expiry?: string,
  signal?: AbortSignal,
): Promise<NiftyReport> {
  const url = optionsLiveUrl(underlying, expiry, false);
  // Keep the no-signal call shape identical to before (existing callers and
  // tests assert a single argument).
  const response = signal
    ? await fetchWithAuth(url, { signal })
    : await fetchWithAuth(url);
  return parseOptionsLiveResponse(response, underlying);
}

/**
 * Same report with the 1-minute candles (`?candles=1`).
 *
 * This is the SLOW optional path (first call ~20 s, then cached ~120 s), so it
 * must never gate the first render and must never run in a poll loop. Call it
 * once in the background after `fetchOptionsLive` has painted the chain, then
 * merge `intraday` into the report.
 */
export async function fetchOptionsLiveCandles(
  underlying: string,
  expiry?: string,
  signal?: AbortSignal,
): Promise<NiftyReport> {
  const url = optionsLiveUrl(underlying, expiry, true);
  const response = signal
    ? await fetchWithAuth(url, { signal })
    : await fetchWithAuth(url);
  return parseOptionsLiveResponse(response, underlying);
}

export async function fetchLiveSensex(signal?: AbortSignal): Promise<NiftySensex> {
  const response = await fetchWithAuth(`${NIFTY_API_BASE}/sensex`, { signal });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(detailMessage(error, "Failed to fetch Sensex report"));
  }
  return normalizeSensex((await response.json()) as Record<string, unknown>);
}

export async function fetchNiftyByDate(
  date: string,
  signal?: AbortSignal,
): Promise<NiftyReport> {
  const response = await fetchWithAuth(
    `${NIFTY_API_BASE}?date=${encodeURIComponent(date)}`,
    { signal },
  );
  return parseNiftyResponse(response);
}

export async function snapshotNifty(
  date?: string,
  expiry?: string,
): Promise<NiftyReport> {
  const params = new URLSearchParams();
  if (date) params.set("date", date);
  if (expiry) params.set("expiry", expiry);
  const query = params.toString();
  const response = await fetchWithAuth(
    query ? `${NIFTY_API_BASE}/snapshot?${query}` : `${NIFTY_API_BASE}/snapshot`,
    { method: "POST" },
  );
  return parseNiftyResponse(response);
}

/**
 * `GET /api/reports/nifty/replay?date=…` — the day's recorded minute frames.
 * Each frame's `report` runs through `normalizeReport` and its `sensex` through
 * `normalizeSensex` (null-safe), so a frame is drop-in interchangeable with the
 * single EOD report. Never throws: a missing day (404 / `is_trading_day:false`),
 * a bad payload, or a network failure resolves `null` (or empty `snapshots`)
 * and the caller keeps the plain EOD snapshot.
 */
/** `{reason: count}` with non-finite/negative counts dropped. */
function normalizeReasonCounts(raw: unknown): Record<string, number> | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(value);
    if (key && Number.isFinite(n) && n > 0) out[key] = n;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Normalize one raw replay frame; null when it cannot paint the screen. */
function normalizeReplayFrame(frame: unknown): NiftyReplayFrame | null {
  const f = (frame ?? {}) as Record<string, unknown>;
  const reportRaw = f.report;
  if (reportRaw === null || typeof reportRaw !== "object") return null;
  const sensexRaw = f.sensex;
  return {
    t: typeof f.t === "string" ? f.t : "",
    fetched_at: typeof f.fetched_at === "string" ? f.fetched_at : "",
    report: normalizeReport(reportRaw as Record<string, unknown>),
    sensex:
      sensexRaw !== null && sensexRaw !== undefined && typeof sensexRaw === "object"
        ? normalizeSensex(sensexRaw as Record<string, unknown>)
        : null,
  };
}

export async function fetchNiftyReplay(
  date: string,
  signal?: AbortSignal,
): Promise<NiftyReplay | null> {
  try {
    const response = await fetchWithAuth(
      `${NIFTY_API_BASE}/replay?date=${encodeURIComponent(date)}`,
      { signal },
    );
    if (!response.ok) return null;
    const data = (await response.json().catch(() => null)) as
      | (Record<string, unknown> & { snapshots?: unknown })
      | null;
    if (!data) return null;
    const raw = Array.isArray(data.snapshots) ? data.snapshots : [];
    const snapshots = raw
      .map(normalizeReplayFrame)
      .filter((x): x is NiftyReplayFrame => x !== null);
    return {
      date: typeof data.date === "string" && data.date ? data.date : date,
      count:
        typeof data.count === "number" && Number.isFinite(data.count)
          ? data.count
          : snapshots.length,
      interval_sec: safeNum(data.interval_sec ?? data.intervalSec, 60),
      snapshots,
      gap_reasons: normalizeReasonCounts(data.gap_reasons),
    };
  } catch {
    // Network failure or abort — treat like "no replay recorded".
    return null;
  }
}

/** Playhead list only (t + spot) — a few KB instead of the whole day. */
export interface NiftyReplayMetaFrame {
  t: string;
  spot?: number;
}

export interface NiftyReplayMeta {
  date: string;
  count: number;
  interval_sec: number;
  frames: NiftyReplayMetaFrame[];
  gap_reasons?: Record<string, number>;
}

export async function fetchNiftyReplayMeta(
  date: string,
  signal?: AbortSignal,
): Promise<NiftyReplayMeta | null> {
  try {
    const response = await fetchWithAuth(
      `${NIFTY_API_BASE}/replay?date=${encodeURIComponent(date)}&meta=1`,
      { signal },
    );
    if (!response.ok) return null;
    const data = (await response.json().catch(() => null)) as
      | (Record<string, unknown> & { frames?: unknown })
      | null;
    if (!data) return null;
    const frames = (Array.isArray(data.frames) ? data.frames : [])
      .map((f): NiftyReplayMetaFrame | null => {
        const row = (f ?? {}) as Record<string, unknown>;
        if (typeof row.t !== "string" || !row.t) return null;
        return { t: row.t, spot: safeNum(row.spot, NaN) };
      })
      .filter((x): x is NiftyReplayMetaFrame => x !== null);
    return {
      date: typeof data.date === "string" && data.date ? data.date : date,
      count: typeof data.count === "number" && Number.isFinite(data.count) ? data.count : frames.length,
      interval_sec: safeNum(data.interval_sec ?? data.intervalSec, 60),
      frames,
      gap_reasons: normalizeReasonCounts(data.gap_reasons),
    };
  } catch {
    return null;
  }
}

/** One full frame (the server returns the snapshot at/just before `t`). */
export async function fetchNiftyReplayFrame(
  date: string,
  t: string,
  signal?: AbortSignal,
): Promise<NiftyReplayFrame | null> {
  try {
    const response = await fetchWithAuth(
      `${NIFTY_API_BASE}/replay?date=${encodeURIComponent(date)}&t=${encodeURIComponent(t)}`,
      { signal },
    );
    if (!response.ok) return null;
    const data = (await response.json().catch(() => null)) as
      | { snapshot?: unknown }
      | null;
    if (!data) return null;
    return normalizeReplayFrame(data.snapshot);
  } catch {
    return null;
  }
}

/** One 10-second slim chain snapshot: `rows = [strike, ceLtp, ceOi, ceVol, peLtp, peOi, peVol]`. */
export interface Chain10sSnapshot {
  t: string;
  spot: number;
  expiry?: string;
  rows: number[][];
}

export interface Chain10sPayload {
  date: string;
  count: number;
  rows: Chain10sSnapshot[];
}

/** Slim 10-second chain snapshots (the fast OI/volume feed). */
export async function fetchChain10s(
  date?: string,
  limit = 90,
  signal?: AbortSignal,
): Promise<Chain10sPayload | null> {
  try {
    const qs = new URLSearchParams();
    if (date) qs.set("date", date);
    qs.set("limit", String(limit));
    const response = await fetchWithAuth(`${API_BASE}/api/reports/nifty/chain10s?${qs}`, { signal });
    if (!response.ok) return null;
    const data = (await response.json().catch(() => null)) as Chain10sPayload | null;
    if (!data || !Array.isArray(data.rows)) return null;
    return data;
  } catch {
    return null;
  }
}

/** Server-aggregated 10 s snapshot: totals per side, no strike payload. */
export interface Chain10sSummaryPoint {
  t: string;
  spot: number | null;
  ce_oi: number;
  pe_oi: number;
  ce_vol: number;
  pe_vol: number;
  /** ATM (fixed reference strike) premium — the buy/sell tiebreaker. */
  atm_strike?: number | null;
  ce_prem?: number | null;
  pe_prem?: number | null;
}

export interface Chain10sSummaryPayload {
  date: string;
  count: number;
  summary: Chain10sSummaryPoint[];
}

/**
 * Per-snapshot OI/volume totals from the 10-second chain.
 *
 * `summary=1` keeps the strip cheap: full snapshots are ~177 KB per poll,
 * the totals are ~5 KB.
 */
export async function fetchChain10sSummary(
  date?: string,
  limit = 90,
  signal?: AbortSignal,
): Promise<Chain10sSummaryPoint[]> {
  try {
    const qs = new URLSearchParams({ summary: "1", limit: String(limit) });
    if (date) qs.set("date", date);
    const response = await fetchWithAuth(`${API_BASE}/api/reports/nifty/chain10s?${qs}`, { signal });
    if (!response.ok) return [];
    const data = (await response.json().catch(() => null)) as Chain10sSummaryPayload | null;
    return Array.isArray(data?.summary) ? data.summary : [];
  } catch {
    return [];
  }
}

/** One fast move: spot velocity, OI blast or volume blast. */
export interface NiftyBlast {
  kind: "spot" | "oi" | "volume";
  t: string;
  side: "CE" | "PE" | null;
  delta: number;
  label: string;
  detail: string;
  severity: "critical" | "alert" | "warning";
  bias: "bull" | "bear" | "neutral";
}

/**
 * Unified blast feed: spot velocity (1 s tape) + OI/volume (10 s chain).
 *
 * Thresholds are adaptive server-side (`max(floor, k × window median)`), so a
 * quiet lunch does not need the morning's absolute gates.
 */
export async function fetchNiftyBlasts(
  lookbackMin = 5,
  limit = 40,
  signal?: AbortSignal,
): Promise<NiftyBlast[]> {
  try {
    const qs = new URLSearchParams({
      lookback_min: String(lookbackMin),
      limit: String(limit),
    });
    const url = `${API_BASE}/api/reports/nifty/blasts?${qs}`;
    const response = signal
      ? await fetchWithAuth(url, { signal })
      : await fetchWithAuth(url);
    if (!response.ok) return [];
    const data = (await response.json().catch(() => null)) as { blasts?: NiftyBlast[] } | null;
    return Array.isArray(data?.blasts) ? data.blasts : [];
  } catch {
    return [];
  }
}

/** One spot-velocity blast from the 1-second tick tape. */
export interface SpotBlast {
  t: string;
  from_spot: number;
  to_spot: number;
  delta: number;
  direction: "up" | "down";
  window_sec: number;
  rate_pts_per_sec: number;
}

/**
 * Spot moves ≥ `minPts` inside `window` seconds, newest last.
 *
 * The 1-minute OI tape cannot see these (2026-10-26 12:28: +14.5 pts in 10 s
 * while every OI column looked ordinary).
 */
export async function fetchSpotBlasts(
  date?: string,
  window = 10,
  minPts = 8,
  lookbackMin = 4,
): Promise<SpotBlast[]> {
  try {
    const qs = new URLSearchParams({
      window: String(window),
      min_pts: String(minPts),
      lookback_min: String(lookbackMin),
    });
    if (date) qs.set("date", date);
    const response = await fetchWithAuth(`${API_BASE}/api/reports/nifty/spot-blasts?${qs}`);
    if (!response.ok) return [];
    const data = (await response.json().catch(() => null)) as { blasts?: SpotBlast[] } | null;
    return Array.isArray(data?.blasts) ? data.blasts : [];
  } catch {
    return [];
  }
}

/** Dates that have a per-minute replay log, newest first. */
export async function fetchNiftyReplayDates(signal?: AbortSignal): Promise<string[]> {
  try {
    const response = await fetchWithAuth(`${NIFTY_API_BASE}/replay/dates`, { signal });
    if (!response.ok) return [];
    const data = (await response.json().catch(() => null)) as { dates?: unknown } | null;
    if (!data || !Array.isArray(data.dates)) return [];
    return data.dates.filter((d): d is string => typeof d === "string");
  } catch {
    // A missing endpoint (older backend) must not break the panel.
    return [];
  }
}

/** One tape row, snake_case-tolerant; numbers default 0, spot_flip stays null-safe. */
/** Row walls arrive as `{calls:[{strike,oi}], puts:[...]}` — reduce to top-OI strikes. */
function topStrike(list: unknown): number {
  if (!Array.isArray(list) || list.length === 0) return 0;
  let best = 0;
  let bestOi = -Infinity;
  for (const e of list) {
    const r = e as Record<string, unknown>;
    const oi = typeof r?.oi === "number" ? r.oi : 0;
    const s = typeof r?.strike === "number" ? r.strike : 0;
    if (oi > bestOi) {
      bestOi = oi;
      best = s;
    }
  }
  return best;
}

export function normalizeTapeRow(raw: Record<string, unknown>): NiftyTapeRow {
  const wallsRaw = (raw.walls ?? {}) as Record<string, unknown>;
  const flipRaw = raw.flip;
  const spotFlipRaw = raw.spot_flip ?? raw.spotFlip;
  const ceLtp = raw.atm_ce_ltp ?? raw.atmCeLtp;
  const peLtp = raw.atm_pe_ltp ?? raw.atmPeLtp;
  const chain = normalizeChain(raw.chain ?? raw.chain_snapshot ?? raw.chainSnapshot);
  return {
    t: String(raw.t ?? raw.time ?? ""),
    spot: safeNum(raw.spot),
    ...(raw.ce_oi !== undefined ? { ce_oi: safeNum(raw.ce_oi) } : {}),
    ...(raw.pe_oi !== undefined ? { pe_oi: safeNum(raw.pe_oi) } : {}),
    // ATM leg premiums — absent on tapes recorded before they were added.
    ...(raw.atm_strike !== undefined ? { atm_strike: safeNum(raw.atm_strike) } : {}),
    ...(ceLtp !== undefined && ceLtp !== null ? { atm_ce_ltp: safeNum(ceLtp) } : {}),
    ...(peLtp !== undefined && peLtp !== null ? { atm_pe_ltp: safeNum(peLtp) } : {}),
    // Per-minute GEX + ATM IV — absent on tapes recorded before they were added.
    ...(raw.net_gex !== undefined && raw.net_gex !== null
      ? { net_gex: nullNum(raw.net_gex) }
      : {}),
    ...(raw.gex_degraded === true ? { gex_degraded: true } : {}),
    ...(raw.atm_ce_iv !== undefined && raw.atm_ce_iv !== null
      ? { atm_ce_iv: nullNum(raw.atm_ce_iv) }
      : {}),
    ...(raw.atm_pe_iv !== undefined && raw.atm_pe_iv !== null
      ? { atm_pe_iv: nullNum(raw.atm_pe_iv) }
      : {}),
    call_doi: safeNum(raw.call_doi ?? raw.callDoi),
    put_doi: safeNum(raw.put_doi ?? raw.putDoi),
    net: safeNum(raw.net),
    net_pct: safeNum(raw.net_pct ?? raw.netPct),
    call_tick: safeNum(raw.call_tick ?? raw.callTick ?? raw.ticks),
    put_tick: safeNum(raw.put_tick ?? raw.putTick ?? raw.ticks),
    pcr_vol: safeNum(raw.pcr_vol ?? raw.pcrVol),
    pcr_oi: safeNum(raw.pcr_oi ?? raw.pcrOi),
    pcr_doi: safeNum(raw.pcr_doi ?? raw.pcrDoi),
    spot_flip:
      spotFlipRaw === null || spotFlipRaw === undefined || spotFlipRaw === ""
        ? null
        : (() => {
            const n =
              typeof spotFlipRaw === "string"
                ? Number(spotFlipRaw)
                : (spotFlipRaw as number);
            return typeof n === "number" && Number.isFinite(n) ? n : null;
          })(),
    max_pain: safeNum(raw.max_pain ?? raw.maxPain),
    flip: safeNum(flipRaw),
    walls: {
      call:
        typeof wallsRaw.call === "number"
          ? wallsRaw.call
          : topStrike(wallsRaw.call ?? wallsRaw.calls),
      put:
        typeof wallsRaw.put === "number"
          ? wallsRaw.put
          : topStrike(wallsRaw.put ?? wallsRaw.puts),
    },
    ...(chain ? { chain } : {}),
  };
}

/**
 * Per-strike chain snapshot — `chain[strike] = [ce_ltp, pe_ltp, ce_oi, pe_oi,
 * ce_vol, pe_vol]` with dead legs as `null`. Keeps only entries whose key is
 * a positive finite strike and whose value is an array; each of the first 6
 * slots normalizes to a finite number or `null` (padded to 6). Empty or
 * malformed entries are dropped, and a missing/empty chain stays `undefined`
 * so the visuals keep their "no tape chain" empty state.
 */
export function normalizeChain(
  raw: unknown,
): Record<string, NiftyTapeChainTuple> | undefined {
  if (raw === null || raw === undefined || typeof raw !== "object") return undefined;
  if (Array.isArray(raw)) return undefined;
  const out: Record<string, NiftyTapeChainTuple> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const strike = Number(key);
    if (!Number.isFinite(strike) || strike <= 0) continue;
    if (!Array.isArray(value) || value.length === 0) continue;
    const slots = (value as unknown[]).slice(0, 6).map((slot) => {
      const n = typeof slot === "string" ? Number(slot) : (slot as number);
      return typeof n === "number" && Number.isFinite(n) ? n : null;
    });
    while (slots.length < 6) slots.push(null);
    out[String(strike)] = slots as NiftyTapeChainTuple;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Top-level walls may be `{call, put}` scalars or `{calls, puts}` strike arrays. */
function normalizeTopWalls(raw: unknown): NiftyTape["walls"] {
  if (raw === null || raw === undefined || typeof raw !== "object") return undefined;
  const w = raw as Record<string, unknown>;
  if (Array.isArray(w.calls) || Array.isArray(w.puts)) {
    const top = (list: unknown): number => {
      if (!Array.isArray(list)) return 0;
      let best = 0;
      let bestOi = -1;
      for (const e of list) {
        const row = (e ?? {}) as Record<string, unknown>;
        const oi = safeNum(row.oi);
        if (oi > bestOi) {
          bestOi = oi;
          best = safeNum(row.strike);
        }
      }
      return best;
    };
    return { call: top(w.calls), put: top(w.puts) };
  }
  const call = safeNum(w.call ?? w.calls);
  const put = safeNum(w.put ?? w.puts);
  if (call === 0 && put === 0) return undefined;
  return { call, put };
}

/** Shared tape payload parser (NIFTY recorder + generic per-symbol history). */
function normalizeTapePayload(
  raw: Record<string, unknown>,
  fallbackDate?: string,
): NiftyTape {
  const pcrOi = safeNum(raw.pcr_oi ?? raw.pcrOi);
  const maxPain = safeNum(raw.max_pain ?? raw.maxPain);
  const flip = safeNum(raw.flip);
  const baselineRaw = raw.baseline_t ?? raw.baselineT;
  return {
    date: String(raw.date ?? fallbackDate ?? ""),
    interval_sec: safeNum(raw.interval_sec ?? raw.intervalSec, 60),
    rows: (Array.isArray(raw.rows) ? raw.rows : []).map((r) =>
      normalizeTapeRow((r ?? {}) as Record<string, unknown>),
    ),
    ...(typeof baselineRaw === "string" && baselineRaw
      ? { baseline_t: baselineRaw }
      : {}),
    ...(pcrOi !== 0 ? { pcr_oi: pcrOi } : {}),
    ...(maxPain !== 0 ? { max_pain: maxPain } : {}),
    ...(flip !== 0 ? { flip } : {}),
    walls: normalizeTopWalls(raw.walls),
  };
}

/** `GET /api/reports/nifty/tape` — plain passthrough, one row per minute. */
export async function fetchNiftyTape(
  date?: string,
  signal?: AbortSignal,
): Promise<NiftyTape> {
  const url = date
    ? `${NIFTY_API_BASE}/tape?date=${encodeURIComponent(date)}`
    : `${NIFTY_API_BASE}/tape`;
  const response = await fetchWithAuth(url, { signal });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(detailMessage(error, "Failed to fetch Nifty tape"));
  }
  return normalizeTapePayload(
    (await response.json()) as Record<string, unknown>,
    date,
  );
}

/**
 * `GET /api/reports/options/{symbol}/tape?date=` — the same per-minute tape
 * shape as the NIFTY recorder, for any underlying with a recorded history.
 *
 * Never throws: a missing day, an unrecorded symbol (404), a malformed payload
 * or a network failure resolves `null` so the caller keeps its last-good tape.
 */
export async function fetchOptionsTape(
  symbol: string,
  date?: string,
  signal?: AbortSignal,
): Promise<NiftyTape | null> {
  try {
    const base = optionsApiBase(symbol);
    const url = date
      ? `${base}/tape?date=${encodeURIComponent(date)}`
      : `${base}/tape`;
    const response = await fetchWithAuth(url, { signal });
    if (!response.ok) return null;
    const raw = await response.json().catch(() => null);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    return normalizeTapePayload(raw as Record<string, unknown>, date);
  } catch {
    return null;
  }
}

/**
 * `GET /api/reports/options/{symbol}/chain10s?summary=1` — per-snapshot OI /
 * volume totals from the 10-second chain. Empty on any failure.
 */
export async function fetchOptionsChain10s(
  symbol: string,
  date?: string,
  limit = 90,
  signal?: AbortSignal,
): Promise<Chain10sSummaryPoint[]> {
  try {
    const qs = new URLSearchParams({ summary: "1", limit: String(limit) });
    if (date) qs.set("date", date);
    const response = await fetchWithAuth(
      `${optionsApiBase(symbol)}/chain10s?${qs}`,
      { signal },
    );
    if (!response.ok) return [];
    const data = (await response.json().catch(() => null)) as
      | Chain10sSummaryPayload
      | null;
    return Array.isArray(data?.summary) ? data.summary : [];
  } catch {
    return [];
  }
}

const BURST_SEVERITIES = ["info", "watch", "alert", "critical"] as const;

/** The backend's fuel 2×2 cells (api/reports_api/nifty_fuel.py). */
const BURST_FUEL_STATES = [
  "fresh_buyers",
  "fresh_sellers",
  "writers_covering",
  "longs_liquidating",
] as const;

/** True when a value is actually present (not undefined/null/empty string). */
function present(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

function asFinite(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : (value as number);
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/**
 * Burst signal block — snake_case-tolerant (`signal_leg ?? leg`). Returns `null`
 * unless strike and entry are both present and finite, so a partial block never
 * leaks into the UI as a half-tradeable object.
 */
function normalizeBurstSignal(raw: unknown): NiftyBurstSignal | null {
  if (raw === null || raw === undefined || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  const strikeRaw = s.signal_strike ?? s.strike;
  const entryRaw = s.signal_entry ?? s.entry;
  const strike = asFinite(strikeRaw);
  const entry = asFinite(entryRaw);
  if (!present(strikeRaw) || !present(entryRaw)) return null;
  if (strike === null || strike <= 0 || entry === null || entry <= 0) return null;
  const legRaw = String(s.signal_leg ?? s.leg ?? "").toUpperCase();
  return {
    leg: legRaw === "PE" ? "PE" : "CE",
    strike,
    entry,
    sl: safeNum(s.signal_sl ?? s.sl),
    target: safeNum(s.signal_target ?? s.target),
    qty: safeNum(s.signal_qty ?? s.qty),
    lots: safeNum(s.signal_lots ?? s.lots),
    basis: String(s.signal_basis ?? s.basis ?? ""),
  };
}

/** One burst alert, snake_case-tolerant; unknown side/severity coerce to safe defaults. */
function normalizeBurstNews(raw: unknown): NiftyBurstNews[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      const r = (entry ?? {}) as Record<string, unknown>;
      const heading = r.heading ?? r.headline;
      if (typeof heading !== "string" || heading.length === 0) return null;
      return {
        heading,
        link: String(r.link ?? r.url ?? r.article_link ?? ""),
        source: String(r.source ?? ""),
        minutesAway: safeNum(r.minutesAway ?? r.minutes_away),
      } satisfies NiftyBurstNews;
    })
    .filter((x): x is NiftyBurstNews => x !== null);
}

/** One burst's structure evidence (the level the underlying closed beyond). */
function normalizeBurstStructure(raw: unknown): NiftyBurstStructure | null {
  if (raw === null || raw === undefined || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const level = asFinite(r.level);
  if (level === null || level <= 0) return null;
  const dir = String(r.direction ?? "").toLowerCase();
  return {
    level,
    direction: dir === "down" ? "down" : "up",
    ...(typeof r.kind === "string" ? { kind: r.kind } : {}),
    ...(asFinite(r.close) !== null ? { close: asFinite(r.close)! } : {}),
    ...(typeof r.confirmed_at === "string" ? { confirmed_at: r.confirmed_at } : {}),
  };
}

const BURST_TYPES = [
  "squeeze", "strike", "premium", "coil",
  "wall", "wall_test", "rejection", "break", "wall_break", "data_stale",
] as const;

export function normalizeBurst(raw: Record<string, unknown>): NiftyBurst {
  const side: NiftyBurst["side"] = raw.side === "put" ? "put" : "call";
  const sevRaw = String(raw.severity ?? "").toLowerCase();
  const severity = (BURST_SEVERITIES as readonly string[]).includes(sevRaw)
    ? (sevRaw as NiftyBurst["severity"])
    : "watch";
  const fuelRaw = String(raw.fuel_state ?? "").toLowerCase();
  const fuel = (BURST_FUEL_STATES as readonly string[]).includes(fuelRaw)
    ? (fuelRaw as NiftyBurstFuelState)
    : null;
  const type = BURST_TYPES.includes(String(raw.type) as (typeof BURST_TYPES)[number])
    ? (raw.type as NiftyBurst["type"])
    : undefined;
  const t = String(raw.t ?? raw.time ?? "");
  const strikeRaw = raw.strike !== undefined && raw.strike !== null ? safeNum(raw.strike) : null;
  const targetRaw = raw.target !== undefined && raw.target !== null ? safeNum(raw.target) : null;
  // Wall events (and data-stale warnings) are emitted without an `id`. An
  // empty id collapsed every wall event into one row in the panel map AND was
  // silently dropped by the burst WS hook, so derive a deterministic one from
  // the event itself: REST and WS copies of the same event must match.
  const rawId = String(raw.id ?? "").trim();
  const id =
    rawId ||
    `${type ?? "burst"}:${t}:${side}:${strikeRaw ?? ""}:${targetRaw ?? ""}`;
  return {
    id,
    side,
    t,
    delta: safeNum(raw.delta),
    baseline: safeNum(raw.baseline),
    score: safeNum(raw.score),
    severity,
    cumDoi: safeNum(raw.cumDoi ?? raw.cum_doi),
    spot: safeNum(raw.spot),
    tickVol: safeNum(raw.tickVol ?? raw.tick_vol),
    signal: normalizeBurstSignal(raw.signal),
    news: normalizeBurstNews(raw.news),
    // Buyer/writer flow verdict — passed through verbatim when present so the
    // client direction mapping can use it (absent on pre-restart bursts).
    ...(typeof raw.flow === "string" && raw.flow.length > 0 ? { flow: raw.flow } : {}),
    ...(typeof raw.bearish === "boolean" ? { bearish: raw.bearish } : {}),
    // The premium half of the fuel 2×2 (same-side ATM premium change, ₹).
    ...(raw.premChg !== undefined && raw.premChg !== null
      ? { premChg: safeNum(raw.premChg) }
      : {}),
    // The backend's fuel reading is authoritative — it has the same-strike
    // premium change, the client only has a guess.
    ...(fuel ? { fuel_state: fuel } : {}),
    ...(raw.structure !== undefined && raw.structure !== null
      ? { structure: normalizeBurstStructure(raw.structure) }
      : {}),
    ...(raw.invalidation !== undefined && raw.invalidation !== null
      ? { invalidation: safeNum(raw.invalidation) }
      : {}),
    ...(raw.plan_suppressed === true ? { plan_suppressed: true } : {}),
    ...(type ? { type } : {}),
    ...(targetRaw !== null ? { target: targetRaw } : {}),
    ...(raw.wall !== undefined && raw.wall !== null ? { wall: safeNum(raw.wall) } : {}),
    ...(strikeRaw !== null ? { strike: strikeRaw } : {}),
    ...(typeof raw.leg === "string" ? { leg: raw.leg } : {}),
    ...(typeof raw.label === "string" && raw.label.length > 0 ? { label: raw.label } : {}),
    ...(typeof raw.detail === "string" && raw.detail.length > 0 ? { detail: raw.detail } : {}),
  };
}

/**
 * `GET /api/reports/nifty/bursts` — additive alerting feed. It must never break
 * the page: any non-ok response, parse failure, network error, or abort yields `[]`.
 */
export async function fetchNiftyBursts(
  date?: string,
  signal?: AbortSignal,
): Promise<NiftyBurst[]> {
  const url = date
    ? `${NIFTY_API_BASE}/bursts?date=${encodeURIComponent(date)}`
    : `${NIFTY_API_BASE}/bursts`;
  try {
    const response = await fetchWithAuth(url, { signal });
    if (!response.ok) return [];
    return parseBurstsPayload(await response.json().catch(() => null));
  } catch {
    return [];
  }
}

/** Shared bursts payload parser (`{count, bursts}` or a bare array). */
function parseBurstsPayload(data: unknown): NiftyBurst[] {
  const rows = Array.isArray(data)
    ? data
    : (data as { bursts?: unknown } | null)?.bursts;
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => normalizeBurst((r ?? {}) as Record<string, unknown>));
}

/** `GET /api/reports/options/{symbol}/bursts?date=` — per-underlying bursts. */
export async function fetchOptionsBursts(
  symbol: string,
  date?: string,
  signal?: AbortSignal,
): Promise<NiftyBurst[]> {
  try {
    const base = optionsApiBase(symbol);
    const url = date ? `${base}/bursts?date=${encodeURIComponent(date)}` : `${base}/bursts`;
    const response = await fetchWithAuth(url, { signal });
    if (!response.ok) return [];
    return parseBurstsPayload(await response.json().catch(() => null));
  } catch {
    return [];
  }
}

/**
 * `GET /api/reports/options/{symbol}/blasts` — the unified spot/OI/volume feed.
 * Non-NIFTY underlyings have no 1-second spot tape, so the spot lane is empty
 * and only the 10-second chain blasts may appear.
 */
export async function fetchOptionsBlasts(
  symbol: string,
  lookbackMin = 5,
  limit = 40,
  signal?: AbortSignal,
): Promise<NiftyBlast[]> {
  try {
    const qs = new URLSearchParams({
      lookback_min: String(lookbackMin),
      limit: String(limit),
    });
    const response = await fetchWithAuth(
      `${optionsApiBase(symbol)}/blasts?${qs}`,
      { signal },
    );
    if (!response.ok) return [];
    const data = (await response.json().catch(() => null)) as
      | { blasts?: NiftyBlast[] }
      | null;
    return Array.isArray(data?.blasts) ? data.blasts : [];
  } catch {
    return [];
  }
}

/** `GET /api/reports/options/{symbol}/replay/dates` — recorded days, newest first. */
export async function fetchOptionsReplayDates(
  symbol: string,
  signal?: AbortSignal,
): Promise<string[]> {
  try {
    const response = await fetchWithAuth(
      `${optionsApiBase(symbol)}/replay/dates`,
      { signal },
    );
    if (!response.ok) return [];
    const data = (await response.json().catch(() => null)) as { dates?: unknown } | null;
    if (!data || !Array.isArray(data.dates)) return [];
    return data.dates.filter((d): d is string => typeof d === "string");
  } catch {
    return [];
  }
}

/** `GET …/replay?date=` — the day's recorded frames (whole-day payload). */
export async function fetchOptionsReplay(
  symbol: string,
  date: string,
  signal?: AbortSignal,
): Promise<NiftyReplay | null> {
  try {
    const response = await fetchWithAuth(
      `${optionsApiBase(symbol)}/replay?date=${encodeURIComponent(date)}`,
      { signal },
    );
    if (!response.ok) return null;
    const data = (await response.json().catch(() => null)) as
      | (Record<string, unknown> & { snapshots?: unknown })
      | null;
    if (!data) return null;
    const raw = Array.isArray(data.snapshots) ? data.snapshots : [];
    const snapshots = raw
      .map(normalizeReplayFrame)
      .filter((x): x is NiftyReplayFrame => x !== null);
    return {
      date: typeof data.date === "string" && data.date ? data.date : date,
      count:
        typeof data.count === "number" && Number.isFinite(data.count)
          ? data.count
          : snapshots.length,
      interval_sec: safeNum(data.interval_sec ?? data.intervalSec, 60),
      snapshots,
      gap_reasons: normalizeReasonCounts(data.gap_reasons),
    };
  } catch {
    return null;
  }
}

/** `GET …/replay?date=&meta=1` — playhead list only (t + spot). */
export async function fetchOptionsReplayMeta(
  symbol: string,
  date: string,
  signal?: AbortSignal,
): Promise<NiftyReplayMeta | null> {
  try {
    const response = await fetchWithAuth(
      `${optionsApiBase(symbol)}/replay?date=${encodeURIComponent(date)}&meta=1`,
      { signal },
    );
    if (!response.ok) return null;
    const data = (await response.json().catch(() => null)) as
      | (Record<string, unknown> & { frames?: unknown })
      | null;
    if (!data) return null;
    const frames = (Array.isArray(data.frames) ? data.frames : [])
      .map((f): NiftyReplayMetaFrame | null => {
        const row = (f ?? {}) as Record<string, unknown>;
        if (typeof row.t !== "string" || !row.t) return null;
        return { t: row.t, spot: safeNum(row.spot, NaN) };
      })
      .filter((x): x is NiftyReplayMetaFrame => x !== null);
    return {
      date: typeof data.date === "string" && data.date ? data.date : date,
      count:
        typeof data.count === "number" && Number.isFinite(data.count)
          ? data.count
          : frames.length,
      interval_sec: safeNum(data.interval_sec ?? data.intervalSec, 60),
      frames,
      gap_reasons: normalizeReasonCounts(data.gap_reasons),
    };
  } catch {
    return null;
  }
}

/** `GET …/replay?date=&t=` — one full frame at/just before `t`. */
export async function fetchOptionsReplayFrame(
  symbol: string,
  date: string,
  minute: string,
  signal?: AbortSignal,
): Promise<NiftyReplayFrame | null> {
  try {
    const response = await fetchWithAuth(
      `${optionsApiBase(symbol)}/replay?date=${encodeURIComponent(date)}&t=${encodeURIComponent(minute)}`,
      { signal },
    );
    if (!response.ok) return null;
    const data = (await response.json().catch(() => null)) as
      | { snapshot?: unknown }
      | null;
    if (!data) return null;
    return normalizeReplayFrame(data.snapshot);
  } catch {
    return null;
  }
}

/** `GET …/snapshot?date=` — the recorded end-of-day report for that symbol. */
export async function fetchOptionsSnapshot(
  symbol: string,
  date: string,
  signal?: AbortSignal,
): Promise<NiftyReport | null> {
  try {
    const response = await fetchWithAuth(
      `${optionsApiBase(symbol)}/snapshot?date=${encodeURIComponent(date)}`,
      { signal },
    );
    if (!response.ok) return null;
    const raw = await response.json().catch(() => null);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    return normalizeReport(raw as Record<string, unknown>);
  } catch {
    return null;
  }
}

/** Recorder status for one underlying (shape is backend-owned). */
export interface OptionsTapeStatus {
  date?: string | null;
  recording?: boolean;
  rows?: number;
  last_tick?: string | null;
  last_error?: string | null;
  [key: string]: unknown;
}

/** `GET …/tape/status` — is the recorder writing for this symbol? */
export async function fetchOptionsTapeStatus(
  symbol: string,
  signal?: AbortSignal,
): Promise<OptionsTapeStatus | null> {
  try {
    const response = await fetchWithAuth(`${optionsApiBase(symbol)}/tape/status`, {
      signal,
    });
    if (!response.ok) return null;
    const data = await response.json().catch(() => null);
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    return data as OptionsTapeStatus;
  } catch {
    return null;
  }
}

/**
 * `GET /api/options/expiries/{symbol}` — the real exchange listing for an
 * underlying. Returns ISO dates, ascending; empty on any failure.
 */
export async function fetchOptionsExpiries(
  symbol: string,
  signal?: AbortSignal,
): Promise<string[]> {
  try {
    const response = await fetchWithAuth(
      `${API_BASE}/api/options/expiries/${encodeURIComponent(symbol)}`,
      { signal },
    );
    if (!response.ok) return [];
    const data = (await response.json().catch(() => null)) as
      | { expiries?: { date?: unknown }[] }
      | null;
    if (!data || !Array.isArray(data.expiries)) return [];
    return data.expiries
      .map((e) => (typeof e?.date === "string" ? e.date : ""))
      .filter((d) => d.length > 0);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Walls / 0-DTE pin state — backend-computed, the UI only renders it.
// ---------------------------------------------------------------------------

/** Writer/long behaviour on the wall, as classified by the backend. */
export type WallsFlow =
  | "WRITERS_COVERING"
  | "LONG_UNWIND"
  | "WRITERS_ADDING"
  | "LONG_BUILD"
  | "UNKNOWN";

export type WallsStatus = "BREACHED" | "ERODING" | "BUILDING" | "STABLE";

/** Sub-scores behind `fuel_score`; each a 0-100 share of its bucket. */
export interface WallsFuelParts {
  erosion: number;
  volume: number;
  proximity: number;
  gamma: number;
  flow: number;
}

export interface WallsRow {
  strike: number;
  oi: number;
  /** OI at the session open — the old book before today's new participants. */
  oi_open?: number | null;
  /** current OI minus session-open OI (contracts). */
  new_oi?: number | null;
  new_oi_pct?: number | null;
  ltp?: number | null;
  erosion_5m?: number | null;
  erosion_15m?: number | null;
  erosion_30m?: number | null;
  erosion_60m?: number | null;
  /** Erosion velocity, fraction of OI per minute (negative = unwinding). */
  erosion_rate_30m?: number | null;
  vol_5m?: number | null;
  vol_30m?: number | null;
  /** 5-minute volume as a multiple of its own 30-minute baseline. */
  vol_mult?: number | null;
  /** Same-side ATM premium change over 5 minutes, fraction. */
  prem_chg_5m?: number | null;
  flow?: WallsFlow | null;
  /** BREACHED/ERODING = wall is failing; BUILDING = wall is firming. */
  status?: WallsStatus;
  /** 0-100 "how imminent is the break" — NOT a P&L number. */
  fuel_score?: number;
  fuel_parts?: WallsFuelParts | null;
  time_to_break_min?: number | null;
  oi_history?: number[];
  /** Backend flags the nearest call/put wall so the UI can pin it. */
  nearest?: boolean;
  distance_pts?: number | null;
  distance_pct?: number | null;
  tracked?: boolean;
}

export interface WallsHistoryPoint {
  t: string;
  spot: number;
  max_pain: number;
  call_oi?: number | null;
  put_oi?: number | null;
  net_gex?: number | null;
  flip?: number | null;
}

/**
 * Strike x time OI-change grid for the expanded wall map.
 * `call_delta[strikeIndex][timeIndex]` is the fractional change vs the first
 * minute in the window (negative = erosion, positive = build).
 */
export interface WallsMap {
  strikes: number[];
  times: string[];
  call_delta: (number | null)[][];
  put_delta: (number | null)[][];
  /** Same grid measured from the session open instead of the window start. */
  call_delta_open?: (number | null)[][] | null;
  put_delta_open?: (number | null)[][] | null;
  /** Exact OI per strike per minute; powers the hover/pin preview bars. */
  call_oi?: number[][] | null;
  put_oi?: number[][] | null;
  call_now: number[];
  put_now: number[];
  /** Session-open OI per strike; old/new split on the current bars. */
  call_open?: number[] | null;
  put_open?: number[] | null;
  /** Top call/put strike per minute; the migration ribbon. */
  top_call?: (number | null)[] | null;
  top_put?: (number | null)[] | null;
  spot: number[];
  max_pain: number[];
  flip: (number | null)[];
  /** Max pain ± half a strike gap, per minute (backend-owned). */
  pin_band?: { low: number[]; high: number[] } | null;
}

export interface WallsAlert {
  symbol: string;
  wall: number;
  spot: number;
  erosion_30m: number | null;
  put_build_30m: number | null;
  max_pain_drift: number;
  max_pain: number;
  at: string;
  cooldown_min: number;
  reasons: string[];
}

export interface WallsEvent {
  at: string;
  kind: "TOUCH" | "BREAK" | string;
  wall: number;
  spot: number;
  erosion_30m: number | null;
  put_build_30m: number | null;
  max_pain_drift: number;
  max_pain: number;
}

export interface WallsPayload {
  symbol: string;
  date: string;
  expiry: string | null;
  dte: number | null;
  spot: number;
  max_pain: number;
  max_pain_drift: number;
  atm: number;
  net_gex: number | null;
  flip: number | null;
  /** Spot vs flip: SHORT Γ below the flip, LONG Γ above it. */
  regime?: "LONG" | "SHORT" | null;
  /** Backend-computed one-line story for the current frame. */
  read?: string | null;
  gex_degraded: boolean;
  pin_distance_pts: number;
  pin_distance_pct: number;
  state: "QUIET" | "WATCH" | "PIN_RISK" | "BREAK" | "FADE" | "WALL_WATCH" | string;
  expiry_day: boolean;
  alert_eligible: boolean;
  alert: WallsAlert | null;
  reasons: string[];
  call_wall: { strike: number | null; oi: number; oi_open?: number | null; new_oi?: number | null; new_oi_pct?: number | null; ltp?: number | null; distance_pts?: number | null; distance_pct?: number | null };
  put_wall: { strike: number | null; oi: number; oi_open?: number | null; new_oi?: number | null; new_oi_pct?: number | null; ltp?: number | null; distance_pts?: number | null; distance_pct?: number | null };
  tracked_call_erosion_30m: number | null;
  tracked_call_erosion_5m: number | null;
  tracked_put_build_30m: number | null;
  near: boolean;
  cross: boolean;
  calls: WallsRow[];
  puts: WallsRow[];
  /** Backend-picked nearest walls; absent on older snapshots. */
  nearest_call?: WallsRow | null;
  nearest_put?: WallsRow | null;
  events: WallsEvent[];
  history: WallsHistoryPoint[];
  /** Strike x time erosion/build grid; absent on old snapshots. */
  wall_map?: WallsMap | null;
  freshness: {
    last_t: string;
    age_sec: number;
    stale: boolean;
    rows: number;
    gaps: { from: string; to: string; seconds: number }[];
  };
  window_min: number;
  top: number;
}

/** `GET /api/reports/options/{symbol}/walls` — null on any failure. */
export async function fetchOptionsWalls(
  symbol: string,
  date?: string,
  at?: string,
  signal?: AbortSignal,
  includeMap = false,
): Promise<WallsPayload | null> {
  try {
    const params = new URLSearchParams();
    if (date) params.set("date", date);
    if (at) params.set("at", at);
    if (includeMap) params.set("map", "1");
    const qs = params.toString();
    const response = await fetchWithAuth(`${optionsApiBase(symbol)}/walls${qs ? `?${qs}` : ""}`, {
      signal,
    });
    if (!response.ok) return null;
    const data = await response.json().catch(() => null);
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    return data as WallsPayload;
  } catch {
    return null;
  }
}
