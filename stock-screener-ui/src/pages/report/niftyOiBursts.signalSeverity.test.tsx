// @vitest-environment happy-dom

import { describe, expect, test } from "vitest";
import {
  NIFTY_LOT_SIZE,
  OI_BURST_TIERS,
  burstToAlert,
  criticalBannerText,
  deriveOiSignal,
  inferFlowFromPremium,
  resolveOiDirection,
  severityForScore,
} from "./niftyOiBursts";

describe("severityForScore", () => {
  test("maps score to the tier ladder", () => {
    expect(severityForScore(1)).toBe("info");
    expect(severityForScore(OI_BURST_TIERS.watch)).toBe("watch");
    expect(severityForScore(OI_BURST_TIERS.alert)).toBe("alert");
    expect(severityForScore(OI_BURST_TIERS.critical)).toBe("critical");
    expect(severityForScore(999)).toBe("critical");
  });
});

describe("deriveOiSignal", () => {
  const chain = [
    { strike: 22_650, ce: { ltp: 70 }, pe: { ltp: 12 } },
    { strike: 22_700, ce: { ltp: 22 }, pe: { ltp: 28 } },
    { strike: 22_750, ce: { ltp: 8 }, pe: { ltp: 60 } }, // CE under minPremium
  ];
  const spot = 22_722;

  function burst(side: "call" | "put", delta = 60_000): Parameters<typeof deriveOiSignal>[0] {
    return {
      id: "x",
      side,
      t: "14:03",
      delta,
      baseline: 1_000,
      score: 60,
      severity: "critical",
      cumDoi: 0,
      spot,
      tickVol: 1_000,
    };
  }

  test("call OI build fades with the nearest tradeable PUT", () => {
    const s = deriveOiSignal(burst("call", 60_000), chain, spot)!;
    expect(s.leg).toBe("PE");
    expect(s.strike).toBe(22_700);
    expect(s.entry).toBe(28);
    expect(s.target).toBe(42);
    expect(s.sl).toBe(21);
    expect(s.basis).toContain("build");
    expect(s.basis).toContain("ceiling");
  });

  test("call OI unwind buys CALLS (writers covering = upside fuel)", () => {
    const s = deriveOiSignal(burst("call", -60_000), chain, spot)!;
    expect(s.leg).toBe("CE");
    expect(s.basis).toContain("unwind");
    expect(s.basis).toContain("upside fuel");
  });

  test("put OI build buys CALLS at the nearest tradeable strike", () => {
    const s = deriveOiSignal(burst("put", 60_000), chain, spot)!;
    expect(s.leg).toBe("CE");
    // 22,750 CE is 8 (< minPremium 10) so the nearest tradeable is 22,700
    expect(s.strike).toBe(22_700);
    expect(s.entry).toBe(22);
    expect(s.basis).toContain("floor");
  });

  test("put OI unwind buys PUTS (support removed)", () => {
    const s = deriveOiSignal(burst("put", -60_000), chain, spot)!;
    expect(s.leg).toBe("PE");
    expect(s.basis).toContain("support removed");
  });

  test("sizes whole lots from a fixed risk budget", () => {
    const s = deriveOiSignal(burst("call", 60_000), chain, spot)!;
    // entry 28, sl 21 → risk/unit 7 → 714 units → floored to whole lots.
    // Derived from the constant, not hardcoded: the lot size is a market fact
    // (65) that has already changed once.
    const lots = Math.floor(714 / NIFTY_LOT_SIZE);
    expect(s.lots).toBe(lots);
    expect(s.qty).toBe(lots * NIFTY_LOT_SIZE);
    expect(s.qty % NIFTY_LOT_SIZE).toBe(0);
  });

  test("returns null when no strike clears the minimum premium", () => {
    const dead = [{ strike: 22_700, ce: { ltp: 0.05 }, pe: { ltp: 0.05 } }];
    expect(deriveOiSignal(burst("call", 60_000), dead, spot)).toBeNull();
    expect(deriveOiSignal(burst("call", 60_000), [], spot)).toBeNull();
  });

  test("target sits above entry which sits above the stop", () => {
    const s = deriveOiSignal(burst("put", -60_000), chain, spot)!;
    expect(s.sl).toBeLessThan(s.entry);
    expect(s.target).toBeGreaterThan(s.entry);
  });
});

