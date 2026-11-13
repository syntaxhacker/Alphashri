/**
 * Shared row-badge + date helpers for the pattern rows (watch list, results
 * list). Tag membership, the F&O/ETF badges and the compact date formats were
 * copied across WatchView / PatternListView; they live here so every surface
 * renders them identically.
 */

import { createMemo, Show } from "solid-js";
import { Badge } from "@/ui";
import { formatChartTimestamp } from "./datetime";

/** Backend `tags` on a row (F&O / ETF). Always an array of strings; missing/invalid → []. */
export function rowTags(row: { tags?: unknown } | null | undefined): string[] {
  const tags = row?.tags;
  if (!Array.isArray(tags)) return [];
  return tags.filter((t): t is string => typeof t === "string");
}

/** True when the backend `tags` array carries `tag`. Never throws on missing. */
export function hasTag(row: { tags?: unknown } | null | undefined, tag: string): boolean {
  return rowTags(row).includes(tag);
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * "2026-11-05" → "5 Nov" (badge text; the year lives in the caller's tooltip).
 * Null when missing/unparseable.
 */
export function shortIstDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = DATE_ONLY_RE.exec(String(iso).trim());
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!Number.isFinite(month) || month < 1 || month > 12) return null;
  if (!Number.isFinite(day) || day < 1 || day > 31) return null;
  return `${day} ${MONTHS_SHORT[month - 1]}`;
}

/**
 * Full, human-readable date for tooltips (e.g. "05 Nov 2026"). Delegates to
 * the chart timestamp formatter so tooltips read identically to the charts.
 * Null when missing.
 */
export function fullDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return formatChartTimestamp(String(iso));
}

export interface PatternTagsProps {
  /** Backend `tags` (F&O / ETF). Tolerated null/undefined — renders nothing. */
  tags: string[] | null | undefined;
  symbol: string;
  /** Testid namespace: badges land at `${testIdPrefix}-tag-fno-${symbol}` / `${testIdPrefix}-tag-etf-${symbol}`. */
  testIdPrefix: string;
  /** Render the ETF badge too (default true). The results list hides it to keep its current DOM. */
  showEtf?: boolean;
  /** Dense inline layout for ~28px table rows (size xs, tight gap). Default true. */
  compact?: boolean;
}

/**
 * F&O (info) / ETF (warning) badges rendered next to the symbol. Additive
 * only — rows without matching tags render nothing extra.
 */
export function PatternTags(props: PatternTagsProps) {
  const list = createMemo(() => rowTags({ tags: props.tags }));
  const fno = () => list().includes("F&O");
  const etf = () => (props.showEtf ?? true) && list().includes("ETF");
  const size = () => ((props.compact ?? true) ? "xs" : "sm");
  return (
    <>
      <Show when={fno()}>
        <Badge
          color="info"
          size={size()}
          data-testid={`${props.testIdPrefix}-tag-fno-${props.symbol}`}
        >
          {"F&O"}
        </Badge>
      </Show>
      <Show when={etf()}>
        <Badge
          color="warning"
          size={size()}
          data-testid={`${props.testIdPrefix}-tag-etf-${props.symbol}`}
        >
          ETF
        </Badge>
      </Show>
    </>
  );
}
