import {
  formatNumberIN,
  formatPercentage,
} from "@/utils/ui-helpers";

export type Tone = "positive" | "negative" | "muted";

export interface FmtInrOpts {
  /** Decimal places, default 0. */
  decimals?: number;
  /** Prefix a `+` for positive values, default false. */
  signed?: boolean;
}

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function fmtInr(value: number | null | undefined, opts: FmtInrOpts = {}): string {
  if (!finite(value)) return "—";
  const decimals = opts.decimals ?? 0;
  const abs = Math.abs(value);
  const body =
    decimals > 0
      ? abs.toLocaleString("en-IN", {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        })
      : formatNumberIN(Math.round(abs));
  const sign = value < 0 ? "-" : opts.signed && value > 0 ? "+" : "";
  return `${sign}₹${body}`;
}

export function fmtSignedInr(value: number | null | undefined): string {
  if (!finite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}₹${formatNumberIN(Math.round(Math.abs(value)))}`;
}

export function fmtPoints(value: number | null | undefined, decimals = 2): string {
  if (!finite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(decimals)} pts`;
}

export function fmtPct(value: number | null | undefined): string {
  if (!finite(value)) return "—";
  return formatPercentage(value, 2, value !== 0);
}

export function toneFor(value: number | null | undefined): Tone {
  if (!finite(value) || value === 0) return "muted";
  return value > 0 ? "positive" : "negative";
}

const ISO_TIME = /T(\d{2}):(\d{2})/;
const BARE_TIME = /^(\d{1,2}):(\d{2})/;

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const isoMatch = ISO_TIME.exec(iso);
  if (isoMatch) return `${isoMatch[1]}:${isoMatch[2]}`;

  const bare = BARE_TIME.exec(iso);
  if (bare) return `${bare[1].padStart(2, "0")}:${bare[2]}`;

  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  });
}

function timeMs(value: string): number | null {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function clockOf(value: string): string | null {
  const m = ISO_TIME.exec(value) ?? BARE_TIME.exec(value);
  if (!m) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

function compareTime(a: string, b: string): number {
  const am = timeMs(a);
  const bm = timeMs(b);
  if (am !== null && bm !== null) return am - bm;
  return a < b ? -1 : a > b ? 1 : 0;
}

function isBareTime(value: string): boolean {
  return /^\d{1,2}:\d{2}(:\d{2})?$/.test(value);
}

/**
 * Prefix ending at the last point at or before `asOf`. A bare `HH:MM`
 * playhead is compared against the clock time of each ISO timestamp.
 */
export function sliceEquityAt<T extends { t: string }>(
  equity: T[],
  asOf: string | null | undefined,
): T[] {
  if (!asOf) return equity;
  const bare = isBareTime(asOf);
  let last = -1;
  for (let i = 0; i < equity.length; i += 1) {
    const point = equity[i];
    const cmp = bare
      ? compareClock(point.t, asOf)
      : compareTime(point.t, asOf);
    if (cmp <= 0) last = i;
  }
  return last < 0 ? [] : equity.slice(0, last + 1);
}

function compareClock(value: string, clock: string): number {
  const own = clockOf(value);
  if (own === null) return compareTime(value, clock);
  return own < clock ? -1 : own > clock ? 1 : 0;
}

export function equityAt<T extends { t: string }>(
  equity: T[],
  asOf: string | null | undefined,
): T | null {
  const sliced = sliceEquityAt(equity, asOf);
  return sliced.length === 0 ? null : sliced[sliced.length - 1];
}

export function sumByTime(
  series: Array<Array<{ t: string; pnl: number }>>,
): Array<{ t: string; pnl: number }> {
  const totals = new Map<string, number>();
  for (const points of series) {
    for (const point of points) {
      if (!point || typeof point.t !== "string" || !Number.isFinite(point.pnl)) continue;
      totals.set(point.t, (totals.get(point.t) ?? 0) + point.pnl);
    }
  }
  return [...totals.entries()]
    .map(([t, pnl]) => ({ t, pnl }))
    .sort((a, b) => compareTime(a.t, b.t));
}
