/**
 * Compact freshness badge logic for the Nifty report header.
 *
 * Pure function — no React, no side effects. Returns the label and whether
 * it should use the warning (stale) colour.
 */

import {
  DATA_STALE_AFTER_MS,
  formatFreshnessAge,
  type DataFreshness,
} from "./niftyDataFreshness";

/** The only two fields freshness needs — lets both `NiftyBurst` and the
 *  client-side `OiBurst` feed the same badge. */
export interface FreshnessBurst {
  t?: string | null;
  type?: string | null;
}

export interface NiftyFreshnessInput {
  /** Current wall-clock time (epoch ms). */
  nowMs: number;
  /**
   * The newest backend timestamp from report/tape/bursts (epoch ms), or null if
   * unavailable. Legacy fallback only — a `max()` of all sources lets a fresh
   * `fetched_at` hide a tape that stopped hours ago.
   */
  lastBackendMs?: number | null;
  /** True when the NSE cash session is open. */
  marketOpen: boolean;
  /** Burst array — checked for `type === "data_stale"`. */
  bursts?: FreshnessBurst[] | null;
  /**
   * Authoritative read from `dataFreshness()`. When supplied it decides the
   * label and staleness; the tape is the freshness authority there.
   */
  authoritative?: DataFreshness | null;
}

export interface NiftyFreshnessOutput {
  /** Badge text: `DATA 42s`, `STALE`, or `CLOSED`. */
  label: string;
  /** True when the badge should use warning colour (STALE). */
  isStale: boolean;
  /** Tooltip detail. */
  detail: string;
}

/**
 * Check if any burst signals stale data.
 */
function hasDataStaleBurst(bursts?: FreshnessBurst[] | null): boolean {
  if (!bursts || bursts.length === 0) return false;
  return bursts.some((b) => b?.type === "data_stale");
}

/**
 * Compute the freshness badge state.
 *
 * Rules:
 * - Market closed → `CLOSED` (dim), never STALE.
 * - Market open & `data_stale` burst present → `STALE` (warning).
 * - Market open & newest timestamp ≤ `DATA_STALE_AFTER_MS` ago → `DATA 42s` (dim).
 * - Market open & newest timestamp > `DATA_STALE_AFTER_MS` ago → `STALE` (warning).
 * - Market open & no timestamp available → `DATA —` (dim).
 */
export function computeNiftyFreshness(input: NiftyFreshnessInput): NiftyFreshnessOutput {
  const { nowMs, marketOpen, bursts } = input;

  // Market closed: always CLOSED, never stale
  if (!marketOpen) {
    return {
      label: "CLOSED",
      isStale: false,
      detail: "Market closed — data reflects last session",
    };
  }

  // data_stale burst forces STALE regardless of timestamp age
  if (hasDataStaleBurst(bursts)) {
    return {
      label: "STALE",
      isStale: true,
      detail: "Backend flagged stale data (data_stale burst)",
    };
  }

  // The shipped badge passes this in: dataFreshness() owns the data-age rule,
  // this function only applies the two UI overrides above it.
  if (input.authoritative) {
    return {
      label: input.authoritative.label,
      isStale: input.authoritative.stale,
      detail: input.authoritative.detail,
    };
  }

  const lastBackendMs = input.lastBackendMs;
  // No timestamp available
  if (lastBackendMs === null || lastBackendMs === undefined || !Number.isFinite(lastBackendMs)) {
    return {
      label: "DATA —",
      isStale: false,
      detail: "No backend timestamp available",
    };
  }

  const ageMs = Math.max(0, nowMs - lastBackendMs);
  const isStale = ageMs > DATA_STALE_AFTER_MS;

  return {
    label: isStale ? "STALE" : `DATA ${formatFreshnessAge(ageMs)}`,
    isStale,
    detail: isStale
      ? `Last update ${formatFreshnessAge(ageMs)} ago (tape stopped)`
      : `Last update ${formatFreshnessAge(ageMs)} ago`,
  };
}

/**
 * The WS-outage badge names its own signal. Calling it "STALE" put a warning
 * next to a fresh DATA badge during a reconnect, reading as a contradiction.
 */
export function wsBadgeLabel(staleMins: number): string {
  return `WS DOWN ${Math.max(1, staleMins)}m`;
}
