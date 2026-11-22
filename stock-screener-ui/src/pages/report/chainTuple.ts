/**
 * Canonical chain-tuple accessors — single source of truth for the
 * `[ce_ltp, pe_ltp, ce_oi, pe_oi, ce_vol, pe_vol]` tuple emitted by the
 * backend (`_premium_chain_snapshot`). All per-strike readers should import
 * from here instead of hard-coding indexes.
 */

import type { NiftyTapeChainTuple } from "@/types/niftyReport";

/** Tuple index constants — must match the backend emission order. */
export const CHAIN_CE_LTP = 0;
export const CHAIN_PE_LTP = 1;
export const CHAIN_CE_OI = 2;
export const CHAIN_PE_OI = 3;
export const CHAIN_CE_VOL = 4;
export const CHAIN_PE_VOL = 5;

/** Re-export the canonical tuple type (do not redefine). */
export type ChainTuple = NiftyTapeChainTuple;

export interface ChainMap {
  [strike: string]: ChainTuple | (number | null)[] | undefined;
}

function toFinite(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function chainLeg(
  chain: ChainMap | null | undefined,
  strike: number,
): {
  ceLtp: number | null;
  peLtp: number | null;
  ceOi: number | null;
  peOi: number | null;
  ceVol: number | null;
  peVol: number | null;
} {
  if (!chain || typeof chain !== "object") {
    return { ceLtp: null, peLtp: null, ceOi: null, peOi: null, ceVol: null, peVol: null };
  }
  const key = String(strike);
  const altKey = String(Math.round(strike));
  const tuple = chain[key] ?? chain[altKey];
  if (!Array.isArray(tuple)) {
    return { ceLtp: null, peLtp: null, ceOi: null, peOi: null, ceVol: null, peVol: null };
  }
  return {
    ceLtp: toFinite(tuple[CHAIN_CE_LTP]),
    peLtp: toFinite(tuple[CHAIN_PE_LTP]),
    ceOi: toFinite(tuple[CHAIN_CE_OI]),
    peOi: toFinite(tuple[CHAIN_PE_OI]),
    ceVol: toFinite(tuple[CHAIN_CE_VOL]),
    peVol: toFinite(tuple[CHAIN_PE_VOL]),
  };
}

export function chainMetric(
  leg: ReturnType<typeof chainLeg>,
  metric: "oi" | "volume" | "premium",
): { ce: number | null; pe: number | null } {
  switch (metric) {
    case "volume":
      return { ce: leg.ceVol, pe: leg.peVol };
    case "premium":
      return { ce: leg.ceLtp, pe: leg.peLtp };
    case "oi":
    default:
      return { ce: leg.ceOi, pe: leg.peOi };
  }
}