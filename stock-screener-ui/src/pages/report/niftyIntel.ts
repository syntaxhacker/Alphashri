/**
 * Nifty desk intel — official Upstox FII/DII, ΔOI, max-pain, PCR + headlines.
 *
 * Pure types/formatters plus one fetch. The backend degrades per source, so a
 * field can be `null` while the rest of the block is usable; the strip renders
 * an em dash for those instead of hiding the whole row.
 */

import { fetchWithAuth } from "@/state/auth";
import { API_BASE } from "@/api/config";
import {
  REPORT_DASH,
  REPORT_MINUS,
  formatReportCompact,
  formatReportNum,
  formatReportRatio,
} from "./reportFormat";

export const NIFTY_INTEL_URL = `${API_BASE}/api/reports/nifty/intel`;

/** How often the desk refreshes the intel strip. */
export const NIFTY_INTEL_POLL_MS = 5 * 60 * 1000;

export interface NiftyIntelStrike {
  strike: number;
  doi: number;
}

interface NiftyIntelNews {
  heading: string;
  link: string;
  published: string;
}

export interface NiftyIntel {
  date: string;
  expiry: string;
  fii_net: number | null;
  dii_net: number | null;
  dce_oi: number | null;
  dpe_oi: number | null;
  top_dce: NiftyIntelStrike[];
  top_dpe: NiftyIntelStrike[];
  max_pain: number | null;
  pcr: number | null;
  news: NiftyIntelNews[];
  unavailable: string[];
  as_of: string;
}

export const EMPTY_INTEL: NiftyIntel = {
  date: "",
  expiry: "",
  fii_net: null,
  dii_net: null,
  dce_oi: null,
  dpe_oi: null,
  top_dce: [],
  top_dpe: [],
  max_pain: null,
  pcr: null,
  news: [],
  unavailable: [],
  as_of: "",
};

function numOrNull(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : (value as number);
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function normalizeStrikes(raw: unknown): NiftyIntelStrike[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      const r = (row ?? {}) as Record<string, unknown>;
      const strike = numOrNull(r.strike);
      const doi = numOrNull(r.doi);
      return strike !== null && doi !== null ? { strike, doi } : null;
    })
    .filter((row): row is NiftyIntelStrike => row !== null);
}

export function normalizeNiftyIntel(raw: Record<string, unknown>): NiftyIntel {
  const news = Array.isArray(raw.news)
    ? raw.news.map((item) => {
        const n = (item ?? {}) as Record<string, unknown>;
        return {
          heading: str(n.heading),
          link: str(n.link),
          published: str(n.published, "—"),
        };
      })
    : [];
  return {
    date: str(raw.date),
    expiry: str(raw.expiry),
    fii_net: numOrNull(raw.fii_net),
    dii_net: numOrNull(raw.dii_net),
    dce_oi: numOrNull(raw.dce_oi),
    dpe_oi: numOrNull(raw.dpe_oi),
    top_dce: normalizeStrikes(raw.top_dce),
    top_dpe: normalizeStrikes(raw.top_dpe),
    max_pain: numOrNull(raw.max_pain),
    pcr: numOrNull(raw.pcr),
    news,
    unavailable: Array.isArray(raw.unavailable)
      ? raw.unavailable.filter((v): v is string => typeof v === "string")
      : [],
    as_of: str(raw.as_of),
  };
}

/** Fetch the desk intel block; throws only when the HTTP call itself fails.
 *
 * `date` / `expiry` pin the upstream session so a replayed frame reads that
 * frame's intel instead of silently showing the latest session. They are
 * optional because the backend defaults to today IST + current-week expiry.
 */
export async function fetchNiftyIntel(
  signal?: AbortSignal,
  opts: { date?: string | null; expiry?: string | null } = {},
): Promise<NiftyIntel> {
  const params = new URLSearchParams();
  if (opts.date) params.set("date", opts.date);
  if (opts.expiry) params.set("expiry", opts.expiry);
  const query = params.toString();
  const response = await fetchWithAuth(
    query ? `${NIFTY_INTEL_URL}?${query}` : NIFTY_INTEL_URL,
    { signal },
  );
  if (!response.ok) {
    throw new Error(`Nifty intel failed (${response.status})`);
  }
  const raw = (await response.json()) as Record<string, unknown>;
  return normalizeNiftyIntel(raw ?? {});
}

export const INTEL_DASH = REPORT_DASH;

/** Signed Indian-grouped integer, e.g. `+3,201` / `−1,149`. */
export function fmtIntelSigned(value: number | null | undefined, digits = 0): string {
  return formatReportNum(value, {
    digits,
    minDigits: digits,
    sign: "nonzero",
    minus: REPORT_MINUS,
  });
}

/** Plain Indian-grouped integer (max pain etc.), or a dash. */
export function fmtIntelInt(value: number | null | undefined): string {
  return formatReportNum(value, { round: true });
}

/** Signed ΔOI in compact contract units, e.g. `+96M`, `−1.2M`. */
export function fmtIntelOi(value: number | null | undefined): string {
  return formatReportCompact(value, {
    sign: "nonzero",
    minus: REPORT_MINUS,
    millions: 1,
    smartMillions: true,
    thousands: 0,
    grouped: false,
  });
}

/** PCR to 2dp, or a dash. */
export function fmtIntelPcr(value: number | null | undefined): string {
  return formatReportRatio(value);
}

/**
 * Flow tone: positive net buying is green, selling red, flat/absent muted.
 * FII/DII are cash-market rupee flows, so sign is the whole signal.
 */
export function flowTone(value: number | null | undefined, palette: {
  POSITIVE: string;
  NEGATIVE: string;
  TEXT_MUTED: string;
}): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) {
    return palette.TEXT_MUTED;
  }
  return value > 0 ? palette.POSITIVE : palette.NEGATIVE;
}

/**
 * ΔOI tone by option side: call build is bearish (red), put build bullish
 * (green), and unwinds invert. Matches the flow strip's side convention.
 */
export function oiTone(
  value: number | null | undefined,
  side: "call" | "put",
  palette: { POSITIVE: string; NEGATIVE: string; TEXT_MUTED: string },
): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) {
    return palette.TEXT_MUTED;
  }
  const bullish = side === "put" ? value > 0 : value < 0;
  return bullish ? palette.POSITIVE : palette.NEGATIVE;
}

/**
 * `as of` label for the drawer: ISO instant → `21 Oct 2026, 20:00 IST`.
 * Raw ISO strings (`2026-10-21T20:00:00+05:30`) leaked the transport format
 * into the desk UI; anything unparseable is returned untouched.
 */
export function formatIntelAsOf(value: string | null | undefined): string {
  const text = (value ?? "").trim();
  if (!text) return "";
  const at = new Date(text);
  if (Number.isNaN(at.getTime())) return text;
  return `${at.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })} IST`;
}
