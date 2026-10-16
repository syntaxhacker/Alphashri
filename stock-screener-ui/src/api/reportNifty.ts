/**
 * Nifty report API client.
 */

import { fetchWithAuth } from "../state/auth";
import type {
  NiftyBurst,
  NiftyBurstNews,
  NiftyBurstSignal,
  NiftyControlBlock,
  NiftyControlVerdict,
  NiftyEmaSeries,
  NiftyGex,
  NiftyGexLevel,
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
  NiftyRegimeBlock,
  NiftyRegimeVerdict,
  NiftyReport,
  NiftySensex,
  NiftyStrike,
  NiftyStrengthBlock,
  NiftyStrengthVerdict,
  NiftyStructureShift,
  NiftyTape,
  NiftyTapeRow,
  NiftyTimelineEvent,
  NiftyVixBlock,
} from "../types/niftyReport";

import { API_BASE } from "./config";

const NIFTY_API_BASE = `${API_BASE}/api/reports/nifty`;

function num(value: unknown, fallback = 0): number {
  const n = typeof value === "string" ? Number(value) : (value as number);
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

function normalizeSide(raw: Record<string, unknown> = {}): NiftyOptionSide {
  return {
    ltp: num(raw.ltp),
    close: num(raw.close ?? raw.close_price),
    oi: num(raw.oi),
    prevOi: num(raw.prevOi ?? raw.prev_oi),
    oiChange: num(raw.oiChange ?? raw.oi_change),
    priceChange: num(raw.priceChange ?? raw.price_change),
    volume: num(raw.volume),
    delta: nullNum(raw.delta),
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
  return {
    strike: num(row.strike),
    netGex: num(row.netGex ?? row.net_gex),
  };
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
          strike: num(row.strike),
          callGex: num(row.callGex ?? row.call_gex),
          putGex: num(row.putGex ?? row.put_gex),
          netGex: num(row.netGex ?? row.net_gex),
        };
      },
    ),
    netTotal: num(g.netTotal ?? g.net_total),
    regime,
    topPositive: (Array.isArray(g.topPositive ?? g.top_positive)
      ? ((g.topPositive ?? g.top_positive) as unknown[])
      : []
    ).map(normalizeGexLevel),
    topNegative: (Array.isArray(g.topNegative ?? g.top_negative)
      ? ((g.topNegative ?? g.top_negative) as unknown[])
      : []
    ).map(normalizeGexLevel),
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
  "balanced",
] as const satisfies readonly NiftyControlVerdict[];

