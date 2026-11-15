import { describe, expect, test } from "vitest";
import {
  aggregateGreeks,
  expectedMove,
  maxPain,
  payoffAt,
  payoffCurve,
  pcr,
  pickDefaultExpiry,
  probabilityOfProfit,
  type OptionLeg,
} from "./optionsMath";

const leg = (
  side: OptionLeg["side"],
  type: OptionLeg["type"],
  strike: number,
  premium: number,
  lots = 1,
  lotSize = 65,
): OptionLeg => ({ side, type, strike, premium, lots, lotSize });

/** §4.1 fixture: short 24 200 CE / long 24 500 CE / short 23 800 PE / long 23 500 PE, lot 65. */
const CONDOR: OptionLeg[] = [
  leg("sell", "CE", 24200, 36.6),
  leg("buy", "CE", 24500, 3.5),
  leg("sell", "PE", 23800, 23.1),
  leg("buy", "PE", 23500, 1.8),
];
const CONDOR_SPOT = 24031.5;
const CONDOR_IV = 0.138;
const CONDOR_T = 2 / 365;

describe("payoffAt", () => {
  test("long call: intrinsic minus premium, floored at the premium lost", () => {
    const long = [leg("buy", "CE", 24000, 100, 1, 50)];
    expect(payoffAt(23900, long)).toBeCloseTo(-5000, 6); // 50 × (−100)
    expect(payoffAt(24000, long)).toBeCloseTo(-5000, 6); // at the strike
    expect(payoffAt(24100, long)).toBeCloseTo(0, 6); // breakeven = K + p
    expect(payoffAt(24200, long)).toBeCloseTo(5000, 6);
  });

  test("short put: keeps the premium, loses below strike − premium", () => {
    const short = [leg("sell", "PE", 24000, 100, 1, 50)];
    expect(payoffAt(24100, short)).toBeCloseTo(5000, 6);
    expect(payoffAt(23900, short)).toBeCloseTo(0, 6); // breakeven = K − p
    expect(payoffAt(23800, short)).toBeCloseTo(-5000, 6);
  });

  test("straddle: V shape with two breakevens", () => {
    const straddle = [leg("buy", "CE", 24000, 100, 1, 50), leg("buy", "PE", 24000, 100, 1, 50)];
    expect(payoffAt(24000, straddle)).toBeCloseTo(-10000, 6);
    expect(payoffAt(24200, straddle)).toBeCloseTo(0, 6);
    expect(payoffAt(23800, straddle)).toBeCloseTo(0, 6);
    expect(payoffAt(24400, straddle)).toBeCloseTo(10000, 6);
    expect(payoffAt(23600, straddle)).toBeCloseTo(10000, 6);
  });

  test("lots and lot size both scale the P&L", () => {
    const twoLots = [leg("buy", "CE", 24000, 100, 2, 50)];
    const halfLot = [leg("buy", "CE", 24000, 100, 1, 25)];
    expect(payoffAt(24200, twoLots)).toBeCloseTo(10000, 6); // 2 × 50 × 100
    expect(payoffAt(24200, halfLot)).toBeCloseTo(2500, 6); // 1 × 25 × 100
  });

  test("no legs → flat zero", () => {
    expect(payoffAt(0, [])).toBe(0);
    expect(payoffAt(24031.5, [])).toBe(0);
  });

  test("§4.1 condor: credit at spot, flat maximum between the shorts", () => {
    expect(payoffAt(CONDOR_SPOT, CONDOR)).toBeCloseTo(3536, 6);
    expect(payoffAt(24000, CONDOR)).toBeCloseTo(3536, 6);
  });
});

