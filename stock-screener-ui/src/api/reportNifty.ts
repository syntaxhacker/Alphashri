/**
 * Nifty report API client.
 */

import { fetchWithAuth } from "../state/auth";
import type {
  NiftyOptionSide,
  NiftyReport,
  NiftyStrike,
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
