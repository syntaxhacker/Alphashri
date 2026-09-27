import { describe, it, expect } from "vitest";
import {
  breakevens,
  curveSpots,
  maxLossAtExpiry,
  maxProfitAtExpiry,
  netEntry,
  payoffAtExpiry,
  payoffCurve,
  type PayoffLeg,
} from "./payoff";

const longCall: PayoffLeg[] = [
  { strike: 100, optionType: "CE", action: "BUY", qty: 1, entry: 5 },
];

const longStraddle: PayoffLeg[] = [
  { strike: 100, optionType: "CE", action: "BUY", qty: 1, entry: 5 },
  { strike: 100, optionType: "PE", action: "BUY", qty: 1, entry: 5 },
];

const bullPutSpread: PayoffLeg[] = [
  { strike: 105, optionType: "PE", action: "SELL", qty: 1, entry: 4 },
  { strike: 100, optionType: "PE", action: "BUY", qty: 1, entry: 2 },
];

const ironCondor: PayoffLeg[] = [
  { strike: 110, optionType: "CE", action: "SELL", qty: 1, entry: 3 },
  { strike: 115, optionType: "CE", action: "BUY", qty: 1, entry: 1 },
  { strike: 90, optionType: "PE", action: "SELL", qty: 1, entry: 3 },
  { strike: 85, optionType: "PE", action: "BUY", qty: 1, entry: 1 },
];

describe("netEntry", () => {
  it("returns net debit for a long call", () => {
    expect(netEntry(longCall)).toBe(5);
  });

  it("negates SELL legs (net credit is negative)", () => {
    expect(netEntry(bullPutSpread)).toBe(-2);
  });

  it("multiplies by qty", () => {
    const legs: PayoffLeg[] = [{ ...longCall[0], qty: 3 }];
    expect(netEntry(legs)).toBe(15);
  });

  it("returns 0 for empty legs", () => {
    expect(netEntry([])).toBe(0);
  });
});

describe("payoffAtExpiry", () => {
  it("prices a long call: worthless below strike, intrinsic minus entry above", () => {
    expect(payoffAtExpiry(longCall, 90)).toBe(-5);
    expect(payoffAtExpiry(longCall, 100)).toBe(-5);
    expect(payoffAtExpiry(longCall, 110)).toBe(5);
  });

  it("prices a long put", () => {
    const longPut: PayoffLeg[] = [
      { strike: 100, optionType: "PE", action: "BUY", qty: 1, entry: 4 },
    ];
    expect(payoffAtExpiry(longPut, 90)).toBe(6);
    expect(payoffAtExpiry(longPut, 110)).toBe(-4);
  });

  it("negates SELL legs", () => {
    const shortCall: PayoffLeg[] = [
      { strike: 100, optionType: "CE", action: "SELL", qty: 1, entry: 5 },
    ];
    expect(payoffAtExpiry(shortCall, 90)).toBe(5);
    expect(payoffAtExpiry(shortCall, 110)).toBe(-5);
  });

  it("multiplies by qty", () => {
    const legs: PayoffLeg[] = [{ ...longCall[0], qty: 2 }];
    expect(payoffAtExpiry(legs, 110)).toBe(10);
    expect(payoffAtExpiry(legs, 90)).toBe(-10);
  });

  it("is symmetric for a long straddle", () => {
    expect(payoffAtExpiry(longStraddle, 110)).toBe(
      payoffAtExpiry(longStraddle, 90),
    );
    expect(payoffAtExpiry(longStraddle, 100)).toBe(-10);
  });

  it("returns 0 for empty legs", () => {
    expect(payoffAtExpiry([], 100)).toBe(0);
  });
});

describe("payoffCurve and curveSpots", () => {
  it("maps spots to { spot, pnl }", () => {
    expect(payoffCurve(longCall, [90, 110])).toEqual([
      { spot: 90, pnl: -5 },
      { spot: 110, pnl: 5 },
    ]);
  });

  it("returns [] for empty legs", () => {
    expect(payoffCurve([], [90, 110])).toEqual([]);
  });

  it("builds n evenly spaced spots around ±pctRange", () => {
    const spots = curveSpots(100);
    expect(spots).toHaveLength(61);
    expect(spots[0]).toBeCloseTo(92, 10);
    expect(spots[spots.length - 1]).toBeCloseTo(108, 10);
    const custom = curveSpots(200, 10, 11);
    expect(custom).toHaveLength(11);
    expect(custom[0]).toBeCloseTo(180, 10);
    expect(custom[custom.length - 1]).toBeCloseTo(220, 10);
  });
});

describe("breakevens", () => {
  it("finds strike + entry for a long call", () => {
    expect(breakevens(longCall, 80, 130)).toEqual([105]);
  });

  it("finds ~2 breakevens for a long straddle", () => {
    const found = breakevens(longStraddle, 80, 130);
    expect(found).toHaveLength(2);
    expect(found[0]).toBeCloseTo(90, 0);
    expect(found[1]).toBeCloseTo(110, 0);
  });

  it("returns [] for empty legs", () => {
    expect(breakevens([], 80, 130)).toEqual([]);
  });
});

describe("maxProfitAtExpiry / maxLossAtExpiry", () => {
  it("is unbounded on the upside for a long call, bounded loss", () => {
    expect(maxProfitAtExpiry(longCall)).toBeNull();
    expect(maxLossAtExpiry(longCall)).toBe(-5);
  });

  it("caps bull-put-spread profit at net credit with bounded loss", () => {
    expect(maxProfitAtExpiry(bullPutSpread)).toBeCloseTo(2, 6);
    const loss = maxLossAtExpiry(bullPutSpread);
    expect(loss).not.toBeNull();
    expect(loss as number).toBeCloseTo(-3, 6);
  });

  it("bounds an iron condor on both sides", () => {
    expect(maxProfitAtExpiry(ironCondor)).toBeCloseTo(4, 6);
    expect(maxLossAtExpiry(ironCondor)).toBeCloseTo(-1, 6);
  });

  it("is unbounded loss for a naked short call", () => {
    const shortCall: PayoffLeg[] = [
      { strike: 100, optionType: "CE", action: "SELL", qty: 1, entry: 5 },
    ];
    expect(maxLossAtExpiry(shortCall)).toBeNull();
    expect(maxProfitAtExpiry(shortCall)).toBeCloseTo(5, 6);
  });

  it("returns 0 for empty legs", () => {
    expect(maxProfitAtExpiry([])).toBe(0);
    expect(maxLossAtExpiry([])).toBe(0);
  });
});

describe("breakeven noise filter", () => {
  it("reports no phantom breakevens for a zero-entry spread draft", () => {
    const legs: PayoffLeg[] = [
      { strike: 23100, optionType: "PE", action: "SELL", qty: 1, entry: 0 },
      { strike: 23050, optionType: "PE", action: "BUY", qty: 1, entry: 0 },
    ];
    expect(breakevens(legs, 22000, 24200).length).toBeLessThanOrEqual(2);
  });

  it("still finds the single crossing of a credited spread", () => {
    const legs: PayoffLeg[] = [
      { strike: 23100, optionType: "PE", action: "SELL", qty: 1, entry: 40 },
      { strike: 23050, optionType: "PE", action: "BUY", qty: 1, entry: 25 },
    ];
    expect(breakevens(legs, 22000, 24200)).toEqual([23085]);
  });
});
