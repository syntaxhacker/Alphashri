import { describe, expect, test } from "vitest";
import type { SimResolvedLeg } from "@/types/reportSim";
import {
  payoffSeries,
  payoffSummary,
  spotsFor,
  toPayoffLegs,
} from "./simPayoff";

function bullCallLegs(): SimResolvedLeg[] {
  return [
    { action: "BUY", opt: "CE", strike: 25000, lots: 1, qty: 1, entryPremium: 100 },
    { action: "SELL", opt: "CE", strike: 25200, lots: 1, qty: 1, entryPremium: 50 },
  ];
}

describe("toPayoffLegs", () => {
  test("maps contract fields onto PayoffLeg", () => {
    expect(toPayoffLegs(bullCallLegs())).toEqual([
      { strike: 25000, optionType: "CE", action: "BUY", qty: 1, entry: 100 },
      { strike: 25200, optionType: "CE", action: "SELL", qty: 1, entry: 50 },
    ]);
  });
});

describe("payoffSeries", () => {
  test("returns the expiry curve on the default grid", () => {
    const legs = toPayoffLegs(bullCallLegs());
    const series = payoffSeries(legs);
    expect(series.spots).toHaveLength(161);
    expect(series.expiry).toHaveLength(161);
    expect(series.spots.every((s) => s > 0)).toBe(true);
  });

  test("uses explicit spots and caps/floor the bull call spread", () => {
    const legs = toPayoffLegs(bullCallLegs());
    const spots = [24900, 25000, 25100, 25200, 25300];
    const series = payoffSeries(legs, spots);
    expect(series.spots).toEqual(spots);
    expect(series.expiry).toEqual([-50, -50, 50, 150, 150]);
  });

  test("empty legs never produce NaN", () => {
    expect(payoffSeries([])).toEqual({ spots: [], expiry: [] });
  });
});

describe("spotsFor", () => {
  test("centres the window on the structure and stays positive", () => {
    const spots = spotsFor(toPayoffLegs(bullCallLegs()), 8, 5);
    expect(spots).toHaveLength(5);
    expect(spots[0]).toBeCloseTo(23092, 0);
    expect(spots[4]).toBeCloseTo(27108, 0);
  });

  test("empty legs and zero points return []", () => {
    expect(spotsFor([])).toEqual([]);
    expect(spotsFor(toPayoffLegs(bullCallLegs()), 8, 0)).toEqual([]);
  });
});

describe("payoffSummary", () => {
  test("bull call spread has a capped profit, floor loss and one breakeven", () => {
    const summary = payoffSummary(toPayoffLegs(bullCallLegs()));
    expect(summary.maxProfit).toBeCloseTo(150, 6);
    expect(summary.maxLoss).toBeCloseTo(-50, 6);
    expect(summary.breakevens).toHaveLength(1);
    expect(summary.breakevens[0]).toBeCloseTo(25050, 1);
    expect(summary.spots).toHaveLength(161);
  });

  test("long call has unbounded upside", () => {
    const legs = toPayoffLegs([
      { action: "BUY", opt: "CE", strike: 25000, lots: 1, qty: 1, entryPremium: 100 },
    ]);
    const summary = payoffSummary(legs);
    expect(summary.maxProfit).toBeNull();
    expect(summary.maxLoss).toBeCloseTo(-100, 6);
    expect(summary.breakevens[0]).toBeCloseTo(25100, 1);
  });

  test("long put has unbounded downside", () => {
    const legs = toPayoffLegs([
      { action: "BUY", opt: "PE", strike: 25000, lots: 1, qty: 1, entryPremium: 80 },
    ]);
    const summary = payoffSummary(legs);
    expect(summary.maxProfit).toBeNull();
    expect(summary.maxLoss).toBeCloseTo(-80, 6);
  });

  test("empty legs return zeros and empty arrays", () => {
    expect(payoffSummary([])).toEqual({
      maxProfit: 0,
      maxLoss: 0,
      breakevens: [],
      spots: [],
    });
  });
});
