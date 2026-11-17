/**
 * Shared cutoffs for the option-chain readouts. The table tab (ChainSummary)
 * and the analysis tab (OIAnalysis) must describe the same PCR with the same
 * words and colours; keeping the cutoffs here stops one tab calling a 1.1 PCR
 * bullish while the other calls it neutral.
 */

/** PCR at/above which positioning is read as call-heavy (bullish). */
export const PCR_BULLISH_MIN = 1.2;
/** PCR at/below which positioning is read as put-light (bearish). */
export const PCR_BEARISH_MAX = 0.7;

export type PcrTone = "bullish" | "bearish" | "neutral";

/**
 * Single tone source for the PCR badge colour and the bias label. A missing or
 * non-finite PCR is neutral — never "bullish", which is what an absent summary
 * used to render as.
 */
export function pcrTone(pcr: number | null | undefined): PcrTone {
  if (pcr == null || !Number.isFinite(pcr)) return "neutral";
  if (pcr > PCR_BULLISH_MIN) return "bullish";
  if (pcr < PCR_BEARISH_MAX) return "bearish";
  return "neutral";
}

/**
 * Volume ÷ |ΔOI| above this reads as churn rather than a fresh position. The
 * ratio is a heuristic, so the spike badge labels it "High churn"/"OI build" —
 * never "Speculative"/"Positional" with an implied institutional narrative.
 */
export const HIGH_TURNOVER_VOL_OI_RATIO = 10;
