import { DEFAULT_MAX_GAP_DAYS, MONTHS } from "./constants";
import type { AgriEdaPoint } from "./types";

/** A finite number, or `null` for null / undefined / NaN / ±Infinity. */
export function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function rowsOf(series: AgriEdaPoint[] | null | undefined): AgriEdaPoint[] {
  return Array.isArray(series) ? series : [];
}

export function modalOf(point: AgriEdaPoint | null | undefined): number | null {
  return finite(point?.modal);
}

export function arrivalsOf(point: AgriEdaPoint | null | undefined): number | null {
  return finite(point?.arrivals_qtl);
}

/** `YYYY-MM` bucket plus month index; rejects non-strings and month 13+. */
export function monthParts(date: unknown): { key: string; year: string; month: number; mm: string } | null {
  if (typeof date !== "string") return null;
  const match = /^(\d{4})-(\d{2})/.exec(date);
  if (!match) return null;
  const month = Number(match[2]);
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return { key: `${match[1]}-${match[2]}`, year: match[1], month, mm: match[2] };
}

export function monthLabel(key: string): string {
  const parts = monthParts(key);
  if (!parts) return key;
  const name = MONTHS[parts.month - 1] ?? parts.mm;
  return `${name} ${parts.year.slice(2)}`;
}

export function meanOf(values: number[]): number {
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

/** Population standard deviation (divide by n), documented for the band. */
export function stdOf(values: number[], mean: number): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const value of values) {
    const delta = value - mean;
    sum += delta * delta;
  }
  return Math.sqrt(sum / values.length);
}

/** Linear interpolation between order statistics (R type 7). */
export function quantile(sorted: number[], probability: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * probability;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

export function sortedModals(series: AgriEdaPoint[] | null | undefined): number[] {
  const values: number[] = [];
  for (const point of rowsOf(series)) {
    const value = modalOf(point);
    if (value != null) values.push(value);
  }
  return values.sort((a, b) => a - b);
}

export function normalizeWindow(window: number, fallback = 7): number {
  return Number.isFinite(window) ? Math.max(1, Math.floor(window)) : fallback;
}

/** UTC-midnight day number for a strict `YYYY-MM-DD`; rejects rolled dates. */
export function dayNumber(date: unknown): number | null {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  // Date.parse turns 2026-02-31 into March; round-tripping rejects that.
  return new Date(ms).toISOString().slice(0, 10) === date ? ms : null;
}

export function maxGapOf(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : DEFAULT_MAX_GAP_DAYS;
}

export function addDays(date: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  const shifted = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(shifted.getTime())) return "";
  shifted.setUTCDate(shifted.getUTCDate() + Math.trunc(days));
  return shifted.toISOString().slice(0, 10);
}
