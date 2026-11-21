/**
 * Pure view helpers for the Catalyst Radar panel.
 *
 * The panel renders and formats only. Everything here derives a *view* of the
 * payload the store already normalized — no scoring, no inference, no
 * fabricated confirmation. A missing metric stays missing (`null`), never zero.
 */
import { TZ_IST } from "@/config/constants";

export type CatalystFilter = "all" | "high" | "sector" | "scheduled";

export interface CatalystFilterOption {
  value: CatalystFilter;
  label: string;
}

/** Order is the toolbar order; the first entry is the default view. */
export const CATALYST_FILTERS: CatalystFilterOption[] = [
  { value: "all", label: "ALL" },
  { value: "high", label: "HIGH" },
  { value: "sector", label: "SECTOR" },
  { value: "scheduled", label: "SCHEDULED" },
];

/**
 * The store polls at most every 30s, so a payload older than five minutes means
 * the feed stopped moving — surfaced as STALE, never silently rendered as live.
 */
export const STALE_AFTER_MS = 5 * 60_000;

export interface CatalystBreadth {
  advancing?: number | null;
  declining?: number | null;
  total?: number | null;
}

export interface CatalystSectorView {
  id?: string | null;
  label?: string | null;
  change_pct?: number | null;
  breadth?: CatalystBreadth | null;
}

/** Structural mirror of the backend row (snake_case), plus null tolerance. */
export interface CatalystRowLike {
  symbol: string;
  name?: string | null;
  sector?: string | null;
  kind?: string | null;
  headline?: string | null;
  source?: string | null;
  source_url?: string | null;
  first_seen?: string | null;
  event_at?: string | null;
  state?: string | null;
  score?: string | null;
  confidence?: number | null;
  move_pct?: number | null;
  rel_volume?: number | null;
  reasons?: string[] | null;
  invalidates?: string[] | null;
}

export interface CatalystTodayView {
  as_of?: string | null;
  sector?: CatalystSectorView | null;
  rows?: CatalystRowLike[] | null;
  counts?: { high?: number; medium?: number; low?: number; total?: number } | null;
  warnings?: string[] | null;
}

/**
 * Single source for column alignment, consumed as `meta.align` by the table and
 * asserted directly by the test so a column can never silently lose its align.
 */
export const CATALYST_COLUMN_ALIGN = {
  symbol: "left",
  catalyst: "left",
  first_seen: "left",
  state: "center",
  confirmation: "right",
  score: "center",
} as const;

export type CatalystColumnId = keyof typeof CATALYST_COLUMN_ALIGN;

const SCORE_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

export function scoreRank(score: string | null | undefined): number {
  return SCORE_RANK[(score ?? "").toLowerCase()] ?? 0;
}

/**
 * `"TECHNOLOGY SERVICES"`, `"technology-services"` and `"Technology Services"`
 * name the same bucket; a row's sector is
 * written in the exchange's own words, so compare on the normalized token.
 */