describe("payoffCurve", () => {
  test("§4.1 condor assertions to the rupee", () => {
    const curve = payoffCurve(CONDOR, CONDOR_SPOT);
    expect(curve.points).toHaveLength(241);
    expect(curve.netPremium).toBeCloseTo(3536, 6);

    expect(curve.breakevens).toHaveLength(2);
    // Analytic roots are 23 800 − 54.4 and 24 200 + 54.4; the plan's 23 745 /
    // 24 254 are those values truncated for display.
    expect(curve.breakevens[0]).toBeCloseTo(23745.6, 6);
    expect(curve.breakevens[1]).toBeCloseTo(24254.4, 6);
    expect(Math.abs(curve.breakevens[0] - 23745)).toBeLessThan(1);
    expect(Math.abs(curve.breakevens[1] - 24254)).toBeLessThan(1);

    expect(curve.maxProfit).toBe(3536);
    expect(curve.maxLoss).toBe(-15964);
  });

  test("default window is ±10 % of spot and contains spot", () => {
    const curve = payoffCurve(CONDOR, CONDOR_SPOT);
    expect(curve.points[0].spot).toBeCloseTo(CONDOR_SPOT * 0.9, 6);
    expect(curve.points[240].spot).toBeCloseTo(CONDOR_SPOT * 1.1, 6);
    expect(curve.points[120].spot).toBeCloseTo(CONDOR_SPOT, 6);
  });

  test("widthPct and points are honoured, and monotone spot", () => {
    const curve = payoffCurve(CONDOR, CONDOR_SPOT, { widthPct: 0.05, points: 101 });
    expect(curve.points).toHaveLength(101);
    expect(curve.points[0].spot).toBeCloseTo(CONDOR_SPOT * 0.95, 6);
    expect(curve.points[100].spot).toBeCloseTo(CONDOR_SPOT * 1.05, 6);
    for (let i = 1; i < curve.points.length; i++) {
      expect(curve.points[i].spot).toBeGreaterThan(curve.points[i - 1].spot);
    }
  });

  test("long call breaches one side, so maxProfit is unbounded", () => {
    const curve = payoffCurve([leg("buy", "CE", 24000, 100, 1, 50)], 24000);
    expect(curve.maxProfit).toBeNull();
    expect(curve.maxLoss).toBeCloseTo(-5000, 6); // 50 × 100
    expect(curve.breakevens).toHaveLength(1);
    expect(curve.breakevens[0]).toBeCloseTo(24100, 6);
  });

  test("short call is unbounded on the loss side", () => {
    const curve = payoffCurve([leg("sell", "CE", 24000, 100, 1, 50)], 24000);
    expect(curve.maxLoss).toBeNull();
    expect(curve.maxProfit).toBeCloseTo(5000, 6);
    expect(curve.breakevens[0]).toBeCloseTo(24100, 6);
  });

  test("short put keeps a bounded loss and a bounded profit", () => {
    const curve = payoffCurve([leg("sell", "PE", 24000, 100, 1, 50)], 24000);
    expect(curve.maxProfit).toBeCloseTo(5000, 6);
    // K − p = 23900 is the floor; floor × units.
    expect(curve.maxLoss).toBeCloseTo(-(24000 - 100) * 50, 6);
    expect(curve.breakevens[0]).toBeCloseTo(23900, 6);
  });

  test("straddle: both bounds unbounded", () => {
    const curve = payoffCurve(
      [leg("buy", "CE", 24000, 100, 1, 50), leg("buy", "PE", 24000, 100, 1, 50)],
      24000,
    );
    expect(curve.maxProfit).toBeNull();
    expect(curve.maxLoss).toBeCloseTo(-10000, 6); // the debit
    expect(curve.breakevens).toHaveLength(2);
  });

  test("no legs → flat zero, no breakevens, zero premium", () => {
    const curve = payoffCurve([], CONDOR_SPOT);
    expect(curve.points).toHaveLength(241);
    expect(curve.points.every((p) => p.pnl === 0)).toBe(true);
    expect(curve.breakevens).toEqual([]);
    expect(curve.netPremium).toBe(0);
    expect(curve.maxProfit).toBe(0);
    expect(curve.maxLoss).toBe(0);
  });

  test("debit baskets report a negative net premium", () => {
    const curve = payoffCurve([leg("buy", "CE", 24000, 100, 1, 50)], 24000);
    expect(curve.netPremium).toBeCloseTo(-5000, 6);
  });

  test("payoff is continuous at every strike (no kink offset from sampling)", () => {
    const curve = payoffCurve(CONDOR, CONDOR_SPOT, { points: 2001 });
    const strikes = [23500, 23800, 24200, 24500];
    for (const strike of strikes) {
      // Approach from both sides: a kink sampled at a single point must agree.
      expect(payoffAt(strike - 1e-9, CONDOR)).toBeCloseTo(payoffAt(strike, CONDOR), 4);
      expect(payoffAt(strike + 1e-9, CONDOR)).toBeCloseTo(payoffAt(strike, CONDOR), 4);
    }
    // A real kink can only change the *slope*; the line itself may not jump.
    for (let i = 1; i < curve.points.length; i++) {
      const jump = Math.abs(curve.points[i].pnl - curve.points[i - 1].pnl);
      const step = curve.points[i].spot - curve.points[i - 1].spot;
      expect(jump).toBeLessThan(step * 65 + 1e-6); // 65 units = the steepest leg
    }
  });

  test("4 legs / 241 points recomputes inside the 1.2 ms budget", () => {
    payoffCurve(CONDOR, CONDOR_SPOT); // warm up the JIT
    const started = performance.now();
    const runs = 50;
    for (let i = 0; i < runs; i++) payoffCurve(CONDOR, CONDOR_SPOT);
    const perCall = (performance.now() - started) / runs;
    expect(perCall).toBeLessThan(1.2);
  });
});

