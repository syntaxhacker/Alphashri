import { describe, expect, it } from "vitest";
import {
  payoffAt as canonicalPayoffAt,
  payoffCurve as canonicalPayoffCurve,
  type OptionLeg,
} from "@/utils/optionsMath";
import {
  breakevens,
  maxLossAtExpiry,
  maxProfitAtExpiry,
  netEntry,
  payoffAtExpiry,
  payoffCurve,
  type PayoffLeg,
} from "./payoff";

/** Independent mapping so the adapter's leg translation is under test, not assumed. */
function canonicalLegs(legs: readonly PayoffLeg[]): OptionLeg[] {
  return legs.map((leg): OptionLeg => ({
    side: leg.action === "BUY" ? "buy" : "sell",
    type: leg.optionType,
    strike: leg.strike,
    premium: leg.entry,
    lots: leg.qty,
    lotSize: 1,
  }));
}

interface Facts {
  spot: number;
  roots: number[];
  maxProfit: number;
  maxLoss: number;
  netEntry: number;
}

function paritySuite(name: string, legs: PayoffLeg[], facts: Facts): void {
  describe(name, () => {
    it("breakevens match optionsMath and the known roots", () => {
      const canonical = canonicalPayoffCurve(canonicalLegs(legs), facts.spot);
      const actual = breakevens(legs, facts.spot * 0.5, facts.spot * 1.5);
      expect(actual).toEqual(canonical.breakevens);
      expect(actual).toHaveLength(facts.roots.length);
      actual.forEach((value, index) => expect(value).toBeCloseTo(facts.roots[index], 6));
    });

    it("max profit/loss match optionsMath and the known bounds", () => {
      const canonical = canonicalPayoffCurve(canonicalLegs(legs), facts.spot);
      expect(canonical.maxProfit).not.toBeNull();
      expect(maxProfitAtExpiry(legs)).toBeCloseTo(canonical.maxProfit as number, 6);
      expect(maxProfitAtExpiry(legs)).toBeCloseTo(facts.maxProfit, 6);
      expect(canonical.maxLoss).not.toBeNull();
      expect(maxLossAtExpiry(legs)).toBeCloseTo(canonical.maxLoss as number, 6);
      expect(maxLossAtExpiry(legs)).toBeCloseTo(facts.maxLoss, 6);
    });

    it("net premium matches optionsMath with the debit-positive sign", () => {
      const canonical = canonicalPayoffCurve(canonicalLegs(legs), facts.spot);
      expect(netEntry(legs)).toBeCloseTo(-canonical.netPremium, 6);
      expect(netEntry(legs)).toBeCloseTo(facts.netEntry, 6);
    });

    it("per-spot P&L matches optionsMath", () => {
      const spots = [facts.spot * 0.9, facts.spot, facts.spot * 1.1];
      const mapped = canonicalLegs(legs);
      const actual = payoffCurve(legs, spots);
      expect(actual.map((point) => point.spot)).toEqual(spots);
      actual.forEach((point, index) => {
        expect(point.pnl).toBeCloseTo(canonicalPayoffAt(spots[index], mapped), 6);
        expect(point.pnl).toBeCloseTo(payoffAtExpiry(legs, spots[index]), 6);
      });
    });
  });
}

describe("payoff adapter parity with optionsMath", () => {
  paritySuite("iron condor", [
    { strike: 110, optionType: "CE", action: "SELL", qty: 1, entry: 3 },
    { strike: 115, optionType: "CE", action: "BUY", qty: 1, entry: 1 },
    { strike: 90, optionType: "PE", action: "SELL", qty: 1, entry: 3 },
    { strike: 85, optionType: "PE", action: "BUY", qty: 1, entry: 1 },
  ], { spot: 100, roots: [86, 114], maxProfit: 4, maxLoss: -1, netEntry: -4 });

  paritySuite("bull put credit spread", [
    { strike: 105, optionType: "PE", action: "SELL", qty: 1, entry: 4 },
    { strike: 100, optionType: "PE", action: "BUY", qty: 1, entry: 2 },
  ], { spot: 102.5, roots: [103], maxProfit: 2, maxLoss: -3, netEntry: -2 });

  paritySuite("iron fly", [
    { strike: 100, optionType: "CE", action: "SELL", qty: 1, entry: 3 },
    { strike: 105, optionType: "CE", action: "BUY", qty: 1, entry: 1 },
    { strike: 100, optionType: "PE", action: "SELL", qty: 1, entry: 3 },
    { strike: 95, optionType: "PE", action: "BUY", qty: 1, entry: 1 },
  ], { spot: 100, roots: [96, 104], maxProfit: 4, maxLoss: -1, netEntry: -4 });

  it("finds both roots of a narrow band the stepped scan rounded away", () => {
    const legs: PayoffLeg[] = [
      { strike: 90, optionType: "CE", action: "BUY", qty: 1, entry: 11 },
      { strike: 100, optionType: "CE", action: "SELL", qty: 2, entry: 1.025 },
      { strike: 110, optionType: "CE", action: "BUY", qty: 1, entry: 1 },
    ];
    const found = breakevens(legs, 80, 130);
    expect(found).toHaveLength(2);
    expect(found[0]).toBeCloseTo(99.95, 3);
    expect(found[1]).toBeCloseTo(100.05, 3);
  });

  describe("unbounded tails agree", () => {
    it("long call: max profit unbounded on both sides", () => {
      const legs: PayoffLeg[] = [
        { strike: 100, optionType: "CE", action: "BUY", qty: 1, entry: 5 },
      ];
      expect(maxProfitAtExpiry(legs)).toBeNull();
      expect(canonicalPayoffCurve(canonicalLegs(legs), 100).maxProfit).toBeNull();
    });

    it("naked short call: max loss unbounded on both sides", () => {
      const legs: PayoffLeg[] = [
        { strike: 100, optionType: "CE", action: "SELL", qty: 1, entry: 5 },
      ];
      expect(maxLossAtExpiry(legs)).toBeNull();
      expect(canonicalPayoffCurve(canonicalLegs(legs), 100).maxLoss).toBeNull();
    });
  });
});
