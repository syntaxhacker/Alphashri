// @vitest-environment happy-dom

import { describe, expect, test } from "vitest";
import type { NiftyTapeRow } from "@/types/niftyReport";
import type { OiBurst } from "./niftyOiBursts";
import { clockLabel } from "./tapeRange";
import {
  OI_BURST_MIN_ABS,
  OI_BURST_TIERS,
  atmPremiumChange,
  burstTimeLabel,
  computeMinuteDoi,
  detectOiBursts,
  dropConflictingSides,
  premiumChangeBefore,
  sessionTrend,
  spotMinutesBefore,
} from "./niftyOiBursts";
import { callSeries, hm, tapeRow } from "./niftyOiBursts.fixtures";

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

describe("burstTimeLabel", () => {
  test("strips ISO and passes HH:MM through", () => {
    expect(burstTimeLabel("2026-10-13T14:03:00+05:30")).toBe("14:03");
    expect(burstTimeLabel("14:03")).toBe("14:03");
    expect(burstTimeLabel("")).toBe("--:--");
  });

  test("delegates to the shared tape clock label for every stamp shape", () => {
    const stamps = [
      "2026-10-13T14:03:00+05:30",
      "14:03",
      "14:03:22",
      "2026-10-13T",
      "nope",
      "",
    ];
    for (const stamp of stamps) expect(burstTimeLabel(stamp)).toBe(clockLabel(stamp));
  });
});

describe("two-sided writer pin", () => {
  const burst = (over: Partial<OiBurst>): OiBurst => ({
    id: "b",
    t: "2026-10-29T09:19:00+05:30",
    side: "call",
    delta: 3_600_000,
    baseline: 100_000,
    score: 10,
    severity: "critical",
    cumDoi: 3_600_000,
    spot: 22_720,
    tickVol: 1_000_000,
    flow: "writers",
    strike: 22_700,
    ...over,
  });

  test("drops both sides when call and put writers add in the same minute", () => {
    const call = burst({ id: "call", side: "call", delta: 3_600_000 });
    const put = burst({ id: "put", side: "put", delta: 2_200_000 });
    expect(dropConflictingSides([call, put])).toEqual([]);
  });

  test("keeps one representative for same-leg bursts in the same minute", () => {
    const a = burst({ id: "a", side: "call", delta: 3_600_000 });
    const b = burst({ id: "b", side: "call", delta: 1_000_000 });
    expect(dropConflictingSides([a, b]).map((x) => x.id)).toEqual(["a"]);
  });

  test("prefers the highest severity/score, then an actionable plan", () => {
    const watch = burst({ id: "watch", score: 3, severity: "watch" });
    const critical = burst({ id: "critical", score: 12, severity: "critical" });
    expect(dropConflictingSides([watch, critical]).map((x) => x.id)).toEqual(["critical"]);

    const signal = {
      leg: "PE" as const,
      strike: 84_400,
      entry: 198,
      sl: 148.5,
      target: 297,
      qty: 100,
      lots: 1,
      basis: "backend",
    };
    const suppressed = burst({ id: "suppressed", plan_suppressed: true });
    const actionable = burst({ id: "actionable", signal });
    expect(dropConflictingSides([suppressed, actionable]).map((x) => x.id)).toEqual([
      "actionable",
    ]);
    // A backend leg that contradicts the flow reading is re-derived by the
    // alert builder, so it is not the plan the row will show.
    const mismatched = burst({ id: "mismatched", signal: { ...signal, leg: "CE" } });
    expect(dropConflictingSides([mismatched, actionable]).map((x) => x.id)).toEqual([
      "actionable",
    ]);
  });

  test("collapses duplicate backend plans that resolve to the same leg", () => {
    const signal = {
      leg: "PE" as const,
      strike: 84_400,
      entry: 198,
      sl: 148.5,
      target: 297,
      qty: 100,
      lots: 1,
      basis: "backend",
    };
    const a = burst({
      id: "a",
      t: "2026-11-26T12:05:00+05:30",
      delta: 3_600_000,
      bearish: true,
      signal,
    });
    const b = burst({
      id: "b",
      t: "2026-11-26T12:05:00+05:30",
      side: "put",
      delta: 2_200_000,
      bearish: true,
      signal,
    });
    expect(dropConflictingSides([a, b]).map((x) => x.id)).toEqual(["a"]);
  });

  test("same-leg bursts in different minutes stay independent", () => {
    const a = burst({ id: "a", t: "2026-11-26T12:05:00+05:30" });
    const b = burst({ id: "b", t: "2026-11-26T12:06:00+05:30" });
    expect(dropConflictingSides([a, b]).map((x) => x.id)).toEqual(["a", "b"]);
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

describe("withheld-plan evidence shape", () => {
  test("a burst carries unconfirmed flow and same-strike evidence, never a plan", () => {
    const b: OiBurst = {
      id: "b-unconfirmed",
      side: "call",
      t: "2026-11-26T12:05:00+05:30",
      delta: -2_400_000,
      baseline: 100_000,
      score: 14.2,
      severity: "critical",
      cumDoi: -2_400_000,
      spot: 24_310,
      tickVol: 900_000,
      flow: "unconfirmed",
      plan_suppressed: true,
      confirmation: {
        same_strike: false,
        strike_oi_delta: -30_000,
        strike_premium_change: -4.25,
        spot_change: -18.4,
        reasons: ["no same-strike agreement"],
      },
    };
    expect(b.flow).toBe("unconfirmed");
    expect(b.confirmation?.same_strike).toBe(false);
    expect(b.confirmation?.strike_oi_delta).toBe(-30_000);
    expect(b.confirmation?.strike_premium_change).toBe(-4.25);
    expect(b.confirmation?.spot_change).toBe(-18.4);
    expect(b.confirmation?.reasons).toEqual(["no same-strike agreement"]);
    expect(b.signal ?? null).toBeNull();
  });
});