describe("expectedMove", () => {
  test("§4.1: 24 031.5 × 13.8 % × √(2/365) ≈ 245", () => {
    expect(expectedMove(CONDOR_SPOT, CONDOR_IV, CONDOR_T)).toBeCloseTo(245.5, 1);
  });

  test("scales linearly with spot and with √T", () => {
    const base = expectedMove(10000, 0.2, 0.25);
    expect(base).toBeCloseTo(1000, 6);
    expect(expectedMove(20000, 0.2, 0.25)).toBeCloseTo(2000, 6);
    expect(expectedMove(10000, 0.2, 1)).toBeCloseTo(base * 2, 6);
  });

  test("floors T at 15 minutes and never returns NaN/Infinity for a live model", () => {
    const floored = expectedMove(24000, 0.14, 5 / (365 * 24 * 60));
    const atFloor = expectedMove(24000, 0.14, 15 / (365 * 24 * 60));
    expect(floored).toBeCloseTo(atFloor, 6);
    expect(expectedMove(24000, 0.14, -1)).toBeCloseTo(atFloor, 6);
    expect(Number.isFinite(expectedMove(24000, 0.01, 0.01))).toBe(true);
  });

  test("unavailable model → NaN, never 0 (0 reads as 'no move priced')", () => {
    expect(Number.isNaN(expectedMove(24000, 0, 0.01))).toBe(true);
    expect(Number.isNaN(expectedMove(24000, Number.NaN, 0.01))).toBe(true);
    expect(Number.isNaN(expectedMove(0, 0.14, 0.01))).toBe(true);
  });
});

