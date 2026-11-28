/**
 * Scale helpers shared by the Market Vis views that read the same P&L ramp.
 * Only implementations that were byte-identical in two or more views live here:
 * the √-curved money-flow ramp, the continuous RSI×ADX lerp, the breadth bars
 * and the market map's viridis fills keep their own modules because their
 * numbers genuinely differ.
 */
import { VIZ_SCALE_PNL } from "@/ui/palette";

/** VIZ_SCALE_PNL has nine stops; stop four is the neutral midpoint. */
export const VIZ_PNL_NEUTRAL_INDEX = Math.floor(VIZ_SCALE_PNL.length / 2);

export const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/**
 * Zero-pinned stop on the loss → gain ramp. Range52 and Relative volume painted
 * the same index for the same change/extent before this was extracted.
 */
export function vizPnlColor(change: number | null, extent: number): string {
  if (!isFiniteNumber(change)) return VIZ_SCALE_PNL[VIZ_PNL_NEUTRAL_INDEX]!;
  const span = isFiniteNumber(extent) && extent > 0 ? extent : 1;
  const t = Math.max(-1, Math.min(1, change / span));
  const index = Math.round(((t + 1) / 2) * (VIZ_SCALE_PNL.length - 1));
  return VIZ_SCALE_PNL[index]!;
}

/** Signed two-decimal percent, no "-0.00%", with a dash for a missing quote. */
export function formatSignedPct(value: number | null): string {
  if (!isFiniteNumber(value)) return "—";
  const rounded = Math.abs(value) < 0.005 ? 0 : value;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(2)}%`;
}

/** The inline legend swatch used by Relative volume and RSI×ADX. */
export function pnlRampCss(): string {
  return `linear-gradient(to right, ${VIZ_SCALE_PNL.join(",")})`;
}
