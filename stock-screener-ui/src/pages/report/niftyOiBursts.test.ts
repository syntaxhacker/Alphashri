// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";
import type { NiftyTapeRow } from "@/types/niftyReport";
import type { OiBurst, OiSignal } from "./niftyOiBursts";
import {
  NIFTY_LOT_SIZE,
  OI_BURST_MIN_ABS,
  OI_BURST_TIERS,
  atmPremiumChange,
  burstTimeLabel,
  burstToAlert,
  computeMinuteDoi,
  criticalBannerText,
  deriveOiSignal,
  detectOiBursts,
  entryFreshness,
  inferFlowFromPremium,
  premiumChangeBefore,
  resolveFuelState,
  resolveOiDirection,
  sessionTrend,
  severityForScore,
  sortAlertsCriticalFirst,
  spotMinutesBefore,
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

describe("critical prominence helpers", () => {
  const alert = (id: string, severity: "critical" | "watch" | "alert" | "info") => ({
    id,
    kind: "oi_burst" as const,
    severity,
    symbol: "NIFTY",
    title: `burst ${id}`,
    detail: "",
    metrics: [],
    ts: Date.parse(`2026-10-21T09:${id.slice(-2)}:00+05:30`) || 0,
    source: "",
    href: "/report/nifty",
  });

  test("critical-first sort keeps newest-first within each group", () => {
    const rows = [alert("a-15", "watch"), alert("b-16", "critical"), alert("c-17", "alert"), alert("d-18", "critical")];
    const sorted = sortAlertsCriticalFirst(rows);
    expect(sorted.map((r) => r.id)).toEqual(["b-16", "d-18", "a-15", "c-17"]);
  });

  test("a trail without criticals is returned unchanged", () => {
    const rows = [alert("a-15", "watch"), alert("c-17", "alert")];
    expect(sortAlertsCriticalFirst(rows).map((r) => r.id)).toEqual(["a-15", "c-17"]);
  });

  test("banner text leads with side/unwind, spot, then the trade plan", () => {
    const chain = [{ strike: 22_700, ce: { ltp: 185 }, pe: { ltp: 140 } }];
    const b = { id: "x", side: "put" as const, t: "15:04", delta: -1_480_000,
      baseline: 100_000, score: 14.8, severity: "critical" as const, cumDoi: 0,
      spot: 22_701, tickVol: 5_000 };
    const signal = deriveOiSignal(b, chain, 22_701, {})!;
    const text = criticalBannerText(b, burstToAlert(b, signal));
    expect(text).toContain("CRITICAL PUT UNWIND");
    expect(text).toContain("-1.48M");
    expect(text).toContain("22,701");
    expect(text).toContain(`BUY ${signal.leg} 22,700`);
    expect(text).toContain(`entry ${signal.entry}`);
    expect(text).toContain(`SL ${signal.sl}`);
    expect(text).toContain(`TGT ${signal.target}`);
  });

  test("banner without a signal still names the unwind", () => {
    const b = { id: "x", side: "call" as const, t: "15:04", delta: -900_000,
      baseline: 100_000, score: 9, severity: "critical" as const, cumDoi: 0,
      spot: 22_701, tickVol: 0 };
    const text = criticalBannerText(b, burstToAlert(b, null));
    expect(text).toContain("CRITICAL CALL UNWIND");
    expect(text).toContain("22,701");
  });

  test("banner without a burst falls back to the alert title", () => {
    const a = { ...alert("z-99", "critical"), title: "→ BUY PE 22,700 · qty 130" };
    expect(criticalBannerText(undefined, a)).toContain("BUY PE 22,700");
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

describe("tape context helpers (5m trend + premium change)", () => {
  test("atmPremiumChange mirrors the backend guards", () => {
    const prev = { strike: 22_700, ce: 100, pe: 140 };
    expect(atmPremiumChange(prev, { strike: 22_700, ce: 110, pe: 140 }, "call")).toBe(10);
    expect(atmPremiumChange(prev, { strike: 22_700, ce: 100, pe: 130 }, "put")).toBe(-10);
    // ATM strike rolled → strike artefact, not a trade
    expect(atmPremiumChange(prev, { strike: 22_750, ce: 110, pe: 140 }, "call")).toBeNull();
    // non-positive premiums are incomparable
    expect(atmPremiumChange({ strike: 22_700, ce: 0, pe: 140 }, { strike: 22_700, ce: 110, pe: 140 }, "call")).toBeNull();
    expect(atmPremiumChange(null, { strike: 22_700, ce: 110, pe: 140 }, "call")).toBeNull();
    expect(atmPremiumChange(prev, null, "call")).toBeNull();
  });

  test("spotMinutesBefore tolerates gaps and returns null when blind", () => {
    const spots = new Map([
      ["15:04", 22_701],
      ["14:59", 22_662],
      ["14:50", 22_600],
    ]);
    expect(spotMinutesBefore(spots, "15:04", 5)).toBe(22_662);
    // 14:58/14:57 missing → walks back to 14:50 within tolerance
    expect(spotMinutesBefore(spots, "14:55", 5)).toBe(22_600);
    // nothing within the window → null, never a guess
    expect(spotMinutesBefore(spots, "09:20", 5)).toBeNull();
    expect(spotMinutesBefore(spots, "nope", 5)).toBeNull();
  });

  test("premiumChangeBefore reads the nearest earlier minute", () => {
    const prems = new Map([
      ["15:04", { strike: 22_700, ce: 100, pe: 150 }],
      ["15:03", { strike: 22_700, ce: 100, pe: 140 }],
    ]);
    expect(premiumChangeBefore(prems, "15:04", "put")).toBe(10);
    expect(premiumChangeBefore(prems, "15:04", "call")).toBe(0);
    expect(premiumChangeBefore(prems, "15:03", "put")).toBeNull();
  });
});

/**
 * 2026-10-22 regressions — the two alerts that looked identical on the tape
 * and traded in opposite directions.
 *
 *  11:13  CALL UNWIND −162.5K, CE premium +5.90, spot at the DAY HIGH
 *         22,779 → "BUY CE 22,700 · ENTRY 179.25". The market topped
 *         22,780.35 two minutes later and fell 160 pts.
 *  11:44  PUT UNWIND −94.9K, PE premium +6.85, spot CLOSED BELOW the
 *         22,697 pivot → "BUY PE 22,700 · ENTRY 150.20". The market fell
 *         another 60 pts.
 *
 * Both were the same 2×2 cell (unwind + premium up = writers covering). The
 * differences the UI must now expose: the FUEL state, the LOCATION, and
 * whether the plan is still priced at the market.
 */
describe("2026-10-22 fuel-state alerts", () => {
  const chain = [
    { strike: 22_700, ce: { ltp: 220.3 }, pe: { ltp: 151.85 } },
  ];

  test("a covering burst says the fuel is spent and names the location", () => {
    const burst: OiBurst = {
      id: "2026-10-22T11:13:00+05:30-call",
      side: "call",
      t: "2026-10-22T11:13:00+05:30",
      delta: -162_500,
      baseline: 20_000,
      score: 8.1,
      severity: "critical",
      cumDoi: -1_861_275,
      spot: 22_779.6,
      tickVol: 49_583_495,
      flow: "covering",
    };
    const a = burstToAlert(burst);
    expect(a.title).toContain("Call OI burst");
    expect(a.detail).toContain("WRITERS COVERING");
    expect(a.detail).toContain("@ 22,780");
    expect(a.metrics?.find((m) => m.label === "FUEL")?.value).toBe("spent");
  });

  test("a plan priced off a stale chain is marked RE-PRICE, not actionable", () => {
    const burst: OiBurst = {
      id: "2026-10-22T11:13:00+05:30-call",
      side: "call",
      t: "2026-10-22T11:13:00+05:30",
      delta: -162_500,
      baseline: 20_000,
      score: 8.1,
      severity: "critical",
      cumDoi: -1_861_275,
      spot: 22_779.6,
      tickVol: 49_583_495,
      flow: "covering",
    };
    const signal: OiSignal = {
      leg: "CE",
      strike: 22_700,
      entry: 179.25,
      sl: 134.44,
      target: 268.88,
      qty: 65,
      lots: 1,
      basis: "call OI unwind — writers covering → upside fuel → buy calls",
    };
    const a = burstToAlert(burst, signal, { freshness: entryFreshness(signal, chain) });
    expect(a.title).toContain("RE-PRICE");
    expect(a.title).toContain("220.30");
    expect(a.detail).toContain("re-price before trading");
    expect((a as { actionable?: boolean }).actionable).toBe(false);
  });

  test("a covering burst whose structure contradicts the leg carries no plan", () => {
    const burst: OiBurst = {
      id: "2026-10-22T11:13:00+05:30-call",
      side: "call",
      t: "2026-10-22T11:13:00+05:30",
      delta: -162_500,
      baseline: 20_000,
      score: 8.1,
      severity: "critical",
      cumDoi: -1_861_275,
      spot: 22_779.6,
      tickVol: 49_583_495,
      flow: "covering",
      // the underlying closed DOWN through 22,697 — a call plan is the wrong side
      structure: { level: 22_697, direction: "down", kind: "pivot" },
    };
    expect(deriveOiSignal(burst, chain, 22_779.6, {})).toBeNull();
    const a = burstToAlert(burst, null);
    expect(a.title).toContain("NO TRADE");
    expect((a as { actionable?: boolean }).actionable).toBe(false);
  });

  test("a covering burst with a structure break in the same direction keeps its plan", () => {
    const burst: OiBurst = {
      id: "2026-10-22T11:44:00+05:30-put",
      side: "put",
      t: "2026-10-22T11:44:00+05:30",
      delta: -94_900,
      baseline: 20_000,
      score: 4.7,
      severity: "alert",
      cumDoi: -886_535,
      spot: 22_687.95,
      tickVol: 68_325_660,
      flow: "covering",
      structure: { level: 22_697, direction: "down", kind: "pivot", close: 22_687.95 },
      invalidation: 22_697,
    };
    // The backend attaches the plan (leg PE — the put side's own direction);
    // the client renders it with the structure and the invalidation.
    const signal: OiSignal = {
      leg: "PE",
      strike: 22_700,
      entry: 150.2,
      sl: 112.65,
      target: 225.3,
      qty: 130,
      lots: 2,
      basis: "put OI unwind + covering — shorts bought back → downside fuel → buy puts",
    };
    const a = burstToAlert(burst, signal);
    expect(a.title).toContain("BUY PE 22,700");
    expect(a.detail).toContain("below the 22,697 pivot");
    expect(a.detail).toContain("while spot stays below 22,697");
    expect(a.detail).toContain("WRITERS COVERING");
    expect((a as { actionable?: boolean }).actionable).toBeUndefined();
  });

  test("entryFreshness flags a plan the market has run away from", () => {
    const fresh = entryFreshness({ leg: "PE", strike: 22_700, entry: 150.2 }, chain);
    expect(fresh.stale).toBe(false);
    expect(fresh.live).toBe(151.85);
    const stale = entryFreshness({ leg: "CE", strike: 22_700, entry: 179.25 }, chain);
    expect(stale.stale).toBe(true);
    expect(stale.driftPct).toBeGreaterThan(20);
  });

  test("the backend's fuel_state is authoritative over the client's guess", () => {
    const burst: OiBurst = {
      id: "b1", side: "call", t: "2026-10-22T11:13:00+05:30",
      delta: -162_500, baseline: 20_000, score: 8.1, severity: "critical",
      cumDoi: -1_861_275, spot: 22_779.6, tickVol: 49_583_495,
      // The client would read the ATM premium as "covering" — the backend
      // knows the same-strike premium and says the fuel was spent.
      flow: "covering",
      fuel_state: "writers_covering",
    };
    expect(resolveFuelState(burst)).toBe("writers_covering");
    const a = burstToAlert(burst);
    expect(a.detail).toContain("WRITERS COVERING");
  });

  test("a backend-suppressed burst renders NO TRADE and is not actionable", () => {
    const burst: OiBurst = {
      id: "b2", side: "call", t: "2026-10-22T11:13:00+05:30",
      delta: -162_500, baseline: 20_000, score: 8.1, severity: "critical",
      cumDoi: -1_861_275, spot: 22_779.6, tickVol: 49_583_495,
      fuel_state: "writers_covering",
      plan_suppressed: true,
    };
    // The client must not re-derive a plan the backend withheld.
    expect(deriveOiSignal(burst, chain, 22_779.6, {})).toBeNull();
    const a = burstToAlert(burst, null);
    expect(a.title).toContain("NO TRADE");
    expect((a as { actionable?: boolean }).actionable).toBe(false);
  });

  test("the invalidation level is printed even without a plan", () => {
    const burst: OiBurst = {
      id: "b3", side: "put", t: "2026-10-22T11:44:00+05:30",
      delta: -94_900, baseline: 20_000, score: 4.7, severity: "alert",
      cumDoi: -886_535, spot: 22_687.95, tickVol: 68_325_660,
      fuel_state: "writers_covering",
      structure: { level: 22_697, direction: "down", kind: "pivot" },
      invalidation: 22_697,
    };
    const a = burstToAlert(burst, null);
    expect(a.detail).toContain("while spot stays below 22,697");
  });
});
