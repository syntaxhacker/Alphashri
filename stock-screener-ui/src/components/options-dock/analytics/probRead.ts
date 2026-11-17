/**
 * Pure payoff facts for the probability tab: breakevens and a small scenario
 * ladder. Both come from the same `optionsMath` primitives the payoff canvas
 * uses — this module never restates the P&L formula.
 */

import { payoffAt, payoffCurve, type OptionLeg } from "@/utils/optionsMath";
import type { DockLeg } from "@/state/optionsDock";

export interface ProfitScenario {
  label: string;
  spot: number;
  pnl: number;
}

export interface ProbRead {
  breakevens: number[];
  scenarios: ProfitScenario[];
}

/** The five rungs of the scenario row, expressed as multipliers of spot. */
export const PROB_SCENARIOS = [
  { label: "−10%", factor: 0.9 },
  { label: "−5%", factor: 0.95 },
  { label: "spot", factor: 1 },
  { label: "+5%", factor: 1.05 },
  { label: "+10%", factor: 1.1 },
] as const;

function toPure(legs: DockLeg[]): OptionLeg[] {
  return legs.map((leg) => ({
    side: leg.side,
    type: leg.type,
    strike: leg.strike,
    premium: leg.premium,
    lots: leg.lots,
    lotSize: leg.lotSize,
  }));
}

/** Breakevens and spot-shock P&L for a basket; empty for no legs / invalid spot. */
export function readProb(legs: DockLeg[], spot: number): ProbRead {
  if (legs.length === 0 || !(spot > 0) || !Number.isFinite(spot)) {
    return { breakevens: [], scenarios: [] };
  }
  const pure = toPure(legs);
  return {
    breakevens: payoffCurve(pure, spot).breakevens,
    scenarios: PROB_SCENARIOS.map(({ label, factor }) => {
      const shocked = spot * factor;
      return { label, spot: shocked, pnl: payoffAt(shocked, pure) };
    }),
  };
}
