// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  classifyFlowLeg,
  detectFlipChange,
  detectFlowFlip,
  flipStorageKey,
  flowWindowFromTape,
  fmtFlowCr,
  fmtFlowOi,
  loadStoredFlip,
  saveStoredFlip,
  sessionTone,
  flowNoiseFor,
  readFlow,
  rollingRead,
  FLOW_NOISE,
  FLOW_NOISE_REL,
  FLIP_TTL_MS,
} from "./niftyFlowRead";
import type { NiftyStrike, OiPoint } from "@/types/niftyReport";

describe("classifyFlowLeg", () => {
  test("call build + put unwind is a bid; the inverse is a put bid", () => {
    expect(classifyFlowLeg({ from: "", ce: 3_316_105, pe: -852_670, net: 4_168_775 })).toEqual({
      label: "CALL BID",
      tone: "bull",
    });
    expect(classifyFlowLeg({ from: "", ce: -952_185, pe: 646_815, net: -1_599_000 })).toEqual({
      label: "PUT BID",
      tone: "bear",
    });
  });

  test("both sides building is mixed, not a direction", () => {
    expect(classifyFlowLeg({ from: "", ce: 1, pe: 1, net: 0 }).label).toBe("BOTH BUILD");
    expect(classifyFlowLeg(null).label).toBe("—");
  });
});

describe("detectFlowFlip", () => {
  test("5m against 15m is a flip", () => {
    const out = detectFlowFlip(
      { from: "", ce: -1, pe: 1, net: -2 },
      { from: "", ce: 1, pe: -1, net: 2 },
      "bull",
    );
    expect(out).toEqual({ flipped: true, reason: "5m vs 15m" });
  });

  test("5m against the session is a flip when the medium leg agrees with the session", () => {
    const out = detectFlowFlip(
      { from: "", ce: -1, pe: 1, net: -2 },
      { from: "", ce: 1, pe: -1, net: 2 },
      "bear",
    );
    expect(out.reason).toBe("5m vs 15m");
    expect(detectFlowFlip({ from: "", ce: -1, pe: 1, net: -2 }, null, "bull")).toEqual({
      flipped: true,
      reason: "5m vs session",
    });
  });

  test("aligned legs do not badge a flip", () => {
    expect(
      detectFlowFlip(
        { from: "", ce: 1, pe: -1, net: 2 },
        { from: "", ce: 1, pe: -1, net: 2 },
        "bull",
      ),
    ).toEqual({ flipped: false, reason: null });
  });
});

describe("flowWindowFromTape (generic underlyings)", () => {
  const rows = [
    { t: "2026-11-05T09:15:00+05:30", ce_oi: 1000, pe_oi: 1000 },
    { t: "2026-11-05T09:20:00+05:30", ce_oi: 1100, pe_oi: 900 },
    { t: "2026-11-05T09:25:00+05:30", ce_oi: 1300, pe_oi: 800 },
  ];

  test("derives the 5m/15m CE-PE net from tape OI", () => {
    const fw = flowWindowFromTape(rows);
    expect(fw?.as_of).toBe("2026-11-05T09:25:00+05:30");
    expect(fw?.["5m"]).toMatchObject({ ce: 200, pe: -100, net: 300 });
    expect(fw?.["15m"]).toMatchObject({ ce: 300, pe: -200, net: 500 });
  });

  test("a tape shorter than the window uses its first row (partial, not invented)", () => {
    const fw = flowWindowFromTape(rows.slice(0, 2));
    expect(fw?.["5m"]).toMatchObject({ from: rows[0].t, ce: 100, pe: -100 });
    expect(fw?.["15m"]).toMatchObject({ from: rows[0].t, ce: 100, pe: -100 });
  });

  test("honours a replay cutoff and returns null without two rows", () => {
    const fw = flowWindowFromTape(rows, "2026-11-05T09:20:00+05:30");
    expect(fw?.as_of).toBe(rows[1].t);
    expect(fw?.["5m"]).toMatchObject({ ce: 100, pe: -100 });
    expect(flowWindowFromTape([{ t: rows[0].t, ce_oi: 1, pe_oi: 1 }])).toBeNull();
  });

  test("sorts unsorted tape and rejects a leg with a missing OI side", () => {
    expect(flowWindowFromTape([...rows].reverse())).toEqual(flowWindowFromTape(rows));
    expect(
      flowWindowFromTape([
        { t: rows[0].t, ce_oi: 1000 },
        { t: rows[1].t, ce_oi: 1100 },
      ]),
    ).toBeNull();
  });

  test("two rows at the same timestamp do not throw and pick the later sorted row", () => {
    const dup = "2026-11-05T09:20:00+05:30";
    let fw: ReturnType<typeof flowWindowFromTape>;
    expect(() => {
      fw = flowWindowFromTape([
        { t: dup, ce_oi: 1000, pe_oi: 1000 },
        { t: dup, ce_oi: 1100, pe_oi: 900 },
      ]);
    }).not.toThrow();
    expect(fw).not.toBeNull();
    expect(fw?.as_of).toBe(dup);
    for (const key of ["5m", "15m"] as const) {
      const leg = fw?.[key];
      expect(leg).toBeDefined();
      expect(Number.isFinite(leg?.ce)).toBe(true);
      expect(Number.isFinite(leg?.pe)).toBe(true);
      expect(Number.isFinite(leg?.net)).toBe(true);
    }
    expect(fw?.["5m"]).toMatchObject({ from: dup, ce: 100, pe: -100, net: 200 });
    expect(fw?.["15m"]).toMatchObject({ from: dup, ce: 100, pe: -100, net: 200 });
  });

  test("a cutoff before the first row returns null", () => {
    expect(flowWindowFromTape(rows, "2026-11-05T09:00:00+05:30")).toBeNull();
  });
});