describe("probabilityOfProfit", () => {
  test("§4.1 condor: POP ≈ 69.7 %, model E[P&L] ≈ −13", () => {
    const result = probabilityOfProfit(CONDOR, CONDOR_SPOT, CONDOR_IV, CONDOR_T);
    expect(result.pop).toBeCloseTo(0.697, 3); // ±0.3 pp
    expect(result.expectedPnl).toBeCloseTo(-13, 0); // ±2 of the plan's −13
    expect(result.sigma).toBeCloseTo(245.5, 1);
  });

  test("POP + P(loss) sums to 1", () => {
    const profit = probabilityOfProfit(CONDOR, CONDOR_SPOT, CONDOR_IV, CONDOR_T);
    // A bounded basket's profitable set is one interval; the complement is loss.
    const inverted = probabilityOfProfit(
      CONDOR.map((l) => ({ ...l, side: l.side === "buy" ? "sell" : "buy" }) as OptionLeg),
      CONDOR_SPOT,
      CONDOR_IV,
      CONDOR_T,
    );
    expect(profit.pop + inverted.pop).toBeCloseTo(1, 9);
  });

  test("long call POP matches an independently-coded Black-76 tail probability", () => {
    const call = [leg("buy", "CE", 24000, 100)];
    const result = probabilityOfProfit(call, 24000, 0.2, 30 / 365);
    // P(S_T > K + p) = 1 − Φ(d(K + p))
    const sigma = 0.2 * Math.sqrt(30 / 365);
    const d = (Math.log(24100 / 24000) + 0.5 * sigma * sigma) / sigma;
    const reference = 1 - standardNormal(d);
    expect(result.pop).toBeCloseTo(reference, 6);
  });

  test("density bars are probabilities and describe a bell", () => {
    const result = probabilityOfProfit(CONDOR, CONDOR_SPOT, CONDOR_IV, CONDOR_T);
    expect(result.density).toHaveLength(241);
    // Window is ±3.5σ (±245 pts → ±861 pts), so ±10 % does not apply here.
    expect(result.density[0].spot).toBeLessThan(CONDOR_SPOT);
    expect(result.density[240].spot).toBeGreaterThan(CONDOR_SPOT);
    expect(result.density[120].spot).toBeCloseTo(CONDOR_SPOT, 6);

    const mass = result.density.reduce((acc, p) => acc + p.prob, 0);
    expect(mass).toBeGreaterThan(0.99);
    expect(mass).toBeLessThan(1 + 1e-9);

    // Bell shape, not a single bar: the peak is at the mode and both tails fade.
    const peak = result.density.reduce((best, p) => (p.prob > best.prob ? p : best), result.density[0]);
    expect(Math.abs(peak.spot - CONDOR_SPOT)).toBeLessThan(CONDOR_SPOT * 0.01);
    expect(result.density[0].prob).toBeLessThan(peak.prob / 100);
    expect(result.density[240].prob).toBeLessThan(peak.prob / 100);
    expect(result.density.every((p) => p.prob >= 0 && Number.isFinite(p.prob))).toBe(true);
  });

  test("T floor: a 5-minute expiry equals the 15-minute floor", () => {
    const short = probabilityOfProfit(CONDOR, CONDOR_SPOT, CONDOR_IV, 5 / (365 * 24 * 60));
    const floored = probabilityOfProfit(CONDOR, CONDOR_SPOT, CONDOR_IV, 15 / (365 * 24 * 60));
    expect(short.pop).toBeCloseTo(floored.pop, 12);
    expect(short.sigma).toBeCloseTo(floored.sigma, 9);
  });

  test("IV = 0 or NaN → no number, empty density (never NaN in the UI)", () => {
    for (const iv of [0, Number.NaN, -0.1]) {
      const result = probabilityOfProfit(CONDOR, CONDOR_SPOT, iv, CONDOR_T);
      expect(Number.isNaN(result.pop)).toBe(true);
      expect(Number.isNaN(result.expectedPnl)).toBe(true);
      expect(Number.isNaN(result.sigma)).toBe(true);
      expect(result.density).toEqual([]);
    }
  });

  test("no legs → POP 0, expected 0, density still plotted", () => {
    const result = probabilityOfProfit([], CONDOR_SPOT, CONDOR_IV, CONDOR_T);
    expect(result.pop).toBe(0);
    expect(result.expectedPnl).toBe(0);
    expect(result.density).toHaveLength(241);
  });

  test("short butterfly: two disjoint profit regions both count toward POP", () => {
    // sell 95 / buy 2× 100 / sell 105 CE — profit on both tails, loss in the body.
    const shortFly: OptionLeg[] = [
      leg("sell", "CE", 95, 6, 1, 50),
      leg("buy", "CE", 100, 3, 2, 50),
      leg("sell", "CE", 105, 1, 1, 50),
    ];
    const result = probabilityOfProfit(shortFly, 100, 0.25, 30 / 365);
    // Closed form: P(S<96) + P(S>104) = 0.29677 + 0.27993 = 0.57669.
    expect(result.pop).toBeCloseTo(0.5767, 3);

    const longFly: OptionLeg[] = shortFly.map((l) => ({ ...l, side: l.side === "buy" ? "sell" : "buy" }));
    const mirrored = probabilityOfProfit(longFly, 100, 0.25, 30 / 365);
    expect(mirrored.pop).toBeCloseTo(0.4233, 3);
    expect(result.pop + mirrored.pop).toBeCloseTo(1, 9);

    const curve = payoffCurve(shortFly, 100, { widthPct: 0.2 });
    expect(curve.maxProfit).toBeCloseTo(50, 6);
    expect(curve.maxLoss).toBeCloseTo(-200, 6);
  });

  test("zero-premium synthetic reports ₹0 premium, not a blank", () => {
    const synthetic = [leg("buy", "CE", 24000, 0), leg("sell", "PE", 24000, 0)];
    const curve = payoffCurve(synthetic, 24000);
    expect(curve.netPremium).toBe(0);
    expect(curve.points.every((p) => Number.isFinite(p.pnl))).toBe(true);
    expect(curve.breakevens).toEqual([24000]);
  });

  test("Φ is accurate at the tabulated points (0, ±1, ±1.96, ±2.576)", () => {    // A zero-premium long call's breakeven is the strike itself, so POP is
    // exactly 1 − Φ(d(K)); invert for K to probe Φ at a chosen d.
    const spot = 10000;
    const iv = 0.25;
    const t = 90 / 365;
    const sigma = iv * Math.sqrt(t);
    const mu = -0.5 * sigma * sigma;
    const table: [number, number][] = [
      [0, 0.5],
      [1, 0.8413447460685429],
      [-1, 0.15865525393145707],
      [1.96, 0.9750021048517795],
      [-1.96, 0.02499789514822043],
      [2.576, 0.995002467315735],
      [-2.576, 0.004997532684265],
    ];
    for (const [d, expected] of table) {
      const strike = spot * Math.exp(mu + d * sigma);
      const result = probabilityOfProfit([leg("buy", "CE", strike, 0, 1, 1)], spot, iv, t);
      expect(result.pop).toBeCloseTo(1 - expected, 6);
    }
  });

  test("a leg priced at its Black-76 value has model E[P&L] ≈ 0 (put-call parity)", () => {
    const spot = 24000;
    const iv = 0.2;
    const t = 30 / 365;
    const sigma = iv * Math.sqrt(t);
    const mu = -0.5 * sigma * sigma;
    const strike = 24000;
    // d(K) in this module is the *tail* probability P(S_T ≤ K), so the call's
    // d₂ is −d(K) and d₁ = d₂ + σ√T. Getting this sign wrong is the cheapest
    // way to produce a plausible-looking wrong premium (plan §5.2).
    const dK = (Math.log(strike / spot) - mu) / sigma;
    const d2 = -dK;
    const d1 = d2 + sigma;
    const callValue = spot * standardNormal(d1) - strike * standardNormal(d2);
    const putValue = strike * standardNormal(-d2) - spot * standardNormal(-d1);

    // Parity itself: C − P = S − K at r = 0.
    expect(callValue - putValue).toBeCloseTo(spot - strike, 6);

    for (const [type, value] of [
      ["CE", callValue],
      ["PE", putValue],
    ] as const) {
      const result = probabilityOfProfit([leg("buy", type, strike, value)], spot, iv, t);
      // Not exactly 0: the A&S Φ has |ε| < 1.5e-7, and spot × 1.5e-7 ≈ ₹0.004.
      // A paisa tolerance proves the sign convention without hiding a real bug
      // (the wrong d₁ sign showed up as ₹58.7 here, four orders larger).
      expect(Math.abs(result.expectedPnl)).toBeLessThan(0.01);
    }
  });
});

