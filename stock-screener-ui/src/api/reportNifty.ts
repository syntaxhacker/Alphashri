/**
 * Nifty report API client.
 */

import { fetchWithAuth } from "../state/auth";
import type {
  NiftyBurst,
  NiftyBurstNews,
  NiftyBurstSignal,
  NiftyGex,
  NiftyGexLevel,
  NiftyGexStrike,
  NiftyOptionSide,
  NiftyReport,
  NiftyStrike,
  NiftyTape,
  NiftyTapeRow,
  NiftyTimelineEvent,
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
    fetchedAt: (raw.fetchedAt ?? raw.fetched_at) as string | undefined,
    snapshotAt: (raw.snapshotAt ?? raw.snapshot_at) as string | undefined,
    gex: normalizeGex(raw.gex),
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
    ...(raw.type === "squeeze" || raw.type === "strike"
      ? { type: raw.type as "squeeze" | "strike" }
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