describe("sessionTone", () => {
  test("session tone maps premium flow verdicts", () => {
    expect(sessionTone("call_buyers")).toBe("bull");
    expect(sessionTone("put_writers")).toBe("bull");
    expect(sessionTone("call_writers")).toBe("bear");
    expect(sessionTone("put_buyers")).toBe("bear");
    expect(sessionTone("balanced")).toBe("flat");
  });
});

describe("formatting", () => {
  test("compact signed OI and crore flow", () => {
    expect(fmtFlowOi(-952_185)).toBe("−952K");
    expect(fmtFlowOi(3_316_105)).toBe("+3.3M");
    expect(fmtFlowCr(2656.63)).toBe("+₹2,657cr");
    expect(fmtFlowCr(-98)).toBe("−₹98cr");
  });
});

describe("detectFlipChange", () => {
  const leg = (net: number) => ({ from: "", ce: net, pe: 0, net });

  test("the first observation seeds the watcher and never fires", () => {
    const out = detectFlipChange(null, leg(5), null, "flat", "2026-11-04T11:28:00+05:30");
    expect(out.flip).toBeNull();
    expect(out.state).toEqual({ sign: 1, flipped: false });
  });

  test("a 5m net sign change records the poll time", () => {
    const out = detectFlipChange(
      { sign: 1, flipped: false },
      leg(-2),
      null,
      "flat",
      "2026-11-04T11:28:00+05:30",
    );
    expect(out.flip).toEqual({ at: "2026-11-04T11:28:00+05:30", reason: "5m net turned PUT-led" });
    expect(out.state).toEqual({ sign: -1, flipped: false });
  });

  test("a new 5m-vs-15m disagreement records the disagreement reason", () => {
    const out = detectFlipChange(
      { sign: 1, flipped: false },
      leg(1),
      leg(-1),
      "bull",
      "2026-11-04T11:28:00+05:30",
    );
    expect(out.flip?.reason).toBe("5m vs 15m");
  });

  test("no sign change and no new disagreement stays silent", () => {
    expect(
      detectFlipChange({ sign: 1, flipped: false }, leg(1), leg(1), "bull", "2026-11-04T11:28:00+05:30")
        .flip,
    ).toBeNull();
  });
});

describe("flip persistence", () => {
  afterEach(() => window.localStorage.clear());

  test("keeps a flip for 30 minutes, then drops it", () => {
    const key = flipStorageKey("NIFTY", "live", "2026-11-04");
    const at = "2026-11-04T11:28:00+05:30";
    const now = Date.parse(at) + 1_000;
    saveStoredFlip(key, { at, reason: "5m vs 15m" }, now);
    expect(loadStoredFlip(key, now + 1_000)).toEqual({ at, reason: "5m vs 15m" });
    expect(loadStoredFlip(key, Date.parse(at) + FLIP_TTL_MS + 1)).toBeNull();
  });

  test("malformed storage is ignored", () => {
    const key = flipStorageKey("NIFTY", "live", "2026-11-04");
    window.localStorage.setItem(key, "not-json");
    expect(loadStoredFlip(key)).toBeNull();
  });

  test("expires a flip 31 minutes after save (mocked clock) and removes the key", () => {
    const key = flipStorageKey("NIFTY", "live", "2026-11-04");
    const at = "2026-11-04T11:28:00+05:30";
    const clock = vi.spyOn(Date, "now");
    try {
      clock.mockReturnValue(Date.parse(at));
      saveStoredFlip(key, { at, reason: "5m vs 15m" });
      expect(window.localStorage.getItem(key)).not.toBeNull();
      clock.mockReturnValue(Date.parse(at) + 31 * 60_000);
      expect(loadStoredFlip(key)).toBeNull();
      expect(window.localStorage.getItem(key)).toBeNull();
    } finally {
      clock.mockRestore();
    }
  });
});