const REGIME_VERDICTS = [
  "range_sell_premium",
  "trend_buy",
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
    doi: num(l.doi ?? l.oi_change ?? l.oiChange),
    initiated: num(l.initiated),
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
    strikes: rows.map((r): NiftyPositioningStrike => {
      const row = (r ?? {}) as Record<string, unknown>;
      return {
        strike: num(row.strike),
        ce: normalizePositioningLeg(row.ce),
        pe: normalizePositioningLeg(row.pe),
        netInitiated: num(row.net_initiated ?? row.netInitiated),
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
      open: num(row.open),
      high: num(row.high),
      low: num(row.low),
      close: num(row.close),
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
      period: num(row.period),
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
  const ohlc = (raw.ohlc ?? {}) as Record<string, unknown>;
  return {
    mode: raw.mode === "eod" ? "eod" : "live",
    date: String(raw.date ?? ""),
    expiry: String(raw.expiry ?? ""),
    spot: num(raw.spot),
    ohlc: {
      open: num(ohlc.open),
      high: num(ohlc.high),
      low: num(ohlc.low),
      close: num(ohlc.close),
    },
    pcrOi: num(raw.pcrOi ?? raw.pcr_oi),
    pcrVol: num(raw.pcrVol ?? raw.pcr_vol),
    maxPain: num(raw.maxPain ?? raw.max_pain),
    walls: { calls: walls.calls ?? [], puts: walls.puts ?? [] },
    strikes: (Array.isArray(raw.strikes) ? raw.strikes : []).map(
      (s): NiftyStrike => {
        const row = s as Record<string, Record<string, unknown>>;
        return {
          strike: num((s as Record<string, unknown>).strike),
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
    regime: normalizeRegime(raw.regime),
    vix: normalizeVix(raw.vix),
    strength: normalizeStrength(raw.strength),
    market: normalizeMarket(raw.market),
    positioning: normalizePositioning(raw.positioning),
    structure: normalizeStructure(raw.structure),
  };
}

export function normalizeSensex(raw: Record<string, unknown>): NiftySensex {
  const walls = (raw.walls ?? {}) as Record<string, { strike: number; oi: number }[]>;
  const ohlc = (raw.ohlc ?? {}) as Record<string, unknown>;
  return {
    symbol: "SENSEX",
    spot: num(raw.spot),
    expiry: String(raw.expiry ?? ""),
    pcrOi: num(raw.pcrOi ?? raw.pcr_oi),
    pcrVol: num(raw.pcrVol ?? raw.pcr_vol),
    maxPain: num(raw.maxPain ?? raw.max_pain),
    walls: { calls: walls.calls ?? [], puts: walls.puts ?? [] },
    ohlc: {
      open: num(ohlc.open),
      high: num(ohlc.high),
      low: num(ohlc.low),
      close: num(ohlc.close),
    },
    fetchedAt: (raw.fetchedAt ?? raw.fetched_at) as string | undefined,
    market: normalizeMarket(raw.market),
  };
}

async function parseNiftyResponse(response: Response): Promise<NiftyReport> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      (error as { detail?: string }).detail || "Failed to fetch Nifty report",
    );
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

export async function fetchLiveSensex(signal?: AbortSignal): Promise<NiftySensex> {
  const response = await fetchWithAuth(`${NIFTY_API_BASE}/sensex`, { signal });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error((error as { detail?: string }).detail || "Failed to fetch Sensex report");
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
  return {
    t: String(raw.t ?? raw.time ?? ""),
    spot: num(raw.spot),
    // ATM leg premiums — absent on tapes recorded before they were added.
    ...(raw.atm_strike !== undefined ? { atm_strike: num(raw.atm_strike) } : {}),
    ...(ceLtp !== undefined && ceLtp !== null ? { atm_ce_ltp: num(ceLtp) } : {}),
    ...(peLtp !== undefined && peLtp !== null ? { atm_pe_ltp: num(peLtp) } : {}),
    // Per-minute GEX + ATM IV — absent on tapes recorded before they were added.
    ...(raw.net_gex !== undefined && raw.net_gex !== null
      ? { net_gex: nullNum(raw.net_gex) }
      : {}),
    ...(raw.atm_ce_iv !== undefined && raw.atm_ce_iv !== null
      ? { atm_ce_iv: nullNum(raw.atm_ce_iv) }
      : {}),
    ...(raw.atm_pe_iv !== undefined && raw.atm_pe_iv !== null
      ? { atm_pe_iv: nullNum(raw.atm_pe_iv) }
      : {}),
    call_doi: num(raw.call_doi ?? raw.callDoi),
    put_doi: num(raw.put_doi ?? raw.putDoi),
    net: num(raw.net),
    net_pct: num(raw.net_pct ?? raw.netPct),
    call_tick: num(raw.call_tick ?? raw.callTick ?? raw.ticks),
    put_tick: num(raw.put_tick ?? raw.putTick ?? raw.ticks),
    pcr_vol: num(raw.pcr_vol ?? raw.pcrVol),
    pcr_oi: num(raw.pcr_oi ?? raw.pcrOi),
    pcr_doi: num(raw.pcr_doi ?? raw.pcrDoi),
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
    max_pain: num(raw.max_pain ?? raw.maxPain),
    flip: num(flipRaw),
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
  };
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
        const oi = num(row.oi);
        if (oi > bestOi) {
          bestOi = oi;
          best = num(row.strike);
        }
      }
      return best;
    };
    return { call: top(w.calls), put: top(w.puts) };
  }
  const call = num(w.call ?? w.calls);
  const put = num(w.put ?? w.puts);
  if (call === 0 && put === 0) return undefined;
  return { call, put };
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
    throw new Error(
      (error as { detail?: string }).detail || "Failed to fetch Nifty tape",
    );
  }
  const raw = (await response.json()) as Record<string, unknown>;
  const pcrOi = num(raw.pcr_oi ?? raw.pcrOi);
  const maxPain = num(raw.max_pain ?? raw.maxPain);
  const flip = num(raw.flip);
  const baselineRaw = raw.baseline_t ?? raw.baselineT;
  return {
    date: String(raw.date ?? date ?? ""),
    interval_sec: num(raw.interval_sec ?? raw.intervalSec, 60),
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

const BURST_SEVERITIES = ["info", "watch", "alert", "critical"] as const;

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
    sl: num(s.signal_sl ?? s.sl),
    target: num(s.signal_target ?? s.target),
    qty: num(s.signal_qty ?? s.qty),
    lots: num(s.signal_lots ?? s.lots),
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
        minutesAway: num(r.minutesAway ?? r.minutes_away),
      } satisfies NiftyBurstNews;
    })
    .filter((x): x is NiftyBurstNews => x !== null);
}

export function normalizeBurst(raw: Record<string, unknown>): NiftyBurst {
  const side: NiftyBurst["side"] = raw.side === "put" ? "put" : "call";
  const sevRaw = String(raw.severity ?? "").toLowerCase();
  const severity = (BURST_SEVERITIES as readonly string[]).includes(sevRaw)
    ? (sevRaw as NiftyBurst["severity"])
    : "watch";
  return {
    id: String(raw.id ?? ""),
    side,
    t: String(raw.t ?? raw.time ?? ""),
    delta: num(raw.delta),
    baseline: num(raw.baseline),
    score: num(raw.score),
    severity,
    cumDoi: num(raw.cumDoi ?? raw.cum_doi),
    spot: num(raw.spot),
    tickVol: num(raw.tickVol ?? raw.tick_vol),
    signal: normalizeBurstSignal(raw.signal),
    news: normalizeBurstNews(raw.news),
    ...(raw.type === "squeeze" || raw.type === "strike" || raw.type === "premium" || raw.type === "coil"
      ? { type: raw.type as "squeeze" | "strike" | "premium" | "coil" }
      : {}),
    ...(raw.wall !== undefined && raw.wall !== null ? { wall: num(raw.wall) } : {}),
    ...(raw.strike !== undefined && raw.strike !== null ? { strike: num(raw.strike) } : {}),
    ...(typeof raw.leg === "string" ? { leg: raw.leg } : {}),
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
    const data = await response.json().catch(() => null);
    const rows = Array.isArray(data)
      ? data
      : (data as { bursts?: unknown } | null)?.bursts;
    if (!Array.isArray(rows)) return [];
    return rows.map((r) => normalizeBurst((r ?? {}) as Record<string, unknown>));
  } catch {
    return [];
  }
}
