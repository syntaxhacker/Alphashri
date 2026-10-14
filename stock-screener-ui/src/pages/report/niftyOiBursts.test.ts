// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";
import type { NiftyTapeRow } from "@/types/niftyReport";
import {
  NIFTY_LOT_SIZE,
  OI_BURST_MIN_ABS,
  OI_BURST_TIERS,
  burstTimeLabel,
  burstToAlert,
  computeMinuteDoi,
  deriveOiSignal,
  detectOiBursts,
  sessionTrend,
  severityForScore,
} from "./niftyOiBursts";

/** "09:15" + i minutes. */
function hm(i: number): string {
  const total = 9 * 60 + 15 + i;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function tapeRow(t: string, callDoi: number, putDoi: number, spot = 22_550): NiftyTapeRow {
  return {
    t,
    spot,
    call_doi: callDoi,
    put_doi: putDoi,
    net: putDoi - callDoi,
    net_pct: 0,
    call_tick: 1_000,
    put_tick: 1_000,
    pcr_vol: 1,
    pcr_oi: 1,
    pcr_doi: 0,
    spot_flip: 0,
    max_pain: 22_550,
    flip: 22_500,
    walls: { call: 22_600, put: 22_500 },
  };
}

/** Build rows whose per-minute CALL deltas follow `deltas` (cumulative OI). */
function callSeries(deltas: number[]): NiftyTapeRow[] {
  let cum = 0;
  const rows: NiftyTapeRow[] = [tapeRow(hm(0), 0, 0)];
  deltas.forEach((d, i) => {
    cum += d;
    rows.push(tapeRow(hm(i + 1), cum, 0));
  });
  return rows;
}

function putSeries(deltas: number[]): NiftyTapeRow[] {
  let cum = 0;
  const rows: NiftyTapeRow[] = [tapeRow(hm(0), 0, 0)];
  deltas.forEach((d, i) => {
    cum += d;
    rows.push(tapeRow(hm(i + 1), 0, cum));
  });
  return rows;
}

describe("computeMinuteDoi", () => {
  test("takes the first difference of the cumulative series", () => {
    const rows = [tapeRow("09:15", 0, 0), tapeRow("09:16", 500, -200), tapeRow("09:17", 1_500, 100)];
    const s = computeMinuteDoi(rows);
    expect(s).toHaveLength(2);
    expect(s[0].t).toBe("09:16");
    expect(s[0].dCall).toBe(500);
    expect(s[0].dPut).toBe(-200);
    expect(s[1].dCall).toBe(1_000);
    expect(s[1].dPut).toBe(300);
  });

  test("sorts unsorted input and tolerates an empty/short series", () => {
    const rows = [tapeRow("09:17", 1_500, 0), tapeRow("09:15", 0, 0), tapeRow("09:16", 500, 0)];
    expect(computeMinuteDoi(rows).map((m) => m.t)).toEqual(["09:16", "09:17"]);
    expect(computeMinuteDoi([])).toEqual([]);
    expect(computeMinuteDoi([tapeRow("09:15", 0, 0)])).toEqual([]);
  });
});

describe("severityForScore", () => {
  test("maps score to the tier ladder", () => {
    expect(severityForScore(1)).toBe("info");
    expect(severityForScore(OI_BURST_TIERS.watch)).toBe("watch");
    expect(severityForScore(OI_BURST_TIERS.alert)).toBe("alert");
    expect(severityForScore(OI_BURST_TIERS.critical)).toBe("critical");
    expect(severityForScore(999)).toBe("critical");
  });
});

describe("detectOiBursts", () => {
  test("a steady tape produces no bursts", () => {
    const rows = callSeries(Array.from({ length: 20 }, () => 1_000));
    expect(detectOiBursts(rows)).toEqual([]);
  });

  test("a one-minute call spike is detected against the trailing median", () => {
    // 12 steady minutes of +1000, then a +60000 minute (~60× the median).
    const rows = callSeries([...Array.from({ length: 12 }, () => 1_000), 60_000]);
    const bursts = detectOiBursts(rows);
    expect(bursts).toHaveLength(1);
    const b = bursts[0];
    expect(b.side).toBe("call");
    expect(b.delta).toBe(60_000);
    expect(b.score).toBeGreaterThanOrEqual(OI_BURST_TIERS.critical);
    expect(b.severity).toBe("critical");
    expect(b.t).toBe(hm(13));
  });

  test("call and put bursts in the same minute are two separate events", () => {
    const rows = callSeries([...Array.from({ length: 12 }, () => 1_000), 60_000]);
    // same final minute also carries a put spike
    const spikeT = hm(13);
    const withPut = rows.map((r) => ({
      ...r,
      put_doi: r.t === spikeT ? 120_000 : 0,
    }));
    const bursts = detectOiBursts(withPut);
    expect(bursts.map((b) => b.side).sort()).toEqual(["call", "put"]);
    expect(bursts.every((b) => b.t === spikeT)).toBe(true);
  });

  test("ignores spikes below the absolute floor", () => {
    const tiny = Math.floor(OI_BURST_MIN_ABS / 2);
    const rows = callSeries([...Array.from({ length: 12 }, () => 1), tiny]);
    // score is huge but |delta| is under the floor → no alert
    expect(detectOiBursts(rows)).toEqual([]);
  });

  test("does not score before the warmup window", () => {
    // spike on the very first scored minute, with warmup=3
    const rows = callSeries([100_000, 1_000, 1_000, 1_000]);
    const bursts = detectOiBursts(rows, { warmup: 3 });
    expect(bursts.some((b) => b.t === hm(1))).toBe(false);
  });

  test("unwinding (negative delta) is detected too", () => {
    const rows = callSeries([...Array.from({ length: 12 }, () => -1_000), -80_000]);
    const bursts = detectOiBursts(rows);
    expect(bursts).toHaveLength(1);
    expect(bursts[0].delta).toBeLessThan(0);
  });

  test("empty rows never throw", () => {
    expect(detectOiBursts([])).toEqual([]);
  });
});

describe("burstToAlert", () => {
  test("maps to the shared MarketAlert shape", () => {
    const rows = callSeries([...Array.from({ length: 12 }, () => 1_000), 60_000]);
    const b = detectOiBursts(rows)[0];
    const a = burstToAlert(b);
    expect(a.kind).toBe("oi_burst");
    expect(a.severity).toBe("critical");
    expect(a.symbol).toBe("NIFTY");
    expect(a.title).toContain("Call OI burst");
    expect(a.title).toContain("+60.0K");
    expect(a.metrics?.find((m) => m.label === "ΔOI")?.value).toBe("+60.0K");
    expect(a.source).toContain("Nifty tape");
    expect(a.href).toBe("/report/nifty");
  });

  test("put side labels correctly and signs the tone down when negative", () => {
    const rows = callSeries([...Array.from({ length: 12 }, () => 1_000), 60_000]);
    const b = detectOiBursts(rows)[0];
    const signal = deriveOiSignal(b, [{ strike: 22_700, ce: { ltp: 22 }, pe: { ltp: 28 } }], 22_720)!;
    const a = burstToAlert(b, signal);
    expect(a.title).toContain("BUY PE 22,700");
    expect(a.title).toContain("qty");
    expect(a.metrics?.find((m) => m.label === "ENTRY")?.value).toBe("28.00");
    expect(a.metrics?.find((m) => m.label === "TGT")?.value).toBe("42.00");
    expect(a.metrics?.find((m) => m.label === "SL")?.value).toBe("21.00");
    expect(a.detail).toContain("not advice");
    expect(a.source).toContain("mechanical plan");
  });

  test("with a signal the title leads with the trade plan and metrics carry it", () => {
    const rows = putSeries([...Array.from({ length: 12 }, () => -1_000), -50_000]);
    const a = burstToAlert(detectOiBursts(rows)[0]);
    expect(a.title).toContain("Put OI burst");
    expect(a.title).toContain("-50.0K");
    expect(a.metrics?.find((m) => m.label === "ΔOI")?.tone).toBe("down");
  });
});

describe("burst news tagging", () => {
  test("the nearest headline is appended to the detail and its source", () => {
    const rows = callSeries([...Array.from({ length: 12 }, () => 1_000), 60_000]);
    const b = {
      ...detectOiBursts(rows)[0],
      news: [
        {
          heading: "FM Sitharaman open to LTCG tax rethink",
          link: "https://upstox.com/news/a/",
          source: "upstox",
          minutesAway: -1,
        },
      ],
    };
    const a = burstToAlert(b, null);
    expect(a.detail).toContain("NEWS -1m: FM Sitharaman open to LTCG tax rethink");
    expect(a.source).toContain("upstox");
  });

  test("a positive offset is signed +Nm", () => {
    const rows = callSeries([...Array.from({ length: 12 }, () => 1_000), 60_000]);
    const b = {
      ...detectOiBursts(rows)[0],
      news: [{ heading: "IT stocks lead rally", link: "", source: "", minutesAway: 4 }],
    };
    expect(burstToAlert(b, null).detail).toContain("NEWS +4m: IT stocks lead rally");
  });

  test("no news leaves the detail clean", () => {
    const rows = callSeries([...Array.from({ length: 12 }, () => 1_000), 60_000]);
    const a = burstToAlert(detectOiBursts(rows)[0], null);
    expect(a.detail).not.toContain("NEWS");
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

describe("burstTimeLabel", () => {
  test("strips ISO and passes HH:MM through", () => {
    expect(burstTimeLabel("2026-10-13T14:03:00+05:30")).toBe("14:03");
    expect(burstTimeLabel("14:03")).toBe("14:03");
    expect(burstTimeLabel("")).toBe("--:--");
  });
});

describe("sessionTrend", () => {
  const row = (t: string, spot: number): NiftyTapeRow =>
    ({ ...tapeRow(t, 0, 0), spot });

  test("rising tape is 'up', falling is 'down'", () => {
    expect(sessionTrend([row("09:15", 100), row("09:16", 110), row("09:17", 120), row("09:18", 130)])).toBe("up");
    expect(sessionTrend([row("09:15", 130), row("09:16", 120), row("09:17", 110), row("09:18", 100)])).toBe("down");
  });

  test("needs at least two usable points", () => {
    expect(sessionTrend([])).toBeNull();
    expect(sessionTrend([row("09:15", 100)])).toBeNull();
  });

  test("atTime only uses data up to that minute", () => {
    const rows = [row("09:15", 100), row("09:16", 101), row("09:17", 102), row("09:18", 103), row("09:19", 60)];
    expect(sessionTrend(rows, "09:18")).toBe("up");
    expect(sessionTrend(rows)).toBe("down");
  });

  test("unsorted input is handled", () => {
    const rows = [row("09:17", 120), row("09:15", 100), row("09:16", 110)];
    expect(sessionTrend(rows)).toBe("up");
  });

  test("zero/invalid spots are ignored", () => {
    expect(sessionTrend([])).toBeNull();
    expect(sessionTrend([row("09:15", 0), row("09:16", 0)])).toBeNull();
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

  test("counter-trend plan is flagged and says skip", () => {
    const s = deriveOiSignal(burst("call", -50_000), chain, 22_720, { trend: "down" })!;
    expect(s.aligned).toBe(false);
    expect(s.basis).toMatch(/^COUNTER-TREND \(session down\) — skip:/);
  });

  test("no trend leaves the plan ungated", () => {
    const s = deriveOiSignal(burst("put", 50_000), chain, 22_720)!;
    expect(s.aligned).toBeNull();
    expect(s.trend).toBeNull();
  });

  test("counter-trend plans are marked in the alert detail", () => {
    const b = { ...burst("call", -50_000), trend: "down" as const };
    const signal = deriveOiSignal(b, chain, 22_720, { trend: b.trend });
    const a = burstToAlert(b, signal);
    expect(a.detail).toContain("COUNTER-TREND · skip");
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
  });

  test("put squeeze buys PE", () => {
    const s = deriveOiSignal(squeeze("put", -9_000_000, 22_500), chain, 22_480, {})!;
    expect(s.leg).toBe("PE");
    expect(s.aligned).toBe(true);
  });

  test("a plain burst is still a fade (unchanged)", () => {
    const b = { ...squeeze("call", 60_000, 22_600) };
    delete (b as { type?: unknown }).type;
    const s = deriveOiSignal(b, chain, 22_610, { trend: "up" })!;
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
    const s = deriveOiSignal(b, chain, 22_720, { trend: "up" })!;
    expect(s.strike).toBe(22_750);   // not 22,700, which is nearer to spot
  });

  test("falls back to nearest-to-spot when the named strike is not in the chain", () => {
    const b = { id: "s", side: "call" as const, t: "14:33", delta: 6_300_000,
      baseline: 300_000, score: 18.9, severity: "critical" as const, cumDoi: 0,
      spot: 22_720, tickVol: 0, type: "strike" as const, strike: 99_999 };
    const s = deriveOiSignal(b, chain, 22_720, { trend: "up" })!;
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