describe("flowNoiseFor and default noise constant", () => {
  function makeStrikes(ceOi: number, peOi: number, count: number): NiftyStrike[] {
    const strikes: NiftyStrike[] = [];
    for (let i = 0; i < count; i++) {
      strikes.push({
        strike: 22_500 + i * 50,
        ce: { oi: ceOi, ltp: 0, close: 0, prevOi: 0, oiChange: 0, priceChange: 0, sentiment: "Neutral", volume: 0, delta: 0.5, gamma: 0, theta: 0, vega: 0, iv: 0 },
        pe: { oi: peOi, ltp: 0, close: 0, prevOi: 0, oiChange: 0, priceChange: 0, sentiment: "Neutral", volume: 0, delta: -0.5, gamma: 0, theta: 0, vega: 0, iv: 0 },
      });
    }
    return strikes;
  }

  test("exported FLOW_NOISE constant is 100_000 (NIFTY legacy default)", () => {
    expect(FLOW_NOISE).toBe(100_000);
    expect(FLOW_NOISE_REL).toBe(0.001);
  });

  test("default readFlow/rollingRead uses 100k threshold (NIFTY behavior preserved)", () => {
    // 50k delta should be filtered out with default 100k noise
    const result = readFlow({ ce: 50_000, pe: 0 }, 1, null, FLOW_NOISE);
    expect(result).toBeNull();

    // 100k delta should pass with default 100k noise
    const result2 = readFlow({ ce: 100_000, pe: 0 }, 1, null, FLOW_NOISE);
    expect(result2).not.toBeNull();

    // rollingRead also uses default FLOW_NOISE
    const points: OiPoint[] = [
      { t: "2026-11-05T09:15:00+05:30", ce: 1_000_000, pe: 1_000_000, cePrem: 100, pePrem: 50 },
      { t: "2026-11-05T09:16:00+05:30", ce: 1_050_000, pe: 1_000_000, cePrem: 102, pePrem: 51 }, // +50k CE
    ];
    const rolling = rollingRead(points, 1, FLOW_NOISE);
    expect(rolling).toBeNull(); // 50k < 100k noise floor

    const points2: OiPoint[] = [
      { t: "2026-11-05T09:15:00+05:30", ce: 1_000_000, pe: 1_000_000, cePrem: 100, pePrem: 50 },
      { t: "2026-11-05T09:16:00+05:30", ce: 1_100_000, pe: 1_000_000, cePrem: 102, pePrem: 51 }, // +100k CE
    ];
    const rolling2 = rollingRead(points2, 1, FLOW_NOISE);
    expect(rolling2).not.toBeNull(); // 100k >= 100k noise floor
  });

  test("flowNoiseFor uses internal 50k floor + 0.1% relative (per-symbol)", () => {
    // NIFTY: 20M total OI -> max(50k, 20M * 0.1%) = max(50k, 20k) = 50k
    // (real NIFTY totalOi ~100M would give 100k)
    const niftyStrikes = makeStrikes(2_000_000, 2_000_000, 5); // 5 * 4M = 20M
    expect(flowNoiseFor({ strikes: niftyStrikes })).toBe(50_000);

    // SENSEX: totalOi ~1.8M (chain) -> max(50k, 1.8M * 0.1%) = 50k
    // (real SENSEX tape totalOi ~170M would give 170k)
    const sensexStrikes = makeStrikes(100_000, 100_000, 9); // 9 * 200k = 1.8M
    expect(flowNoiseFor({ strikes: sensexStrikes })).toBe(50_000);

    // RELIANCE: totalOi ~0.6M (chain) -> max(50k, 0.6M * 0.1%) = 50k
    // (real RELIANCE totalOi ~50M would give 50k)
    const relianceStrikes = makeStrikes(50_000, 50_000, 6); // 6 * 100k = 0.6M
    expect(flowNoiseFor({ strikes: relianceStrikes })).toBe(50_000);

    // High totalOi triggers relative threshold
    // totalOi = 100M -> 100M * 0.1% = 100k > 50k floor
    const highOiStrikes = makeStrikes(10_000_000, 10_000_000, 5); // 5 * 20M = 100M
    expect(flowNoiseFor({ strikes: highOiStrikes })).toBe(100_000);

    // Empty strikes returns internal floor
    expect(flowNoiseFor({ strikes: [] as NiftyStrike[] })).toBe(50_000);
  });

  test("readFlow with per-symbol noise (flowNoiseFor) captures smaller moves", () => {
    // Using per-symbol noise of 50k, a 60k delta should pass
    const result = readFlow({ ce: 60_000, pe: 0 }, 1, null, 50_000);
    expect(result).not.toBeNull();

    // But 40k should still be filtered
    const result2 = readFlow({ ce: 40_000, pe: 0 }, 1, null, 50_000);
    expect(result2).toBeNull();
  });

  function makeStrikes(ceOi: number, peOi: number, count: number): NiftyStrike[] {
    const strikes: NiftyStrike[] = [];
    for (let i = 0; i < count; i++) {
      strikes.push({
        strike: 22_500 + i * 50,
        ce: { oi: ceOi, ltp: 0, close: 0, prevOi: 0, oiChange: 0, priceChange: 0, sentiment: "Neutral", volume: 0, delta: 0.5, gamma: 0, theta: 0, vega: 0, iv: 0 },
        pe: { oi: peOi, ltp: 0, close: 0, prevOi: 0, oiChange: 0, priceChange: 0, sentiment: "Neutral", volume: 0, delta: -0.5, gamma: 0, theta: 0, vega: 0, iv: 0 },
      });
    }
    return strikes;
  }
});