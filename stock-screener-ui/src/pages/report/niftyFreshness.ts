/**
 * Compact freshness badge logic for the Nifty report header.
 *
 * Pure function — no React, no side effects. Returns the label and whether
 * it should use the warning (stale) colour.
 */

import type { NiftyBurst } from "@/types/niftyReport";
import { formatFreshnessAge } from "./niftyDataFreshness";

export interface NiftyFreshnessInput {
  /** Current wall-clock time (epoch ms). */
  nowMs: number;
  /** The newest backend timestamp from report/tape/bursts (epoch ms), or null if unavailable. */
  lastBackendMs: number | null;
  /** True when the NSE cash session is open. */
  marketOpen: boolean;
  /** Burst array — checked for `type === "data_stale"`. */
  bursts?: NiftyBurst[] | null;
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
function hasDataStaleBurst(bursts?: NiftyBurst[] | null): boolean {
  if (!bursts || bursts.length === 0) return false;
  return bursts.some((b) => b?.type === "data_stale");
}

/**
 * Compute the freshness badge state.
 *
 * Rules:
 * - Market closed → `CLOSED` (dim), never STALE.
 * - Market open & `data_stale` burst present → `STALE` (warning).
 * - Market open & last backend timestamp ≤ 120s ago → `DATA 42s` (dim).
 * - Market open & last backend timestamp > 120s ago → `STALE` (warning).
 * - Market open & no timestamp available → `DATA —` (dim).
 */
export function computeNiftyFreshness(input: NiftyFreshnessInput): NiftyFreshnessOutput {
  const { nowMs, lastBackendMs, marketOpen, bursts } = input;

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

  // No timestamp available
  if (lastBackendMs === null || !Number.isFinite(lastBackendMs)) {
    return {
      label: "DATA —",
      isStale: false,
      detail: "No backend timestamp available",
    };
  }

  const ageMs = Math.max(0, nowMs - lastBackendMs);
  const isStale = ageMs > 120_000; // 2 minutes

  return {
    label: isStale ? "STALE" : `DATA ${formatFreshnessAge(ageMs)}`,
    isStale,
    detail: isStale
      ? `Last update ${formatFreshnessAge(ageMs)} ago (tape stopped)`
      : `Last update ${formatFreshnessAge(ageMs)} ago`,
  };
}