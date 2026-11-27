import { describe, expect, test } from "vitest";
import { payoffAt, payoffCurve, type OptionLeg } from "./optionsMath";

/** One lot = 100 units throughout; doubled legs use two lots. */
const U = 100;

const leg = (
  side: OptionLeg["side"],
  type: OptionLeg["type"],
  strike: number,
  premium: number,
  lots = 1,
): OptionLeg => ({ side, type, strike, premium, lots, lotSize: U });

interface StructureCase {
  name: string;
  legs: OptionLeg[];
  spot: number;
  /** Hand-summed from the structure itself — never calls payoffAt. */
  expected: (spot: number) => number;
  probes: number[];
  credit: boolean;
  netPremium: number;
  breakevens: number[];
  maxProfit: number | null;
  maxLoss: number | null;
}

const CASES: StructureCase[] = [
  {
    name: "bull call spread",
    legs: [leg("buy", "CE", 100, 6), leg("sell", "CE", 110, 3)],
    spot: 105,
    expected: (s) => U * (Math.max(0, s - 100) - 6) - U * (Math.max(0, s - 110) - 3),
    probes: [90, 100, 103, 110, 120],
    credit: false,
    netPremium: -300,
    breakevens: [103],
    maxProfit: 700,
    maxLoss: -300,
  },
  {
    name: "bear put spread",
    legs: [leg("buy", "PE", 110, 6), leg("sell", "PE", 100, 3)],
    spot: 105,
    expected: (s) => U * (Math.max(0, 110 - s) - 6) - U * (Math.max(0, 100 - s) - 3),
    probes: [90, 100, 107, 110, 120],
    credit: false,
    netPremium: -300,
    breakevens: [107],
    maxProfit: 700,
    maxLoss: -300,
  },
  {
    name: "long straddle",
    legs: [leg("buy", "CE", 100, 5), leg("buy", "PE", 100, 4)],
    spot: 100,
    expected: (s) => U * (Math.max(0, s - 100) - 5) + U * (Math.max(0, 100 - s) - 4),
    probes: [0, 80, 91, 100, 109, 120],
    credit: false,
    netPremium: -900,
    breakevens: [91, 109],
    maxProfit: null,
    maxLoss: -900,
  },
  {
    name: "short strangle",
    legs: [leg("sell", "CE", 110, 4), leg("sell", "PE", 90, 3)],
    spot: 100,
    expected: (s) => -U * (Math.max(0, s - 110) - 4) - U * (Math.max(0, 90 - s) - 3),
    probes: [0, 70, 83, 90, 100, 110, 117, 130],
    credit: true,
    netPremium: 700,
    breakevens: [83, 117],
    maxProfit: 700,
    maxLoss: null,
  },
  {
    name: "iron condor",
    legs: [
      leg("sell", "PE", 90, 3),
      leg("buy", "PE", 80, 1),
      leg("sell", "CE", 110, 4),
      leg("buy", "CE", 120, 1),
    ],
    spot: 100,
    expected: (s) =>
      -U * (Math.max(0, 90 - s) - 3) +
      U * (Math.max(0, 80 - s) - 1) -
      U * (Math.max(0, s - 110) - 4) +
      U * (Math.max(0, s - 120) - 1),
    probes: [0, 70, 85, 100, 115, 130],
    credit: true,
    netPremium: 500,
    breakevens: [85, 115],
    maxProfit: 500,
    maxLoss: -500,
  },
  {
    name: "butterfly",
    legs: [leg("buy", "CE", 90, 12), leg("sell", "CE", 100, 5, 2), leg("buy", "CE", 110, 1)],
    spot: 100,
    expected: (s) =>
      U * (Math.max(0, s - 90) - 12) -
      2 * U * (Math.max(0, s - 100) - 5) +
      U * (Math.max(0, s - 110) - 1),
    probes: [0, 80, 93, 100, 107, 120],
    credit: false,
    netPremium: -300,
    breakevens: [93, 107],
    maxProfit: 700,
    maxLoss: -300,
  },
  {
    name: "ratio spread",
    legs: [leg("buy", "CE", 100, 5), leg("sell", "CE", 110, 4, 2)],
    spot: 110,
    expected: (s) => U * (Math.max(0, s - 100) - 5) - 2 * U * (Math.max(0, s - 110) - 4),
    probes: [0, 90, 100, 110, 123, 140],
    credit: true,
    netPremium: 300,
    breakevens: [123],
    maxProfit: 1300,
    maxLoss: null,
  },
];