describe("trend gate", () => {
  const chain = [
    { strike: 22_700, ce: { ltp: 22 }, pe: { ltp: 28 } },
  ];
  const burst = (side: "call" | "put", delta: number) => ({
    id: "x", side, t: "14:20", delta, baseline: 1_000, score: 60,
    severity: "critical" as const, cumDoi: 0, spot: 22_720, tickVol: 0,
  });

  test("aligned plan is not flagged", () => {
    // call unwind -> CE (bullish); trend up -> aligned
    const s = deriveOiSignal(burst("call", -50_000), chain, 22_720, { trend: "up" })!;
    expect(s.leg).toBe("CE");
    expect(s.aligned).toBe(true);
    expect(s.trend).toBe("up");
    expect(s.basis).not.toContain("COUNTER-TREND");
  });

  test("counter-trend emits no plan", () => {
    const s = deriveOiSignal(burst("call", -50_000), chain, 22_720, { trend: "down" });
    expect(s).toBeNull();
  });

  test("no trend leaves the plan ungated", () => {
    const s = deriveOiSignal(burst("put", 50_000), chain, 22_720)!;
    expect(s.aligned).toBeNull();
    expect(s.trend).toBeNull();
  });

  test("counter-trend bursts carry no plan in the alert detail", () => {
    const b = { ...burst("call", -50_000), trend: "down" as const };
    const signal = deriveOiSignal(b, chain, 22_720, { trend: b.trend });
    expect(signal).toBeNull();
    const a = burstToAlert(b, signal);
    expect(a.detail).not.toContain("BUY");
  });

  test("aligned plans have no skip marker", () => {
    const b = { ...burst("call", -50_000), trend: "up" as const };
    const signal = deriveOiSignal(b, chain, 22_720, { trend: b.trend });
    expect(burstToAlert(b, signal).detail).not.toContain("skip");
  });
});

describe("squeeze trigger (momentum, not fade)", () => {
  const chain = [{ strike: 22_600, ce: { ltp: 40 }, pe: { ltp: 35 } }];
  const squeeze = (side: "call" | "put", delta: number, wall: number) => ({
    id: `sq-${side}`, side, t: "14:21", delta, baseline: 2_000_000, score: 8.2,
    severity: "critical" as const, cumDoi: 0, spot: 22_610, tickVol: 0,
    type: "squeeze" as const, wall,
  });

  test("call squeeze buys CE and is aligned even against the trend", () => {
    const s = deriveOiSignal(squeeze("call", -16_461_965, 22_600), chain, 22_610, {
      trend: "down",
    })!;
    expect(s.leg).toBe("CE");
    expect(s.aligned).toBe(true);
    expect(s.basis).toContain("short-covering squeeze");
    expect(s.basis).toContain("22,600");
    // Unwind size is OI in UNITS (shares), matching the backend wording.
    expect(s.basis).toContain("1,64,61,965 units");
  });

  test("put squeeze buys PE", () => {
    const s = deriveOiSignal(squeeze("put", -9_000_000, 22_500), chain, 22_480, {})!;
    expect(s.leg).toBe("PE");
    expect(s.aligned).toBe(true);
  });

  test("a plain burst is still a fade (unchanged)", () => {
    const b = { ...squeeze("call", 60_000, 22_600) };
    delete (b as { type?: unknown }).type;
    // no trend -> ungated, so the fade direction itself is observable
    const s = deriveOiSignal(b, chain, 22_610, {})!;
    expect(s.leg).toBe("PE");       // fade, not momentum
  });

  test("squeeze alert carries the squeeze rationale", () => {
    const b = squeeze("call", -16_461_965, 22_600);
    const a = burstToAlert(b, deriveOiSignal(b, chain, 22_610, {}));
    expect(a.detail).toContain("short-covering squeeze");
    expect(a.detail).not.toContain("COUNTER-TREND");
  });
});

