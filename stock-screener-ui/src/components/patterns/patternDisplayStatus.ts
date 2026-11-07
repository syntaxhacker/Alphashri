/**
 * Derives the *display* status for a pattern-hit status pill from the raw DB
 * status plus the live price vs the consolidation box.
 *
 * The DB status lies for range bases: a valid base mid-box is `failed` while a
 * stale breakout from weeks ago is still `confirmed`. This derivation replaces
 * the pill label/tone so the user sees what the setup actually is right now.
 *
 * Rules:
 *  - Missing/non-positive price or trigger → raw status passthrough.
 *  - Non-base (reversal etc.) → raw status passthrough (never relabel as ARMED).
 *  - Base with price above trigger:
 *      > 5%   → EXTENDED  (warning)  — move already in progress
 *      0..5%  → BREAKOUT  (success)  — closed above the trigger
 *  - Base below trigger:
 *      inside box (≥ lower, or no lower edge) → ARMED  (info)
 *      below box                              → INVALID (error) — setup broken
 */

import type { PatternHitDTO } from "@/types/chartPatterns";
import { triggerLevels } from "./triggerDistance";

export type DisplayTone = "success" | "warning" | "error" | "info" | "neutral";

export interface DisplayStatus {
  label: string;
  tone: DisplayTone;
  tooltip: string;
}

const RAW_LABELS: Record<string, string> = {
  confirmed: "CONFIRMED",
  forming: "FORMING",
  failed: "FAILED",
  marginal: "MARGINAL",
};

const RAW_TONES: Record<string, DisplayTone> = {
  confirmed: "success",
  forming: "info",
  failed: "error",
  marginal: "neutral",
};

function isPositive(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function rawStatusFallback(rawStatus: string): DisplayStatus {
  const key = String(rawStatus ?? "").toLowerCase();
  return {
    label: RAW_LABELS[key] ?? (key.toUpperCase() || "UNKNOWN"),
    tone: RAW_TONES[key] ?? "neutral",
    tooltip: key ? `DB status: ${rawStatus}` : "DB status: —",
  };
}

export function patternDisplayStatus(args: {
  rawStatus: string; // hit.status
  isBase: boolean; // hit.base_days > 0 || hit.pattern_id === "consolidation"
  lastClose?: number | null; // current close shown on the card
  upper?: number | null; // box top / breakout trigger
  lower?: number | null; // box bottom
}): DisplayStatus {
  const { rawStatus, isBase, lastClose, upper, lower } = args;

  // Without a live price and a breakout trigger we cannot place the price in
  // the box — fall back to the raw DB status.
  if (!isPositive(lastClose) || !isPositive(upper)) {
    return rawStatusFallback(rawStatus);
  }

  // Reversal / non-consolidation patterns keep the raw DB status; they have no
  // box to be inside, so never relabel them as ARMED.
  if (!isBase) {
    return rawStatusFallback(rawStatus);
  }

  const dist = ((lastClose - upper) / upper) * 100;

  if (dist > 5) {
    return {
      label: "EXTENDED",
      tone: "warning",
      tooltip: `More than 5% above the breakout trigger — the move is already in progress · raw: ${rawStatus}`,
    };
  }

  if (dist >= 0) {
    return {
      label: "BREAKOUT",
      tone: "success",
      tooltip: `Closed above the trigger · raw: ${rawStatus}`,
    };
  }

  // dist < 0: price is below the trigger.
  if (lower == null || !Number.isFinite(lower) || lastClose >= lower) {
    return {
      label: "ARMED",
      tone: "info",
      tooltip: `Inside the base, below the trigger · raw: ${rawStatus}`,
    };
  }

  return {
    label: "INVALID",
    tone: "error",
    tooltip: `Below the base — the setup is broken · raw: ${rawStatus}`,
  };
}

/**
 * Convenience wrapper for surfaces that only have the hit (list, fullscreen,
 * chart body): resolves the box edges from the hit's trendlines/pivots and
 * derives the display status with the same rules as the card pill.
 */
export function displayStatusForHit(hit: PatternHitDTO): DisplayStatus {
  const isBase = hit.pattern_id === "consolidation" || (hit.base_days ?? 0) > 0;
  const { upper, lower } = isBase ? triggerLevels(hit) : { upper: null, lower: null };
  return patternDisplayStatus({
    rawStatus: hit.status,
    isBase,
    lastClose: hit.last_close ?? null,
    upper,
    lower,
  });
}
