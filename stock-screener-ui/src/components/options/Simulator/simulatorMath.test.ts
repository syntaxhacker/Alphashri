import { describe, it, expect } from "vitest";
import {
  daysToExpiry,
  rangePctFor,
  scenarioRows,
  scenarioSpots,
  statsFor,
  toPayoffLegs,
} from "./simulatorMath";
import type { PayoffLeg } from "../PremiumTracker/payoff";

const longCall: PayoffLeg[] = [{ strike: 100, optionType: "CE", action: "BUY", qty: 1, entry: 5 }];
const bullPutSpread: PayoffLeg[] = [
  { strike: 105, optionType: "PE", action: "SELL", qty: 1, entry: 4 },
  { strike: 100, optionType: "PE", action: "BUY", qty: 1, entry: 2 },
];
const nakedShortCall: PayoffLeg[] = [{ strike: 100, optionType: "CE", action: "SELL", qty: 1, entry: 5 }];

describe("scenarioSpots", () => {
  it("returns −10/−5/0/+5/+10 levels around spot", () => {
    const spots = scenarioSpots(100);
    expect(spots).toHaveLength(5);
    expect(spots.map((s) => s.label)).toEqual(["-10%", "-5%", "Spot", "+5%", "+10%"]);
    expect(spots.map((s) => s.pct)).toEqual([-10, -5, 0, 5, 10]);
    expect(spots[0].spot).toBeCloseTo(90);
    expect(spots[2].spot).toBeCloseTo(100);
    expect(spots[4].spot).toBeCloseTo(110);
  });

  it("yields null spots for a null spot", () => {
    expect(scenarioSpots(null).every((s) => s.spot === null)).toBe(true);
  });
});

describe("scenarioRows", () => {
  it("prices each scenario at expiry via the leg total", () => {
    const rows = scenarioRows(longCall, 100);
    expect(rows).toHaveLength(5);
    const row0 = rows[0];
    expect(row0.label).toBe("-10%");
    expect(row0.pct).toBe(-10);
    expect(row0.spot).toBeCloseTo(90);
    expect(row0.pnl).toBe(-5);
    const row2 = rows[2];
    expect(row2.label).toBe("Spot");
    expect(row2.pct).toBe(0);
    expect(row2.spot).toBeCloseTo(100);
    expect(row2.pnl).toBe(-5);
    const row4 = rows[4];
    expect(row4.label).toBe("+10%");
    expect(row4.pct).toBe(10);
    expect(row4.spot).toBeCloseTo(110);
    expect(row4.pnl).toBeCloseTo(5);
  });

  it("orders rows from −10% to +10%", () => {
    expect(scenarioRows(longCall, 100).map((r) => r.label)).toEqual([
      "-10%", "-5%", "Spot", "+5%", "+10%",
    ]);
  });

  it("yields null P&L for a null spot", () => {
    const rows = scenarioRows(longCall, null);
    expect(rows.every((r) => r.pnl === null && r.spot === null)).toBe(true);
  });

  it("prices zero P&L for every scenario with no legs", () => {
    const rows = scenarioRows([], 100);
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.pnl === 0)).toBe(true);
  });
});

describe("toPayoffLegs", () => {
  it("drops legId and keeps the rest", () => {
    expect(
      toPayoffLegs([{ legId: "a", strike: 100, optionType: "CE", action: "BUY", qty: 1, entry: 5 }]),
    ).toEqual([{ strike: 100, optionType: "CE", action: "BUY", qty: 1, entry: 5 }]);
  });

  it("does not mutate inputs", () => {
    const legs = [{ legId: "a", strike: 100, optionType: "CE", action: "BUY", qty: 1, entry: 5 }];
    toPayoffLegs(legs);
    expect(legs[0].legId).toBe("a");
  });
});

describe("statsFor", () => {
  it("no legs returns zeros and nulls", () => {
    expect(statsFor([], 100)).toEqual({
      netEntry: 0, kind: "flat", maxProfit: 0, maxLoss: 0, breakevens: [], riskReward: null,
    });
  });

  it("long call: net debit, bounded loss, open profit", () => {
    const s = statsFor(longCall, 100);
    expect(s.netEntry).toBe(5);
    expect(s.kind).toBe("debit");
    expect(s.maxProfit).toBeNull();
    expect(s.maxLoss).toBe(-5);
    expect(s.riskReward).toBeNull();
    expect(s.breakevens).toEqual([105]);
  });

  it("bull put spread: net credit, capped profit and loss", () => {
    const s = statsFor(bullPutSpread, 100);
    expect(s.netEntry).toBe(-2);
    expect(s.kind).toBe("credit");
    expect(s.maxProfit).toBeCloseTo(2, 6);
    expect(s.maxLoss).toBeCloseTo(-3, 6);
    expect(s.breakevens).toEqual([103]);
    expect(s.riskReward).toBeCloseTo(2 / 3, 6);
  });

  it("naked short call: capped profit, open loss", () => {
    const s = statsFor(nakedShortCall, 100);
    expect(s.netEntry).toBe(-5);
    expect(s.kind).toBe("credit");
    expect(s.maxProfit).toBeCloseTo(5, 6);
    expect(s.maxLoss).toBeNull();
    expect(s.riskReward).toBeNull();
    expect(s.breakevens).toEqual([105]);
  });

  it("riskReward is null for flat positions", () => {
    const flat: PayoffLeg[] = [
      { strike: 100, optionType: "CE", action: "BUY", qty: 1, entry: 0 },
      { strike: 100, optionType: "CE", action: "SELL", qty: 1, entry: 0 },
    ];
    const s = statsFor(flat, 100);
    expect(s.netEntry).toBe(0);
    expect(s.kind).toBe("flat");
    expect(s.maxProfit).toBe(0);
    expect(s.maxLoss).toBe(0);
    expect(s.riskReward).toBeNull();
    expect(s.breakevens).toEqual([]);
  });
});

describe("rangePctFor", () => {
  it("brackets all strikes with a buffer", () => {
    expect(rangePctFor(100, [90, 110])).toBe(11.5);
    expect(rangePctFor(23150, [23100, 23150, 23200])).toBe(5);
  });

  it("defaults to 12 without a usable spot or strikes", () => {
    expect(rangePctFor(null, [100])).toBe(12);
    expect(rangePctFor(100, [])).toBe(12);
  });
});

describe("daysToExpiry", () => {
  const ref = new Date("2026-05-20T10:00:00Z");

  it("computes DTE for a 25MAY-style expiry", () => {
    expect(daysToExpiry("25MAY", ref)).toBe(5);
  });

  it("computes DTE for an ISO expiry", () => {
    expect(daysToExpiry("2026-05-25", ref)).toBe(5);
  });

  it("treats a past ISO expiry as 0 DTE", () => {
    expect(daysToExpiry("2026-04-30", ref)).toBe(0);
  });

  it("rolls a past 25MAY-style expiry forward to the next year", () => {
    expect(daysToExpiry("25MAY", new Date("2026-06-01T10:00:00Z"))).toBeGreaterThan(300);
  });

  it("returns null for unparseable input", () => {
    expect(daysToExpiry(null)).toBeNull();
    expect(daysToExpiry("not-an-expiry")).toBeNull();
  });
});
