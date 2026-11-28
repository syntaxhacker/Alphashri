import type { DockLeg } from "@/state/optionsDock";
import type { OptionLeg } from "@/utils/optionsMath";

/**
 * Payoff/IV input preparation shared by the dock's payoff canvas and probability
 * view. The payoff integral itself already has one home (`@/utils/optionsMath`);
 * nothing here re-implements Black-76, payoff at expiry or breakevens.
 */

/** The same six-field projection the payoff core and the probability read use. */
export function toOptionLegs(legs: readonly DockLeg[]): OptionLeg[] {
  return legs.map((leg) => ({
    side: leg.side,
    type: leg.type,
    strike: leg.strike,
    premium: leg.premium,
    lots: leg.lots,
    lotSize: leg.lotSize,
  }));
}

/** A decimal IV, or NaN when the feed quoted none — never a fabricated zero. */
export function ivDecimalOrNaN(iv: number | null | undefined): number {
  return iv != null && Number.isFinite(iv) && iv > 0 ? iv : Number.NaN;
}

/** Vol points (13.8 = 13.8 %) to the decimal fraction the model consumes. */
export function volPointsToIvDecimal(iv: number | null | undefined): number {
  const decimal = ivDecimalOrNaN(iv);
  return Number.isFinite(decimal) ? decimal / 100 : Number.NaN;
}