function normalizeSector(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .toLowerCase()
    .replace(/^nifty\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function sectorMatches(
  rowSector: string | null | undefined,
  sectorValue: string | null | undefined,
): boolean {
  const row = normalizeSector(rowSector);
  const target = normalizeSector(sectorValue);
  if (!row || !target) return false;
  return row === target || row.includes(target) || target.includes(row);
}

/**
 * The payload carries one sector breadth (the focused sector), not per-row
 * breadth. Attach it only to rows that belong to that sector — never to a
 * different sector's row, which would read as a confirmation it does not have.
 */
export function rowSectorBreadth(
  row: CatalystRowLike,
  sector: CatalystSectorView | null | undefined,
): CatalystBreadth | null {
  if (!sector?.breadth) return null;
  const matches = sectorMatches(row.sector, sector.label) || sectorMatches(row.sector, sector.id);
  return matches ? sector.breadth : null;
}

export interface CatalystFilterOptions {
  sectorLabel?: string | null;
  sectorId?: string | null;
}

export function filterCatalystRows(
  rows: readonly CatalystRowLike[] | null | undefined,
  filter: CatalystFilter,
  options: CatalystFilterOptions = {},
): CatalystRowLike[] {
  const list = [...(rows ?? [])];
  switch (filter) {
    case "high":
      return list.filter((row) => (row.score ?? "").toLowerCase() === "high");
    case "scheduled":
      return list.filter((row) => (row.state ?? "").toLowerCase() === "scheduled");
    case "sector": {
      // Market-wide view has no single sector to narrow to.
      if (options.sectorId === "all") return list;
      // With no sector context there is nothing honest to attribute the filter
      // to; an empty list is the answer, not "everything".
      if (!options.sectorLabel && !options.sectorId) return [];
      return list.filter(
        (row) =>
          sectorMatches(row.sector, options.sectorLabel) ||
          sectorMatches(row.sector, options.sectorId),
      );
    }
    default:
      return list;
  }
}

function timestamp(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

/**
 * Highest score first, then newest sighting. Missing `first_seen` sorts last in
 * both directions (TanStackTable applies the same rule when a header is clicked).
 */
export function sortCatalystRows(rows: readonly CatalystRowLike[]): CatalystRowLike[] {
  return [...rows].sort((a, b) => {
    const byScore = scoreRank(b.score) - scoreRank(a.score);
    if (byScore !== 0) return byScore;
    const aTime = timestamp(a.first_seen);
    const bTime = timestamp(b.first_seen);
    if (aTime !== bTime) {
      if (aTime === Number.NEGATIVE_INFINITY) return 1;
      if (bTime === Number.NEGATIVE_INFINITY) return -1;
      return bTime - aTime;
    }
    return (a.symbol ?? "").localeCompare(b.symbol ?? "");
  });
}

export function confirmedCount(rows: readonly CatalystRowLike[] | null | undefined): number {
  return (rows ?? []).filter((row) => (row.state ?? "").toLowerCase() === "confirmed").length;
}

function signedPct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export interface ConfirmationFacts {
  move: string | null;
  volume: string | null;
  breadth: string | null;
}

/** The three confirmations the contract allows, each present only when measured. */
export function confirmationFacts(
  row: CatalystRowLike,
  breadth?: CatalystBreadth | null,
): ConfirmationFacts {
  const move =
    typeof row.move_pct === "number" && Number.isFinite(row.move_pct)
      ? signedPct(row.move_pct)
      : null;
  const volume =
    typeof row.rel_volume === "number" && Number.isFinite(row.rel_volume)
      ? `${row.rel_volume.toFixed(1)}× vol`
      : null;

  let breadthText: string | null = null;
  const advancing = breadth?.advancing;
  const total = breadth?.total;
  const declining = breadth?.declining;
  if (typeof advancing === "number" && Number.isFinite(advancing)) {
    if (typeof total === "number" && Number.isFinite(total)) {
      breadthText = `${advancing}/${total} adv`;
    } else if (typeof declining === "number" && Number.isFinite(declining)) {
      breadthText = `${advancing}/${advancing + declining} adv`;
    }
  }

  return { move, volume, breadth: breadthText };
}

export function confirmationText(
  row: CatalystRowLike,
  breadth?: CatalystBreadth | null,
): string {
  const facts = confirmationFacts(row, breadth);
  const parts = [facts.move, facts.volume, facts.breadth].filter(
    (part): part is string => part != null,
  );
  return parts.length > 0 ? parts.join(" · ") : "none";
}

/**
 * Sort key for the composite confirmation column: the measured move dominates,
 * relative volume is the fallback. `null` keeps unconfirmed rows last.
 */
export function confirmationSortValue(row: CatalystRowLike): number | null {
  if (typeof row.move_pct === "number" && Number.isFinite(row.move_pct)) {
    return Math.abs(row.move_pct);
  }
  if (typeof row.rel_volume === "number" && Number.isFinite(row.rel_volume)) {
    return row.rel_volume;
  }
  return null;
}

const clockFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ_IST,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const dayFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ_IST,
  day: "2-digit",
  month: "short",
});

/** IST clock, independent of the host timezone (the payload is +05:30). */
export function formatIstClock(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : clockFormat.format(date);
}

/** Short IST stamp for the expanded detail: `19 Nov · 10:31`. */
export function formatIstStamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return `${dayFormat.format(date)} · ${clockFormat.format(date)}`;
}

/**
 * An unparseable or future `as_of` is unknown, not stale — clock skew must not
 * paint a warning the data cannot justify.
 */
export function isStale(
  asOf: string | null | undefined,
  now: number,
  threshold: number = STALE_AFTER_MS,
): boolean {
  if (!asOf) return false;
  const seen = Date.parse(asOf);
  if (!Number.isFinite(seen)) return false;
  if (seen > now) return false;
  return now - seen > threshold;
}

/** `event_source_unavailable` → `EVENT SOURCE UNAVAILABLE`. */
export function warningLabel(id: string): string {
  return id.trim().replace(/[_-]+/g, " ").toUpperCase();
}

export function warningLabels(warnings: readonly string[] | null | undefined): string[] {
  return (warnings ?? []).filter((warning) => warning.trim() !== "").map(warningLabel);
}

/** Only http(s) source links are rendered — a `javascript:` URL is not a source. */
export function isSafeSourceUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
