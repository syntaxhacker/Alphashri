import {
  NEGATIVE,
  POSITIVE,
  PRIMARY,
  SCALE_GRAY,
  SCALE_GREEN,
  SCALE_RED,
  SURFACE,
} from "@/ui/palette";
import { typeSize } from "@/ui/typography";

/** SVG text uses the shared 12px floor; viewBox units scale with the panel. */
export const SVG_TEXT = String(typeSize("micro"));

export function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export function monthName(index: number): string {
  return MONTH_NAMES[((Math.round(index) % 12) + 12) % 12];
}

export function monthIndex(month: string): number {
  const match = /^(\d{4})-(\d{2})/.exec(month);
  if (!match) return 0;
  const parsed = Number(match[2]) - 1;
  return Math.max(0, Math.min(11, parsed));
}

export function yearOf(month: string): string {
  return /^\d{4}/.test(month) ? month.slice(0, 4) : "";
}

/** Newest month that actually carries a rank, not a metadata `as_of` that can lag the payload. */
export function latestRankMonth(
  months: string[],
  series: Array<{ is_benchmark?: boolean; ranks?: (number | null)[] }>,
): string {
  for (let index = months.length - 1; index >= 0; index -= 1) {
    if (
      series.some(
        (item) =>
          !item.is_benchmark &&
          typeof item.ranks?.[index] === "number" &&
          Number.isFinite(item.ranks[index]),
      )
    ) {
      return months[index];
    }
  }
  return months[months.length - 1] ?? "";
}

export function monthEnd(month: string): string {
  const match = /^(\d{4})-(\d{2})/.exec(month);
  if (!match) return "";
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (monthNumber < 1 || monthNumber > 12) return "";
  const day = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return `${year}-${String(monthNumber).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function truncate(text: string, max: number): string {
  if (max < 2 || text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export function signedPct(value: number, digits = 1): string {
  const rounded = Number(value.toFixed(digits)) || 0;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(digits)}%`;
}

export function rankTone(rank: number, count: number): { fill: string; opacity: number } {
  if (count <= 1) return { fill: SURFACE, opacity: 1 };
  const t = Math.max(0, Math.min(1, (rank - 1) / (count - 1)));
  const strength = 1 - Math.abs(t - 0.5) * 2;
  if (t < 0.5) return { fill: POSITIVE, opacity: 0.14 + 0.56 * strength };
  if (t > 0.5) return { fill: NEGATIVE, opacity: 0.14 + 0.56 * strength };
  return { fill: SURFACE, opacity: 1 };
}

const SERIES_ACCENTS = [
  PRIMARY,
  SCALE_GREEN[4],
  SCALE_RED[4],
  SCALE_GREEN[7],
  SCALE_RED[7],
  SCALE_GRAY[1],
];

export function seriesAccent(index: number): string {
  return SERIES_ACCENTS[index % SERIES_ACCENTS.length];
}

export function hitRatePercent(hitRate: number): number {
  if (!finite(hitRate)) return 0;
  return hitRate <= 1 ? hitRate * 100 : hitRate;
}