describe("aggregateGreeks", () => {
  const greeks = (delta: number, gamma: number, theta: number, vega: number) => ({
    delta,
    gamma,
    theta,
    vega,
  });

  test("sums signed by side and scaled by lots × lot size", () => {
    const legs = [leg("buy", "CE", 24000, 100, 1, 65), leg("sell", "PE", 24000, 100, 2, 65)];
    const net = aggregateGreeks(legs, (l) =>
      l.type === "CE" ? greeks(0.5, 0.001, -10, 20) : greeks(-0.4, 0.002, -12, 25),
    );
    expect(net.partial).toBe(false);
    expect(net.delta).toBeCloseTo(65 * 0.5 - 130 * -0.4, 9);
    expect(net.gamma).toBeCloseTo(65 * 0.001 - 130 * 0.002, 9);
    expect(net.theta).toBeCloseTo(65 * -10 - 130 * -12, 9);
    expect(net.vega).toBeCloseTo(65 * 20 - 130 * 25, 9);
  });

  test("one missing greek nulls that aggregate and flags partial (no zero-fill)", () => {
    const legs = [leg("buy", "CE", 24000, 100), leg("sell", "PE", 24000, 100)];
    const net = aggregateGreeks(legs, (l) =>
      l.type === "CE" ? greeks(0.5, 0.001, -10, 20) : { delta: null, gamma: 0.002, theta: -12, vega: 25 },
    );
    expect(net.partial).toBe(true);
    expect(net.delta).toBeNull();
    expect(net.gamma).not.toBeNull();
    expect(net.theta).not.toBeNull();
    expect(net.vega).not.toBeNull();
  });

  test("absent greek object → every aggregate null, partial true", () => {
    const net = aggregateGreeks([leg("buy", "CE", 24000, 100)], () => ({}));
    expect(net).toEqual({ delta: null, gamma: null, theta: null, vega: null, partial: true });
  });

  test("empty basket → zeros, not partial", () => {
    expect(aggregateGreeks([], () => ({}))).toEqual({
      delta: 0,
      gamma: 0,
      theta: 0,
      vega: 0,
      partial: false,
    });
  });
});