const deepFreeze = <T,>(value: T): T => {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

describe("multi-leg payoff parity", () => {
  test.each(CASES)("$name: payoffAt equals the hand-summed leg intrinsics", ({ legs, probes, expected }) => {
    expect(probes.length).toBeGreaterThanOrEqual(5);
    for (const s of probes) {
      expect(payoffAt(s, legs)).toBeCloseTo(expected(s), 6);
    }
  });

  test.each(CASES)("$name: net premium sign and amount", ({ legs, spot, credit, netPremium }) => {
    const curve = payoffCurve(legs, spot);
    expect(curve.netPremium).toBeCloseTo(netPremium, 6);
    expect(curve.netPremium >= 0).toBe(credit);
  });

  test.each(CASES)("$name: breakevens and bounded / unbounded tails", (item) => {
    const { legs, spot, probes, breakevens, maxProfit, maxLoss, expected } = item;
    const curve = payoffCurve(legs, spot);
    expect(curve.breakevens).toHaveLength(breakevens.length);
    breakevens.forEach((be, index) => expect(curve.breakevens[index]).toBeCloseTo(be, 6));
    // Roots really are roots: the hand-summed payoff flips sign across each one.
    for (const be of breakevens) {
      expect(payoffAt(be, legs)).toBeCloseTo(expected(be), 6);
      expect(Math.abs(payoffAt(be, legs))).toBeLessThan(1e-5);
    }

    if (maxProfit === null) expect(curve.maxProfit).toBeNull();
    else expect(curve.maxProfit).toBeCloseTo(maxProfit, 6);
    if (maxLoss === null) expect(curve.maxLoss).toBeNull();
    else expect(curve.maxLoss).toBeCloseTo(maxLoss, 6);

    // The default ±10 % chart window can sit entirely inside a condor's profit
    // band, so sample the structural extremes (spot 0 and past the last strike)
    // rather than the window when checking that a finite bound is attained.
    const farTail = Math.max(...legs.map((l) => l.strike)) * 3;
    const samples = [0, ...probes, farTail].map(expected);
    if (maxProfit !== null) expect(Math.max(...samples)).toBeGreaterThanOrEqual(maxProfit - 1e-5);
    if (maxLoss !== null) expect(Math.min(...samples)).toBeLessThanOrEqual(maxLoss + 1e-5);
  });

  test.each(CASES)("$name: curve spots stay finite and positive", ({ legs, spot }) => {
    const curve = payoffCurve(legs, spot, { points: 31 });
    expect(curve.points).toHaveLength(31);
    for (let i = 0; i < curve.points.length; i++) {
      expect(Number.isFinite(curve.points[i].spot)).toBe(true);
      expect(curve.points[i].spot).toBeGreaterThan(0);
      expect(Number.isFinite(curve.points[i].pnl)).toBe(true);
      if (i > 0) expect(curve.points[i].spot).toBeGreaterThan(curve.points[i - 1].spot);
    }
  });

  test.each(CASES)("$name: never mutates the input legs", ({ legs, spot }) => {
    const before = JSON.stringify(legs);
    const frozen = deepFreeze(legs.map((l) => ({ ...l })));
    expect(() => payoffAt(spot, frozen)).not.toThrow();
    expect(() => payoffCurve(frozen, spot)).not.toThrow();
    expect(JSON.stringify(frozen)).toBe(before);
  });
});

describe("tail bounds", () => {
  test("a short put's left tail is valued at spot 0, not at the right sentinel", () => {
    const shortPut = [leg("sell", "PE", 90, 3)];
    expect(payoffAt(0, shortPut)).toBeCloseTo(-U * (90 - 3), 6);
    const curve = payoffCurve(shortPut, 100);
    expect(curve.maxProfit).toBeCloseTo(300, 6);
    expect(curve.maxLoss).toBeCloseTo(-8700, 6);
    expect(curve.maxLoss).not.toBeNull();
  });

  test("short strangle: finite PE left tail but unbounded CE right tail", () => {
    const strangle = CASES.find((c) => c.name === "short strangle")!.legs;
    expect(payoffAt(0, strangle)).toBeCloseTo(-8300, 6);
    const curve = payoffCurve(strangle, 100);
    expect(curve.maxProfit).toBeCloseTo(700, 6);
    expect(curve.maxLoss).toBeNull();
  });

  test("null marks an unbounded tail, never a truncated chart-window number", () => {
    const longCall = payoffCurve([leg("buy", "CE", 100, 6)], 100);
    expect(longCall.maxProfit).toBeNull();
    expect(longCall.maxLoss).toBeCloseTo(-600, 6);
    const shortCall = payoffCurve([leg("sell", "CE", 100, 6)], 100);
    expect(shortCall.maxLoss).toBeNull();
    expect(shortCall.maxProfit).toBeCloseTo(600, 6);
  });
});