describe("per-strike bursts", () => {
  const chain = [
    { strike: 22_700, ce: { ltp: 22 }, pe: { ltp: 28 } },
    { strike: 22_750, ce: { ltp: 9 }, pe: { ltp: 60 } },
  ];

  test("the named strike wins over nearest-to-spot", () => {
    const b = { id: "s", side: "call" as const, t: "14:33", delta: 6_300_000,
      baseline: 300_000, score: 18.9, severity: "critical" as const, cumDoi: 0,
      spot: 22_720, tickVol: 0, type: "strike" as const, strike: 22_750, leg: "CE" };
    // no trend -> ungated, so strike selection itself is observable
    const s = deriveOiSignal(b, chain, 22_720, {})!;
    expect(s.strike).toBe(22_750);   // not 22,700, which is nearer to spot
  });

  test("falls back to nearest-to-spot when the named strike is not in the chain", () => {
    const b = { id: "s", side: "call" as const, t: "14:33", delta: 6_300_000,
      baseline: 300_000, score: 18.9, severity: "critical" as const, cumDoi: 0,
      spot: 22_720, tickVol: 0, type: "strike" as const, strike: 99_999 };
    const s = deriveOiSignal(b, chain, 22_720, {})!;
    expect(s.strike).toBe(22_700);
  });
});

describe("premium + coil triggers", () => {
  const chain = [{ strike: 22_700, ce: { ltp: 30 }, pe: { ltp: 22 } }];

  test("premium impulse buys the moved leg, aligned by construction", () => {
    const b = { id: "p", side: "call" as const, t: "14:03", delta: 10, baseline: 20,
      score: 50, severity: "critical" as const, cumDoi: 0, spot: 22_715, tickVol: 0,
      type: "premium" as const, leg: "CE", strike: 22_700, pct: 50 };
    const s = deriveOiSignal(b, chain, 22_715, { trend: "down" })!;
    expect(s.leg).toBe("CE");
    expect(s.aligned).toBe(true);
    expect(s.basis).toContain("premium impulse");
    expect(s.basis).toContain("+50.00%");
  });

  test("a coil produces no trade plan", () => {
    const b = { id: "c", side: "call" as const, t: "14:10", delta: 0, baseline: 0,
      score: 0.01, severity: "watch" as const, cumDoi: 0, spot: 22_748, tickVol: 0,
      type: "coil" as const, wall: 22_750, range_pct: 0.009, dist_pct: 0.004 };
    expect(deriveOiSignal(b, chain, 22_748, {})).toBeNull();
  });

  test("coil alert is titled as a heads-up, not a buy", () => {
    const b = { id: "c", side: "call" as const, t: "14:10", delta: 0, baseline: 0,
      score: 0.01, severity: "watch" as const, cumDoi: 0, spot: 22_748, tickVol: 0,
      type: "coil" as const, wall: 22_750, range_pct: 0.009, dist_pct: 0.004 };
    const a = burstToAlert(b, null);
    expect(a.title).toContain("COILING @ 22,750");
    expect(a.detail).toContain("heads-up, no plan");
    expect(a.title).not.toContain("BUY");
  });
});