describe("maxPain", () => {
  test("skewed OI table pins at the strike with the smallest total payout", () => {
    // Heavy CE OI above 24 000 pulls the pin down; heavy PE OI below pulls it up.
    const chain = [
      { strike: 23800, ceOi: 10, peOi: 900 },
      { strike: 23900, ceOi: 20, peOi: 600 },
      { strike: 24000, ceOi: 1200, peOi: 1200 },
      { strike: 24100, ceOi: 900, peOi: 20 },
      { strike: 24200, ceOi: 600, peOi: 10 },
    ];
    expect(maxPain(chain)).toBe(24000);
  });

  test("3-strike hand-worked fixture pins in the middle", () => {
    const chain = [
      { strike: 90, ceOi: 0, peOi: 10 },
      { strike: 100, ceOi: 5, peOi: 5 },
      { strike: 110, ceOi: 10, peOi: 0 },
    ];
    // Payout at 90 : CE(100) 5×10 + CE(110) 10×20 = 250
    // Payout at 100: CE(110) 10×10 + PE(90) 10×10 = 200
    // Payout at 110: PE(90) 10×20 + PE(100) 5×10 = 250
    expect(maxPain(chain)).toBe(100);

    // Flip the skew to a one-sided wall: the pin follows the heavy side.
    expect(
      maxPain([
        { strike: 90, ceOi: 0, peOi: 10 },
        { strike: 100, ceOi: 0, peOi: 0 },
        { strike: 110, ceOi: 40, peOi: 0 },
      ]),
    ).toBe(110);
  });

  test("all-zero OI still returns a strike", () => {
    const chain = [
      { strike: 100, ceOi: 0, peOi: 0 },
      { strike: 110, ceOi: 0, peOi: 0 },
    ];
    expect(maxPain(chain)).toBe(100);
    expect(maxPain([])).toBeNull();
  });
});

