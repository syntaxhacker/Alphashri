/**
 * Test-only keepers for option-chain arithmetic that is not used in production.
 *
 * These helpers used to be exported from `optionChainMetrics.ts`, but only the
 * test suite calls them. They live here so the desk's OI/sentiment read stays
 * pinned by tests without shipping unused exports in the production module.
 */

import { safeNum } from "@/utils/reportParsers";
import type { ChainRow, ChainSide } from "./optionChainMetrics";

type ChainSortKey = "strike" | "oi" | "volume" | "oiChange";

export interface ChainSummary {
  ceWriters: number;
  ceBuyers: number;
  peWriters: number;
  peBuyers: number;
  /** Signed Σ CE ΔOI (writers positive, unwinding negative). */
  netCe: number;
  /** Signed Σ PE ΔOI. */
  netPe: number;
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function oiChange(leg: ChainSide): number {
  return safeNum(leg.oi_change ?? leg.oiChange);
}

function oi(leg: ChainSide): number {
  return safeNum(leg.oi);
}

function volume(leg: ChainSide): number {
  return safeNum(leg.volume);
}

/**
 * Today's OI build as a percent of yesterday's OI:
 * `oi_change / max(oi - oi_change, 1) * 100`.
 *
 * Returns `null` when `oi` or `oi_change` is absent/non-finite. A zero
 * `oi_change` is a real value (flat day), not a missing one.
 */
export function oiChangePct(leg: ChainSide): number | null {
  const change = finiteOrNull(leg.oi_change ?? leg.oiChange);
  const total = finiteOrNull(leg.oi);
  if (change === null || total === null) return null;
  const base = Math.max(total - change, 1);
  return (change / base) * 100;
}

/** Row-level sort metric: both legs summed, so sorting is side-symmetric. */
function sortValue(row: ChainRow, by: ChainSortKey): number {
  switch (by) {
    case "strike":
      return safeNum(row.strike);
    case "oi":
      return oi(row.ce) + oi(row.pe);
    case "volume":
      return volume(row.ce) + volume(row.pe);
    case "oiChange":
      return oiChange(row.ce) + oiChange(row.pe);
  }
}

/**
 * Stable chain ordering — ascending strike, descending OI/volume/ΔOI. Equal
 * values keep their incoming order. Returns a new array; the input is never
 * mutated.
 */
export function sortChainRows(rows: ChainRow[], by: ChainSortKey): ChainRow[] {
  const direction = by === "strike" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, value: sortValue(row, by) }))
    .sort((a, b) => {
      if (a.value !== b.value) return (a.value - b.value) * direction;
      return a.index - b.index;
    })
    .map((entry) => entry.row);
}

function finish(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function sentimentLabel(leg: ChainSide): string {
  const sentiment = leg.sentiment;
  const raw =
    typeof sentiment === "string" ? sentiment : sentiment?.label ?? "";
  return raw.trim().toUpperCase();
}

/**
 * Writer/buyer totals across the chain.
 *
 * Sentiment labels are bucketed exactly as the desk reads them: `SB` (short
 * buildup) is a writer, `LB` (long buildup) is a buyer. Other/absent labels
 * do not contribute, but every leg's ΔOI is still counted in `netCe`/`netPe`.
 */
export function chainSummary(rows: ChainRow[]): ChainSummary {
  let ceWriters = 0;
  let ceBuyers = 0;
  let peWriters = 0;
  let peBuyers = 0;
  let netCe = 0;
  let netPe = 0;

  for (const row of rows) {
    const ceChange = oiChange(row.ce);
    const peChange = oiChange(row.pe);
    netCe += ceChange;
    netPe += peChange;

    const ceLabel = sentimentLabel(row.ce);
    if (ceLabel === "SB") ceWriters += ceChange;
    else if (ceLabel === "LB") ceBuyers += ceChange;

    const peLabel = sentimentLabel(row.pe);
    if (peLabel === "SB") peWriters += peChange;
    else if (peLabel === "LB") peBuyers += peChange;
  }

  return {
    ceWriters: finish(ceWriters),
    ceBuyers: finish(ceBuyers),
    peWriters: finish(peWriters),
    peBuyers: finish(peBuyers),
    netCe: finish(netCe),
    netPe: finish(netPe),
  };
}
