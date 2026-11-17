/**
 * Contract for the Options Analytics dashboard panels.
 *
 * `data` is the normalized analytics payload the client already produces. The
 * four pillar-specific blocks are OPTIONAL and additive: a client that only
 * fetches the shipped `/api/options/analytics/{symbol}` DTO still renders every
 * panel, with a fail-soft reason wherever a block is absent. A richer client
 * can populate `positioning` / `dealer` / `liquidity` / `realisedVol` without
 * changing a panel signature.
 */

import type { OptionsAnalytics } from "@/api/optionsAnalytics";

export interface StrikePair {
  strike: number;
  ce: number | null;
  pe: number | null;
}

export interface StrikeValue {
  strike: number;
  value: number | null;
}

export interface TenorValue {
  dte: number;
  value: number | null;
}

export interface SpreadCell {
  strike: number;
  expiry: string;
  /** Bid-ask spread in the quote's own unit (₹ or vol points). */
  spread: number | null;
}

export interface PositioningBlock {
  /** Change in open interest by strike; absent on a closed/stale snapshot. */
  deltaOi?: StrikePair[] | null;
  volume?: StrikePair[] | null;
}

export interface DealerBlock {
  /** Net gamma (GEX) by strike. */
  gex?: StrikeValue[] | null;
  /** Net delta exposure by strike. */
  dex?: StrikeValue[] | null;
  vanna?: StrikeValue[] | null;
  charm?: StrikeValue[] | null;
  /** Theta decay by tenor (DTE). */
  theta?: TenorValue[] | null;
}

export interface LiquidityBlock {
  /** One cell per strike × expiry intersection; null = no two-sided quote. */
  spread?: SpreadCell[] | null;
  /** Volume / open-interest ratio by strike. */
  volumeOi?: StrikeValue[] | null;
}

export interface DashboardAnalytics extends OptionsAnalytics {
  positioning?: PositioningBlock | null;
  dealer?: DealerBlock | null;
  liquidity?: LiquidityBlock | null;
  /** Realised-vol term points for the IV vs RV cone. */
  realisedVol?: TenorValue[] | null;
}

export interface PanelProps {
  data: DashboardAnalytics;
  selectedExpiry: string | null;
  onExpiry: (expiry: string) => void;
}

/** A short, human reason shown in place of a chart when its block is missing. */
export type EmptyReason = string | null;

export const REASON = {
  noQuotes: "No quotes for this expiry",
  noRv: "RV unavailable — no realised-vol history",
  noPositioning: "No change-in-OI / volume feed",
  noGamma: "No gamma profile for this expiry",
  noDex: "No DEX profile for this expiry",
  noVannaCharm: "No vanna/charm profile for this expiry",
  noTheta: "No theta curve by expiry",
  noSpread: "No bid-ask quotes",
  noVolOi: "No volume / OI data",
} as const;