describe("pcr", () => {
  test("sums PE over CE", () => {
    expect(
      pcr([
        { ceOi: 100, peOi: 150 },
        { ceOi: 100, peOi: 50 },
      ]),
    ).toBeCloseTo(1, 9);
  });

  test("zero CE OI → null, never 0 or Infinity", () => {
    expect(pcr([{ ceOi: 0, peOi: 100 }])).toBeNull();
    expect(pcr([])).toBeNull();
  });

  test("ignores non-finite OI", () => {
    expect(pcr([{ ceOi: Number.NaN, peOi: 50 }])).toBeNull();
  });
});

describe("pickDefaultExpiry", () => {
  // 2026-10-21T06:00Z = 11:30 IST; 2026-10-21T10:20Z = 15:50 IST.
  const midday = new Date("2026-10-21T06:00:00Z");
  const afterClose = new Date("2026-10-21T10:20:00Z");
  const expiries = ["2026-10-15", "2026-10-22", "2026-10-29"];

  test("picks the first date ≥ today", () => {
    expect(pickDefaultExpiry(expiries, midday)).toBe("2026-10-22");
  });

  test("expiry today, before the derivatives close → today", () => {
    expect(pickDefaultExpiry(["2026-10-21", "2026-10-28"], midday)).toBe("2026-10-21");
  });

  test("expiry today, at/after 15:40 IST → next expiry", () => {
    expect(pickDefaultExpiry(["2026-10-21", "2026-10-28"], afterClose)).toBe("2026-10-28");
  });

  test("expiry today is the only one and the market is closed → null", () => {
    expect(pickDefaultExpiry(["2026-10-21"], afterClose)).toBeNull();
  });

  test("custom cutoff is honoured", () => {
    expect(pickDefaultExpiry(["2026-10-21", "2026-10-28"], midday, 600)).toBe("2026-10-28");
  });

  test("empty or all-past list → null", () => {
    expect(pickDefaultExpiry([], midday)).toBeNull();
    expect(pickDefaultExpiry(["2026-10-01", "2026-10-02"], midday)).toBeNull();
  });

  test("unsorted duplicates are handled", () => {
    expect(pickDefaultExpiry(["2026-10-29", "2026-10-22", "2026-10-22"], midday)).toBe("2026-10-22");
  });
});