describe("flow-aware direction (covering/liquidation)", () => {
  // Mirrors the 2026-10-21 15:04 event: put OI unwind −1.48M at spot 22,701,
  // 5m up, backend flow covering (bullish) — the squeeze that followed.
  const chain = [
    { strike: 22_700, ce: { ltp: 185 }, pe: { ltp: 140 } },
  ];
  const spot = 22_701;

  function burst(overrides = {}) {
    return {
      id: "x", side: "put" as const, t: "15:04", delta: -1_480_000,
      baseline: 100_000, score: 14.8, severity: "critical" as const, cumDoi: 0,
      spot, tickVol: 5_000, ...overrides,
    };
  }

  test("15:04 fixture: put unwind + covering in an up-move → BUY CE 22,700", () => {
    const b = burst({ flow: "covering", bearish: false });
    const s = deriveOiSignal(b, chain, spot, { trend: "up", trend5m: "up" })!;
    expect(s.leg).toBe("CE");
    expect(s.strike).toBe(22_700);
    expect(s.entry).toBe(185);
    expect(s.sl).toBe(138.75);
    expect(s.target).toBe(277.5);
    expect(s.basis).toContain("covering");
    expect(s.aligned).toBe(true);
    const a = burstToAlert(b, s);
    expect(a.title).toContain("BUY CE 22,700");
    expect(criticalBannerText(b, a)).toContain("BUY CE 22,700");
  });

  test("put unwind + liquidation in a down-move → BUY PE", () => {
    const b = burst({ flow: "liquidation", bearish: true });
    const s = deriveOiSignal(b, chain, spot, { trend: "down", trend5m: "down" })!;
    expect(s.leg).toBe("PE");
    expect(s.entry).toBe(140);
    expect(s.sl).toBe(105);
    expect(s.target).toBe(210);
    expect(s.basis).toContain("liquidation");
  });

  test("put build + buyers in an up-trend → no plan (counter-trend rule kept)", () => {
    const b = burst({ delta: 1_480_000, flow: "buyers", bearish: true });
    expect(deriveOiSignal(b, chain, spot, { trend: "up", trend5m: "up" })).toBeNull();
  });

  test("put build + writers in an up-trend → BUY CE (support)", () => {
    const b = burst({ delta: 640_000, flow: "writers", bearish: false });
    const s = deriveOiSignal(b, chain, spot, { trend: "up", trend5m: "up" })!;
    expect(s.leg).toBe("CE");
    expect(s.basis).toContain("writers");
  });

  test("bearish verdict alone decides the leg (no flow string)", () => {
    const bull = resolveOiDirection({ side: "put", delta: -1_000, bearish: false });
    expect(bull.leg).toBe("CE");
    expect(bull.via).toBe("flow");
    const bear = resolveOiDirection({ side: "call", delta: -1_000, bearish: true });
    expect(bear.leg).toBe("PE");
  });

  test("premium fallback mirrors the backend table", () => {
    const prem = (side: "call" | "put", delta: number, premChg: number) =>
      resolveOiDirection({ side, delta, premChg });
    // put unwind + PE up → covering → CE; PE down → liquidation → PE
    expect(prem("put", -1_000, 50)).toMatchObject({ leg: "CE", via: "premium" });
    expect(prem("put", -1_000, -50)).toMatchObject({ leg: "PE", via: "premium" });
    // put build + PE up → buyers → PE; PE down → writers → CE
    expect(prem("put", 1_000, 50)).toMatchObject({ leg: "PE", via: "premium" });
    expect(prem("put", 1_000, -50)).toMatchObject({ leg: "CE", via: "premium" });
    // call mirror: build + CE up → buyers → CE; build + CE down → writers → PE
    expect(prem("call", 1_000, 50)).toMatchObject({ leg: "CE", via: "premium" });
    expect(prem("call", 1_000, -50)).toMatchObject({ leg: "PE", via: "premium" });
    // unwind call: CE up → covering → CE; CE down → liquidation → PE
    expect(prem("call", -1_000, 50)).toMatchObject({ leg: "CE", via: "premium" });
    expect(prem("call", -1_000, -50)).toMatchObject({ leg: "PE", via: "premium" });
  });

  test("legacy OI-only rule is unchanged without flow or premium", () => {
    expect(resolveOiDirection({ side: "put", delta: -1_000 })).toMatchObject({ leg: "PE", via: "oi" });
    expect(resolveOiDirection({ side: "put", delta: 1_000 })).toMatchObject({ leg: "CE", via: "oi" });
    expect(resolveOiDirection({ side: "call", delta: -1_000 })).toMatchObject({ leg: "CE", via: "oi" });
    expect(resolveOiDirection({ side: "call", delta: 1_000 })).toMatchObject({ leg: "PE", via: "oi" });
    // flat/missing premium never invents a reading
    expect(inferFlowFromPremium(0, false)).toBeNull();
    expect(inferFlowFromPremium(null, false)).toBeNull();
    expect(inferFlowFromPremium(NaN, true)).toBeNull();
    expect(inferFlowFromPremium(12, true)).toBe("buyers");
    expect(inferFlowFromPremium(-12, true)).toBe("writers");
    expect(inferFlowFromPremium(12, false)).toBe("covering");
    expect(inferFlowFromPremium(-12, false)).toBe("liquidation");
  });

  test("5m trend rescues a covering signal on a reversal; both-opposed still blocked", () => {
    const b = burst({ flow: "covering", bearish: false });
    // session down but the last 5m turned up → the CE plan is with the move
    const rescued = deriveOiSignal(b, chain, spot, { trend: "down", trend5m: "up" })!;
    expect(rescued.leg).toBe("CE");
    expect(rescued.aligned).toBe(true);
    // opposed by every known trend → still suppressed
    expect(deriveOiSignal(b, chain, spot, { trend: "down", trend5m: "down" })).toBeNull();
    // no 5m info → the strict session rule still applies
    expect(deriveOiSignal(b, chain, spot, { trend: "down" })).toBeNull();
  });
});
