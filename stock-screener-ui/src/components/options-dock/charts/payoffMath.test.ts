import { describe, expect, test } from "vitest";
import type { DockLeg } from "@/state/optionsDock";
import { ivDecimalOrNaN, toOptionLegs, volPointsToIvDecimal } from "./payoffMath";

const legs: DockLeg[] = [
  {
    key: "CE|100",
    expiry: "2026-11-19",
    side: "buy",
    type: "CE",
    strike: 100,
    premium: 3.5,
    lots: 2,
    lotSize: 75,
    fromPreset: true,
  },
  {
    key: "PE|95",
    expiry: "2026-11-19",
    side: "sell",
    type: "PE",
    strike: 95,
    premium: 2,
    lots: 1,
    lotSize: 75,
  },
];

/** The projection that lived inline in PayoffChartCore and probRead. */
function legacyToPure(source: DockLeg[]) {
  return source.map((leg) => ({
    side: leg.side,
    type: leg.type,
    strike: leg.strike,
    premium: leg.premium,
    lots: leg.lots,
    lotSize: leg.lotSize,
  }));
}

describe("toOptionLegs", () => {
  test("projects exactly the six model fields, dropping dock-only identity", () => {
    expect(toOptionLegs(legs)).toEqual(legacyToPure(legs));
    expect(toOptionLegs([])).toEqual([]);
  });
});

describe("IV guards", () => {
  const inputs = [null, undefined, Number.NaN, Infinity, -Infinity, 0, -0, -13.8, 0.0001, 13.8, 0.138];

  test("ivDecimalOrNaN matches the payoff core's old guard", () => {
    for (const iv of inputs) {
      const legacy = iv != null && Number.isFinite(iv) && iv > 0 ? iv : Number.NaN;
      const actual = ivDecimalOrNaN(iv);
      if (Number.isNaN(legacy)) expect(Number.isNaN(actual)).toBe(true);
      else expect(actual).toBe(legacy);
    }
  });

  test("volPointsToIvDecimal matches the panel guards with no changed value", () => {
    const finiteLegacy = (value: number | null | undefined): value is number =>
      value != null && Number.isFinite(value);
    for (const iv of inputs) {
      const legacyA =
        iv != null && Number.isFinite(iv) && iv > 0 ? iv / 100 : Number.NaN; // PayoffPanel
      const legacyB =
        finiteLegacy(iv) && iv > 0 ? iv / 100 : Number.NaN; // ProbPanel
      const actual = volPointsToIvDecimal(iv);
      expect(Number.isNaN(actual)).toBe(Number.isNaN(legacyA));
      expect(Number.isNaN(actual)).toBe(Number.isNaN(legacyB));
      if (!Number.isNaN(legacyA)) {
        expect(actual).toBe(legacyA);
        expect(actual).toBe(legacyB);
      }
    }
  });
});