describe("degenerate inputs — no NaN or Infinity ever reaches the UI", () => {
  test("the curve stays finite for every iv/T/spot the feed can send", () => {
    const cases: [number, number, number][] = [
      [CONDOR_SPOT, 0.138, CONDOR_T],
      [CONDOR_SPOT, 0, CONDOR_T],
      [CONDOR_SPOT, Number.NaN, CONDOR_T],
      [CONDOR_SPOT, Number.POSITIVE_INFINITY, CONDOR_T],
      [CONDOR_SPOT, 10, CONDOR_T], // 1000 % vol
      [CONDOR_SPOT, 0.138, 0],
      [CONDOR_SPOT, 0.138, -1],
      [CONDOR_SPOT, 0.9, 50], // 50-year horizon
    ];
    for (const [spot, iv, t] of cases) {
      const curve = payoffCurve(CONDOR, spot);
      expect(curve.points.every((p) => Number.isFinite(p.pnl) && Number.isFinite(p.spot))).toBe(true);
      expect(curve.points).toHaveLength(241);

      const prob = probabilityOfProfit(CONDOR, spot, iv, t);
      const usable = iv > 0 && Number.isFinite(iv);
      expect(prob.density.every((d) => Number.isFinite(d.prob) && d.prob >= 0)).toBe(true);
      if (usable) {
        expect(Number.isFinite(prob.pop)).toBe(true);
        expect(Number.isFinite(prob.expectedPnl)).toBe(true);
        expect(prob.pop).toBeGreaterThanOrEqual(0);
        expect(prob.pop).toBeLessThanOrEqual(1);
        // At T→0 the mass concentrates on spot, so the cell sum lands a few
        // femtos above the bounded payoff; the bound is the right ceiling.
        expect(prob.expectedPnl).toBeLessThanOrEqual((curve.maxProfit ?? Infinity) + 1e-6);
      } else {
        expect(Number.isNaN(prob.pop)).toBe(true);
        expect(prob.density).toEqual([]);
      }
    }
  });

  test("unusable spot returns an empty curve instead of NaN points", () => {
    for (const spot of [0, -100, Number.NaN, Number.POSITIVE_INFINITY]) {
      const curve = payoffCurve(CONDOR, spot);
      expect(curve.points).toEqual([]);
      expect(curve.breakevens).toEqual([]);
      expect(curve.maxProfit).toBeNull();
      expect(curve.maxLoss).toBeNull();
      expect(Number.isFinite(curve.netPremium)).toBe(true);
    }
  });
});

describe("purity", () => {
  const deepFreeze = <T,>(value: T): T => {
    if (value && typeof value === "object") {
      for (const child of Object.values(value)) deepFreeze(child);
      Object.freeze(value);
    }
    return value;
  };

  test("deterministic across calls", () => {
    const a = payoffCurve(CONDOR, CONDOR_SPOT);
    const b = payoffCurve(CONDOR, CONDOR_SPOT);
    expect(a).toEqual(b);
    const p1 = probabilityOfProfit(CONDOR, CONDOR_SPOT, CONDOR_IV, CONDOR_T);
    const p2 = probabilityOfProfit(CONDOR, CONDOR_SPOT, CONDOR_IV, CONDOR_T);
    expect(p1).toEqual(p2);
  });

  test("never mutates legs, the chain or the expiry list", () => {
    const legs = deepFreeze(CONDOR.map((l) => ({ ...l })));
    const chain = deepFreeze([
      { strike: 24000, ceOi: 10, peOi: 20 },
      { strike: 24100, ceOi: 30, peOi: 5 },
    ]);
    const expiries = deepFreeze(["2026-10-29", "2026-10-22"]);
    const opts = deepFreeze({ widthPct: 0.05, points: 41 });

    expect(() => payoffCurve(legs, CONDOR_SPOT, opts)).not.toThrow();
    expect(() => payoffAt(24000, legs)).not.toThrow();
    expect(() => probabilityOfProfit(legs, CONDOR_SPOT, CONDOR_IV, CONDOR_T)).not.toThrow();
    expect(() => aggregateGreeks(legs, () => ({ delta: 0.5 }))).not.toThrow();
    expect(() => maxPain(chain)).not.toThrow();
    expect(() => pcr(chain)).not.toThrow();
    expect(() => pickDefaultExpiry(expiries, new Date("2026-10-21T06:00:00Z"))).not.toThrow();

    expect(legs).toEqual(CONDOR);
    expect(expiries).toEqual(["2026-10-29", "2026-10-22"]);
  });
});

/** Abramowitz & Stegun 7.0.26 erf, coded independently of the module's 7.1.26 path. */
function standardNormal(x: number): number {
  const z = x / Math.SQRT2;
  const sign = z < 0 ? -1 : 1;
  const ax = Math.abs(z);
  const t = 1 / (1 + 0.3275911 * ax);
  const poly =
    t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = sign * (1 - poly * Math.exp(-ax * ax));
  return 0.5 * (1 + erf);
}
