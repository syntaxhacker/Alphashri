// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";
import type { NiftyTapeRow } from "@/types/niftyReport";
import {
  OI_BURST_MIN_ABS,
  OI_BURST_TIERS,
  burstTimeLabel,
  burstToAlert,
  computeMinuteDoi,
  deriveOiSignal,
  detectOiBursts,
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
    // entry 28, sl 21 → risk/unit 7 → 714 units → 9 lots × 75
    expect(s.lots).toBe(9);
    expect(s.qty).toBe(675);
    expect(s.qty % 75).toBe(0);
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
